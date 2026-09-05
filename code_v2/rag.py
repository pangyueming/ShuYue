"""RAG layer: page chunks + FTS5 trigram + DashScope embeddings + hybrid retrieval.

Chunk/embedding state lives in the main cognibridge.db (tables doc_chunks,
chunks_fts, doc_embeddings). Retrieval fuses BM25 (trigram FTS, LIKE fallback
for short Chinese/English tokens) with cosine similarity via RRF.
"""
from __future__ import annotations

import json
import re
import sqlite3
import struct
import time
from pathlib import Path

import requests

DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
EMBED_MODEL = "text-embedding-v4"
EMBED_DIM = 1024
EMBED_BATCH = 10
PARA_BREAK = "\n\n"
RRF_K = 60

FTS_AVAILABLE = True  # resolved by ensure_rag_schema


def ensure_rag_schema(conn: sqlite3.Connection) -> bool:
    """Create RAG tables; returns FTS availability (SQLite <3.34 lacks trigram)."""
    global FTS_AVAILABLE
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS doc_chunks(
            id INTEGER PRIMARY KEY,
            doc_id TEXT NOT NULL,
            page INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            text TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS doc_embeddings(
            chunk_id INTEGER PRIMARY KEY,
            doc_id TEXT NOT NULL,
            dim INTEGER NOT NULL,
            vec BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_doc_chunks ON doc_chunks(doc_id, page);
        """
    )
    try:
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize='trigram')")
        FTS_AVAILABLE = True
    except sqlite3.OperationalError:
        FTS_AVAILABLE = False
    conn.commit()
    return FTS_AVAILABLE


def make_chunks(pages: list[dict], chunk_size: int = 600) -> list[tuple[int, str]]:
    """[(page_number, text)]; chunks never span pages."""
    chunks: list[tuple[int, str]] = []
    for record in pages:
        page = record["page"]
        paragraphs = [p.strip() for p in record["text"].split(PARA_BREAK) if p.strip()]
        buffer = ""
        for para in paragraphs:
            if len(buffer) + len(para) + 2 <= chunk_size:
                buffer = (buffer + PARA_BREAK + para) if buffer else para
                continue
            if buffer:
                chunks.append((page, buffer))
                buffer = ""
            while len(para) > chunk_size:
                chunks.append((page, para[:chunk_size]))
                para = para[chunk_size:]
            buffer = para
        if buffer:
            chunks.append((page, buffer))
    return chunks


def rebuild_doc(conn: sqlite3.Connection, doc_id: str, chunks: list[tuple[int, str]]) -> list[int]:
    """Replace chunks for one doc (stale rows purged); returns chunk ids in order."""
    conn.execute("DELETE FROM doc_chunks WHERE doc_id=?", (doc_id,))
    conn.execute("DELETE FROM doc_embeddings WHERE doc_id=?", (doc_id,))
    if FTS_AVAILABLE:
        stale = [
            row[0]
            for row in conn.execute(
                "SELECT f.rowid FROM chunks_fts f LEFT JOIN doc_chunks c ON c.id=f.rowid WHERE c.id IS NULL"
            )
        ]
        for row_id in stale:
            conn.execute("DELETE FROM chunks_fts WHERE rowid=?", (row_id,))
    conn.commit()
    conn.executemany(
        "INSERT INTO doc_chunks(doc_id,page,seq,text) VALUES (?,?,?,?)",
        [(doc_id, page, seq, text) for seq, (page, text) in enumerate(chunks)],
    )
    ids = [row[0] for row in conn.execute("SELECT id FROM doc_chunks WHERE doc_id=? ORDER BY id", (doc_id,))]
    if FTS_AVAILABLE:
        conn.executemany(
            "INSERT INTO chunks_fts(rowid, text) VALUES (?,?)",
            [(ids[i], chunks[i][1]) for i in range(len(chunks))],
        )
    conn.commit()
    return ids


def store_embeddings(conn: sqlite3.Connection, doc_id: str, chunk_ids: list[int], vectors: list[list[float]]) -> None:
    dim = len(vectors[0]) if vectors else 0
    conn.executemany(
        "INSERT OR REPLACE INTO doc_embeddings(chunk_id,doc_id,dim,vec) VALUES (?,?,?,?)",
        [
            (chunk_ids[i], doc_id, dim, struct.pack(f"<{dim}f", *vectors[i]))
            for i in range(len(vectors))
        ],
    )
    conn.commit()


def embed_texts(texts: list[str], api_key: str) -> list[list[float]]:
    """Batch-embed via DashScope compatible-mode. Raises RuntimeError on final failure."""
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start : start + EMBED_BATCH]
        last_err = None
        for attempt in range(4):
            try:
                resp = requests.post(
                    f"{DASHSCOPE_BASE}/embeddings",
                    headers=headers,
                    json={"model": EMBED_MODEL, "input": batch, "dimensions": EMBED_DIM, "encoding_format": "float"},
                    timeout=60,
                )
                body = resp.json()
                if resp.status_code == 200:
                    vectors.extend(item["embedding"] for item in body["data"])
                    last_err = None
                    break
                last_err = f"HTTP {resp.status_code}: {json.dumps(body, ensure_ascii=False)[:200]}"
            except Exception as exc:  # noqa: BLE001
                last_err = repr(exc)
            time.sleep(2 * (attempt + 1))
        if last_err:
            raise RuntimeError(f"embedding batch {start // EMBED_BATCH} failed: {last_err}")
        time.sleep(0.3)
    return vectors


def _cosine(a: list[float], b) -> float:
    num = 0.0
    da = 0.0
    db = 0.0
    for x, y in zip(a, b):
        num += x * y
        da += x * x
        db += y * y
    return num / ((da * db) ** 0.5) if da and db else 0.0


def _fts_candidates(conn: sqlite3.Connection, doc_id: str, question: str) -> list[int]:
    tokens = [t for t in re.split(r"[\s，。？！、；：''""（）]+", question) if t]
    scores: dict[int, float] = {}
    if FTS_AVAILABLE:
        for token in (t for t in tokens if len(t) >= 3):
            try:
                rows = conn.execute(
                    "SELECT f.rowid, bm25(chunks_fts) FROM chunks_fts f "
                    "JOIN doc_chunks c ON c.id=f.rowid WHERE chunks_fts MATCH ? AND c.doc_id=?",
                    (f'"{token}"', doc_id),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []
            best: dict[int, float] = {}
            for row_id, score in rows:
                if score is not None:
                    best[row_id] = min(best.get(row_id, 0.0), score)
            for row_id, score in best.items():
                scores[row_id] = scores.get(row_id, 0.0) - score
    for token in tokens:
        if len(token) < 3 or not FTS_AVAILABLE:
            for (row_id,) in conn.execute(
                "SELECT id FROM doc_chunks WHERE doc_id=? AND text LIKE ?", (doc_id, f"%{token}%")
            ):
                scores[row_id] = scores.get(row_id, 0.0) + 1.0
    return [row_id for row_id, _ in sorted(scores.items(), key=lambda kv: -kv[1])]


def retrieve(conn: sqlite3.Connection, doc_id: str, question: str, api_key: str, topk: int = 8) -> list[dict]:
    rows = conn.execute(
        "SELECT id, page, text FROM doc_chunks WHERE doc_id=? ORDER BY id", (doc_id,)
    ).fetchall()
    if not rows:
        return []
    by_id = {row[0]: {"id": row[0], "page": row[1], "text": row[2]} for row in rows}

    emb_rows = conn.execute(
        "SELECT chunk_id, dim, vec FROM doc_embeddings WHERE doc_id=?", (doc_id,)
    ).fetchall()
    if not emb_rows:
        return []
    vec_by_id = {row[0]: struct.unpack(f"<{row[1]}f", row[2]) for row in emb_rows}
    qvec = embed_texts([question], api_key)[0]

    dense_rank = sorted(by_id.keys(), key=lambda cid: -_cosine(qvec, vec_by_id.get(cid, (0.0,))))
    sparse_rank = _fts_candidates(conn, doc_id, question)

    fused: dict[int, float] = {}
    for rank, cid in enumerate(dense_rank):
        fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
    for rank, cid in enumerate(sparse_rank):
        fused[cid] = fused.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
    top = sorted(fused.items(), key=lambda kv: -kv[1])[:topk]
    results = []
    for cid, score in top:
        item = by_id[cid].copy()
        item["score"] = round(score, 5)
        results.append(item)
    return results


SYSTEM_PROMPT_EN = (
    "You are CogniBridge, an AI study assistant for university students. "
    "Answer ONLY from the provided textbook excerpts.\n"
    "1. Be clear and concise; use markdown (bold, lists); write math in LaTeX.\n"
    "2. After each key claim, cite the source page as [Page N] (N is the number in the excerpt header).\n"
    "3. If the excerpts do not contain the answer, say exactly: "
    "'The provided excerpts do not cover this.' Never invent content.\n"
    "4. Reply in the language of the question (default English)."
)


def ask_with_citations(question: str, contexts: list[dict], api_key: str, model: str) -> str:
    blocks = []
    for i, ctx in enumerate(contexts, 1):
        blocks.append(f"[Page {ctx['page']}] (excerpt {i})\n{ctx['text'][:600]}")
    user_content = "Textbook excerpts:\n\n" + "\n\n".join(blocks) + f"\n\nStudent question: {question}"
    resp = requests.post(
        f"{DASHSCOPE_BASE}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "temperature": 0.3,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT_EN},
                {"role": "user", "content": user_content},
            ],
        },
        timeout=120,
    )
    body = resp.json()
    if resp.status_code != 200:
        raise RuntimeError(f"LLM failed: {json.dumps(body, ensure_ascii=False)[:200]}")
    return body["choices"][0]["message"]["content"]


def load_pages_json(data_dir: Path, doc_id: str) -> list[dict]:
    return json.loads((data_dir / doc_id / "pages.json").read_text(encoding="utf-8"))
