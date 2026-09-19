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


# ============================================================================
# Bilingual query layer (China track / Sino-foreign joint programme)
#
# Students ask in Chinese but read English textbooks (and vice versa). The
# sparse FTS path is purely lexical ("上确界" never matches "supremum"), and
# retrieve_multi's dual-path CONSENSUS requires both paths to hit — so without
# a translated query, cross-lingual anchors are structurally impossible.
# Fix: translate the query (zh<->en, cheap model, 5-min cache, best-effort)
# and run BOTH paths on the original + translated query.
# ============================================================================

QUERY_TRANSLATE_MODEL = "qwen-turbo"
_QTRANS_TTL = 300          # seconds
_qtrans_cache: dict[str, tuple] = {}   # query -> (translated | None, ts)


def _has_cjk(s: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", s or ""))


def translate_query(query: str, api_key: str):
    """Translate a query zh<->en for cross-lingual retrieval.

    Returns the translated string, or None (translation unavailable/failed —
    callers must fall back to the original query only). Cached 5 minutes;
    failures are cached too so a bad network doesn't multiply API calls.
    """
    key = (query or "").strip()
    if not key or not api_key:
        return None
    now = time.time()
    hit = _qtrans_cache.get(key)
    if hit and now - hit[1] < _QTRANS_TTL:
        return hit[0]
    target = "English" if _has_cjk(key) else "Chinese"
    out = None
    try:
        resp = requests.post(
            f"{DASHSCOPE_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": QUERY_TRANSLATE_MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            f"Translate the user's mathematical query into {target}. "
                            "Keep LaTeX and all mathematical notation unchanged. "
                            "Reply with ONLY the translation — no explanation, no quotes."
                        ),
                    },
                    {"role": "user", "content": key},
                ],
                "temperature": 0.1,
                "max_tokens": 200,
            },
            timeout=15,
        )
        body = resp.json()
        cand = str(body["choices"][0]["message"]["content"]).strip().strip('"“”').strip()
        if cand and cand != key:
            out = cand
    except Exception:
        out = None
    _qtrans_cache[key] = (out, now)
    # Keep the cache bounded (queries repeat across anchoring/concept calls)
    if len(_qtrans_cache) > 256:
        for k in list(_qtrans_cache)[:128]:
            del _qtrans_cache[k]
    return out


def _zh_ngrams(token: str) -> list[str]:
    """CJK sliding 3-char windows (compatible with the trigram tokenizer).

    Chinese has no spaces, so a whole clause becomes ONE token; an FTS5
    trigram phrase match then requires that exact contiguous string in the
    text and virtually never hits. Sliding 3-grams ("上确界" inside
    "什么是上确界" → …/上确界) match the trigram index and give the lexical
    path real recall on Chinese queries."""
    return [token[i:i + 3] for i in range(len(token) - 2)] if _has_cjk(token) else []


def _fts_candidates(conn: sqlite3.Connection, doc_id: str, question: str, extra_query: str = None) -> list[int]:
    # Tokens from the original AND translated query — gives the lexical path
    # cross-lingual coverage (dense embeddings alone can't pass consensus).
    raw_tokens: list[str] = []
    for q in (question, extra_query):
        if not q:
            continue
        for t in re.split(r"[\s，。？！、；：''""（）]+", q):
            if t and t not in raw_tokens:
                raw_tokens.append(t)
    # Expand CJK tokens into sliding 3-grams; drop the un-matchable long whole
    # clause (a contiguous-phrase FTS match on it would almost never fire).
    tokens: list[str] = []
    for t in raw_tokens:
        if _has_cjk(t):
            if len(t) <= 3:
                if t not in tokens:
                    tokens.append(t)
                continue
            for g in _zh_ngrams(t):
                if g not in tokens:
                    tokens.append(g)
        else:
            tokens.append(t)
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
    # dim may be stored REAL (legacy/imported rows) -> int() before struct unpack
    vec_by_id = {row[0]: struct.unpack(f"<{int(row[1])}f", row[2]) for row in emb_rows}
    qvec = embed_texts([question], api_key)[0]
    # Cross-lingual: dense similarity = max over (original, translated) query
    t_query = translate_query(question, api_key)
    qvec_t = embed_texts([t_query], api_key)[0] if t_query else None

    def _best_sim(cid: int) -> float:
        v = vec_by_id.get(cid, (0.0,))
        s = _cosine(qvec, v)
        if qvec_t is not None:
            s = max(s, _cosine(qvec_t, v))
        return s

    dense_rank = sorted(by_id.keys(), key=lambda cid: -_best_sim(cid))
    sparse_rank = _fts_candidates(conn, doc_id, question, extra_query=t_query)

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


def retrieve_multi(
    conn: sqlite3.Connection,
    doc_ids: list,
    question: str,
    api_key: str,
    per_path_k: int = 10,
    topk: int = 3,
) -> list:
    """Cross-book retrieval with dual-path consensus (bilingual zh/en).

    A chunk counts as a hit ONLY if it ranks in the top-per_path_k of BOTH the
    dense (cosine) and sparse (FTS/BM25) paths within its own book — a weak
    single-path match never surfaces. Consensus chunks are RRF-fused across all
    books and the global top-k is returned. The question is embedded exactly
    once regardless of how many books are searched.

    China track: both paths run on the original AND translated query, so a
    Chinese question can consensus-hit English textbook chunks (and vice
    versa) — the lexical path alone made cross-lingual consensus impossible.
    Returns [{id, doc_id, page, text, score}].
    """
    qvec = None
    qvec_t = None
    t_query = None
    results = []
    for doc_id in doc_ids:
        rows = conn.execute(
            "SELECT id, page, text FROM doc_chunks WHERE doc_id=? ORDER BY id", (doc_id,)
        ).fetchall()
        if not rows:
            continue
        emb_rows = conn.execute(
            "SELECT chunk_id, dim, vec FROM doc_embeddings WHERE doc_id=?", (doc_id,)
        ).fetchall()
        if not emb_rows:
            continue
        if qvec is None:
            qvec = embed_texts([question], api_key)[0]
            t_query = translate_query(question, api_key)      # zh<->en, cached
            if t_query:
                qvec_t = embed_texts([t_query], api_key)[0]
        by_id = {r[0]: {"id": r[0], "page": r[1], "text": r[2]} for r in rows}
        # dim may be stored REAL (legacy/imported rows) -> int() before struct unpack
        vec_by_id = {r[0]: struct.unpack(f"<{int(r[1])}f", r[2]) for r in emb_rows}

        def _sim(cid, _qv=[qvec, qvec_t]):
            v = vec_by_id[cid]
            best = _cosine(_qv[0], v)
            if _qv[1] is not None:
                best = max(best, _cosine(_qv[1], v))
            return best

        dense = sorted(vec_by_id, key=lambda cid: -_sim(cid))[:per_path_k]
        sparse = _fts_candidates(conn, doc_id, question, extra_query=t_query)[:per_path_k]
        if not dense or not sparse:
            continue
        sparse_rank = {cid: i for i, cid in enumerate(sparse)}
        for rank_d, cid in enumerate(dense):
            if cid not in sparse_rank:
                continue  # no dual-path consensus -> not a hit
            score = 1.0 / (RRF_K + rank_d + 1) + 1.0 / (RRF_K + sparse_rank[cid] + 1)
            item = by_id[cid].copy()
            item["score"] = round(score, 5)
            item["doc_id"] = doc_id
            results.append(item)
    results.sort(key=lambda kv: -kv["score"])
    return results[:topk]


SYSTEM_PROMPT_EN = (
    "You are CogniBridge (智学桥), an AI study assistant for students at a "
    "Chinese Sino-foreign joint university reading mixed Chinese/English textbooks.\n"
    "Answer ONLY from the provided textbook excerpts.\n"
    "1. Be clear and concise; use markdown (bold, lists); write math in LaTeX.\n"
    "2. After each key claim, cite the source page as [Page N] (N is the number in the excerpt header).\n"
    "3. If the excerpts do not contain the answer, say exactly: "
    "'The provided excerpts do not cover this.' (中文提问时说：所给教材摘录未覆盖此内容。) "
    "Never invent content.\n"
    "4. Reply in the language of the question (default English; 中文提问用中文回答).\n"
    "5. Gloss key mathematical terms bilingually on first use, e.g. 上确界 (supremum), "
    "eigenvector 特征向量 — the excerpts may use either language."
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
