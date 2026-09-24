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

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header
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
MODEL = os.getenv("MODEL", "qwen3.6-35b-a3b")
TRANSLATE_MODEL = os.getenv("TRANSLATE_MODEL", "qwen-turbo")
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
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
    return MODEL  # qwen3.6-35b-a3b

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

class ChatRequest(BaseModel):
    task_type: str = "general"
    messages: List[dict] = []
    temperature: float = 0.3
    max_tokens: int = 2000
    stream: bool = True

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
    
    access_token = create_access_token(data={"sub": user_id})
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
    
    access_token = create_access_token(data={"sub": user["id"]})
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
async def forgot_password(req: ForgotPassword):
    """Forgot password — generates reset token (prints to console for demo)."""
    conn = get_db()
    user = conn.execute("SELECT id, email FROM users WHERE email=?", (req.email,)).fetchone()
    if not user:
        conn.close()
        # Don't reveal whether email exists
        return {"message": "If the email exists, a reset link has been generated."}
    
    reset_token = str(uuid.uuid4())
    expires_at = (datetime.utcnow() + timedelta(hours=1)).isoformat()
    
    conn.execute(
        "INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?,?,?,?)",
        (str(uuid.uuid4())[:8], user["id"], reset_token, expires_at)
    )
    conn.commit(); conn.close()
    
    # For demo: print reset link to console (no real email sent)
    reset_url = f"http://localhost:8000/reset-password.html?token={reset_token}"
    print("=" * 60)
    print("PASSWORD RESET REQUEST")
    print(f"Email: {req.email}")
    print(f"Reset URL: {reset_url}")
    print("=" * 60)
    
    return {"message": "If the email exists, a reset link has been generated. Check server console."}

@app.post("/api/auth/reset-password")
async def reset_password(req: ResetPassword):
    """Reset password using token."""
    if len(req.new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    
    conn = get_db()
    reset = conn.execute(
        "SELECT * FROM password_resets WHERE token=? AND used=0 AND expires_at > ?",
        (req.token, datetime.utcnow().isoformat())
    ).fetchone()
    
    if not reset:
        conn.close()
        raise HTTPException(400, "Invalid or expired reset token")
    
    new_hash = get_password_hash(req.new_password)
    conn.execute("UPDATE users SET password_hash=? WHERE id=?", (new_hash, reset["user_id"]))
    conn.execute("UPDATE password_resets SET used=1 WHERE id=?", (reset["id"],))
    conn.commit(); conn.close()
    
    return {"message": "Password reset successfully. Please log in with your new password."}

# ============================================================================
# HEALTH
# ============================================================================

@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL, "harness": "enabled"}

@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Streaming chat endpoint — routed through Harness V3 analysis layer."""
    question = req.messages[-1].get("content", "") if req.messages else ""

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
    return {"id": doc_id, "title": title, "filename": file.filename,
            "category": category, "icon": icons.get(ext, "file-text"),
            "fileType": ext, "fileSize": file_size,
            "sizeText": f"{file_size/1024/1024:.1f} MB", "source": "upload",
            "needsOcr": bool(needs_ocr), "parseStatus": "none", "aiDeclined": False}

    # [单词本] Auto-extract vocabulary for slides/PPTs after upload (background)
    # Skip scanned PDFs (they go through MinerU pipeline which has its own hook)
    if category in ("slides", "research-papers") and not needs_ocr:
        import threading
        def _bg_vocab():
            try:
                if ensure_pages_json(doc_id):
                    _conn = get_db()
                    _u = _conn.execute("SELECT user_id FROM documents WHERE id=?", (doc_id,)).fetchone()
                    if _u:
                        extract_vocab_for_doc(_conn, _u["user_id"], doc_id, category)
                    _conn.close()
            except Exception as e:
                print(f"[vocab] post-upload extraction failed for {doc_id}: {e}")
        threading.Thread(target=_bg_vocab, daemon=True).start()


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
                         weak_context: str, quiz_lang: str = "en") -> list:
    """One model call that returns up to `count` parsed question dicts."""
    qtype_desc = {
        "MCQ": "multiple-choice only",
        "short": "short-answer (fill-in-the-blank) only",
        "mixed": "a mix of multiple-choice and short-answer",
    }.get(qtype, "multiple-choice only")
    prompt = QUIZ_PROMPT_TEMPLATE.format(
        topic=topic, count=count, difficulty=difficulty,
        qtype_desc=qtype_desc, weak_context=weak_context,
        lang_policy=QUIZ_LANG_POLICIES.get(quiz_lang, QUIZ_LANG_POLICIES["en"]),
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
        print(f"[quiz] generation error: {e}")
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

    # 2) Optional Harness cross-verification — PARALLEL (each question already
    #    carries its own 45s solve timeout inside _quiz_verify_question).
    if req.verify:
        with _cf.ThreadPoolExecutor(max_workers=6) as ex:
            verdicts = list(ex.map(_quiz_verify_question, questions))
        kept = [qd for qd, ok in zip(questions, verdicts) if ok]
        for qd in kept:
            qd["verified"] = True
        # One concurrent retry batch if verification dropped too many
        if len(kept) < count:
            extra = _quiz_generate_batch(req.topic, min(6, count), req.difficulty,
                                         req.qtype, weak_context, req.quiz_lang)
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
