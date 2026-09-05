r"""Import an already-MinerU-parsed book into cognibridge.db without re-parsing.

Copies content_list/pages into mineru_data/{doc_id}/, registers the PDF under
the given user's account (parse_status='done'), and clones chunks+embeddings
from the sandbox rag.db (no MinerU quota, no embedding cost).

Usage:
    python import_parsed_book.py --email <user@example.com> --title 高等代数 ^
        --pdf "D:\study\智学桥\教材\高等代数.pdf" ^
        --data-dir "D:\mineru\rag_test\data\高等代数" ^
        --sandbox-db "D:\mineru\rag_test\data\rag.db" --sandbox-book 高等代数
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import struct
import sys
import uuid
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "cognibridge.db"
UPLOADS = BASE / "uploads"
MINERU_DATA = BASE / "mineru_data"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--data-dir", type=Path, required=True, help="dir with content_list.json + pages.json")
    parser.add_argument("--sandbox-db", type=Path, default=None)
    parser.add_argument("--sandbox-book", default=None, help="book key in sandbox rag.db")
    parser.add_argument("--category", default="textbooks")
    args = parser.parse_args()

    for required in ("content_list.json", "pages.json"):
        if not (args.data_dir / required).exists():
            raise SystemExit(f"[error] {args.data_dir / required} missing")
    if not args.pdf.exists():
        raise SystemExit(f"[error] {args.pdf} missing")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    user = conn.execute("SELECT id FROM users WHERE email=?", (args.email,)).fetchone()
    if not user:
        raise SystemExit(f"[error] no user with email {args.email}")
    user_id = user["id"]

    doc_id = uuid.uuid4().hex[:8]
    safe_name = f"{doc_id}_{args.pdf.name}"
    shutil.copy2(args.pdf, UPLOADS / safe_name)
    book_dir = MINERU_DATA / doc_id
    book_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.data_dir / "content_list.json", book_dir / "content_list.json")
    shutil.copy2(args.data_dir / "pages.json", book_dir / "pages.json")

    conn.execute(
        "INSERT INTO documents(id,user_id,title,filename,file_path,category,source,file_size,file_type,"
        "needs_ocr,ai_declined,parse_status,parse_error) VALUES (?,?,?,?,?,?,'upload',?,'pdf',1,0,'done','')",
        (doc_id, user_id, args.title, args.pdf.name, safe_name, args.category, args.pdf.stat().st_size),
    )
    conn.commit()

    if args.sandbox_db and args.sandbox_book and args.sandbox_db.exists():
        src = sqlite3.connect(args.sandbox_db)
        src.row_factory = sqlite3.Row
        chunks = src.execute(
            "SELECT page, seq, text FROM chunks WHERE book=? ORDER BY seq", (args.sandbox_book,)
        ).fetchall()
        embeddings = {
            row["chunk_id"]: (row["dim"], row["vec"])
            for row in src.execute("SELECT chunk_id,dim,vec FROM embeddings WHERE book=?", (args.sandbox_book,))
        }
        src_ids = [row[0] for row in src.execute("SELECT id FROM chunks WHERE book=? ORDER BY seq", (args.sandbox_book,))]
        src.close()
        conn.execute("DELETE FROM doc_chunks WHERE doc_id=?", (doc_id,))
        conn.execute("DELETE FROM doc_embeddings WHERE doc_id=?", (doc_id,))
        for i, chunk in enumerate(chunks):
            cur = conn.execute(
                "INSERT INTO doc_chunks(doc_id,page,seq,text) VALUES (?,?,?,?)",
                (doc_id, chunk["page"], chunk["seq"], chunk["text"]),
            )
            new_id = cur.lastrowid
            if src_ids[i] in embeddings:
                dim, vec = embeddings[src_ids[i]]
                conn.execute(
                    "INSERT OR REPLACE INTO doc_embeddings(chunk_id,doc_id,dim,vec) VALUES (?,?,?,?)",
                    (new_id, doc_id, dim, vec),
                )
            try:
                conn.execute("INSERT INTO chunks_fts(rowid, text) VALUES (?,?)", (new_id, chunk["text"]))
            except sqlite3.OperationalError:
                pass  # FTS unavailable
        conn.commit()
        print(f"[rag] cloned {len(chunks)} chunks + embeddings")
    conn.close()
    print(f"[done] doc_id={doc_id} title={args.title} user={args.email}")


if __name__ == "__main__":
    main()
