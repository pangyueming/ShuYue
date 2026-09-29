"""
数跃 Backend Server — FastAPI + Harness V3 Engine
Runs the UK Math Harness V3 (with V2 fallback capability) for AI-powered math tutoring.

Usage:
    pip install fastapi uvicorn requests python-dotenv
    python server.py
    # Server runs on http://localhost:8000

Harness Version:
    Default: V3 (improved with ToRA, Proof Verifier, Smart Routing)
    Fallback: Set HARNESS_VERSION=v2 in .env to use legacy V2
"""
import os
import sys
import json
import re
import time
import random
import sqlite3
import uuid
import asyncio
import hashlib
import secrets
from pathlib import Path
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv

# MinerU integration: cloud parsing client + RAG index/retrieval layer
import threading
import queue as _queue
from mineru_client import (
    MineruAuthError,
    detect_needs_ocr,
    normalize_pages,
    split_pdf,
    submit_part,
    count_pages,
    validate_token,
)
import rag
import skill_loader
from skill_loader import list_skills, load_skill, skill_label

# Add harness_design paths for importing Harness V2 and V3
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'harness_design', 'harness_uk'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'harness_design', 'harness_improve'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'harness_design', 'harness_improve', 'integration'))

# Import server bridge (supports V2/V3 switching via HARNESS_VERSION env var)
from server_bridge import solve_question

# ---------------------------------------------------------------------------
# Import V3 analysis + verification components (fall back gracefully).
# These power /api/chat's routing and proof verification with the real
# Harness V3 engine instead of the simplified inline lexicon further down.
# ---------------------------------------------------------------------------
try:
    from core.topic_detector import TopicDetector
    from core.question_classifier import QuestionClassifier
    from core.router import SmartRouter
    from verification.proof_verifier import ProofVerifier
    from verification.answer_verifier import AnswerVerifier
    from models.api_client import APIClient as HarnessAPIClient
    _V3_ANALYSIS_AVAILABLE = True
except ImportError:
    _V3_ANALYSIS_AVAILABLE = False
    TopicDetector = None
    QuestionClassifier = None
    SmartRouter = None
    ProofVerifier = None
    AnswerVerifier = None
    HarnessAPIClient = None

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional

# ============================================================================
# AUTH: JWT + PBKDF2 (standard library, no external deps)
# ============================================================================
from jose import jwt, JWTError

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

def _hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with random salt."""
    salt = secrets.token_hex(16)
    pwdhash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000).hex()
    return f"{salt}${pwdhash}"

def _verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against PBKDF2 hash."""
    try:
        salt, stored_hash = hashed_password.split("$")
        pwdhash = hashlib.pbkdf2_hmac('sha256', plain_password.encode(), salt.encode(), 100000).hex()
        return pwdhash == stored_hash
    except Exception:
        return False

# ============================================================================
# CONFIGURATION — reads from .env file (API key NOT in source code)
# ============================================================================

load_dotenv()

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
MODEL = os.getenv("MODEL", "qwen3.8-27b")
TRANSLATE_MODEL = os.getenv("TRANSLATE_MODEL", "qwen-turbo")
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
# --- Phase 0 (launch): email reset + environment isolation + admin ---
APP_BASE_URL = os.getenv("APP_BASE_URL", "").rstrip("/")   # e.g. https://shuyue.example.com (OWASP: hardcoded trusted origin, never trust Host header)
SMTP_HOST = os.getenv("SMTP_HOST", "")                     # Aliyun DirectMail SMTP endpoint
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")                     # e.g. noreply@mail.yourdomain.com
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
MAIL_FROM = os.getenv("MAIL_FROM", "")                     # display sender (defaults to SMTP_USER)
ENV_NAME = os.getenv("ENV", "development")                 # production | development (P7: keep test data out of prod stats)
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "")                 # sole admin for /api/agent/metrics/stats when set
# --- P8 vision (two-tier VL routing, mirrors the text decision layer) ---
VISION_MODEL_PLUS = os.getenv("VISION_MODEL_PLUS", "qwen3-vl-plus")    # grading / explaining (quality)
VISION_MODEL_FLASH = os.getenv("VISION_MODEL_FLASH", "qwen3-vl-flash") # extraction / classification (cheap)
VISION_GRADE_DAILY_LIMIT = int(os.getenv("VISION_GRADE_DAILY_LIMIT", "20"))
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
DB_PATH = os.path.join(os.path.dirname(__file__), "cognibridge.db")
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
# --- MinerU integration paths & limits ---
MINERU_DATA_DIR = os.path.join(os.path.dirname(__file__), "mineru_data")
FERNET_KEY_PATH = os.path.join(os.path.dirname(__file__), ".mineru_secret")
MINERU_MAX_UPLOAD = 200 * 1024 * 1024        # textbook-size PDFs
MINERU_PART_TIMEOUT = 1500                   # per-part cloud parse timeout (s)
_DEFAULT_SECRET = "cognibridge-dev-secret-key-change-in-production"
SECRET_KEY = os.getenv("SECRET_KEY", _DEFAULT_SECRET)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(MINERU_DATA_DIR, exist_ok=True)

if not DASHSCOPE_API_KEY:
    print("WARNING: DASHSCOPE_API_KEY not set! Check .env file.")

# Product-ready auth: every deployment gets its own unique, persistent JWT key.
# Generated once on first run and written back to .env (or created next to server.py).
if SECRET_KEY == _DEFAULT_SECRET:
    SECRET_KEY = secrets.token_hex(32)
    try:
        line = f"\n# Auto-generated JWT secret (unique per deployment)\nSECRET_KEY={SECRET_KEY}\n"
        if os.path.exists(ENV_PATH):
            with open(ENV_PATH, "a", encoding="utf-8") as f:
                f.write(line)
        else:
            with open(ENV_PATH, "w", encoding="utf-8") as f:
                f.write(line)
        print("SECRET_KEY: auto-generated and persisted to .env (tokens survive restarts).")
    except Exception as e:
        # Read-only FS etc.: still run with the generated key for this session
        print(f"SECRET_KEY: generated for this session only (could not persist: {e}).")

# ============================================================================
# DATABASE (SQLite)
# ============================================================================
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
    -- Users table (JWT auth)
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        university TEXT DEFAULT '北京邮电大学（中外合办）',
        major TEXT DEFAULT 'Computer Science',
        year TEXT DEFAULT 'freshman',
        a_level_grade TEXT,
        further_math INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Password resets (forgot password)
    CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );

    -- Documents (bookshelf) — with user_id
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT DEFAULT 'upload',
        file_size INTEGER DEFAULT 0,
        file_type TEXT DEFAULT 'pdf',
        created_at TEXT DEFAULT (datetime('now'))
    );

    -- Notes — with user_id
    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        title TEXT DEFAULT '',
        tag TEXT DEFAULT '',
        content TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Assessments (pre-test results)
    CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        knowledge_json TEXT,
        transition_json TEXT,
        quiz_correct INTEGER,
        quiz_total INTEGER,
        avg_score INTEGER,
        weak_topics TEXT,
        strong_topics TEXT,
        danger_topics TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    );

    -- Study plans
    CREATE TABLE IF NOT EXISTS study_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        plan_json TEXT,
        progress_json TEXT,
        week_number INTEGER DEFAULT 1,
        last_updated TEXT DEFAULT (datetime('now'))
    );

    -- Highlights (reader text highlights with notes)
    CREATE TABLE IF NOT EXISTS highlights (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        document_id TEXT NOT NULL REFERENCES documents(id),
        page INTEGER NOT NULL,
        text TEXT NOT NULL,
        color TEXT DEFAULT '#faad14',
        note TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );

        -- 单词本: math terminology entries (auto-extracted + manually added)
        CREATE TABLE IF NOT EXISTS vocab_entries(
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            term_en TEXT NOT NULL,
            term_zh TEXT DEFAULT '',
            definition TEXT DEFAULT '',
            source_doc_id TEXT,
            source_page INTEGER,
            source_text TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_vocab_user ON vocab_entries(user_id);

    -- Quiz results (AI Quiz attempts)
    CREATE TABLE IF NOT EXISTS quiz_results (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        topic TEXT NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        detail_json TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
    );

    -- MinerU daily page quota ledger (BYOT: per-user, resets each day)
    CREATE TABLE IF NOT EXISTS mineru_usage (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        pages INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, day)
    );

    -- Agent V4 · G1 工作台（用户命名，独立聊天场所；消息/摘要按会话隔离）
    CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        title TEXT DEFAULT '新工作台',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES chat_sessions(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

    -- P3 G5: long-term memory entries (semi-auto curated, user-approved)
    CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source_session TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_entries(user_id, id DESC);

    -- P4 E5: tool call audit log
    CREATE TABLE IF NOT EXISTS tool_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id),
        session_id TEXT DEFAULT '',
        tool_name TEXT NOT NULL,
        args_summary TEXT DEFAULT '',
        result_summary TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tool_audit_user ON tool_audit_log(user_id, id DESC);

    -- P7: agent run metrics (Langfuse-style trace — one row per run, steps as JSON)
    CREATE TABLE IF NOT EXISTS agent_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT DEFAULT '',
        user_id TEXT,
        env TEXT DEFAULT 'development',
        intent TEXT DEFAULT '',
        skill TEXT DEFAULT '',
        fast_path INTEGER DEFAULT 0,
        steps TEXT DEFAULT '[]',
        n_tools INTEGER DEFAULT 0,
        tools_fail INTEGER DEFAULT 0,
        total_ms INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        interrupted INTEGER DEFAULT 0,
        error TEXT DEFAULT '',
        input_preview TEXT DEFAULT '',
        output_preview TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_created ON agent_metrics(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_user ON agent_metrics(user_id, id DESC);

    -- P8: vision grade quota (grade-only daily cap; solve/explain/ask unlimited)
    CREATE TABLE IF NOT EXISTS vision_usage (
        user_id TEXT NOT NULL,
        day TEXT NOT NULL,
        grade_count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, day)
    );
    """)

    # === Migration: add user_id to legacy tables (notes/documents) ===
    def _ensure_column(table, column, decl):
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    _ensure_column("notes", "user_id", "TEXT REFERENCES users(id)")
    _ensure_column("documents", "user_id", "TEXT REFERENCES users(id)")
    _ensure_column("assessments", "result_json", "TEXT DEFAULT '{}'")   # full pretestResult snapshot
    _ensure_column("study_plans", "state_json", "TEXT DEFAULT '{}'")    # full plan state snapshot
    # Phase 0: JWT session revocation — bump on password reset, invalidates all old tokens
    _ensure_column("users", "token_version", "INTEGER DEFAULT 0")

    # One-time repair: imported/legacy embeddings may store dim as REAL
    # (e.g. 1024.0), which breaks struct.unpack -> cast back to INTEGER.
    try:
        bad = conn.execute(
            "SELECT COUNT(*) FROM doc_embeddings WHERE typeof(dim)<>'integer'"
        ).fetchone()[0]
        if bad:
            conn.execute(
                "UPDATE doc_embeddings SET dim=CAST(dim AS INTEGER) WHERE typeof(dim)<>'integer'"
            )
            print(f"[migration] doc_embeddings: cast {bad} REAL dims to INTEGER")
    except sqlite3.OperationalError:
        pass   # table not created yet on first run
    # --- MinerU integration columns ---
    _ensure_column("documents", "needs_ocr", "INTEGER DEFAULT 0")  # legacy rows: assume native (no gate)
    _ensure_column("documents", "ai_declined", "INTEGER DEFAULT 0")
    _ensure_column("documents", "parse_status", "TEXT DEFAULT 'none'")
    _ensure_column("documents", "parse_error", "TEXT DEFAULT ''")
    _ensure_column("users", "mineru_token_enc", "TEXT DEFAULT ''")
    # P5 C13: structured knowledge guide for textbooks (AI-distilled)
    _ensure_column("documents", "study_guide", "TEXT DEFAULT ''")

    # vocab_entries: add tag column (idempotent)
    try:
        conn.execute("ALTER TABLE vocab_entries ADD COLUMN tag TEXT DEFAULT ''")
    except Exception:
        pass  # column already exists
    # RAG tables (doc_chunks / chunks_fts / doc_embeddings)
    rag.ensure_rag_schema(conn)

    # Backfill orphaned legacy rows to the first existing user
    first_user = conn.execute("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").fetchone()
    if first_user:
        conn.execute("UPDATE documents SET user_id=? WHERE user_id IS NULL", (first_user["id"],))
        conn.execute("UPDATE notes SET user_id=? WHERE user_id IS NULL", (first_user["id"],))

    conn.commit(); conn.close()
    print(f"Database: {DB_PATH}")

init_db()

# ============================================================================
# MINERU: token vault + background parse pipeline
# ============================================================================

def get_fernet():
    """Fernet key auto-generated once per deployment (like JWT secret)."""
    from cryptography.fernet import Fernet

    if not os.path.exists(FERNET_KEY_PATH):
        with open(FERNET_KEY_PATH, "w", encoding="utf-8") as f:
            f.write(Fernet.generate_key().decode())
    with open(FERNET_KEY_PATH, "r", encoding="utf-8") as f:
        return Fernet(f.read().strip().encode())


def get_user_mineru_token(user_id: str) -> Optional[str]:
    """Decrypt the user's stored MinerU API key; None if not configured."""
    conn = get_db()
    row = conn.execute("SELECT mineru_token_enc FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    if not row or not row["mineru_token_enc"]:
        return None
    try:
        return get_fernet().decrypt(row["mineru_token_enc"].encode()).decode()
    except Exception:
        return None


PARSE_QUEUE: "_queue.Queue[str]" = _queue.Queue()
PARSE_STATUS: dict = {}


def set_parse_status(doc_id: str, status: str, error: str = "", error_type: str = "", **extra) -> None:
    row = PARSE_STATUS.get(doc_id, {})
    row.update({"status": status, "error": error, "error_type": error_type}, **extra)
    PARSE_STATUS[doc_id] = row
    conn = get_db()
    conn.execute(
        "UPDATE documents SET parse_status=?, parse_error=? WHERE id=?", (status, error, doc_id)
    )
    conn.commit(); conn.close()


MINERU_DAILY_LIMIT = 2000   # free tier, per user key, resets daily


def _mineru_today() -> str:
    return time.strftime("%Y-%m-%d")


def mineru_usage_today(user_id: str) -> int:
    conn = get_db()
    row = conn.execute(
        "SELECT pages FROM mineru_usage WHERE user_id=? AND day=?", (user_id, _mineru_today())
    ).fetchone()
    conn.close()
    return row["pages"] if row else 0


def record_mineru_usage(user_id: str, pages: int) -> None:
    """Count pages actually submitted to the MinerU cloud (cached parts cost 0)."""
    conn = get_db()
    conn.execute(
        "INSERT INTO mineru_usage(user_id,day,pages) VALUES (?,?,?) "
        "ON CONFLICT(user_id,day) DO UPDATE SET pages=pages+?",
        (user_id, _mineru_today(), pages, pages),
    )
    conn.commit(); conn.close()


def mineru_pages_needed(book_dir, total_pages: int) -> int:
    """Pages this parse would actually submit = non-cached parts only
    (mirrors split_pdf boundaries of <=190 pages and the part cache naming)."""
    from pathlib import Path
    book_dir = Path(book_dir)
    if (book_dir / "content_list.json").exists() and (book_dir / "pages.json").exists():
        return 0   # short-circuit rebuild — zero cloud spend
    needed = 0
    start = 0
    idx = 0
    while start < total_pages:
        end = min(start + 190, total_pages)
        cache = book_dir / f"part{idx:02d}_p{start + 1}-{end}.content_list.json"
        if not cache.exists():
            needed += end - start
        start = end
        idx += 1
    return needed


def run_parse(doc_id: str) -> None:
    from pathlib import Path

    conn = get_db()
    row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    conn.close()
    if not row:
        return
    token = get_user_mineru_token(row["user_id"])
    if not token:
        set_parse_status(doc_id, "failed", "MinerU API key not configured")
        return

    pdf_path = Path(os.path.join(UPLOAD_DIR, row["file_path"]))
    book_dir = Path(os.path.join(MINERU_DATA_DIR, doc_id))
    parts_dir = book_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)

    # Short-circuit: a previous run already produced the full content_list —
    # skip MinerU entirely (protects quota on resume/retry paths).
    done_content = book_dir / "content_list.json"
    done_pages = book_dir / "pages.json"
    if done_content.exists() and done_pages.exists():
        try:
            pages = json.loads(done_pages.read_text(encoding="utf-8"))
            total_pages = count_pages(pdf_path)
            set_parse_status(doc_id, "indexing", pages_done=total_pages, total_pages=total_pages)
            # RAG index: textbooks only — other categories parse for reading but never index
            if row["category"] == "textbooks":
                chunks = rag.make_chunks(pages, 600)
                conn = get_db()
                chunk_ids = rag.rebuild_doc(conn, doc_id, chunks)
                vectors = rag.embed_texts([text for _, text in chunks], DASHSCOPE_API_KEY)
                rag.store_embeddings(conn, doc_id, chunk_ids, vectors)
                conn.close()
                set_parse_status(doc_id, "done", pages_done=total_pages, total_pages=total_pages, chunks=len(chunks))
            else:
                set_parse_status(doc_id, "done", pages_done=total_pages, total_pages=total_pages, chunks=0)
            return
        except BaseException as exc:  # noqa: BLE001
            set_parse_status(doc_id, "failed", f"index rebuild failed: {exc}"[:300])
            return

    total_pages = count_pages(pdf_path)
    set_parse_status(doc_id, "parsing", phase="splitting", pages_done=0, total_pages=total_pages)

    jobs = split_pdf(pdf_path, parts_dir)
    merged: list = []
    done_pages = 0
    for part_path, start_page0 in jobs:
        part_cache = book_dir / f"{part_path.stem}.content_list.json"
        if part_cache.exists():
            # part already parsed in a previous run (retry/restart) — don't burn quota again
            blocks = json.loads(part_cache.read_text(encoding="utf-8"))
        else:
            part_pages = int(part_path.stem.split("-")[-1]) - start_page0
            # Mid-job quota guard: never push the user past the daily free limit
            if mineru_usage_today(row["user_id"]) + part_pages > MINERU_DAILY_LIMIT:
                raise RuntimeError(
                    "QUOTA_EXCEEDED: today's free MinerU limit (2,000 pages) would be passed. "
                    "Finished parts are kept — continue tomorrow at no extra cost."
                )
            for attempt in range(3):
                try:
                    blocks = submit_part(part_path, start_page0, token, "ch", MINERU_PART_TIMEOUT)
                    record_mineru_usage(row["user_id"], part_pages)   # count real submissions only
                    break
                except RuntimeError as exc:
                    set_parse_status(doc_id, "parsing", phase=f"retry {attempt + 1}/3",
                                     pages_done=done_pages, total_pages=total_pages)
                    time.sleep(10 * (attempt + 1))
            else:
                raise RuntimeError(f"part failed after 3 retries: {part_path.name}")
            with open(part_cache, "w", encoding="utf-8") as f:
                json.dump(blocks, f, ensure_ascii=False)
        for block in blocks:
            block["page_idx"] = block.get("page_idx", 0) + start_page0
        merged.extend(blocks)
        done_pages += int(part_path.stem.split("-")[-1]) - start_page0
        set_parse_status(doc_id, "parsing", phase="mineru", pages_done=done_pages, total_pages=total_pages)

    with open(book_dir / "content_list.json", "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=1)
    pages = normalize_pages(merged, total_pages)
    with open(book_dir / "pages.json", "w", encoding="utf-8") as f:
        json.dump(pages, f, ensure_ascii=False, indent=1)

    set_parse_status(doc_id, "indexing", pages_done=total_pages, total_pages=total_pages)
    # RAG index: textbooks only — other categories parse for reading but never index
    if row["category"] == "textbooks":
        chunks = rag.make_chunks(pages, 600)
        conn = get_db()
        chunk_ids = rag.rebuild_doc(conn, doc_id, chunks)
        vectors = rag.embed_texts([text for _, text in chunks], DASHSCOPE_API_KEY)
        rag.store_embeddings(conn, doc_id, chunk_ids, vectors)
        conn.close()
        set_parse_status(doc_id, "done", pages_done=total_pages, total_pages=total_pages, chunks=len(chunks))
    else:
        set_parse_status(doc_id, "done", pages_done=total_pages, total_pages=total_pages, chunks=0)
    # [单词本] Auto-extract terminology after parse (textbooks+slides, best-effort)
    try:
        _vc = get_db()
        if row["category"] in ("textbooks", "slides"):
            extract_vocab_for_doc(_vc, row["user_id"], doc_id, row["category"])
        _vc.close()
    except Exception:
        pass



def parse_worker() -> None:
    while True:
        doc_id = PARSE_QUEUE.get()
        try:
            run_parse(doc_id)
        except MineruAuthError:
            # Bad key: retries can't help — fail fast with a specific error type
            set_parse_status(
                doc_id, "failed",
                "Your MinerU API key was rejected. Please update it and retry.",
                error_type="auth",
            )
        except BaseException as exc:  # noqa: BLE001 — SystemExit must not kill the worker
            set_parse_status(doc_id, "failed", str(exc)[:300])


threading.Thread(target=parse_worker, daemon=True).start()


def _resume_orphaned_parses() -> None:
    """After a server restart, re-queue docs whose parse died mid-flight."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id FROM documents WHERE parse_status IN ('queued','parsing','indexing')"
    ).fetchall()
    conn.close()
    for r in rows:
        PARSE_STATUS[r["id"]] = {"status": "queued", "error": ""}
        PARSE_QUEUE.put(r["id"])
    if rows:
        print(f"[mineru] resumed {len(rows)} interrupted parse job(s)")


_resume_orphaned_parses()

# ============================================================================
# AUTH: JWT utilities & user dependency
# ============================================================================

def verify_password(plain_password, hashed_password):
    return _verify_password(plain_password, hashed_password)

def get_password_hash(password):
    return _hash_password(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(authorization: Optional[str] = Header(None)):
    """Extract current user from JWT token in Authorization header."""
    if not authorization:
        return None
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            return None
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
    except (JWTError, ValueError):
        return None

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    if user is None:
        return None
    # Phase 0: session revocation — tokens minted before a password reset die
    if int(payload.get("tv", 0)) != int(user["token_version"] or 0):
        return None
    return dict(user)

# ============================================================================
# AUTH: Pydantic models
# ============================================================================

class UserRegister(BaseModel):
    email: str
    password: str
    name: str = ""

class UserLogin(BaseModel):
    email: str
    password: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    university: Optional[str] = None
    major: Optional[str] = None
    year: Optional[str] = None
    a_level_grade: Optional[str] = None
    further_math: Optional[int] = None

class ForgotPassword(BaseModel):
    email: str

class ResetPassword(BaseModel):
    token: str
    new_password: str


# ============================================================================
# Phase 0: email sending (DirectMail SMTP) + auth rate limiting
# ============================================================================

def _send_email(to: str, subject: str, html_body: str) -> bool:
    """Send transactional email via SMTP (Aliyun DirectMail).
    Unconfigured (dev): fall back to console print — flows keep working locally."""
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD):
        print(f"[email:dev-fallback] to={to} | {subject}\n{html_body}")
        return False
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.header import Header
        msg = MIMEText(html_body, "html", "utf-8")
        msg["Subject"] = Header(subject, "utf-8")
        msg["From"] = MAIL_FROM or SMTP_USER
        msg["To"] = to
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.sendmail(msg["From"], [to], msg.as_string())
        return True
    except Exception as e:
        print(f"[email] send failed to {to}: {e}")
        return False


_forgot_rate: dict = {}   # ip -> [request timestamps] (OWASP: stop email-flooding)


def _rate_ok(ip: str, limit: int = 3, window_s: int = 3600) -> bool:
    now = time.time()
    lst = [t for t in _forgot_rate.get(ip, []) if now - t < window_s]
    if len(lst) >= limit:
        _forgot_rate[ip] = lst
        return False
    lst.append(now)
    _forgot_rate[ip] = lst
    return True

# ============================================================================
# HARNESS: Topic Detection & Routing (from harness_uk_math.py)
# ============================================================================

TOPIC_LEXICON = [
    # China-track: English keywords kept + zh aliases appended (topic IDs unchanged)
    ("Limits", ["limit", "lim", "epsilon-delta", "squeeze theorem", "l'hôpital", "continuity", "0/0",
                "极限", "洛必达", "夹逼", "无穷小", "连续性", "渐近"]),
    ("Differentiation", ["derivative", "differentiat", "tangent", "chain rule", "stationary point",
                         "导数", "求导", "微分", "链式法则", "切线", "极值", "驻点", "拐点"]),
    ("Integration", ["integral", "integrate", "antiderivative", "integration by parts", "Riemann",
                     "积分", "原函数", "分部积分", "换元", "定积分", "不定积分"]),
    ("Series_Convergence", ["series", "converge", "diverge", "ratio test", "Taylor series", "Σ",
                            "级数", "泰勒", "麦克劳林", "等比级数", "调和级数", "敛散", "幂级数"]),
    ("Differential_Equations", ["differential equation", "ODE", "separable",
                                "微分方程", "通解", "特解", "齐次方程"]),
    ("Linear_Algebra", ["matrix", "eigenvalue", "vector space", "basis", "linear independence",
                        "矩阵", "行列式", "特征值", "特征向量", "线性无关", "向量空间", "线性方程组", "秩", "逆矩阵"]),
    ("Discrete_Math", ["set theory", "union", "intersection", "propositional logic", "graph theory", "combinatorics",
                       "离散", "集合论", "命题逻辑", "真值表", "图论", "排列组合", "递推", "抽屉原理"]),
    ("Probability", ["probability", "Bayes", "random variable", "distribution", "normal",
                     "概率", "贝叶斯", "条件概率", "随机变量", "期望", "方差", "正态分布", "二项分布", "泊松"]),
    ("Proof_Techniques", ["prove", "proof", "show that", "by contradiction", "by induction", "contrapositive",
                          "证明", "求证", "试证", "反证", "数学归纳法", "归纳法", "充要", "当且仅当", "证毕"]),
    ("Complex_Numbers", ["complex number", "modulus", "argument", "De Moivre",
                         "复数", "实部", "虚部", "辐角", "共轭", "棣莫弗"]),
    ("Vector_Calculus", ["curl", "divergence", "gradient", "line integral", "Green's theorem",
                         "旋度", "散度", "梯度", "曲线积分", "曲面积分", "格林公式", "斯托克斯", "高斯公式"]),
]

WEAK_TOPICS = {"Proof_Techniques", "Discrete_Math", "Series_Convergence", "Linear_Algebra", "Vector_Calculus"}

def infer_topic(text: str) -> str:
    t = text.lower()
    for name, keywords in TOPIC_LEXICON:
        if any(k in t for k in keywords):
            return name
    return "Other"

def should_use_verifier(topic: str) -> bool:
    """Weak topics get Verifier treatment."""
    return topic in WEAK_TOPICS

# ============================================================================
# HARNESS: System Prompts
# ============================================================================

SYSTEM_PROMPT_SOLVE = (
    "You are 数跃 (ShuYue), an expert tutor for first-year students at a "
    "Chinese Sino-foreign joint university (BUPT-QMUL style) bridging from the "
    "Gaokao to English-medium university mathematics: calculus / mathematical "
    "analysis, linear algebra / advanced algebra, discrete mathematics, "
    "probability, and mathematical proofs. "
    "Solve problems with rigorous step-by-step reasoning; notation follows the "
    "English course textbooks (with Gaokao-habit correspondences shown when helpful). "
    "Always show full working. Put the final answer in **bold**. "
    "If the question is in Chinese, answer in Chinese (关键术语附英文对照, e.g. 极限 limit); "
    "if English, answer in English."
)

SYSTEM_PROMPT_GUIDE = (
    "You are 数跃 (ShuYue), an expert Socratic tutor for first-year students "
    "at a Chinese Sino-foreign joint university bridging from the Gaokao (高考) to "
    "English-medium university mathematics. "
    "Your goal is NOT to give answers directly, but to help students discover them through guided questioning.\n\n"
    "## Expert Decision Process (think through this in <thinking> before each response)\n"
    "1. DIAGNOSE: What is the student's current understanding? What specific misconception or gap do they have?\n"
    "2. STRATEGY: Which technique will best help them? (Elicit / Clarify / Challenge / Hint / Analogue / Summarize)\n"
    "3. INTENT: What should the student understand by the end of this turn?\n\n"
    "## Teaching Techniques\n"
    "- ELICIT: 'What do you already know about [topic]? 你对这个概念已经知道什么？' - Draw out existing knowledge.\n"
    "- CLARIFY: 'Can you walk me through how you got that step? 能说说这一步是怎么来的吗？' - Surface reasoning process.\n"
    "- CHALLENGE: 'What would happen if [condition changed]? 如果条件改变会怎样？' - Test deeper understanding.\n"
    "- HINT: 'Think about [specific concept]. How does it apply here? 想想这个概念在这里怎么用？' - Give targeted nudge.\n"
    "- ANALOGUE: 'Let's try a simpler version first: [simpler problem]. 我们先看一个简单些的例子。' - Reduce cognitive load.\n"
    "- SUMMARIZE: 'So what's the key insight we've discovered? 我们发现的关键点是什么？' - Consolidate learning.\n\n"
    "## Scaffolding Levels (adapt naturally; start at Level 1-2)\n"
    "Level 1 (Open): Broad exploratory questions. 'What approach might work here? 你觉得可以从什么思路入手？'\n"
    "Level 2 (Directed): Point toward the right method. 'Which technique have we learned for products of functions? 乘积函数我们学过什么方法？'\n"
    "Level 3 (Hinted): Give specific conceptual hints. 'Remember LIATE. Which part should be u? 记住 LIATE，哪一部分该设为 u？'\n"
    "Level 4 (Guided): Walk through a similar example. 'Let's solve ∫x dx first. Now how is your problem different? 先解 ∫x dx，你的题有何不同？'\n"
    "Level 5 (Partial): Show the first step. 'If we set u = x, then du = ___. What is dv? 若设 u = x，则 du = ___，那 dv 是什么？'\n\n"
    "## Error Handling (CRITICAL - use Approach B)\n"
    "When a student gives a wrong answer or shows confusion:\n"
    "1. FIRST, identify what is CORRECT in their reasoning: 'Your idea about X is on the right track... 你关于 X 的思路是对的...'\n"
    "2. THEN, pinpoint the specific misconception: '...but there's a common subtlety with Y that many students miss. ...但 Y 这里有个常见易错点。'\n"
    "3. FINALLY, give a targeted hint at the appropriate level. NEVER say 'that's wrong' without acknowledging the good part first. 绝不先否定再解释。\n\n"
    "## Student Signals (detect these — bilingual)\n"
    "- 'I need a hint' / '给点提示' / '提示一下' / '不会做' → Increase scaffolding by 1-2 levels.\n"
    "- 'I'm stuck' / '卡住了' / '我不会' / '不懂' / 'I don't know' → Jump to Level 4 (guided) with an analogue or partial solution.\n"
    "- 'Give me the answer' / '直接告诉我答案' / frustration (急躁/沮丧语气) → Provide Level 5 (partial solution), reassure them, and explain that struggling is part of learning.\n\n"
    "## Format Rules\n"
    "- Start with encouragement or acknowledgment of their effort.\n"
    "- Ask ONE main question per turn. NEVER provide multiple-choice options (A/B/C/D). Always ask ONE open-ended question that requires the student to think and articulate their reasoning.\n"
    "- End each turn by asking: 'Does this help? 需要提示、类似例题，还是换个角度讲解？'\n"
    "- Match the student's language (default Chinese if the question is Chinese; English if English).\n"
    "- Gloss key terms bilingually on first use, e.g. 上确界 (supremum), eigenvector 特征向量.\n"
)

SYSTEM_PROMPT_TRANSLATE = (
    "You are an academic translator specialising in mathematics and computer science. "
    "Translate the text accurately. Format: **Translation**: [result] **Note**: [1-sentence explanation]."
)

SYSTEM_PROMPT_GENERAL = (
    "You are 数跃 (ShuYue), a helpful AI tutor for students at a Chinese "
    "Sino-foreign joint university studying English-medium mathematics. "
    "Be clear, concise, and use markdown formatting. "
    "Respond in the same language as the question; gloss key terms bilingually "
    "on first use (e.g. 极限 limit)."
)

def get_system_prompt(task_type: str) -> str:
    prompts = {
        "math_solve": SYSTEM_PROMPT_SOLVE,
        "math_guide": SYSTEM_PROMPT_GUIDE,
        "translate": SYSTEM_PROMPT_TRANSLATE,
        "doc_qa": SYSTEM_PROMPT_GENERAL,
        "general": SYSTEM_PROMPT_GENERAL,
    }
    return prompts.get(task_type, SYSTEM_PROMPT_GENERAL)

def get_model_for_task(task_type: str) -> str:
    """Route to cheaper model for simple tasks."""
    if task_type == "translate":
        return TRANSLATE_MODEL  # qwen-7b-instruct (cheaper)
    return MODEL  # qwen3.8-27b

# ============================================================================
# HARNESS: Verifier (cross-check B-channel answers)
# ============================================================================

def run_verifier(question: str, original_answer: str, messages: list) -> str:
    """Cross-verify the solution for weak topics."""
    verify_prompt = (
        f"You are a university mathematics examiner for a Chinese Sino-foreign joint "
        f"university. Review this solution for correctness:\n\n"
        f"Question: {question}\n\n"
        f"Solution to verify:\n{original_answer}\n\n"
        f"Check each step. If there's an error, correct it. "
        f"If correct, confirm. Provide your verified answer. "
        f"用与学生解答一致的语言点评（默认中文）。"
    )
    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": "You are a rigorous UK mathematics examiner."},
                {"role": "user", "content": verify_prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 2000,
        }, timeout=60)
        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            return "[Verifier error: empty response]"
        return choices[0]["message"]["content"]
    except Exception as e:
        return f"[Verifier error: {e}]"


def _analyze_question_v3(question: str):
    """Analyze a question with the Harness V3 analysis layer.

    Returns a dict with topic/qtype/lane/verification flags, or None when V3
    is unavailable or fails — callers then fall back to the legacy lexicon.
    """
    if not _V3_ANALYSIS_AVAILABLE:
        return None
    try:
        topic_match = TopicDetector().detect(question)
        qtype_result = QuestionClassifier().classify(question)
        decision = SmartRouter().route(question, topic_override=topic_match.name)
        return {
            "topic": topic_match.name,
            "qtype": qtype_result.qtype.value,
            "lane": decision.lane,
            "is_weak": topic_match.name in TopicDetector.WEAK_TOPICS,
            "is_proof": qtype_result.qtype.value == "Proof",
            "use_proof_verifier": decision.use_proof_verifier,
        }
    except Exception:
        return None


def _verify_proof_v3(question: str, solution: str):
    """Run the upgraded ProofVerifier (LLM semantic grading) on a proof.

    Returns a ProofAssessment or None on any failure.
    """
    if not _V3_ANALYSIS_AVAILABLE or ProofVerifier is None:
        return None
    try:
        client = HarnessAPIClient(
            api_key=DASHSCOPE_API_KEY,
            base_url=BASE_URL.replace("/chat/completions", ""),
            model=MODEL,
            timeout=60,
            retries=1,
        )
        verifier = ProofVerifier(client=client)
        assessment = verifier.verify(question, solution, use_llm=True)
        client.close()
        return assessment
    except Exception:
        return None


# ============================================================================
# FASTAPI APP
# ============================================================================

app = FastAPI(title="数跃 AI Backend", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phase 0: baseline security headers (OWASP reset-page referrer-leak guidance)
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response

class ChatRequest(BaseModel):
    task_type: str = "general"
    messages: List[dict] = []
    temperature: float = 0.3
    max_tokens: int = 2000
    stream: bool = True
    skill: Optional[str] = None   # P1: activate an Agent Skill (SKILL.md) for this message

class SolveRequest(BaseModel):
    question: str
    options: Optional[List[str]] = None
    mode: str = "general"  # "general" or "deep"

# ============================================================================
# AUTH API
# ============================================================================

@app.post("/api/auth/register")
async def register(req: UserRegister):
    """Register a new user."""
    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if not any(c.isalpha() for c in req.password) or not any(c.isdigit() for c in req.password):
        raise HTTPException(400, "Password must contain at least one letter and one number")
    
    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE email=?", (req.email,)).fetchone()
    if existing:
        conn.close()
        raise HTTPException(400, "Email already registered")
    
    user_id = f"user_{int(time.time()*1000)}"
    password_hash = get_password_hash(req.password)
    
    conn.execute(
        "INSERT INTO users (id, email, password_hash, name) VALUES (?,?,?,?)",
        (user_id, req.email, password_hash, req.name or req.email.split('@')[0])
    )
    conn.commit(); conn.close()
    
    access_token = create_access_token(data={"sub": user_id, "tv": 0})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {"id": user_id, "email": req.email, "name": req.name or req.email.split('@')[0]}
    }

@app.post("/api/auth/login")
async def login(req: UserLogin):
    """Login and get JWT token."""
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email=?", (req.email,)).fetchone()
    conn.close()
    
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")

    access_token = create_access_token(data={"sub": user["id"], "tv": int(user["token_version"] or 0)})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "university": user["university"],
            "major": user["major"],
            "year": user["year"],
        }
    }

@app.get("/api/auth/me")
async def get_me(current_user: Optional[dict] = Depends(get_current_user)):
    """Get current user profile."""
    if not current_user:
        raise HTTPException(401, "Not authenticated")
    return {
        "id": current_user["id"],
        "email": current_user["email"],
        "name": current_user["name"],
        "university": current_user["university"],
        "major": current_user["major"],
        "year": current_user["year"],
        "a_level_grade": current_user["a_level_grade"],
        "further_math": current_user["further_math"],
    }

@app.put("/api/auth/me")
async def update_me(req: UserUpdate, current_user: Optional[dict] = Depends(get_current_user)):
    """Update current user profile."""
    if not current_user:
        raise HTTPException(401, "Not authenticated")
    
    updates = {}
    if req.name is not None: updates["name"] = req.name
    if req.university is not None: updates["university"] = req.university
    if req.major is not None: updates["major"] = req.major
    if req.year is not None: updates["year"] = req.year
    if req.a_level_grade is not None: updates["a_level_grade"] = req.a_level_grade
    if req.further_math is not None: updates["further_math"] = req.further_math
    updates["updated_at"] = datetime.now().isoformat()
    
    if not updates:
        return {"updated": False, "message": "No fields to update"}
    
    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [current_user["id"]]
    
    conn = get_db()
    conn.execute(f"UPDATE users SET {set_clause} WHERE id=?", values)
    conn.commit(); conn.close()
    
    return {"updated": True}

@app.post("/api/auth/forgot-password")
async def forgot_password(req: ForgotPassword, request: Request):
    """Forgot password — OWASP-hardened reset flow.
    ① uniform message for existent/non-existent accounts ② crypto-safe token
    (256-bit) stored HASHED ③ per-IP rate limit (3/h) ④ reset URL from
    APP_BASE_URL env (never the Host header) ⑤ real email via DirectMail
    (console fallback in dev)."""
    ip = request.client.host if request.client else "?"
    if not _rate_ok(ip):
        raise HTTPException(429, "请求过于频繁，请 1 小时后再试")

    reset_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(reset_token.encode()).hexdigest()
    expires_at = (datetime.utcnow() + timedelta(hours=1)).isoformat()

    conn = get_db()
    user = conn.execute("SELECT id, email FROM users WHERE email=?", (req.email,)).fetchone()
    if user:
        conn.execute(
            "INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?,?,?,?)",
            (uuid.uuid4().hex[:12], user["id"], token_hash, expires_at)
        )
        conn.commit()
    conn.close()

    if user:
        base = APP_BASE_URL or "http://localhost:8001"
        reset_url = f"{base}/#/reset?token={reset_token}"
        sent = _send_email(
            req.email, "重置你的数跃密码",
            f'<div style="font-family:system-ui;max-width:480px;margin:0 auto;padding:24px;">'
            f'<h2 style="color:#1a1a2e;">数跃 ShuYue</h2>'
            f'<p>你（或他人）请求重置账号密码。点击下方链接设置新密码：</p>'
            f'<p><a href="{reset_url}" style="display:inline-block;background:#6366f1;color:#fff;'
            f'padding:10px 24px;border-radius:8px;text-decoration:none;">重置密码</a></p>'
            f'<p style="color:#888;font-size:12px;">链接 1 小时内有效，仅可使用一次。'
            f'若非本人操作，请忽略此邮件。</p></div>'
        )
        # dev (no SMTP): the link must still be reachable — print it
        if not sent:
            print(f"[reset] dev link for {req.email}: {reset_url}")

    # OWASP: identical response whether or not the account exists
    return {"message": "如果该邮箱已注册，重置链接已发送，请查收邮件。"}


@app.post("/api/auth/reset-password")
async def reset_password(req: ResetPassword):
    """Reset password with token (hashed lookup, single-use, revokes sessions)."""
    if len(req.new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if not any(c.isalpha() for c in req.new_password) or not any(c.isdigit() for c in req.new_password):
        raise HTTPException(400, "Password must contain at least one letter and one number")

    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    conn = get_db()
    reset = conn.execute(
        "SELECT * FROM password_resets WHERE token=? AND used=0 AND expires_at > ?",
        (token_hash, datetime.utcnow().isoformat())
    ).fetchone()

    if not reset:
        conn.close()
        raise HTTPException(400, "重置链接无效或已过期，请重新申请")

    user = conn.execute("SELECT email FROM users WHERE id=?", (reset["user_id"],)).fetchone()
    new_hash = get_password_hash(req.new_password)
    conn.execute(
        "UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
        (new_hash, reset["user_id"]))
    conn.execute("UPDATE password_resets SET used=1 WHERE id=?", (reset["id"],))
    conn.commit(); conn.close()

    # OWASP: notify (never contain the password); old JWTs die via token_version
    if user:
        _send_email(user["email"], "你的数跃密码已重置",
                    '<p>你的数跃账号密码刚刚被重置，所有旧登录已失效。'
                    '若非本人操作，请立即联系管理员。</p>')

    return {"message": "密码重置成功，请使用新密码登录。"}

# ============================================================================
# HEALTH
# ============================================================================

@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL, "harness": "enabled"}

# ============================================================================
# SKILLS (P1 · Agent Skills open standard) — metadata endpoint + chat injection
# ============================================================================

@app.get("/api/skills")
def get_skills():
    """List available Agent Skills (progressive disclosure L1: metadata only)."""
    return {"skills": list_skills()}


@app.get("/api/skills/{skill_name}")
def get_skill_body(skill_name: str):
    """P6: return a skill's full SKILL.md body (for Reader-side injection)."""
    body = load_skill(skill_name)
    if not body:
        raise HTTPException(404, f"Skill '{skill_name}' not found")
    return {"name": skill_name, "body": body}


# ============================================================================
# P6: Reader concept-check (lightweight flash endpoint — NOT the agent loop)
# ============================================================================

class ConceptCheckRequest(BaseModel):
    text: str

@app.post("/api/agent/concept-check")
def concept_check(req: ConceptCheckRequest):
    """P6: lightweight flash check — is this a concept-explanation request?
    Returns {"is_concept": true/false}. No tools, no agent loop, ~1s."""
    from agent.decision import _call, DECISION_MODEL
    try:
        out = _call(DECISION_MODEL,
                    "学生是否在询问或想了解一个数学概念（如：什么是极限/定义/含义/怎么理解/是什么意思/讲讲X）？"
                    '输出JSON: {"is_concept": true} 或 {"is_concept": false}',
                    req.text[:300], timeout=10, max_tokens=100)
        is_concept = out.get("is_concept", False)
        # handle string "true" from model
        if isinstance(is_concept, str):
            is_concept = is_concept.strip().lower() in ("true", "yes", "1")
        print(f"[concept-check] '{req.text[:40]}' → {out.get('is_concept')} → {is_concept}")
        return {"is_concept": bool(is_concept)}
    except Exception as e:
        print(f"[concept-check] error: {e}")
        return {"is_concept": False, "error": str(e)[:100]}


# ============================================================================
# P8: Vision chat — paste-and-ask (grade / solve / explain / ask)
# Ephemeral by design: image arrives as base64, is used once, never stored.
# Two-tier VL routing: flash extracts/classifies, plus grades/explains (D9).
# ============================================================================

VISION_MIME_OK = ("image/jpeg", "image/png", "image/webp", "image/bmp")
VISION_MAX_BYTES = 8 * 1024 * 1024


def _vl_headers():
    return {"Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json"}


def _vl_messages(image_b64: str, mime: str, instruction: str, history: list):
    """Multimodal messages per official qwen-vl guidance: NO system message —
    instructions ride in the user turn; prior text turns keep follow-up context."""
    data_uri = f"data:{mime};base64,{image_b64}"
    msgs = []
    for m in (history or [])[-6:]:
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content"):
            msgs.append({"role": m["role"], "content": str(m["content"])[:1500]})
    msgs.append({"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": data_uri}},
        {"type": "text", "text": instruction},
    ]})
    return msgs


def _vl_call(model: str, image_b64: str, mime: str, instruction: str,
             history: list = None, max_tokens: int = 2000):
    """Non-streaming VL call → (text, total_tokens)."""
    payload = {"model": model,
               "messages": _vl_messages(image_b64, mime, instruction, history),
               "max_tokens": max_tokens}
    r = requests.post(BASE_URL, headers=_vl_headers(), json=payload, timeout=180)
    r.raise_for_status()
    data = r.json()
    txt = ((data["choices"][0]["message"].get("content") or "")).strip()
    usage = int((data.get("usage") or {}).get("total_tokens", 0) or 0)
    return txt, usage


def _vl_stream(model: str, image_b64: str, mime: str, instruction: str,
               history: list = None, max_tokens: int = 3000):
    """Streaming VL call → requests response with .iter_lines().
    stream_options.include_usage: final chunk carries token usage (P7 telemetry)."""
    payload = {"model": model,
               "messages": _vl_messages(image_b64, mime, instruction, history),
               "max_tokens": max_tokens, "stream": True,
               "stream_options": {"include_usage": True}}
    return requests.post(BASE_URL, headers=_vl_headers(), json=payload,
                         stream=True, timeout=180)


def _vision_intent_from_text(text: str) -> str:
    """Flash classifies the accompanying text (follow-ups naturally become ask)."""
    from agent.decision import _call, DECISION_MODEL
    try:
        out = _call(DECISION_MODEL,
                    "学生贴了一张数学相关图片并附言。判断意图："
                    "grade=批改手写作业/检查对错；solve=求解图中题目；"
                    "explain=讲解图中知识点/概念；ask=其他图片提问或对先前图片的追问。"
                    '输出JSON {"intent":"grade|solve|explain|ask"}',
                    (text or "ask").strip()[:200], timeout=10, max_tokens=50)
        i = out.get("intent", "")
        if isinstance(i, str) and i.strip() in ("grade", "solve", "explain", "ask"):
            return i.strip()
    except Exception as e:
        print(f"[vision] intent classify failed: {e}")
    return "ask"


def _vision_intent_from_image(image_b64: str, mime: str) -> str:
    """Empty note → cheap vl-flash looks at the image itself (auto mode)."""
    try:
        txt, _ = _vl_call(VISION_MODEL_FLASH, image_b64, mime,
                          "这张图最像什么？只输出JSON：{\"intent\":\"grade|solve|explain|ask\"}。"
                          "grade=学生的手写解答过程；solve=纯题目（印刷或手写题目本身）；"
                          "explain=教材页/笔记/知识点截图；ask=其他。",
                          max_tokens=50)
        txt = txt.strip().strip("`")
        i = json.loads(txt[txt.find("{"):txt.rfind("}") + 1]).get("intent", "solve")
        if i in ("grade", "solve", "explain", "ask"):
            return i
    except Exception as e:
        print(f"[vision] image classify failed: {e}")
    return "solve"   # bare image default: search-and-solve


_VISION_GRADE_PROMPT = (
    "你是数学作业批改老师。图片是学生的手写数学解答。请严格但公正地批改。\n"
    "批改流程：①先逐题独立解出正确答案（心中演算，不输出过程）；"
    "②按学生自己的方法逐步检查；③判定最终结论看【数学等价】而非字面一致。\n"
    "判定规则（务必遵守）：\n"
    "- 数学等价即 correct：常数乘开（4·4=16）、化简/通分/因式分解、"
    "等价记号（x²与x^2、y'与dy/dx）、数值形式（1/2与0.5）。"
    "例：参考答案 4·4cos4x、学生写 16cos4x → correct。\n"
    "- 方法正确但个别数值错 → result=partial（保留方法分）；"
    "后续步骤只是沿用前面错误数值而方法本身正确 → verdict=correct，"
    "reason 注明'承接前步误差'。\n"
    "- 常规代数化简跳步不算错；仅证明题缺失关键论证才标 逻辑跳步。\n"
    "- 记号/格式风格差异（省略乘号、中英符号、等号链）不算错误，"
    "写入 suggestion 提示即可；error_type 用 符号规范 仅当记号会引人数义错误。\n"
    "- 手写辨认不确定的步骤 verdict=unclear（疑罪从无）；"
    "仅有 unclear 步骤时 result 仍可判 correct。\n"
    "- error_type=方法选择 仅当方法本身错误或不适用。\n"
    "只输出严格 JSON（无任何其他文字、无代码块标记）：\n"
    '{"problems":[{"no":1,"question":"题目概要",'
    '"reference_answer":"你独立算出的参考最终答案",'
    '"student_answer":"识别到的学生最终答案",'
    '"steps":[{"text":"该步骤内容概要","verdict":"correct|wrong|unclear","reason":"若wrong说明错因，其余留空"}],'
    '"result":"correct|partial|wrong",'
    '"error_type":"计算错误|概念误解|逻辑跳步|符号规范|方法选择|无",'
    '"suggestion":"一条改进建议"}],'
    '"overall":"总体评价一句话","praise":"值得肯定的一点"}'
)

_VISION_EXTRACT_PROMPT = (
    "提取图片中的数学题目为纯文本，公式用 LaTeX（行内 $...$），多题用 1. 2. 3. 编号分行。"
    "只输出题目文本本身，不要解答、不要任何说明或前缀。如果图中没有题目，只输出 NO_QUESTION。"
)

_VISION_EXPLAIN_PROMPT = (
    "你是数跃 AI 数学辅导老师（学生来自高考体系、正读中外合办大学一年级）。图片是教材/笔记/知识点页面。"
    "请讲解图中知识点，严格用四层结构（markdown 标题）：\n"
    "## 高考阶段（你已会的）\n## 大学阶段（现在要学的）\n## 深层理解（为什么这样定义）\n## 前沿/应用（哪里会用到）\n"
    "关键术语首次出现附中英对照（如 supremum 上确界），数学用 LaTeX。"
)

_VISION_ASK_PROMPT = (
    "你是数跃 AI 数学辅导老师（中外合办大学一年级，学生来自高考体系）。"
    "请结合图片内容回答学生的附言问题。数学用 LaTeX，markdown 输出，关键术语附中英对照。"
)


def _extract_grade_json(raw: str):
    """Tolerant JSON extraction for VL grading output (P8 regression fix).
    VL occasionally emits stray quotes near structural chars (}"] instead of }])
    or trailing chatter. Four-level fallback:
      ① strict parse of the {..} slice
      ② targeted repairs for VL's frequent glitch patterns (stray quote / trailing comma)
      ③ balanced-brace salvage: parse each problem object inside "problems":[..]
      ④ None (caller returns raw + parse_error to the client)."""
    if not raw:
        return None
    body = raw.strip()
    if body.startswith("```"):
        body = body.strip("`").lstrip("jsonJSON").strip()
    i0, i1 = body.find("{"), body.rfind("}")
    if i0 < 0 or i1 <= i0:
        return None
    seg = body[i0:i1 + 1]
    # ① strict
    try:
        return json.loads(seg)
    except Exception:
        pass
    # ② targeted glitch repairs
    repairs = (
        lambda s: re.sub(r'(?<=[\}\]])"(?=[\],])', "", s),   # stray " before ]/, (incident case }"])
        lambda s: re.sub(r'(?<=,)\s*"(?=\])', "", s),        # dangling " before ]
        lambda s: re.sub(r',\s*([\]}])', r"\1", s),          # trailing comma before ]/}
    )
    for rep in repairs:
        try:
            return json.loads(rep(seg))
        except Exception:
            continue
    # ③ balanced-brace salvage of individual problem objects
    m = re.search(r'"problems"\s*:\s*\[', seg)
    if m:
        arr = seg[m.end():]
        problems, depth, start, in_str, esc = [], 0, -1, False, False
        for idx, ch in enumerate(arr):
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == "{":
                if depth == 0:
                    start = idx
                depth += 1
            elif ch == "}":
                if depth > 0:
                    depth -= 1
                    if depth == 0 and start >= 0:
                        frag = arr[start:idx + 1]
                        for cand in (frag,) + tuple(rep(frag) for rep in repairs):
                            try:
                                po = json.loads(cand)
                                if isinstance(po, dict):
                                    problems.append(po)
                                    break
                            except Exception:
                                continue
        if problems:
            return {"problems": problems, "overall": "", "praise": "",
                    "salvaged": True}
    return None


def _vision_quota_left(conn, user_id: str) -> int:
    row = conn.execute(
        "SELECT grade_count FROM vision_usage WHERE user_id=? AND day=date('now')",
        (user_id,)).fetchone()
    return VISION_GRADE_DAILY_LIMIT - (row["grade_count"] if row else 0)


def _vision_metrics(user_id, intent, steps, total_ms, tokens, err, text, out_preview):
    try:
        conn = get_db()
        conn.execute(
            "INSERT INTO agent_metrics (session_id,user_id,env,intent,skill,fast_path,steps,"
            "n_tools,tools_fail,total_ms,total_tokens,interrupted,error,input_preview,output_preview) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("", user_id, ENV_NAME, f"vision:{intent}", "", 0,
             json.dumps(steps, ensure_ascii=False)[:4000],
             len(steps), sum(1 for s in steps if not s.get("ok")), total_ms, tokens,
             0, (err or "")[:120], (text or "")[:500], (out_preview or "")[:500]))
        conn.commit(); conn.close()
    except Exception as e:
        print(f"[vision] metrics failed: {e}")


class VisionChatRequest(BaseModel):
    image_base64: str = ""
    mime: str = "image/jpeg"
    text: str = ""
    history: List[dict] = []


@app.post("/api/vision/chat")
def vision_chat(req: VisionChatRequest,
                current_user: Optional[dict] = Depends(get_current_user)):
    """P8: paste-and-ask vision endpoint (SSE). Image is ephemeral — never stored.
    grade (20/day quota) | solve (VL extract → harness pipeline) | explain | ask."""
    if not current_user:
        raise HTTPException(401, "请登录后使用图片功能")
    if not req.image_base64:
        raise HTTPException(400, "Missing image")
    if req.mime not in VISION_MIME_OK:
        raise HTTPException(400, f"不支持的图片格式 {req.mime}（支持 jpg/png/webp/bmp；"
                                 "iPhone 请设置相机'兼容性最好'）")
    if len(req.image_base64) * 3 // 4 > VISION_MAX_BYTES:
        raise HTTPException(413, "图片过大（>8MB），请裁剪后重试")
    user_id = current_user["id"]
    text = (req.text or "").strip() or "帮我批改"

    def sse(ev: dict):
        return "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"

    def stream():
        t0 = time.time()
        tokens = 0
        steps = []
        intent = ""
        err = ""
        out = ""
        try:
            # ---- intent routing (flash on text; vl-flash on image when no note) ----
            if (req.text or "").strip() or req.history:
                intent = _vision_intent_from_text(req.text)
            else:
                yield sse({"type": "status", "text": "识别图片类型…"})
                intent = _vision_intent_from_image(req.image_base64, req.mime)
            yield sse({"type": "vision_intent", "intent": intent})

            # ---- grade: quota + structured rubric ----
            if intent == "grade":
                conn = get_db()
                left = _vision_quota_left(conn, user_id)
                if left <= 0:
                    conn.close()
                    yield sse({"type": "quota_exceeded",
                               "limit": VISION_GRADE_DAILY_LIMIT,
                               "message": f"今日批改 {VISION_GRADE_DAILY_LIMIT} 次已用完，明天再来～ 解题和讲解不受限制"})
                    _vision_metrics(user_id, "grade", [], int((time.time()-t0)*1000), 0,
                                    "quota_exceeded", text, "")
                    yield "data: [DONE]\n\n"
                    return
                conn.execute(
                    "INSERT INTO vision_usage(user_id,day,grade_count) VALUES(?,date('now'),1) "
                    "ON CONFLICT(user_id,day) DO UPDATE SET grade_count=grade_count+1",
                    (user_id,))
                conn.commit()
                left2 = _vision_quota_left(conn, user_id)
                conn.close()

                yield sse({"type": "status", "text": "识别手写内容…"})
                ts = time.time()
                raw, tokens = _vl_call(VISION_MODEL_PLUS, req.image_base64, req.mime,
                                       _VISION_GRADE_PROMPT, max_tokens=3000)
                steps.append({"type": "vl", "name": VISION_MODEL_PLUS,
                              "ms": int((time.time()-ts)*1000), "ok": bool(raw)})
                parsed = _extract_grade_json(raw)
                if parsed is None:
                    err = "grade_parse_error"
                # Fix B — equivalence safety net: VL may judge a mathematically
                # equivalent answer as wrong over notation form (4·4 vs 16).
                # Cross-check final answers with the F3 verifier (P0-tested 8/8);
                # equivalent (conf≥0.85) overrides result to correct.
                if isinstance(parsed, dict):
                    try:
                        from agent.decision import answer_equivalence
                    except Exception:
                        answer_equivalence = None
                    for p in parsed.get("problems", []):
                        if not isinstance(p, dict) or p.get("result") == "correct":
                            continue
                        ref = str(p.get("reference_answer") or "").strip()
                        stu = str(p.get("student_answer") or "").strip()
                        if not (ref and stu and ref != stu and answer_equivalence):
                            continue
                        try:
                            eq = answer_equivalence(ref, stu)
                            if eq.get("equivalent") and float(eq.get("confidence", 0)) >= 0.85:
                                p["result"] = "correct"
                                p["error_type"] = "无"
                                p["equivalence_override"] = True
                                note = "最终答案与参考数学等价（仅记号/化简形式不同）"
                                p["suggestion"] = ((p.get("suggestion") or "").strip("｜") + "｜" + note).strip("｜")
                                for s in p.get("steps", []):
                                    if s.get("verdict") == "wrong" and "等价" not in (s.get("reason") or ""):
                                        s["verdict"] = "correct"
                                        s["reason"] = ""
                        except Exception as _eqe:
                            print(f"[vision] equivalence check failed: {_eqe}")
                yield sse({"type": "grade_result",
                           "result": parsed or {"raw": raw[:2000], "parse_error": True},
                           "quota_left": left2})
                out = raw[:500]

            # ---- solve: vl-flash extract → harness pipeline (verified) ----
            elif intent == "solve":
                yield sse({"type": "status", "text": "提取题目…"})
                ts = time.time()
                question, u1 = _vl_call(VISION_MODEL_FLASH, req.image_base64, req.mime,
                                        _VISION_EXTRACT_PROMPT, max_tokens=800)
                tokens += u1
                steps.append({"type": "vl", "name": VISION_MODEL_FLASH,
                              "ms": int((time.time()-ts)*1000), "ok": True})
                if not question or "NO_QUESTION" in question:
                    yield sse({"type": "text", "delta": "图片中未识别出题目。请拍清题目本身，或直接打字描述问题～"})
                    _vision_metrics(user_id, "solve", steps, int((time.time()-t0)*1000),
                                    tokens, "no_question", text, "")
                    yield "data: [DONE]\n\n"
                    return
                yield sse({"type": "status", "text": f"已识别题目：{question[:60]}…"})
                yield sse({"type": "text", "delta": f"**识别到的题目**：{question}\n\n"})
                yield sse({"type": "status", "text": "解题中…（双车道 + 验证器）"})
                ts = time.time()
                result = solve_question(
                    question_text=question, options=None,
                    api_key=DASHSCOPE_API_KEY, model=MODEL,
                    base_url=BASE_URL.replace("/chat/completions", ""))
                steps.append({"type": "tool", "name": "solve_problem",
                              "ms": int((time.time()-ts)*1000),
                              "ok": bool((result or {}).get("solution"))})
                solution = (result or {}).get("solution") or "解题失败，请重试或打字描述题目。"
                # stream in chunks for perceived speed
                for i in range(0, len(solution), 120):
                    chunk = solution[i:i+120]
                    out += chunk
                    yield sse({"type": "text", "delta": chunk})
                    time.sleep(0.01)

            # ---- explain / ask: streaming VL-plus (concept-bridge style for explain) ----
            else:
                prompt = _VISION_EXPLAIN_PROMPT if intent == "explain" else _VISION_ASK_PROMPT
                if intent == "explain":
                    prompt += f"\n学生附言：{text}" if (req.text or "").strip() else ""
                else:
                    prompt += f"\n学生问题：{text}"
                yield sse({"type": "status", "text": "思考中…"})
                ts = time.time()
                resp = _vl_stream(VISION_MODEL_PLUS, req.image_base64, req.mime,
                                  prompt, history=req.history)
                for line in resp.iter_lines(decode_unicode=True):
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        ev = json.loads(payload)
                        delta = (ev.get("choices") or [{}])[0].get("delta", {}).get("content", "")
                        if ev.get("usage"):
                            tokens += int(ev["usage"].get("total_tokens", 0) or 0)
                    except Exception:
                        continue
                    if delta:
                        out += delta
                        yield sse({"type": "text", "delta": delta})
                steps.append({"type": "vl", "name": VISION_MODEL_PLUS,
                              "ms": int((time.time()-ts)*1000), "ok": bool(out)})

            yield sse({"type": "usage", "total_tokens": tokens, "intent": intent})
            yield "data: [DONE]\n\n"
        except Exception as e:
            err = str(e)[:120]
            yield sse({"type": "error", "text": f"图片处理失败：{err}（可重试或改打字提问）"})
            yield "data: [DONE]\n\n"
        finally:
            _vision_metrics(user_id, intent or "unknown", steps,
                            int((time.time()-t0)*1000), tokens, err, text, out)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ============================================================================
# AGENT V4 (P2) · Workspaces (G1) + agent chat loop (A1/F/B)
# ============================================================================

class AgentSessionCreate(BaseModel):
    title: str = ""

class AgentSessionRename(BaseModel):
    title: str

class AgentChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    skill: Optional[str] = None
    history: List[dict] = []   # guest / no-workspace context (client-held)
    approved_tools: List[str] = []   # P3 E1: session write-tool approvals

# ============================================================================
# P3 · G2: Context Compaction (auto ≥80% budget + manual)
# ============================================================================

_COMPACT_CONTEXT_BUDGET = 16000   # ~chars of message history before compaction
_KEEP_RECENT_TURNS = 5            # recent rounds kept verbatim after compaction

_COMPACT_SYSTEM = (
    "你是学习助手数跃。将以下学习对话压缩为结构化摘要，用于后续继续辅导。"
    "用中文输出以下四节（Markdown）：\n"
    "## 学过的概念\n（列出讨论过的知识点，一行一个）\n"
    "## 犯过的错误\n（学生的错误模式和纠正，如有）\n"
    "## 当前卡点\n（学生目前在哪里卡住/正在解决的问题）\n"
    "## 教学要点\n（哪些讲解方式有效、学生的偏好）\n"
    "保留所有数学细节和术语，控制在500字以内。"
)

def _should_compact(history: list) -> bool:
    total = sum(len(str(m.get("content", ""))) for m in history)
    return total >= _COMPACT_CONTEXT_BUDGET * 0.8

def _compact_session(conn, session_id: str, user_id: str):
    """G2: summarize old messages → replace with a summary row, keep recent N turns."""
    rows = conn.execute(
        "SELECT id, role, content FROM chat_messages WHERE session_id=? ORDER BY id",
        (session_id,)).fetchall()
    if len(rows) <= _KEEP_RECENT_TURNS * 2:
        return {"compacted": False, "reason": "too_short", "kept": len(rows)}
    recent = rows[-(_KEEP_RECENT_TURNS * 2):]
    old = rows[:-(_KEEP_RECENT_TURNS * 2)]
    old_text = "\n".join(f"[{r['role']}]: {r['content'][:500]}" for r in old[:40])
    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": _COMPACT_SYSTEM},
                {"role": "user", "content": old_text[:12000]},
            ],
            "temperature": 0.2, "max_tokens": 1500, "enable_thinking": False,
        }, timeout=90)
        resp.raise_for_status()
        summary = resp.json()["choices"][0]["message"].get("content", "").strip()
    except Exception as e:
        return {"compacted": False, "reason": f"summarize_failed: {e}", "kept": len(rows)}
    if not summary:
        return {"compacted": False, "reason": "empty_summary", "kept": len(rows)}
    recent_ids = [r["id"] for r in recent]
    conn.execute(
        f"DELETE FROM chat_messages WHERE session_id=? AND id NOT IN "
        f"({','.join('?' * len(recent_ids))})",
        [session_id] + recent_ids)
    conn.execute(
        "INSERT INTO chat_messages (session_id,role,content,meta) VALUES (?,?,?,?)",
        (session_id, "system", summary,
         json.dumps({"type": "compaction_summary"}, ensure_ascii=False)))
    conn.commit()
    return {"compacted": True, "summary": summary[:200], "removed": len(old),
            "kept": len(recent) + 1}


@app.post("/api/agent/sessions/{sid}/compact")
def compact_session(sid: str, current_user: dict = Depends(get_current_user)):
    """G2: manually trigger context compaction."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    try:
        row = conn.execute("SELECT user_id FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        if not row:
            conn.close(); raise HTTPException(404, "Not found")
        if row["user_id"] != current_user["id"]:
            conn.close(); raise HTTPException(403, "Access denied")
        return _compact_session(conn, sid, current_user["id"])
    finally:
        try: conn.close()
        except Exception: pass


# ============================================================================
# P3 · G5: Long-term memory (semi-auto: /finish extracts candidates → user
# confirms → stored; injected into new sessions ≤300tk; transparency page)
# ============================================================================

_FINISH_SYSTEM = (
    "你是学习助手数跃。根据以下对话完成两个任务：\n"
    "1. 用3-5句中文总结本次学习对话的核心内容。\n"
    "2. 提取值得长期记住的信息（学生的偏好、薄弱点、学习习惯、重要事实）。\n"
    "输出JSON:\n"
    '{"summary": "...", "candidates": [{"kind": "profile|episodic|preference", "content": "..."}]}\n'
    "kind说明: profile=学生画像（水平/背景）, episodic=学习事件（某次卡在哪）, preference=偏好（喜欢中文讲解等）。\n"
    "candidates 最多5条，每条≤50字。没有值得记的就返回空数组。"
)

class MemorySaveRequest(BaseModel):
    items: List[dict] = []          # [{kind, content}]
    session_id: str = ""

@app.post("/api/agent/sessions/{sid}/finish")
def finish_session(sid: str, current_user: dict = Depends(get_current_user)):
    """G5 /完成: summarize the session + extract memory candidates (user confirms)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    try:
        row = conn.execute("SELECT user_id FROM chat_sessions WHERE id=?", (sid,)).fetchone()
        if not row:
            conn.close(); raise HTTPException(404, "Not found")
        if row["user_id"] != current_user["id"]:
            conn.close(); raise HTTPException(403, "Access denied")
        msgs = conn.execute(
            "SELECT role, content FROM chat_messages WHERE session_id=? "
            "ORDER BY id DESC LIMIT 30", (sid,)).fetchall()
    finally:
        conn.close()
    if not msgs:
        raise HTTPException(400, "会话为空")
    transcript = "\n".join(f"[{m['role']}]: {m['content'][:400]}" for m in reversed(msgs))
    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": _FINISH_SYSTEM},
                {"role": "user", "content": transcript[:12000]},
            ],
            "temperature": 0.2, "max_tokens": 1500, "enable_thinking": False,
            "response_format": {"type": "json_object"},
        }, timeout=90)
        resp.raise_for_status()
        txt = resp.json()["choices"][0]["message"].get("content", "{}")
        data = json.loads(txt)
    except Exception as e:
        raise HTTPException(502, f"Finish failed: {e}")
    return {
        "summary": data.get("summary", ""),
        "candidates": [c for c in (data.get("candidates") or [])
                       if isinstance(c, dict) and c.get("content")][:5],
    }

@app.post("/api/agent/memory")
def save_memory(req: MemorySaveRequest, current_user: dict = Depends(get_current_user)):
    """Store confirmed memory entries."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    try:
        saved = 0
        for item in req.items[:10]:
            kind = str(item.get("kind", "episodic"))
            content = str(item.get("content", "")).strip()[:200]
            if content and kind in ("profile", "episodic", "preference"):
                conn.execute(
                    "INSERT INTO memory_entries (user_id,kind,content,source_session) "
                    "VALUES (?,?,?,?)",
                    (current_user["id"], kind, content, req.session_id))
                saved += 1
        conn.commit()
    finally:
        conn.close()
    return {"saved": saved}

@app.get("/api/agent/memory")
def list_memory(current_user: dict = Depends(get_current_user)):
    """Transparency: list what the assistant remembers."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, kind, content, created_at FROM memory_entries "
            "WHERE user_id=? ORDER BY id DESC LIMIT 100",
            (current_user["id"],)).fetchall()
    finally:
        conn.close()
    return [{"id": r["id"], "kind": r["kind"], "content": r["content"],
             "created_at": r["created_at"]} for r in rows]

@app.delete("/api/agent/memory/{mid}")
def delete_memory(mid: int, current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    try:
        row = conn.execute("SELECT user_id FROM memory_entries WHERE id=?", (mid,)).fetchone()
        if not row:
            conn.close(); raise HTTPException(404, "Not found")
        if row["user_id"] != current_user["id"]:
            conn.close(); raise HTTPException(403, "Access denied")
        conn.execute("DELETE FROM memory_entries WHERE id=?", (mid,))
        conn.commit()
    finally:
        try: conn.close()
        except Exception: pass
    return {"deleted": True}

@app.delete("/api/agent/memory")
def clear_memory(current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    try:
        conn.execute("DELETE FROM memory_entries WHERE user_id=?", (current_user["id"],))
        conn.commit()
    finally:
        conn.close()
    return {"cleared": True}

@app.get("/api/agent/audit")
def get_audit_log(limit: int = 50, current_user: dict = Depends(get_current_user)):
    """P4 E5: recent tool calls for the user."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT tool_name, args_summary, result_summary, created_at "
            "FROM tool_audit_log WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (current_user["id"], max(1, min(200, limit)))).fetchall()
    finally:
        conn.close()
    return [{"tool": r["tool_name"], "args": r["args_summary"],
             "result": r["result_summary"], "time": r["created_at"]} for r in rows]


# ============================================================================
# P5 C13: Document Study Guide (textbook → structured knowledge, book-to-skill inspired)
# ============================================================================

_STUDY_GUIDE_SYSTEM = (
    "你是教材知识蒸馏器。将教材文本蒸馏为结构化学习指南（JSON格式）。"
    "只输出 JSON，不要其他文字。格式：\n"
    '{"chapters": [{"id": "ch01", "title": "章节名", "summary": "核心内容摘要(200字内)"}],'
    ' "glossary": [{"term_en": "supremum", "term_zh": "上确界", "chapter": "ch03", "def": "定义(50字内)"}],'
    ' "patterns": [{"name": "证明极限三步法", "desc": "猜值→找N→正向书写(100字内)"}]}\n'
    "规则：章节按教材实际结构划分（通常4-10章）；术语选大学级数学术语（10-20个）；"
    "模式是解题方法论（3-8个）；全部用中英双语。"
)

@app.post("/api/documents/{doc_id}/study-guide")
def generate_study_guide(doc_id: str, current_user: dict = Depends(get_current_user)):
    """C13: AI-distill a document into a structured study guide (chapters+glossary+patterns).
    Auto-triggered on textbook upload; manually triggerable for any document via the agent tool."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute(
        "SELECT user_id, title FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Not found")
    if row["user_id"] != current_user["id"]:
        conn.close(); raise HTTPException(403, "Access denied")
    conn.close()
    return _generate_guide_core(doc_id, row["title"])


def _generate_guide_core(doc_id: str, title: str) -> dict:
    """Shared study-guide generation logic — called by the REST endpoint AND the agent tool directly.
    No category restriction: textbooks auto-trigger, any doc can be manually distilled."""
    # Get text (ensure extraction first)
    if not ensure_pages_json(doc_id):
        raise HTTPException(400, "Document has no extractable text")
    pages_path = os.path.join(MINERU_DATA_DIR, doc_id, "pages.json")
    try:
        pages = json.load(open(pages_path, encoding="utf-8"))
    except Exception:
        raise HTTPException(500, "Failed to read extracted pages")
    full_text = "\n".join((p.get("text") or "") for p in pages)[:12000]  # cap for prompt

    # AI distillation
    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": _STUDY_GUIDE_SYSTEM},
                {"role": "user", "content": f"文档标题：{title}\n\n{full_text}"[:15000]},
            ],
            "temperature": 0.2, "max_tokens": 3000, "enable_thinking": False,
            "response_format": {"type": "json_object"},
        }, timeout=120)
        resp.raise_for_status()
        guide_text = resp.json()["choices"][0]["message"].get("content", "{}")
        guide = json.loads(guide_text)
    except json.JSONDecodeError:
        raise HTTPException(502, "AI returned invalid JSON for study guide")
    except Exception as e:
        raise HTTPException(502, f"Study guide generation failed: {e}")

    # Save to DB
    conn = get_db()
    conn.execute("UPDATE documents SET study_guide=? WHERE id=?",
                 (json.dumps(guide, ensure_ascii=False), doc_id))
    conn.commit(); conn.close()
    chapter_count = len(guide.get("chapters", []))
    glossary_count = len(guide.get("glossary", []))
    pattern_count = len(guide.get("patterns", []))
    return {"ok": True, "chapters": chapter_count, "glossary": glossary_count,
            "patterns": pattern_count}

def _memory_injection(user_id: str) -> str:
    """G5: build the ≤300tk memory block for the system prompt."""
    if not user_id:
        return ""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT kind, content FROM memory_entries WHERE user_id=? "
            "ORDER BY id DESC LIMIT 8", (user_id,)).fetchall()
    except Exception:
        return ""
    finally:
        try: conn.close()
        except Exception: pass
    if not rows:
        return ""
    lines = [f"- [{r['kind']}] {r['content']}" for r in reversed(rows)]
    block = "\n".join(lines)
    if len(block) > 1200:   # ~300 tokens
        block = block[:1200] + "\n…"
    return ("\n\n===== 你记得关于这个学生的事 =====\n" + block +
            "\n（自然运用这些记忆，不要逐条朗读。）")

@app.get("/api/agent/sessions")
def list_agent_sessions(current_user: dict = Depends(get_current_user)):
    """G1 — list the user's workspaces (newest first)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    rows = conn.execute(
        "SELECT s.id, s.title, s.updated_at,"
        " (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id=s.id) AS msgs"
        " FROM chat_sessions s WHERE s.user_id=?"
        " ORDER BY s.updated_at DESC LIMIT 100",
        (current_user["id"],),
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "title": r["title"], "updated_at": r["updated_at"],
             "messages": r["msgs"]} for r in rows]

@app.post("/api/agent/sessions")
def create_agent_session(req: AgentSessionCreate, current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Please log in")
    sid = "ws_" + str(uuid.uuid4())[:10]
    title = (req.title or "").strip()[:40] or "新工作台"
    conn = get_db()
    conn.execute("INSERT INTO chat_sessions (id,user_id,title) VALUES (?,?,?)",
                 (sid, current_user["id"], title))
    conn.commit(); conn.close()
    return {"id": sid, "title": title}

@app.put("/api/agent/sessions/{sid}")
def rename_agent_session(sid: str, req: AgentSessionRename,
                         current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute("SELECT user_id FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Not found")
    if row["user_id"] != current_user["id"]:
        conn.close(); raise HTTPException(403, "Access denied")
    conn.execute("UPDATE chat_sessions SET title=?, updated_at=datetime('now') WHERE id=?",
                 ((req.title or "").strip()[:40] or "新工作台", sid))
    conn.commit(); conn.close()
    return {"renamed": True}

@app.delete("/api/agent/sessions/{sid}")
def delete_agent_session(sid: str, current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute("SELECT user_id FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Not found")
    if row["user_id"] != current_user["id"]:
        conn.close(); raise HTTPException(403, "Access denied")
    conn.execute("DELETE FROM chat_messages WHERE session_id=?", (sid,))
    conn.execute("DELETE FROM chat_sessions WHERE id=?", (sid,))
    conn.commit(); conn.close()
    return {"deleted": True}

@app.get("/api/agent/sessions/{sid}/messages")
def get_agent_session_messages(sid: str, current_user: dict = Depends(get_current_user)):
    """Restore a workspace's conversation (G1 — refresh-proof)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute("SELECT user_id FROM chat_sessions WHERE id=?", (sid,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Not found")
    if row["user_id"] != current_user["id"]:
        conn.close(); raise HTTPException(403, "Access denied")
    msgs = conn.execute(
        "SELECT role, content, meta FROM chat_messages WHERE session_id=? ORDER BY id",
        (sid,)).fetchall()
    conn.close()
    return [{"role": m["role"], "content": m["content"],
             "meta": json.loads(m["meta"] or "{}")} for m in msgs]

@app.post("/api/agent/chat")
def agent_chat(req: AgentChatRequest,
               current_user: Optional[dict] = Depends(get_current_user)):
    """
    V4 agent chat (A1 loop, decision-layer routed) as an SSE stream.
    Guests: full agent features minus persistence (E3 — tools see no user data).
    """
    from agent import loop as agent_loop
    from agent import decision as agent_decision

    user_id = current_user["id"] if current_user else None
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(400, "Empty message")

    # load workspace history (G1) — guests run context-free
    history = []
    conn = None
    if user_id and req.session_id:
        conn = get_db()
        row = conn.execute("SELECT user_id FROM chat_sessions WHERE id=?",
                           (req.session_id,)).fetchone()
        if row and row["user_id"] == user_id:
            rows = conn.execute(
                "SELECT role, content FROM chat_messages WHERE session_id=? "
                "ORDER BY id DESC LIMIT 24", (req.session_id,)).fetchall()
            history = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]
            # persist the user turn
            conn.execute("INSERT INTO chat_messages (session_id,role,content,meta) "
                         "VALUES (?,?,?,?)",
                         (req.session_id, "user", message,
                          json.dumps({"skill": req.skill or ""}, ensure_ascii=False)))
            conn.execute("UPDATE chat_sessions SET updated_at=datetime('now') WHERE id=?",
                         (req.session_id,))
            conn.commit()
            # P3 G2: auto-compact when history ≥ 80% budget (before building context)
            if _should_compact(history):
                try:
                    _c = _compact_session(conn, req.session_id, user_id)
                    if _c.get("compacted"):
                        rows = conn.execute(
                            "SELECT role, content FROM chat_messages WHERE session_id=? "
                            "ORDER BY id DESC LIMIT 24", (req.session_id,)).fetchall()
                        history = [{"role": r["role"], "content": r["content"]}
                                   for r in reversed(rows)]
                        print(f"[agent] auto-compacted session {req.session_id}: "
                              f"removed {_c['removed']} msgs")
                except Exception as e:
                    print(f"[agent] auto-compact failed: {e}")
        if conn:
            conn.close()
    elif not req.session_id and req.history:
        # guest / temporary chat: honour client-held context (server stays stateless)
        history = [m for m in req.history[-24:]
                   if isinstance(m, dict) and m.get("role") in ("user", "assistant")]

    # P3 G5: inject long-term memory as a leading system item (≤300tk)
    if user_id:
        _mb = _memory_injection(user_id)
        if _mb:
            history = [{"role": "system", "content": _mb}] + history

    # P3 D7: resolve @title references → inject document context
    import re as _re
    _at_refs = _re.findall(r'@([^\s@]{2,80})', message)
    if user_id and _at_refs:
        _doc_ctx = []
        conn3 = get_db()
        try:
            for ref in _at_refs[:3]:
                row = conn3.execute(
                    "SELECT id, title FROM documents WHERE user_id=? AND title LIKE ? "
                    "ORDER BY created_at DESC LIMIT 1",
                    (user_id, f"%{ref}%")).fetchone()
                if row:
                    pages_path = os.path.join(MINERU_DATA_DIR, row["id"], "pages.json")
                    text = ""
                    if os.path.exists(pages_path):
                        try:
                            pages = json.load(open(pages_path, encoding="utf-8"))
                            text = "\n".join((p.get("text") or "") for p in pages)[:2000]
                        except Exception:
                            pass
                    if not text:
                        from agent.tools import _read_doc
                        _rd = _read_doc(ref, user_id)
                        text = str((_rd.get("data") or {}).get("text", ""))[:2000]
                    if text:
                        _doc_ctx.append(f"=== 《{row['title']}》内容节选 ===\n{text}")
        finally:
            try: conn3.close()
            except Exception: pass
        if _doc_ctx:
            history = history + [{"role": "system", "content":
                "以下是学生引用的文档内容：\n" + "\n\n".join(_doc_ctx)}]

    def _persist(full_text):
        """Save the assistant turn + auto-title on first exchange (G1)."""
        if not (user_id and req.session_id and full_text):
            return
        try:
            conn2 = get_db()
            conn2.execute(
                "INSERT INTO chat_messages (session_id,role,content,meta) VALUES (?,?,?,?)",
                (req.session_id, "assistant", full_text, "{}"))
            row = conn2.execute(
                "SELECT title, (SELECT COUNT(*) FROM chat_messages WHERE session_id=?) n"
                " FROM chat_sessions WHERE id=?",
                (req.session_id, req.session_id)).fetchone()
            if row and (row["title"] == "新工作台" or not row["title"]):
                # v1.4: fire on any first successful persist (count guard removed —
                # an interrupted first turn no longer blocks auto-naming)
                title = agent_decision.auto_title(message)
                conn2.execute("UPDATE chat_sessions SET title=? WHERE id=?",
                              (title, req.session_id))
            conn2.commit(); conn2.close()
        except Exception as e:
            print(f"[agent] persist failed: {e}")

    # ---- P7 telemetry: per-run trace (Langfuse-style, low-cardinality names) ----
    _mx = {"steps": [], "pending_tool": None, "decision": {}, "tokens": 0,
           "t0": time.time(), "error": ""}

    def _mx_track(chunk: str):
        if not chunk.startswith("data: "):
            return
        try:
            ev = json.loads(chunk[6:].strip())
        except Exception:
            return
        et = ev.get("type")
        if et == "decision":
            _mx["decision"] = {"intent": ev.get("intent", ""),
                               "confidence": ev.get("confidence", 0),
                               "skill": ev.get("skill") or ""}
        elif et == "tool_call":
            _mx["pending_tool"] = {"name": ev.get("name", ""), "t0": time.time()}
        elif et == "tool_result":
            pt = _mx["pending_tool"] or {"name": ev.get("name", ""), "t0": _mx["t0"]}
            summary = str(ev.get("summary", ""))
            ok = not any(k in summary for k in ("失败", "未知工具", "上限", "error", "Error"))
            _mx["steps"].append({"type": "tool", "name": ev.get("name") or pt["name"],
                                 "ms": int((time.time() - pt["t0"]) * 1000), "ok": ok,
                                 "summary": summary[:80]})
            _mx["pending_tool"] = None
        elif et == "usage":
            _mx["tokens"] = int(ev.get("total_tokens") or 0)
        elif et == "error":
            _mx["error"] = str(ev.get("text", ""))[:120]

    def _mx_write(output_preview: str, interrupted: bool = False):
        """Single INSERT after the run — normal completion AND abort paths."""
        try:
            d = _mx["decision"]
            n_tools = sum(1 for s in _mx["steps"] if s["type"] == "tool")
            tools_fail = sum(1 for s in _mx["steps"] if s["type"] == "tool" and not s["ok"])
            fast_path = 1 if (d.get("intent") == "chat" and not d.get("skill")
                              and n_tools == 0) else 0
            conn4 = get_db()
            conn4.execute(
                "INSERT INTO agent_metrics (session_id,user_id,env,intent,skill,fast_path,"
                "steps,n_tools,tools_fail,total_ms,total_tokens,interrupted,error,"
                "input_preview,output_preview) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (req.session_id or "", user_id, ENV_NAME, d.get("intent", ""),
                 d.get("skill", ""), fast_path,
                 json.dumps(_mx["steps"], ensure_ascii=False)[:4000],
                 n_tools, tools_fail, int((time.time() - _mx["t0"]) * 1000),
                 _mx["tokens"], 1 if interrupted else 0, _mx["error"],
                 message[:500], output_preview[:500]))
            conn4.commit(); conn4.close()
        except Exception as e:
            print(f"[metrics] write failed: {e}")

    def stream():
        full_text = ""
        try:
            for chunk in agent_loop.run_agent(message, history, req.skill, user_id,
                                              approved_tools=req.approved_tools):
                yield chunk
                if chunk.startswith("data: "):
                    try:
                        ev = json.loads(chunk[6:].strip())
                        if ev.get("type") == "text" and ev.get("delta"):
                            full_text += ev["delta"]
                    except Exception:
                        pass
                    _mx_track(chunk)
            # persist BEFORE [DONE]: when the client sees DONE, the answer is
            # guaranteed to be in the DB (background-completion race fix).
            _persist(full_text)
            _mx_write(full_text)
            yield "data: [DONE]\n\n"
        except GeneratorExit:
            # client aborted (Esc/stop) — keep the partial answer for the workspace
            _persist(full_text)
            _mx_write(full_text, interrupted=True)
            raise
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)[:200]}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/api/agent/metrics/stats")
def agent_metrics_stats(days: int = 7, current_user: Optional[dict] = Depends(get_current_user)):
    """P7: production telemetry aggregates. Admin-only when ADMIN_EMAIL is set."""
    if not current_user:
        raise HTTPException(401, "Not authenticated")
    if ADMIN_EMAIL and current_user["email"] != ADMIN_EMAIL:
        raise HTTPException(403, "Admin only")
    conn = get_db()
    rows = conn.execute(
        "SELECT total_ms, n_tools, tools_fail, interrupted, fast_path, total_tokens, "
        "intent, error, env, created_at FROM agent_metrics "
        "WHERE created_at >= datetime('now', ?) AND env=?",
        (f"-{int(days)} days", ENV_NAME)).fetchall()
    conn.close()
    if not rows:
        return {"days": days, "env": ENV_NAME, "runs": 0}
    lat = sorted(r["total_ms"] for r in rows)
    n = len(rows)
    p95 = lat[min(n - 1, int(n * 0.95))]
    by_intent = {}
    for r in rows:
        by_intent[r["intent"] or "?"] = by_intent.get(r["intent"] or "?", 0) + 1
    tools = sum(r["n_tools"] for r in rows)
    fails = sum(r["tools_fail"] for r in rows)
    return {
        "days": days, "env": ENV_NAME, "runs": n,
        "avg_ms": sum(lat) // n, "p95_ms": p95,
        "interrupted_rate": round(sum(r["interrupted"] for r in rows) / n, 3),
        "fast_path_share": round(sum(r["fast_path"] for r in rows) / n, 3),
        "tool_calls": tools,
        "tool_fail_rate": round(fails / tools, 3) if tools else 0.0,
        "total_tokens": sum(r["total_tokens"] for r in rows),
        "errors": sum(1 for r in rows if r["error"]),
        "by_intent": by_intent,
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Streaming chat endpoint — routed through Harness V3 analysis layer."""
    question = req.messages[-1].get("content", "") if req.messages else ""

    # P1 · Skills: validate + load the requested Agent Skill (SKILL.md).
    # Unknown/absent names are silently ignored — chips are advisory, never fatal.
    skill_body = None
    if req.skill:
        skill_body = load_skill(req.skill)

    # Use the V3 analysis layer (TopicDetector + QuestionClassifier +
    # SmartRouter) when available; fall back to the legacy lexicon otherwise.
    analysis = _analyze_question_v3(question)
    if analysis:
        topic = analysis["topic"]
        qtype = analysis["qtype"]
        lane = analysis["lane"]
        is_weak = analysis["is_weak"]
        is_proof = analysis["is_proof"]
    else:
        topic = infer_topic(question)
        qtype = "Short"
        lane = "B" if should_use_verifier(topic) else "A"
        is_weak = should_use_verifier(topic)
        is_proof = False

    model = get_model_for_task(req.task_type)
    system_prompt = get_system_prompt(req.task_type)

    # P1 · Skills: append the active skill's instructions to the system prompt.
    # The skill rides AFTER the base persona so its methodology rules win.
    if skill_body:
        system_prompt = (
            system_prompt
            + "\n\n===== 当前启用的教学技能 ["
            + skill_label(req.skill)
            + "] =====\n请严格遵守以下教学方法的每一个要求：\n\n"
            + skill_body
        )

    # Build messages with Harness system prompt
    # Filter out any system messages from frontend to avoid conflicting instructions
    user_messages = [m for m in req.messages if m.get("role") != "system"]
    full_messages = [{"role": "system", "content": system_prompt}] + user_messages

    def stream_response():
        try:
            resp = requests.post(BASE_URL, headers={
                "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
                "Content-Type": "application/json",
            }, json={
                "model": model,
                "messages": full_messages,
                "temperature": req.temperature,
                "max_tokens": req.max_tokens,
                "stream": True,
                # Answer-first UX: keep visible content flowing immediately.
                # Some upstream models emit long reasoning/thinking deltas before
                # normal content, which makes the frontend look stuck.
                "enable_thinking": False,
            }, stream=True, timeout=120)

            if resp.status_code != 200:
                try:
                    body = resp.json()
                except Exception:
                    body = {"message": resp.text[:500]}
                detail = body.get("message") or body.get("error", {}).get("message") or str(body)[:500]
                yield f"data: {json.dumps({'error': f'AI provider error {resp.status_code}: {detail}'})}\n\n"
                yield "data: [DONE]\n\n"
                return

            full_text = ""
            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip() if line.startswith("data: ") else line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    event = json.loads(data_str)
                    choices = event.get("choices", [])
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {}).get("content", "")
                    if delta:
                        full_text += delta
                        # Filter <thinking> blocks for display (preserve full_text for verification)
                        display_delta = delta
                        if "<thinking>" in display_delta or "</thinking>" in display_delta:
                            display_delta = re.sub(r"<thinking>.*?</thinking>", "", display_delta, flags=re.DOTALL)
                        if display_delta:
                            yield f"data: {json.dumps({'content': display_delta, 'topic': topic, 'qtype': qtype, 'lane': lane})}\n\n"
                except json.JSONDecodeError:
                    continue

            # Strip thinking blocks before verification
            clean_text = re.sub(r"<thinking>.*?</thinking>", "", full_text, flags=re.DOTALL).strip()

            # Post-stream verification (added at the end, non-streaming)
            if req.task_type in ("math_solve", "general") and len(clean_text) > 50:
                if is_proof:
                    # Proof questions: Harness V3 ProofVerifier with LLM semantic grading
                    yield f"data: {json.dumps({'content': '\n\n---\n**Proof verification** (type: ' + qtype + ')...\n', 'topic': topic, 'verifier': True})}\n\n"
                    assessment = _verify_proof_v3(question, clean_text)
                    if assessment is not None:
                        icon = {"pass": "PASS", "needs_revision": "NEEDS REVISION", "fail": "FAIL"}.get(assessment.overall, "NEEDS REVISION")
                        yield f"data: {json.dumps({'content': f'**Proof verdict: {icon}** (score {assessment.score:.2f})\n{assessment.feedback}\n', 'verifier': True})}\n\n"
                    else:
                        yield f"data: {json.dumps({'content': 'Proof verification unavailable; treat the above with caution.\n', 'verifier': True})}\n\n"
                elif is_weak:
                    # Weak topics: legacy cross-check verifier
                    yield f"data: {json.dumps({'content': '\n\n---\n**Verifier check** (topic: ' + topic + ')...\n', 'topic': topic, 'verifier': True})}\n\n"
                    verification = run_verifier(
                        question,
                        clean_text,
                        full_messages
                    )
                    if "correct" in verification.lower() or "confirm" in verification.lower():
                        yield f"data: {json.dumps({'content': '**Verified**: Solution confirmed correct.\n', 'verifier': True})}\n\n"
                    else:
                        yield f"data: {json.dumps({'content': '**Verifier note**: ' + verification[:500] + '\n', 'verifier': True})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")

@app.post("/api/solve")
async def solve(req: SolveRequest):
    """Full Harness solve — uses harness_uk_math.py (Lane A/B voting + verifier)."""
    try:
        result = await asyncio.to_thread(
            solve_question,
            question_text=req.question,
            options=req.options,
            api_key=DASHSCOPE_API_KEY,
            model=MODEL,
            base_url=BASE_URL.replace("/chat/completions", ""),
        )
        return result
    except Exception as e:
        return {"error": str(e), "solution": "", "topic": "Other", "lane": "?"}

class TranslateRequest(BaseModel):
    text: str = ""
    target_lang: str = "zh"  # "zh" = to Chinese, "en" = to English, "auto" = detect

def _detect_lang(text: str) -> str:
    """Simple heuristic: >30% Chinese chars -> zh, else en."""
    chinese_chars = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    return "zh" if chinese_chars / max(len(text), 1) > 0.3 else "en"

@app.post("/api/translate")
async def translate(req: TranslateRequest):
    """Translation endpoint — uses cheaper qwen-7b-instruct with auto language detection."""
    if not req.text:
        return {"error": "No text provided", "translation": ""}

    source = _detect_lang(req.text)
    target = req.target_lang if req.target_lang in ("zh", "en") else ("en" if source == "zh" else "zh")

    if source == target:
        return {"translation": req.text, "model": "none", "note": "Source and target language are the same."}

    if target == "zh":
        system_prompt = (
            "You are an academic translator specialising in mathematics and computer science. "
            "Translate the following English text into natural, fluent Chinese. "
            "Preserve all LaTeX formulas unchanged. "
            "Format: **翻译**: [Chinese translation] **释义**: [1-sentence explanation of key terms]."
        )
    else:
        system_prompt = (
            "You are an academic translator specialising in mathematics and computer science. "
            "Translate the following Chinese text into natural, fluent English. "
            "Preserve all LaTeX formulas unchanged. "
            "Format: **Translation**: [English translation] **Note**: [1-sentence explanation of key terms]."
        )

    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": TRANSLATE_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.text},
            ],
            "temperature": 0.1,
            "max_tokens": 1000,
        }, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            return {"error": "Empty response from model", "translation": ""}
        return {"translation": choices[0]["message"]["content"], "model": TRANSLATE_MODEL, "source_lang": source, "target_lang": target}
    except Exception as e:
        return {"error": str(e), "translation": ""}

# ============================================================================
# DOCUMENTS API (PDF/PPTX upload + bookshelf)
# ============================================================================

class NoteCreate(BaseModel):
    title: str = ""
    tag: str = ""
    content: str = ""
    source: str = "manual"

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    tag: Optional[str] = None
    content: Optional[str] = None

class HighlightCreate(BaseModel):
    document_id: str
    page: int
    text: str
    color: str = "#faad14"
    note: str = ""

class HighlightUpdate(BaseModel):
    color: Optional[str] = None
    note: Optional[str] = None

@app.post("/api/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form("slides"),
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Upload PDF/PPTX file to server storage + database (requires login)."""
    if not current_user:
        raise HTTPException(401, "Please log in to upload documents")
    if not file.filename:
        raise HTTPException(400, "No filename")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "pdf"
    if ext not in ("pdf", "pptx"):
        raise HTTPException(400, f"Unsupported file type: {ext}. Only PDF and PPTX allowed.")
    doc_id = str(uuid.uuid4())[:8]
    # Sanitize filename to prevent path traversal
    clean_filename = os.path.basename(file.filename.replace('\x00', ''))
    safe_name = f"{doc_id}_{clean_filename}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)
    # Ensure the resolved path is within UPLOAD_DIR
    if os.path.commonpath([os.path.abspath(file_path), os.path.abspath(UPLOAD_DIR)]) != os.path.abspath(UPLOAD_DIR):
        raise HTTPException(400, "Invalid filename")
    content = await file.read()
    file_size = len(content)
    # Textbook-size limit (MinerU era: scanned textbooks can be large)
    if file_size > MINERU_MAX_UPLOAD:
        raise HTTPException(400, "File too large (max 200MB)")
    with open(file_path, "wb") as f:
        f.write(content)
    # MinerU detector: sampled text-layer check decides scanned vs native PDF
    try:
        needs_ocr = detect_needs_ocr(Path(file_path))
    except Exception:
        needs_ocr = False
    title = file.filename.rsplit(".", 1)[0]
    conn = get_db()
    conn.execute(
        "INSERT INTO documents (id,user_id,title,filename,file_path,category,source,file_size,file_type,"
        "needs_ocr,ai_declined,parse_status) VALUES (?,?,?,?,?,?,?,?,'pdf',?,0,'none')",
        (doc_id, current_user["id"], title, file.filename, safe_name, category, "upload", file_size, int(needs_ocr))
    )
    conn.commit(); conn.close()
    icons = {"pdf": "file-text", "pptx": "presentation"}

    # P5 C13: auto-generate study guide for textbooks (background, ~30s one-time cost)
    if category == "textbooks":
        import threading
        def _bg_guide():
            try:
                if ensure_pages_json(doc_id):
                    _r = requests.post(
                        f"http://127.0.0.1:{PORT}/api/documents/{doc_id}/study-guide",
                        headers={"Authorization": "Bearer " + create_access_token(data={"sub": current_user["id"]})},
                        timeout=180)
                    if _r.status_code == 200:
                        _g = _r.json()
                        print(f"[guide] {doc_id}: {_g.get('chapters',0)} chapters, {_g.get('glossary',0)} terms, {_g.get('patterns',0)} patterns")
                    else:
                        print(f"[guide] auto-guide for {doc_id} returned {_r.status_code}")
            except Exception as e:
                print(f"[guide] auto-guide failed for {doc_id}: {e}")
        threading.Thread(target=_bg_guide, daemon=True).start()

    return {"id": doc_id, "title": title, "filename": file.filename,
            "category": category, "icon": icons.get(ext, "file-text"),
            "fileType": ext, "fileSize": file_size,
            "sizeText": f"{file_size/1024/1024:.1f} MB", "source": "upload",
            "needsOcr": bool(needs_ocr), "parseStatus": "none", "aiDeclined": False}


@app.get("/api/documents")
async def list_documents(
    category: Optional[str] = None,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """List current user's documents, optionally filtered by category."""
    conn = get_db()
    if current_user:
        if category and category != "all":
            rows = conn.execute(
                "SELECT * FROM documents WHERE user_id=? AND category=? ORDER BY created_at DESC",
                (current_user["id"], category)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM documents WHERE user_id=? ORDER BY created_at DESC",
                (current_user["id"],)
            ).fetchall()
    else:
        # Guest: return empty (guest docs stored in frontend memory only)
        rows = []
    conn.close()
    icons = {"pdf": "file-text", "pptx": "presentation"}
    return [{"id": r["id"], "title": r["title"], "category": r["category"],
             "icon": icons.get(r["file_type"], "file-text"), "desc": f"{r['file_size']/1024/1024:.1f} MB",
             "source": r["source"], "fileType": r["file_type"],
             "filename": r["filename"], "filePath": r["file_path"],
             "createdAt": r["created_at"],
             "needsOcr": bool(r["needs_ocr"]), "parseStatus": r["parse_status"],
             "aiDeclined": bool(r["ai_declined"])} for r in rows]

@app.get("/api/documents/{doc_id}/file")
async def get_document_file(
    doc_id: str,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Download/serve the actual file for PDF.js rendering."""
    conn = get_db()
    row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Document not found")
    # Permission check: only owner can access (guests denied)
    if not current_user or row["user_id"] != current_user["id"]:
        raise HTTPException(403, "Access denied")
    file_path = os.path.join(UPLOAD_DIR, row["file_path"])
    # Prevent path traversal from database records
    if os.path.commonpath([os.path.abspath(file_path), os.path.abspath(UPLOAD_DIR)]) != os.path.abspath(UPLOAD_DIR):
        raise HTTPException(403, "Invalid file path")
    if not os.path.exists(file_path):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(file_path, filename=row["filename"])

@app.delete("/api/documents/{doc_id}")
async def delete_document(
    doc_id: str,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Delete document from database + disk."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Not found")
    if row["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Access denied")
    conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    conn.commit()
    # MinerU: purge parse state alongside the document
    conn.execute("DELETE FROM doc_chunks WHERE doc_id=?", (doc_id,))
    conn.execute("DELETE FROM doc_embeddings WHERE doc_id=?", (doc_id,))
    conn.commit(); conn.close()
    file_path = os.path.join(UPLOAD_DIR, row["file_path"])
    # Prevent path traversal from database records
    if os.path.commonpath([os.path.abspath(file_path), os.path.abspath(UPLOAD_DIR)]) == os.path.abspath(UPLOAD_DIR):
        if os.path.exists(file_path):
            os.remove(file_path)
    import shutil
    mineru_dir = os.path.join(MINERU_DATA_DIR, doc_id)
    if os.path.exists(mineru_dir):
        shutil.rmtree(mineru_dir, ignore_errors=True)
    return {"deleted": doc_id}

# ============================================================================
# MINERU API (BYOT: bring-your-own-token) + reader RAG
# ============================================================================

class MineruTokenReq(BaseModel):
    token: str


@app.put("/api/user/mineru-token")
async def set_mineru_token(req: MineruTokenReq, current_user: dict = Depends(get_current_user)):
    """Store the user's personal MinerU API key (Fernet-encrypted, write-only)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    token = req.token.strip()
    if not token.startswith("sk-") or len(token) < 20:
        raise HTTPException(400, "Invalid key format — a MinerU API key starts with 'sk-'")
    if not validate_token(token):
        raise HTTPException(400, "MinerU rejected this key — please double-check it (Avatar → API Key)")
    encrypted = get_fernet().encrypt(token.encode()).decode()
    conn = get_db()
    conn.execute("UPDATE users SET mineru_token_enc=? WHERE id=?", (encrypted, current_user["id"]))
    conn.commit(); conn.close()
    return {"configured": True}


@app.get("/api/user/mineru-token")
async def get_mineru_token_status(current_user: dict = Depends(get_current_user)):
    """Never returns the key itself — only whether one is stored."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    return {"configured": bool(get_user_mineru_token(current_user["id"]))}


@app.get("/api/user/mineru-usage")
async def get_mineru_usage(current_user: dict = Depends(get_current_user)):
    """Today's MinerU page usage for this user (local ledger, resets daily)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    used = mineru_usage_today(current_user["id"])
    return {"day": _mineru_today(), "used": used,
            "limit": MINERU_DAILY_LIMIT, "remaining": max(0, MINERU_DAILY_LIMIT - used)}


@app.get("/api/documents/parsing")
async def list_parsing_documents(current_user: dict = Depends(get_current_user)):
    """Pending-parse list with live progress (DB-driven; powers the global tracker)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    rows = conn.execute(
        "SELECT id,title,parse_status FROM documents "
        "WHERE user_id=? AND parse_status IN ('queued','parsing','indexing')",
        (current_user["id"],),
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        live = PARSE_STATUS.get(r["id"], {})
        result.append({
            "id": r["id"],
            "title": r["title"],
            "status": r["parse_status"],
            "phase": live.get("phase", r["parse_status"]),
            "pages_done": live.get("pages_done", 0),
            "total_pages": live.get("total_pages", 0),
        })
    return result


@app.post("/api/documents/{doc_id}/parse")
async def trigger_parse(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Explicitly start MinerU re-layout for a scanned doc (uses the user's own key)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute("SELECT * FROM documents WHERE id=? AND user_id=?", (doc_id, current_user["id"])).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Not found")
    live = PARSE_STATUS.get(doc_id, {}).get("status")
    state = live if live in ("queued", "parsing", "indexing") else row["parse_status"]
    if state in ("queued", "parsing", "indexing"):
        if live:
            conn.close()
            return {"status": state}
        # Orphan recovery: DB says active but no worker record (server restarted
        # mid-parse) -> re-queue instead of being stuck in 'parsing' forever.
        conn.execute("UPDATE documents SET parse_status='queued', parse_error='' WHERE id=?", (doc_id,))
        conn.commit(); conn.close()
        PARSE_STATUS[doc_id] = {"status": "queued", "error": ""}
        PARSE_QUEUE.put(doc_id)
        return {"status": "queued", "recovered": True}
    if not row["needs_ocr"] and row["category"] != "textbooks":
        conn.close()
        raise HTTPException(400, "This PDF already has selectable text — MinerU is not needed")
    if not get_user_mineru_token(current_user["id"]):
        conn.close()
        raise HTTPException(400, "MinerU API key not configured")
    # Quota pre-flight: refuse upfront rather than run out mid-book
    # (cached parts make a tomorrow-continue cost 0 extra pages)
    from pathlib import Path
    book_dir = Path(os.path.join(MINERU_DATA_DIR, doc_id))
    total_pages = count_pages(Path(os.path.join(UPLOAD_DIR, row["file_path"])))
    needed = mineru_pages_needed(book_dir, total_pages)
    remaining = MINERU_DAILY_LIMIT - mineru_usage_today(current_user["id"])
    if needed > remaining:
        conn.close()
        raise HTTPException(429, {
            "reason": "quota",
            "needed": needed,
            "remaining": max(0, remaining),
            "limit": MINERU_DAILY_LIMIT,
        })
    conn.execute("UPDATE documents SET parse_status='queued', parse_error='', ai_declined=0 WHERE id=?", (doc_id,))
    conn.commit(); conn.close()
    PARSE_STATUS[doc_id] = {"status": "queued", "error": ""}
    PARSE_QUEUE.put(doc_id)
    return {"status": "queued"}


@app.get("/api/documents/{doc_id}/parse")
async def parse_status(doc_id: str, current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute(
        "SELECT parse_status,parse_error,user_id FROM documents WHERE id=?", (doc_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Unknown document")
    if row["user_id"] != current_user["id"]:
        raise HTTPException(403, "Access denied")
    info = PARSE_STATUS.get(doc_id)
    quota = {"mineru_used": mineru_usage_today(row["user_id"]), "mineru_limit": MINERU_DAILY_LIMIT}
    if info:
        out = dict(info); out.update(quota)
        return out
    err = row["parse_error"] or ""
    err_l = err.lower()
    error_type = "auth" if "rejected" in err_l else ("quota" if "quota" in err_l else "")
    return {
        "status": row["parse_status"],
        "error": err,
        "error_type": error_type,
        **quota,
    }


@app.post("/api/documents/{doc_id}/decline-ai")
async def decline_ai(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Remember the user's 'not now' so we stop asking for this document."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    conn.execute("UPDATE documents SET ai_declined=1 WHERE id=? AND user_id=?", (doc_id, current_user["id"]))
    conn.commit(); conn.close()
    return {"ok": True}


class DocSearchRequest(BaseModel):
    query: str = ""
    topk: int = 6


# NOTE: sync endpoint — rag.retrieve makes a blocking DashScope embedding call,
# so it must stay off the event loop (FastAPI runs sync endpoints in a threadpool).
@app.post("/api/documents/{doc_id}/search")
def doc_search(doc_id: str, req: DocSearchRequest, current_user: dict = Depends(get_current_user)):
    """Whole-book RAG search: top chunks (FTS + embedding, RRF-fused) for a question."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    query = (req.query or "").strip()[:200]
    if not query:
        raise HTTPException(400, "Empty query")
    conn = get_db()
    row = conn.execute(
        "SELECT parse_status,user_id,category FROM documents WHERE id=?", (doc_id,)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Unknown document")
    if row["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Access denied")
    if row["category"] != "textbooks":
        conn.close()
        return {"chunks": [], "reason": "not_textbook"}
    if row["parse_status"] != "done":
        conn.close()
        return {"chunks": [], "reason": "not_parsed"}
    chunk_count = conn.execute(
        "SELECT COUNT(*) FROM doc_chunks WHERE doc_id=?", (doc_id,)
    ).fetchone()[0]
    if not chunk_count:
        conn.close()
        return {"chunks": [], "reason": "no_index"}
    try:
        results = rag.retrieve(conn, doc_id, query, DASHSCOPE_API_KEY,
                               topk=max(3, min(10, req.topk)))
    except Exception as e:  # noqa: BLE001
        conn.close()
        return {"chunks": [], "reason": f"retrieve_failed: {e}"}
    conn.close()
    # De-dup: at most one chunk per page, keep the top 3 distinct pages
    seen_pages = set()
    picked = []
    for c in results:
        if c["page"] in seen_pages:
            continue
        seen_pages.add(c["page"])
        picked.append({"page": c["page"], "text": c["text"][:600], "score": c.get("score", 0)})
        if len(picked) >= 3:
            break
    return {"chunks": picked, "reason": "ok"}


class TextbookSearchRequest(BaseModel):
    query: str = ""
    topk: int = 3


# Automatic textbook anchoring: search across ALL of the user's indexed
# textbooks (dual-path consensus). Sync endpoint — embeds the query once.
@app.post("/api/textbooks/search")
def textbooks_search(req: TextbookSearchRequest, current_user: dict = Depends(get_current_user)):
    """Cross-book RAG for the auto-anchor pipeline (cite [Book · Page N] or stay silent)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    query = (req.query or "").strip()[:200]
    if not query:
        raise HTTPException(400, "Empty query")
    conn = get_db()
    books = conn.execute(
        "SELECT id, title FROM documents WHERE user_id=? AND category='textbooks' AND parse_status='done'",
        (current_user["id"],),
    ).fetchall()
    if not books:
        conn.close()
        return {"chunks": [], "reason": "no_textbooks"}
    try:
        hits = rag.retrieve_multi(conn, [b["id"] for b in books], query,
                                  DASHSCOPE_API_KEY, topk=max(1, min(5, req.topk)))
    except Exception as e:  # noqa: BLE001
        conn.close()
        return {"chunks": [], "reason": f"retrieve_failed: {e}"}
    conn.close()
    titles = {b["id"]: b["title"] for b in books}
    seen = set()
    out = []
    for h in hits:
        key = (h["doc_id"], h["page"])
        if key in seen:
            continue
        seen.add(key)
        out.append({"doc_id": h["doc_id"], "book": titles.get(h["doc_id"], h["doc_id"]),
                    "page": h["page"], "text": h["text"][:600], "score": h["score"]})
    return {"chunks": out, "reason": "ok"}


class ConceptTraceRequest(BaseModel):
    answer_text: str = ""


# Post-answer concept tracing: extract theorems from a completed AI answer,
# then locate each in the user's indexed textbooks.
@app.post("/api/textbooks/concepts")
def textbooks_concepts(req: ConceptTraceRequest, current_user: dict = Depends(get_current_user)):
    """Extract key mathematical concepts from an AI answer and cite textbook pages."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    text = (req.answer_text or "").strip()[:3000]
    if len(text) < 30:
        return {"concepts": [], "reason": "answer_too_short"}

    # Phase 1: extract concepts via the cheap model.
    # Language follows the SOLUTION so the concept names hit textbooks written
    # in the same language; standard bilingual naming ("上确界 (supremum)")
    # additionally lets the zh<->en translated retrieval match the OTHER language.
    extract_prompt = (
        "List the mathematical theorems, formulas, and named methods used in this solution. "
        "Return each name in the SAME language as the solution; when a concept has a standard "
        "bilingual name, prefer the form \"中文名 (English Name)\". "
        "Return ONLY a JSON array of strings (max 4 items). No explanation.\n\n"
        f"Solution:\n{text}"
    )
    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": TRANSLATE_MODEL,   # cheap qwen-turbo is enough for extraction
            "messages": [
                {"role": "system", "content": "Output only a JSON array of strings."},
                {"role": "user", "content": extract_prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 200,
        }, timeout=30)
        body = resp.json()
        raw = body.get("choices", [{}])[0].get("message", {}).get("content", "[]")
        # Extract JSON array from the response
        import re as _re
        m = _re.search(r'\[.*?\]', raw, _re.DOTALL)
        names = json.loads(m.group()) if m else []
        names = [str(n).strip()[:80] for n in names if isinstance(n, str) and len(n.strip()) > 2][:4]
    except Exception as e:
        return {"concepts": [], "reason": f"extract_failed: {e}"}

    if not names:
        return {"concepts": [], "reason": "no_concepts"}

    # Phase 2: search textbooks for each concept
    conn = get_db()
    books = conn.execute(
        "SELECT id, title FROM documents WHERE user_id=? AND category='textbooks' AND parse_status='done'",
        (current_user["id"],),
    ).fetchall()
    if not books:
        conn.close()
        return {"concepts": [], "reason": "no_textbooks"}

    titles = {b["id"]: b["title"] for b in books}
    doc_ids = [b["id"] for b in books]
    concepts_out = []
    for name in names:
        try:
            hits = rag.retrieve_multi(conn, doc_ids, name, DASHSCOPE_API_KEY, topk=2)
        except Exception:
            continue
        if not hits:
            continue
        seen = set()
        citations = []
        for h in hits:
            key = (h["doc_id"], h["page"])
            if key in seen:
                continue
            seen.add(key)
            citations.append({"book": titles.get(h["doc_id"], h["doc_id"]),
                              "page": h["page"], "doc_id": h["doc_id"]})
        if citations:
            concepts_out.append({"name": name, "hits": citations})
    conn.close()
    return {"concepts": concepts_out, "reason": "ok"}


@app.get("/api/documents/{doc_id}/pages/{page_num}")
async def get_page_blocks(doc_id: str, page_num: int, current_user: dict = Depends(get_current_user)):
    """Structured blocks for one page (powers the reformatted reader view)."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    owner = conn.execute(
        "SELECT user_id FROM documents WHERE id=?", (doc_id,)
    ).fetchone()
    conn.close()
    if not owner:
        raise HTTPException(404, "Document not found")
    if owner["user_id"] != current_user["id"]:
        raise HTTPException(403, "Access denied")
    content_path = os.path.join(MINERU_DATA_DIR, doc_id, "content_list.json")
    if not os.path.exists(content_path):
        raise HTTPException(404, "Document not parsed yet")
    with open(content_path, "r", encoding="utf-8") as f:
        content = json.load(f)
    skip_types = {"header", "footer", "page_number", "aside_text", "page_footnote"}
    blocks = []
    total_pages = 0
    for block in content:
        btype = block.get("type", "text")
        if btype in skip_types:
            page_idx_for_total = block.get("page_idx", 0)
            total_pages = max(total_pages, page_idx_for_total + 1)
            continue
        page_idx = block.get("page_idx", 0)
        total_pages = max(total_pages, page_idx + 1)
        if page_idx != page_num - 1:
            continue
        text = (block.get("text") or "").strip()
        entry = {"type": btype, "text": text, "bbox": block.get("bbox")}
        if btype in ("text", "title") and block.get("text_level") is not None:
            entry["text_level"] = block["text_level"]
        if btype == "table":
            entry["html"] = (block.get("table_body") or "").strip()
            caption = " ".join(str(c) for c in (block.get("table_caption") or [])).strip()
            entry["caption"] = caption
            entry["text"] = caption or "[table]"
        elif btype in ("image", "chart"):
            caption = " ".join(str(c) for c in (block.get("image_caption") or [])).strip()
            entry["caption"] = caption
            entry["text"] = caption
        if not entry["text"] and not entry.get("html") and not entry.get("bbox"):
            continue
        blocks.append(entry)
    return {"page": page_num, "total_pages": total_pages, "blocks": blocks}

# ============================================================================
# NOTES API (CRUD)
# ============================================================================

@app.get("/api/notes")
async def list_notes(
    tag: Optional[str] = None,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """List current user's notes, optionally filtered by tag."""
    conn = get_db()
    if current_user:
        if tag and tag != "all":
            rows = conn.execute(
                "SELECT * FROM notes WHERE user_id=? AND tag=? ORDER BY updated_at DESC",
                (current_user["id"], tag)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM notes WHERE user_id=? ORDER BY updated_at DESC",
                (current_user["id"],)
            ).fetchall()
    else:
        rows = []
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/notes")
async def create_note(
    note: NoteCreate,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Create a new note (requires login)."""
    if not current_user:
        raise HTTPException(401, "Please log in to create notes")
    note_id = f"note_{int(time.time()*1000)}"
    conn = get_db()
    conn.execute(
        "INSERT INTO notes (id,user_id,title,tag,content,source) VALUES (?,?,?,?,?,?)",
        (note_id, current_user["id"], note.title, note.tag, note.content, note.source)
    )
    conn.commit(); conn.close()
    return {"id": note_id, "title": note.title, "tag": note.tag,
            "content": note.content, "source": note.source, "created": True}

@app.put("/api/notes/{note_id}")
async def update_note(
    note_id: str,
    note: NoteUpdate,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Update an existing note."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    existing = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Note not found")
    if existing["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Access denied")
    updates = {}
    if note.title is not None: updates["title"] = note.title
    if note.tag is not None: updates["tag"] = note.tag
    if note.content is not None: updates["content"] = note.content
    updates["updated_at"] = datetime.now().isoformat()
    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [note_id]
    conn.execute(f"UPDATE notes SET {set_clause} WHERE id=?", values)
    conn.commit(); conn.close()
    return {"id": note_id, "updated": True}

@app.delete("/api/notes/{note_id}")
async def delete_note(
    note_id: str,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Delete a note."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    existing = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Note not found")
    if existing["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Access denied")
    conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.commit(); conn.close()
    return {"deleted": note_id}

# ============================================================================
# HIGHLIGHTS API (Reader text highlights)
# ============================================================================

@app.post("/api/highlights")
async def create_highlight(
    req: HighlightCreate,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Save a text highlight (requires login)."""
    if not current_user:
        raise HTTPException(401, "Please log in to save highlights")
    if not req.text.strip():
        raise HTTPException(400, "Highlight text cannot be empty")
    hl_id = f"hl_{int(time.time()*1000)}"
    conn = get_db()
    conn.execute(
        "INSERT INTO highlights (id,user_id,document_id,page,text,color,note) VALUES (?,?,?,?,?,?,?)",
        (hl_id, current_user["id"], req.document_id, req.page, req.text, req.color, req.note)
    )
    conn.commit(); conn.close()
    return {"id": hl_id, "document_id": req.document_id, "page": req.page,
            "text": req.text, "color": req.color, "note": req.note, "created": True}

@app.get("/api/highlights")
async def list_highlights(
    document_id: str,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Get all highlights for a document."""
    if not current_user:
        return []
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM highlights WHERE document_id=? AND user_id=? ORDER BY page, created_at",
        (document_id, current_user["id"])
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "document_id": r["document_id"], "page": r["page"],
             "text": r["text"], "color": r["color"], "note": r["note"],
             "created_at": r["created_at"]} for r in rows]

@app.put("/api/highlights/{hl_id}")
async def update_highlight(
    hl_id: str,
    req: HighlightUpdate,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Update highlight color or note."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    existing = conn.execute("SELECT * FROM highlights WHERE id=?", (hl_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Highlight not found")
    if existing["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Access denied")
    updates = {}
    if req.color is not None: updates["color"] = req.color
    if req.note is not None: updates["note"] = req.note
    if not updates:
        conn.close()
        return {"updated": False}
    set_clause = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [hl_id]
    conn.execute(f"UPDATE highlights SET {set_clause} WHERE id=?", values)
    conn.commit(); conn.close()
    return {"id": hl_id, "updated": True}

@app.delete("/api/highlights/{hl_id}")
async def delete_highlight(
    hl_id: str,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Delete a highlight."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    existing = conn.execute("SELECT * FROM highlights WHERE id=?", (hl_id,)).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(404, "Highlight not found")
    if existing["user_id"] != current_user["id"]:
        conn.close()
        raise HTTPException(403, "Access denied")
    conn.execute("DELETE FROM highlights WHERE id=?", (hl_id,))
    conn.commit(); conn.close()
    return {"deleted": hl_id}

# ============================================================================
# AI QUIZ API (generative quizzing with Harness cross-verification)
# ============================================================================

QUIZ_CACHE: dict = {}   # quiz_id -> {"user_id", "topic", "questions": [...]}

class QuizGenerateRequest(BaseModel):
    topic: str = "Mixed"
    count: int = 5
    difficulty: str = "Medium"      # Easy / Medium / Hard / Mixed
    qtype: str = "MCQ"              # MCQ / short / mixed
    verify: bool = True             # Harness cross-verification
    quiz_lang: str = "en"           # en (exam language) / zh

class QuizGradeRequest(BaseModel):
    quiz_id: str
    q_index: int
    student_answer: str

class QuizSubmitRequest(BaseModel):
    quiz_id: str
    score: int
    total: int
    detail_json: str = "{}"

QUIZ_PROMPT_TEMPLATE = (
    "You are an examiner writing first-year mathematics quiz questions for a "
    "Chinese Sino-foreign joint university (中外合办大学, English-medium courses — "
    "BUPT-QMUL style). Students come from the Gaokao and study in English.\n"
    "Requirements:\n"
    "- Topic: {topic}\n"
    "- Number of questions: {count}\n"
    "- Difficulty: {difficulty}\n"
    "- Question types: {qtype_desc}\n"
    "{lang_policy}"
    "{weak_context}"
    "Rules:\n"
    "- For MCQ: exactly 4 options, exactly one correct; distractors must be plausible. "
    "\"None of the above\" distractors are allowed (they may be written as "
    "\"None of the above\" or \"以上都不对\").\n"
    "- Distribute the correct answers evenly across A, B, C and D.\n"
    "- In explanations, refer to the option's mathematical content, never its letter "
    "(option order is randomised afterwards).\n"
    "- For short-answer: the answer must be a single short mathematical expression or number "
    "(in English mathematical notation).\n"
    "- Write EVERY mathematical expression in LaTeX, wrapped in $...$ (inline) or $$...$$ (display). "
    "Never output bare LaTeX commands like \\lim or \\frac without dollar delimiters.\n"
    "- Each question must include a concise step-by-step explanation (中文, LaTeX via $...$).\n"
    "- Output STRICT JSON only, no markdown fences, no commentary:\n"
    '{{"questions":[{{"qtype":"MCQ","q":"...","options":["...","...","...","..."],'
    '"answer":"C","explanation":"..."}},'
    '{{"qtype":"short","q":"...","answer":"n(n+1)/2","explanation":"..."}}]}}\n'
    "- \"answer\" for MCQ is the letter A/B/C/D; for short it is the exact answer string."
)

def _strip_math_delims(s: str) -> str:
    """Strip $...$ / $$...$$ wrappers so stored answers stay verifier-friendly."""
    s = str(s).strip()
    s = re.sub(r"^\$\$(.+)\$\$$", r"\1", s, flags=re.DOTALL)
    s = re.sub(r"^\$(.+)\$$", r"\1", s, flags=re.DOTALL)
    return s.strip()

def _extract_json(text: str) -> Optional[dict]:
    """Extract the first JSON object from a model response (tolerates fences/noise)."""
    text = re.sub(r"```(?:json)?", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None

QUIZ_LANG_POLICIES = {
    "en": (
        "- Language policy: write ALL questions, options and answers in ENGLISH "
        "(the exam language), but write each explanation in Chinese with key terms "
        "glossed bilingually, e.g. \"由夹逼定理 (squeeze theorem) 可知……\".\n"
    ),
    "zh": (
        "- 语言策略：全部用中文出题（题干、选项、答案、解析均为中文），"
        "数学表达式仍用 LaTeX 包裹；关键术语首次出现附英文对照，"
        "如 极限 (limit)、特征值 (eigenvalue)。\n"
    ),
}


def _quiz_generate_batch(topic: str, count: int, difficulty: str, qtype: str,
                         weak_context: str, quiz_lang: str = "en",
                         no_repeat: str = "", _retry: int = 0) -> list:
    """One model call that returns up to `count` parsed question dicts.
    Retries with exponential backoff (up to 2 retries) on transient API failures."""
    qtype_desc = {
        "MCQ": "multiple-choice only",
        "short": "short-answer (fill-in-the-blank) only",
        "mixed": "a mix of multiple-choice and short-answer",
    }.get(qtype, "multiple-choice only")
    prompt = QUIZ_PROMPT_TEMPLATE.format(
        topic=topic, count=count, difficulty=difficulty,
        qtype_desc=qtype_desc, weak_context=weak_context,
        lang_policy=QUIZ_LANG_POLICIES.get(quiz_lang, QUIZ_LANG_POLICIES["en"]),
        no_repeat=no_repeat,
    )
    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": "You output strict JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.7,
            "max_tokens": 3000,
        }, timeout=90)
        resp.raise_for_status()
        choices = resp.json().get("choices", [])
        if not choices:
            return []
        data = _extract_json(choices[0]["message"]["content"])
        qs = (data or {}).get("questions", [])
        # Basic field validation
        out = []
        for qd in qs:
            if not isinstance(qd, dict) or not qd.get("q") or not qd.get("answer"):
                continue
            if qd.get("qtype") == "MCQ":
                opts = qd.get("options")
                if not isinstance(opts, list) or len(opts) != 4:
                    continue
                if not ("A" <= str(qd["answer"]).strip().upper() <= "D"):
                    continue
                # Break LLM position bias: shuffle options, recompute the answer letter.
                correct_idx = ord(str(qd["answer"]).strip().upper()) - ord("A")
                correct_text = opts[correct_idx]
                movable = [o for o in opts if not re.search(r"none of (the above|these)|以上都不|以上选项都不|都不正确|都不对", str(o), re.I)]
                tail = [o for o in opts if o not in movable]   # keep "None of the above"/"以上都不对" last
                random.shuffle(movable)
                opts[:] = movable + tail
                qd["answer"] = chr(ord("A") + opts.index(correct_text))
            else:
                qd["qtype"] = "short"
            qd.setdefault("explanation", "")
            # Normalize: stored answers must be bare (no $ wrappers) so both the
            # Harness verifier and AnswerVerifier compare apples to apples.
            qd["answer"] = _strip_math_delims(qd["answer"])
            out.append(qd)
        return out
    except Exception as e:
        # P5 fix: exponential backoff retry on transient failures (DashScope rate-limit/timeout)
        if _retry < 2:
            wait = 2 ** _retry  # 1s, 2s
            print(f"[quiz] batch failed (attempt {_retry + 1}), retrying in {wait}s: {str(e)[:60]}")
            time.sleep(wait)
            return _quiz_generate_batch(topic, count, difficulty, qtype,
                                       weak_context, quiz_lang, no_repeat, _retry + 1)
        print(f"[quiz] generation error after 3 attempts: {e}")
        return []

def _quiz_verify_question(qd: dict) -> bool:
    """Cross-verify a generated question by solving it with the Harness (Lane A).
    Runs with a hard 45s timeout so one slow question can never stall a batch."""
    import concurrent.futures
    def _solve_and_compare() -> bool:
        if AnswerVerifier is None:
            raise RuntimeError("AnswerVerifier unavailable (harness import failed)")
        options = qd.get("options") if qd.get("qtype") == "MCQ" else None
        result = solve_question(
            question_text=qd["q"],
            options=options,
            api_key=DASHSCOPE_API_KEY,
            model=MODEL,
            base_url=BASE_URL.replace("/chat/completions", ""),
            force_lane="A",
        )
        pred = str(result.get("answer", "")).strip()
        gold = str(qd["answer"]).strip()
        if not pred:
            return False
        verifier = AnswerVerifier()
        if qd.get("qtype") == "MCQ":
            idx = ord(gold.upper()) - ord("A")
            gold_text = str(qd["options"][idx]) if 0 <= idx < 4 else gold
            # Accept match against the letter OR the option text
            ok1, _ = verifier.verify(pred, gold)
            ok2, _ = verifier.verify(pred, gold_text)
            return ok1 or ok2
        ok, _ = verifier.verify(pred, gold)
        return ok
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            return ex.submit(_solve_and_compare).result(timeout=45)
    except Exception as e:
        print(f"[quiz] verify error/timeout: {e}")
        return False

# NOTE: intentionally a SYNC endpoint (def, not async def). It makes long blocking
# calls (DashScope generation + Harness verification); FastAPI runs sync endpoints
# in its threadpool, so the event loop (and every other request) stays responsive.
@app.post("/api/quiz/generate")
def quiz_generate(req: QuizGenerateRequest):
    """Generate a quiz. Answers stay server-side (never sent to the client)."""
    count = max(1, min(15, req.count))
    # Weak-topic context from the latest assessment (stronger guidance)
    weak_context = ""
    if req.topic != "Mixed":
        try:
            conn = get_db()
            row = conn.execute(
                "SELECT weak_topics FROM assessments WHERE user_id IS NOT NULL "
                "ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
            conn.close()
            if row and row["weak_topics"] and req.topic in row["weak_topics"]:
                weak_context = ("- The student flagged this topic as weak in their diagnostic; "
                                "favour fundamental concepts.\n")
        except Exception:
            pass

    # 1) Generate count+2 candidates in SMALL CONCURRENT BATCHES of ≤6.
    #    (One giant call for 17 questions overflows max_tokens and breaks JSON.)
    import concurrent.futures as _cf
    target_spare = count + 2
    batch_sizes = []
    remaining = target_spare
    while remaining > 0:
        batch_sizes.append(min(6, remaining))
        remaining -= 6
    with _cf.ThreadPoolExecutor(max_workers=3) as ex:
        futures = [ex.submit(_quiz_generate_batch, req.topic, n, req.difficulty,
                             req.qtype, weak_context, req.quiz_lang) for n in batch_sizes]
        questions = []
        for f in _cf.as_completed(futures):
            questions.extend(f.result())
    if not questions:
        raise HTTPException(502, "Quiz generation failed, please retry")

    # P5 fix: top-up — if concurrent batches returned fewer than requested
    # (flaky VPN kills some batches), fill the gap with SERIAL retries
    # (serial is slower but much more reliable on unstable connections).
    if len(questions) < count:
        deficit = count - len(questions)
        print(f"[quiz] concurrent batches returned {len(questions)}/{count}, topping up {deficit} serially")
        for _ in range(2):  # max 2 serial top-up rounds
            if len(questions) >= count:
                break
            extra = _quiz_generate_batch(req.topic, min(6, deficit + 1), req.difficulty,
                                         req.qtype, weak_context, req.quiz_lang)
            questions.extend(extra)
            deficit = count - len(questions)

    # 2) Optional Harness cross-verification — PARALLEL (each question already
    #    carries its own 45s solve timeout inside _quiz_verify_question).
    if req.verify:
        with _cf.ThreadPoolExecutor(max_workers=6) as ex:
            verdicts = list(ex.map(_quiz_verify_question, questions))
        kept = [qd for qd, ok in zip(questions, verdicts) if ok]
        for qd in kept:
            qd["verified"] = True
        # Serial top-up rounds if verification dropped too many
        while len(kept) < count:
            extra = _quiz_generate_batch(req.topic, min(6, count - len(kept) + 1),
                                         req.difficulty, req.qtype, weak_context, req.quiz_lang)
            if not extra:
                break
            with _cf.ThreadPoolExecutor(max_workers=6) as ex:
                verdicts2 = list(ex.map(_quiz_verify_question, extra))
            for qd, ok in zip(extra, verdicts2):
                if len(kept) >= count:
                    break
                if ok:
                    qd["verified"] = True
                    kept.append(qd)
        questions = kept[:count]
    else:
        questions = questions[:count]

    if not questions:
        raise HTTPException(502, "Generated questions failed verification, please retry")
    if len(questions) < count:
        # partial success is better than 502 — return what we have with a note
        print(f"[quiz] returning {len(questions)}/{count} questions (network-limited)")

    quiz_id = f"quiz_{int(time.time()*1000)}"
    QUIZ_CACHE[quiz_id] = {
        "user_id": None,   # filled on first grade call if logged in
        "topic": req.topic,
        "questions": questions,
    }
    # Strip answers before returning (answers live only in QUIZ_CACHE)
    public = [{"qtype": q.get("qtype", "MCQ"), "q": q["q"],
               "options": q.get("options"), "verified": bool(q.get("verified"))}
              for q in questions]
    return {"quiz_id": quiz_id, "topic": req.topic, "questions": public}

# NOTE: sync endpoint — the short-answer soft-grading fallback calls the cheap
# model synchronously; keeping this off the event loop avoids request stalls.
@app.post("/api/quiz/grade")
def quiz_grade(req: QuizGradeRequest, current_user: Optional[dict] = Depends(get_current_user)):
    """Grade one answer against the server-held correct answer."""
    quiz = QUIZ_CACHE.get(req.quiz_id)
    if not quiz:
        raise HTTPException(404, "Quiz not found or expired, please regenerate")
    if not (0 <= req.q_index < len(quiz["questions"])):
        raise HTTPException(400, "Question index out of range")
    # Ownership: once a quiz is bound to a user, only that user may grade it
    if current_user:
        if quiz.get("user_id") and quiz["user_id"] != current_user["id"]:
            raise HTTPException(403, "This quiz belongs to another session")
        quiz["user_id"] = current_user["id"]

    qd = quiz["questions"][req.q_index]
    gold = str(qd["answer"]).strip()
    student = _strip_math_delims(req.student_answer)

    if qd.get("qtype") == "MCQ":
        correct = student.upper() == gold.upper()
        correct_answer = gold
    else:
        if AnswerVerifier is not None:
            verifier = AnswerVerifier()
            correct, _ = verifier.verify(student, gold)
        else:
            correct = False
        correct_answer = gold
        if not correct:
            # F3 decision-layer fast path (flash, ~1s): confident verdicts in
            # BOTH directions terminate here; only uncertain cases fall through
            # to the slower per-token model check below.
            try:
                from agent.decision import answer_equivalence
                fast = answer_equivalence(gold, student)
                if fast.get("confidence", 0) >= 0.85 and fast.get("equivalent") is not None:
                    correct = bool(fast["equivalent"])
            except Exception:
                pass
        if not correct:
            # Soft fallback: cheap model judges equivalence (free local check failed)
            try:
                resp = requests.post(BASE_URL, headers={
                    "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
                    "Content-Type": "application/json",
                }, json={
                    "model": TRANSLATE_MODEL,   # cheap model is enough for judging
                    "messages": [
                        {"role": "system", "content": "Answer strictly YES or NO."},
                        {"role": "user", "content":
                            f"Question: {qd['q']}\nStudent answer: {student}\n"
                            f"Reference answer: {gold}\n"
                            "Are they mathematically equivalent? YES or NO."},
                    ],
                    "temperature": 0.0,
                    "max_tokens": 2000,
                }, timeout=30)
                choices = resp.json().get("choices", [])
                if choices:
                    correct = "YES" in choices[0]["message"]["content"].upper()
            except Exception:
                pass

    return {
        "correct": bool(correct),
        "correct_answer": correct_answer,
        "explanation": qd.get("explanation", ""),
        "student_answer": student,
    }

@app.post("/api/quiz/submit")
async def quiz_submit(req: QuizSubmitRequest, current_user: Optional[dict] = Depends(get_current_user)):
    """Persist a finished attempt (guests skipped)."""
    if not current_user:
        return {"saved": False, "reason": "guest"}
    result_id = f"qr_{int(time.time()*1000)}"
    conn = get_db()
    conn.execute(
        "INSERT INTO quiz_results (id,user_id,topic,score,total,detail_json) VALUES (?,?,?,?,?,?)",
        (result_id, current_user["id"], QUIZ_CACHE.get(req.quiz_id, {}).get("topic", req.quiz_id),
         req.score, req.total, req.detail_json)
    )
    conn.commit(); conn.close()
    return {"saved": True, "id": result_id}

@app.get("/api/quiz/history")
def quiz_history(current_user: Optional[dict] = Depends(get_current_user)):
    """Recent quiz attempts (topic/score/total) — feeds study-plan evidence loop."""
    if not current_user:
        return []
    conn = get_db()
    rows = conn.execute(
        "SELECT topic, score, total, created_at FROM quiz_results "
        "WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
        (current_user["id"],)
    ).fetchall()
    conn.close()
    return [{"topic": r["topic"], "score": r["score"], "total": r["total"],
             "created_at": r["created_at"]} for r in rows]



# ============================================================================
# ASSESSMENTS API (Pre-test results)
# ============================================================================

class AssessmentCreate(BaseModel):
    alevel: str = ""
    major: str = ""
    knowledge_json: str = "{}"
    transition_json: str = "{}"
    quiz_correct: int = 0
    quiz_total: int = 0
    avg_score: int = 0
    weak_topics: str = ""
    strong_topics: str = ""
    danger_topics: str = ""
    result_json: str = "{}"   # complete frontend pretestResult object

@app.post("/api/assessments")
async def create_assessment(
    req: AssessmentCreate,
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Save pre-assessment results (requires login)."""
    if not current_user:
        raise HTTPException(401, "Please log in to save assessment results")
    
    assessment_id = f"asm_{int(time.time()*1000)}"
    conn = get_db()
    conn.execute(
        """INSERT INTO assessments 
           (id, user_id, knowledge_json, transition_json, quiz_correct, quiz_total, 
            avg_score, weak_topics, strong_topics, danger_topics, result_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (assessment_id, current_user["id"], req.knowledge_json, req.transition_json,
         req.quiz_correct, req.quiz_total, req.avg_score, req.weak_topics, 
         req.strong_topics, req.danger_topics, req.result_json)
    )
    conn.commit(); conn.close()
    return {"id": assessment_id, "saved": True}

@app.get("/api/assessments/latest")
async def get_latest_assessment(
    current_user: Optional[dict] = Depends(get_current_user)
):
    """Get the user's most recent assessment."""
    if not current_user:
        return {}
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM assessments WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
        (current_user["id"],)
    ).fetchone()
    conn.close()
    if not row:
        return {}
    return {
        "id": row["id"],
        "knowledge_json": row["knowledge_json"],
        "transition_json": row["transition_json"],
        "quiz_correct": row["quiz_correct"],
        "quiz_total": row["quiz_total"],
        "avg_score": row["avg_score"],
        "weak_topics": row["weak_topics"],
        "strong_topics": row["strong_topics"],
        "danger_topics": row["danger_topics"],
        "result_json": row["result_json"] if "result_json" in row.keys() else "{}",
        "created_at": row["created_at"]
    }

# ============================================================================
# STUDY PLAN API (per-user plan state sync)
# ============================================================================

class PlanUpdate(BaseModel):
    state_json: str = "{}"

@app.get("/api/plan")
async def get_plan(current_user: Optional[dict] = Depends(get_current_user)):
    """Get the user's saved study-plan state (progress/completed/deleted/order)."""
    if not current_user:
        return {}
    conn = get_db()
    row = conn.execute(
        "SELECT state_json FROM study_plans WHERE user_id=? ORDER BY last_updated DESC LIMIT 1",
        (current_user["id"],)
    ).fetchone()
    conn.close()
    return {"state_json": row["state_json"]} if row else {}

@app.put("/api/plan")
async def put_plan(req: PlanUpdate, current_user: Optional[dict] = Depends(get_current_user)):
    """Upsert the user's study-plan state."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM study_plans WHERE user_id=? ORDER BY last_updated DESC LIMIT 1",
        (current_user["id"],)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE study_plans SET state_json=?, last_updated=datetime('now') WHERE id=?",
            (req.state_json, existing["id"])
        )
    else:
        plan_id = f"plan_{int(time.time()*1000)}"
        conn.execute(
            "INSERT INTO study_plans (id,user_id,state_json) VALUES (?,?,?)",
            (plan_id, current_user["id"], req.state_json)
        )
    conn.commit(); conn.close()
    return {"saved": True}

# ============================================================================
# LOCAL TEXT EXTRACTION (bypasses MinerU for docs that already have text)
# ============================================================================

def local_extract_pdf_pages(pdf_path):
    """Extract text per page from a native PDF using pypdf (no MinerU, no quota)."""
    from pypdf import PdfReader
    reader = PdfReader(str(pdf_path))
    pages = []
    for i, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append({"page": i + 1, "page_idx": i, "text": text})
    return pages

def local_extract_pptx_pages(pptx_path):
    """Extract text per slide from a PPTX using python-pptx (no MinerU)."""
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    prs = Presentation(str(pptx_path))
    pages = []
    for i, slide in enumerate(prs.slides):
        texts = []
        def _collect(shapes):
            for shape in shapes:
                if shape.has_text_frame:
                    for para in shape.text_frame.paragraphs:
                        t = para.text.strip()
                        if t:
                            texts.append(t)
                if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                    _collect(shape.shapes)
        _collect(slide.shapes)
        if texts:
            pages.append({"page": i + 1, "page_idx": i, "text": "\n".join(texts)})
    return pages

def ensure_pages_json(doc_id):
    """Ensure mineru_data/{doc_id}/pages.json exists; extract locally if not.
    Returns True if pages were extracted (or already existed)."""
    pages_path = os.path.join(MINERU_DATA_DIR, doc_id, "pages.json")
    if os.path.exists(pages_path):
        return True  # already parsed (MinerU or previous local extraction)
    # Get file info
    conn = get_db()
    row = conn.execute(
        "SELECT file_path, file_type FROM documents WHERE id=?", (doc_id,)
    ).fetchone()
    conn.close()
    if not row:
        return False
    file_path = os.path.join(UPLOAD_DIR, row["file_path"])
    if not os.path.exists(file_path):
        return False
    # Extract based on file type
    try:
        if row["file_type"] == "pdf":
            pages = local_extract_pdf_pages(file_path)
        elif row["file_type"] == "pptx":
            pages = local_extract_pptx_pages(file_path)
        else:
            return False
    except Exception as e:
        print(f"[vocab] local extraction failed for {doc_id}: {e}")
        return False
    if not pages:
        return False
    # Write pages.json (same format as MinerU output)
    os.makedirs(os.path.dirname(pages_path), exist_ok=True)
    with open(pages_path, "w", encoding="utf-8") as f:
        json.dump(pages, f, ensure_ascii=False, indent=2)
    print(f"[vocab] locally extracted {len(pages)} pages for {doc_id}")
    return True


# ============================================================================
# VOCAB API (单词本 — math terminology book)
# ============================================================================

class VocabCreate(BaseModel):
    term_en: str
    term_zh: str = ""
    definition: str = ""
    source_doc_id: Optional[str] = None
    source_page: Optional[int] = None
    source_text: str = ""
    tag: str = ""
    skip_if_exists: bool = False   # reader-capture: never overwrite an existing entry

class VocabUpdate(BaseModel):
    term_en: Optional[str] = None
    term_zh: Optional[str] = None
    definition: Optional[str] = None
    tag: Optional[str] = None

@app.get("/api/vocab")
def list_vocab(q: Optional[str] = None, tag: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """List user's vocabulary entries; optional ?q= search on term_en/term_zh/definition."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    conditions = ["user_id=?"]
    params = [current_user["id"]]
    if q:
        conditions.append("(term_en LIKE ? OR term_zh LIKE ? OR definition LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    if tag:
        conditions.append("tag=?")
        params.append(tag)
    where = " AND ".join(conditions)
    rows = conn.execute(
        f"SELECT * FROM vocab_entries WHERE {where} ORDER BY updated_at DESC",
        params
    ).fetchall()
    conn.close()
    out = []
    doc_titles = {}
    for r in rows:
        d = dict(r)
        did = d.get("source_doc_id")
        if did and did not in doc_titles:
            dc = get_db().execute("SELECT title FROM documents WHERE id=?", (did,)).fetchone()
            doc_titles[did] = dc["title"] if dc else ""
        d["source_title"] = doc_titles.get(did, "")
        out.append(d)
    return out

@app.post("/api/vocab")
def create_vocab(req: VocabCreate, current_user: dict = Depends(get_current_user)):
    """Add a vocabulary entry (manual / reader capture / AI-concept capture). Dedup on term_en."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    term_en = (req.term_en or "").strip()
    if not term_en:
        raise HTTPException(400, "term_en is required")
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM vocab_entries WHERE user_id=? AND LOWER(term_en)=LOWER(?)",
        (current_user["id"], term_en)
    ).fetchone()
    if existing:
        if req.skip_if_exists:
            # reader-capture semantics: already collected → do NOT touch it
            conn.close()
            return {"id": existing["id"], "deduped": True, "skipped": True}
        conn.execute(
            "UPDATE vocab_entries SET term_zh=?, definition=?, source_doc_id=?, "
            "source_page=?, source_text=?, tag=?, updated_at=datetime('now') WHERE id=?",
            (req.term_zh or "", req.definition or "", req.source_doc_id,
             req.source_page, (req.source_text or "")[:200], req.tag or "", existing["id"])
        )
        conn.commit(); conn.close()
        return {"id": existing["id"], "deduped": True}
    vid = f"vocab_{int(time.time()*1000)}"
    conn.execute(
        "INSERT INTO vocab_entries (id,user_id,term_en,term_zh,definition,"
        "source_doc_id,source_page,source_text,tag) VALUES (?,?,?,?,?,?,?,?,?)",
        (vid, current_user["id"], term_en, req.term_zh or "", req.definition or "",
         req.source_doc_id, req.source_page, (req.source_text or "")[:200], req.tag or "")
    )
    conn.commit(); conn.close()
    return {"id": vid, "deduped": False}

@app.put("/api/vocab/{vocab_id}")
def update_vocab(vocab_id: str, req: VocabUpdate, current_user: dict = Depends(get_current_user)):
    """Edit a vocabulary entry."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute("SELECT user_id FROM vocab_entries WHERE id=?", (vocab_id,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Not found")
    if row["user_id"] != current_user["id"]:
        conn.close(); raise HTTPException(403, "Access denied")
    sets, vals = [], []
    if req.term_en is not None:
        te = req.term_en.strip()
        if not te: raise HTTPException(400, "term_en cannot be empty")
        sets.append("term_en=?"); vals.append(te)
    if req.term_zh is not None:
        sets.append("term_zh=?"); vals.append(req.term_zh)
    if req.definition is not None:
        sets.append("definition=?"); vals.append(req.definition)
    if req.tag is not None:
        sets.append("tag=?"); vals.append(req.tag)
    if not sets:
        conn.close(); return {"updated": False}
    sets.append("updated_at=datetime('now')")
    vals.append(vocab_id)
    conn.execute(f"UPDATE vocab_entries SET {', '.join(sets)} WHERE id=?", vals)
    conn.commit(); conn.close()
    return {"updated": True}

@app.delete("/api/vocab/{vocab_id}")
def delete_vocab(vocab_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a vocabulary entry."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute("SELECT user_id FROM vocab_entries WHERE id=?", (vocab_id,)).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Not found")
    if row["user_id"] != current_user["id"]:
        conn.close(); raise HTTPException(403, "Access denied")
    conn.execute("DELETE FROM vocab_entries WHERE id=?", (vocab_id,))
    conn.commit(); conn.close()
    return {"deleted": True}

# --- Auto-extraction pipeline ---

VOCAB_EXTRACT_SYSTEM = "Output only a JSON array of objects. No markdown fences."
VOCAB_EXTRACT_PROMPT = (
    "Extract mathematical terminology from this textbook/PPT excerpt. "
    "For each term return an object: "
    '\"term_en\" (English), \"term_zh\" (Chinese), '
    '\"definition\" (one bilingual sentence, max 80 chars), '
    '\"context\" (surrounding phrase, max 60 chars). '
    "ONLY extract university-level MATHEMATICAL terms (theorems, methods, operators, structures like supremum, eigenvalue, uniform convergence). DO NOT extract common English words (textbook, university, chapter, department, example, solution, figure, table, exercise). Max 6 per excerpt. "
    "Return ONLY a JSON array.\n\nExcerpt:\n{text}"
)
MAX_VOCAB_PER_DOC = 200

def _extract_vocab_batch(text_chunk: str) -> list:
    prompt = VOCAB_EXTRACT_PROMPT.replace("{text}", text_chunk[:1200])
    try:
        resp = requests.post(BASE_URL, headers={
            "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": TRANSLATE_MODEL,
            "messages": [
                {"role": "system", "content": VOCAB_EXTRACT_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 800,
        }, timeout=30)
        body = resp.json()
        raw = body.get("choices", [{}])[0].get("message", {}).get("content", "[]")
        import re as _re
        m = _re.search(r"\[.*\]", raw, _re.DOTALL)
        items = json.loads(m.group()) if m else []
        return [it for it in items if isinstance(it, dict) and it.get("term_en")]
    except Exception:
        return []

def _chunk_has_math_terms(chunk: str) -> bool:
    """P5 F6: quick flash check — does this chunk contain math terminology?
    Saves 40-60% of Qwen-Turbo extraction calls by skipping ToC/preface pages."""
    # Fast heuristic first: math symbols or LaTeX present → definitely yes
    import re as _re
    if _re.search(r'[∑∫∂∇∀∃≤≥≠∈⊂∞]|\\frac|\\lim|\\sum|theorem|lemma|proof|定义|定理|引理|证明|极限|导数|积分|矩阵|行列式|特征值|收敛|级数', chunk):
        return True
    # Pure CJK/no math → definitely no
    if not _re.search(r'[a-zA-Z]{4,}', chunk):
        return False
    # Ambiguous: use flash for a cheap judgment (~50 tokens, ~0.5s)
    try:
        from agent.decision import _call, DECISION_MODEL
        out = _call(DECISION_MODEL,
                    "判断这段文本是否包含数学学术术语。输出JSON: {\"has_terms\": true/false}",
                    chunk[:300], timeout=10, max_tokens=50)
        return bool(out.get("has_terms", True))
    except Exception:
        return True  # filter failed → don't block extraction


def extract_vocab_for_doc(conn, user_id: str, doc_id: str, category: str):
    """Batch-extract terminology from a parsed document into vocab_entries."""
    pages_path = os.path.join(MINERU_DATA_DIR, doc_id, "pages.json")
    if not os.path.exists(pages_path):
        return 0
    try:
        pages = json.loads(open(pages_path, encoding="utf-8").read())
    except Exception:
        return 0
    chunks, buf = [], ""
    for p in pages:
        t = (p.get("text") or "").strip()
        if not t: continue
        if len(buf) + len(t) + 2 > 800:
            if buf: chunks.append(buf)
            buf = t
        else:
            buf = (buf + "\n" + t) if buf else t
    if buf: chunks.append(buf)
    chunks = chunks[:30]
    seen, inserted = set(), 0
    for chunk in chunks:
        if inserted >= MAX_VOCAB_PER_DOC: break
        # P5 F6: flash pre-filter — skip chunks without math terminology
        # (saves 40-60% Qwen-Turbo calls: ToC/preface/acknowledgement pages)
        if not _chunk_has_math_terms(chunk):
            continue
        items = _extract_vocab_batch(chunk)
        for it in items:
            te = str(it.get("term_en", "")).strip()[:80]
            if not te or te.lower() in seen: continue
            seen.add(te.lower())
            tz = str(it.get("term_zh", "")).strip()[:60]
            df = str(it.get("definition", "")).strip()[:200]
            ctx = str(it.get("context", "")).strip()[:200]
            vid = f"vocab_{int(time.time()*1000)}_{inserted}"
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO vocab_entries "
                    "(id,user_id,term_en,term_zh,definition,source_doc_id,source_text) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (vid, user_id, te, tz, df, doc_id, ctx)
                )
                inserted += 1
            except Exception:
                pass
    if inserted: conn.commit()
    return inserted

@app.post("/api/vocab/auto/{doc_id}")
def auto_extract_vocab(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Manually trigger vocabulary extraction for a parsed document."""
    if not current_user:
        raise HTTPException(401, "Please log in")
    conn = get_db()
    row = conn.execute(
        "SELECT category, parse_status FROM documents WHERE id=? AND user_id=?",
        (doc_id, current_user["id"])
    ).fetchone()
    if not row:
        conn.close(); raise HTTPException(404, "Document not found")
    # Allow any document: if not MinerU-parsed, try local text extraction first
    if row["parse_status"] != "done":
        conn.close()
        if not ensure_pages_json(doc_id):
            raise HTTPException(400, "Document has no extractable text")
        conn = get_db()
    n = extract_vocab_for_doc(conn, current_user["id"], doc_id, row["category"])
    conn.close()
    return {"extracted": n}


# ============================================================================
# STATS API (Dashboard statistics)
# ============================================================================

@app.get("/api/stats")
async def get_stats(current_user: Optional[dict] = Depends(get_current_user)):
    """Get user statistics for Dashboard (math proficiency, docs read, etc)."""
    if not current_user:
        return {
            "math_proficiency": 0,
            "documents_read": 0,
            "problems_solved": 0,
            "day_streak": 0,
        }
    conn = get_db()
    user_id = current_user["id"]

    # Math Proficiency: from latest assessment avg_score
    assessment = conn.execute(
        "SELECT avg_score FROM assessments WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
        (user_id,)
    ).fetchone()
    math_proficiency = assessment["avg_score"] if assessment else 0

    # Documents Read: count of user's documents
    doc_count = conn.execute(
        "SELECT COUNT(*) as cnt FROM documents WHERE user_id=?",
        (user_id,)
    ).fetchone()["cnt"]

    # Problems Solved: total questions answered across submitted AI Quiz attempts
    solved = conn.execute(
        "SELECT COALESCE(SUM(total),0) as s FROM quiz_results WHERE user_id=?",
        (user_id,)
    ).fetchone()["s"]

    # Day Streak: consecutive days with at least one recorded activity.
    # Derived purely from existing tables (no new schema):
    #   quiz_results.created_at | documents.created_at
    #   notes.updated_at        | highlights.created_at
    # SQLite date(...) truncates ISO timestamps to YYYY-MM-DD (UTC).
    day_rows = conn.execute(
        """
        SELECT DISTINCT day FROM (
            SELECT date(created_at) AS day FROM quiz_results  WHERE user_id=?
            UNION
            SELECT date(created_at) AS day FROM documents     WHERE user_id=?
            UNION
            SELECT date(updated_at)  AS day FROM notes         WHERE user_id=?
            UNION
            SELECT date(created_at) AS day FROM highlights    WHERE user_id=?
        ) WHERE day IS NOT NULL ORDER BY day DESC
        """,
        (user_id, user_id, user_id, user_id)
    ).fetchall()
    conn.close()

    streak = 0
    if day_rows:
        from datetime import date as _date, timedelta as _timedelta
        days = [row["day"] for row in day_rows]           # 'YYYY-MM-DD', newest first
        today = _date.today()
        # The streak anchor is today; a today-gap is tolerated (grace: yesterday
        # still counts — you haven't "broken" the streak until you miss a full day).
        anchor = today
        if days[0] != anchor.isoformat():
            if days[0] == (today - _timedelta(days=1)).isoformat():
                anchor = today - _timedelta(days=1)        # last active yesterday
            else:
                anchor = None                              # inactive >1 day -> 0
        if anchor is not None:
            day_set = set(days)
            cur = anchor
            while cur.isoformat() in day_set:
                streak += 1
                cur = cur - _timedelta(days=1)
    return {
        "math_proficiency": math_proficiency,
        "documents_read": doc_count,
        "problems_solved": solved,
        "day_streak": streak,
    }

# ============================================================================
# Phase 0: same-origin static hosting (whitelist catch-all — LAST route)
# Serves the SPA from this FastAPI process so the frontend ships with the
# backend (no CORS, no separate web server). Whitelist-based: .env, the
# SQLite DB, server source and uploads are NEVER reachable.
# ============================================================================

_STATIC_ROOT = os.path.dirname(__file__)
_STATIC_SUBDIRS = ("app/", "styles/")          # code assets only
_STATIC_ROOT_FILE = re.compile(r'^[A-Za-z0-9._-]+\.(html|js|css|png|svg|ico|woff2?|map)$')

@app.get("/{path:path}")
async def spa_static(path: str):
    if not path:
        return FileResponse(os.path.join(_STATIC_ROOT, "index.html"))
    p = path.replace("\\", "/")
    # explicit sensitive-prefix block (defence in depth on top of the whitelist)
    if p.startswith((".", "uploads/", "mineru_data/", "agent/", "skills/", "core/",
                     "verification/", "models/", "harness", "__pycache__/")):
        raise HTTPException(404, "Not Found")
    allowed = p.startswith(_STATIC_SUBDIRS) or ("/" not in p and _STATIC_ROOT_FILE.match(p))
    if not allowed:
        raise HTTPException(404, "Not Found")
    full = os.path.normpath(os.path.join(_STATIC_ROOT, p))
    if not full.startswith(_STATIC_ROOT) or not os.path.isfile(full):
        raise HTTPException(404, "Not Found")
    return FileResponse(full)

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    import os
    harness_version = os.getenv("HARNESS_VERSION", "v2")
    print("=" * 50)
    print("数跃 Backend Server")
    print(f"Model: {MODEL}")
    print(f"Translate Model: {TRANSLATE_MODEL}")
    print(f"Harness: V3 (ToRA + Proof Verifier + Smart Routing)")
    print(f"Fallback: HARNESS_VERSION={harness_version}")
    print(f"API Key: {DASHSCOPE_API_KEY[:15]}..." if DASHSCOPE_API_KEY else "API Key: [WARN] NOT SET")
    print("=" * 50)
    print("Endpoints:")
    print("  AUTH:")
    print("    POST /api/auth/register       — Register")
    print("    POST /api/auth/login          — Login")
    print("    GET  /api/auth/me             — Current user")
    print("    PUT  /api/auth/me             — Update profile")
    print("    POST /api/auth/forgot-password— Forgot password")
    print("    POST /api/auth/reset-password — Reset password")
    print("  AI:")
    print("    POST /api/chat                — Streaming chat (Harness)")
    print("    POST /api/solve               — Full solve (Harness + Verifier)")
    print("  QUIZ:")
    print("    POST /api/quiz/generate       — Generate quiz (Harness-verified, EN only)")
    print("    POST /api/quiz/grade          — Grade one answer (answers stay server-side)")
    print("    POST /api/quiz/submit         — Persist attempt (feeds Problems Solved)")
    print("    POST /api/translate           — Translation (cheap model)")
    print("  DOCUMENTS:")
    print("    POST /api/documents/upload    — Upload PDF/PPTX")
    print("    GET  /api/documents           — List documents")
    print("    GET  /api/documents/:id/file  — Download file")
    print("    DEL  /api/documents/:id       — Delete document")
    print("  NOTES:")
    print("    GET  /api/notes               — List notes")
    print("    POST /api/notes               — Create note")
    print("    PUT  /api/notes/:id           — Update note")
    print("    DEL  /api/notes/:id           — Delete note")
    print("  HIGHLIGHTS:")
    print("    GET  /api/highlights          — List highlights (query: document_id)")
    print("    POST /api/highlights          — Create highlight")
    print("    PUT  /api/highlights/:id      — Update color/note")
    print("    DEL  /api/highlights/:id      — Delete highlight")
    print("  STATS:")
    print("    GET  /api/stats               — Dashboard stats (proficiency/docs/solved/streak)")
    print("=" * 50)
    uvicorn.run(app, host=HOST, port=PORT)
