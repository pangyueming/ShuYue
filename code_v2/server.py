"""
CogniBridge Backend Server — FastAPI + Harness V3 Engine
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
from datetime import datetime, timedelta
import requests
from dotenv import load_dotenv

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
SECRET_KEY = os.getenv("SECRET_KEY", "cognibridge-dev-secret-key-change-in-production")
os.makedirs(UPLOAD_DIR, exist_ok=True)

if not DASHSCOPE_API_KEY:
    print("WARNING: DASHSCOPE_API_KEY not set! Check .env file.")
if SECRET_KEY == "cognibridge-dev-secret-key-change-in-production":
    print("WARNING: Using default SECRET_KEY. Set a strong key in .env for production.")

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
        university TEXT DEFAULT 'Queen Mary University of London',
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
    """)

    # === Migration: add user_id to legacy tables (notes/documents) ===
    def _ensure_column(table, column, decl):
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    _ensure_column("notes", "user_id", "TEXT REFERENCES users(id)")
    _ensure_column("documents", "user_id", "TEXT REFERENCES users(id)")

    # Backfill orphaned legacy rows to the first existing user
    first_user = conn.execute("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").fetchone()
    if first_user:
        conn.execute("UPDATE documents SET user_id=? WHERE user_id IS NULL", (first_user["id"],))
        conn.execute("UPDATE notes SET user_id=? WHERE user_id IS NULL", (first_user["id"],))

    conn.commit(); conn.close()
    print(f"Database: {DB_PATH}")

init_db()

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
    ("Limits", ["limit", "lim", "epsilon-delta", "squeeze theorem", "l'hôpital", "continuity", "0/0"]),
    ("Differentiation", ["derivative", "differentiat", "tangent", "chain rule", "stationary point"]),
    ("Integration", ["integral", "integrate", "antiderivative", "integration by parts", "Riemann"]),
    ("Series_Convergence", ["series", "converge", "diverge", "ratio test", "Taylor series", "Σ"]),
    ("Differential_Equations", ["differential equation", "ODE", "separable"]),
    ("Linear_Algebra", ["matrix", "eigenvalue", "vector space", "basis", "linear independence"]),
    ("Discrete_Math", ["set theory", "union", "intersection", "propositional logic", "graph theory", "combinatorics"]),
    ("Probability", ["probability", "Bayes", "random variable", "distribution", "normal"]),
    ("Proof_Techniques", ["prove", "proof", "show that", "by contradiction", "by induction", "contrapositive"]),
    ("Complex_Numbers", ["complex number", "modulus", "argument", "De Moivre"]),
    ("Vector_Calculus", ["curl", "divergence", "gradient", "line integral", "Green's theorem"]),
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
    "You are CogniBridge, an expert UK university mathematics tutor. "
    "You specialise in first-year undergraduate mathematics: calculus, linear algebra, "
    "discrete mathematics, probability, and mathematical proofs. "
    "Solve problems with rigorous step-by-step reasoning using British mathematical notation. "
    "Always show full working. Put the final answer in **bold**. "
    "If the question is in Chinese, answer in Chinese; if English, answer in English."
)

SYSTEM_PROMPT_GUIDE = (
    "You are CogniBridge, an expert Socratic mathematics tutor for UK university students. "
    "Your goal is NOT to give answers directly, but to help students discover them through guided questioning.\n\n"
    "## Expert Decision Process (think through this in <thinking> before each response)\n"
    "1. DIAGNOSE: What is the student's current understanding? What specific misconception or gap do they have?\n"
    "2. STRATEGY: Which technique will best help them? (Elicit / Clarify / Challenge / Hint / Analogue / Summarize)\n"
    "3. INTENT: What should the student understand by the end of this turn?\n\n"
    "## Teaching Techniques\n"
    "- ELICIT: 'What do you already know about [topic]?' - Draw out existing knowledge.\n"
    "- CLARIFY: 'Can you walk me through how you got that step?' - Surface reasoning process.\n"
    "- CHALLENGE: 'What would happen if [condition changed]?' - Test deeper understanding.\n"
    "- HINT: 'Think about [specific concept]. How does it apply here?' - Give targeted nudge.\n"
    "- ANALOGUE: 'Let's try a simpler version first: [simpler problem].' - Reduce cognitive load.\n"
    "- SUMMARIZE: 'So what's the key insight we've discovered?' - Consolidate learning.\n\n"
    "## Scaffolding Levels (adapt naturally; start at Level 1-2)\n"
    "Level 1 (Open): Broad exploratory questions. 'What approach might work here?'\n"
    "Level 2 (Directed): Point toward the right method. 'Which technique have we learned for products of functions?'\n"
    "Level 3 (Hinted): Give specific conceptual hints. 'Remember LIATE. Which part should be u?'\n"
    "Level 4 (Guided): Walk through a similar example. 'Let's solve ∫x dx first. Now how is your problem different?'\n"
    "Level 5 (Partial): Show the first step. 'If we set u = x, then du = ___. What is dv?'\n\n"
    "## Error Handling (CRITICAL - use Approach B)\n"
    "When a student gives a wrong answer or shows confusion:\n"
    "1. FIRST, identify what is CORRECT in their reasoning: 'Your idea about X is on the right track...'\n"
    "2. THEN, pinpoint the specific misconception: '...but there's a common subtlety with Y that many students miss.'\n"
    "3. FINALLY, give a targeted hint at the appropriate level. NEVER say 'that's wrong' without acknowledging the good part first.\n\n"
    "## Student Signals (detect these in their messages)\n"
    "- 'I need a hint' / '💡' → Increase scaffolding by 1-2 levels.\n"
    "- 'I'm stuck' / '🆘' / 'I don't know' → Jump to Level 4 (guided) with an analogue or partial solution.\n"
    "- 'Give me the answer' / frustration → Provide Level 5 (partial solution), reassure them, and explain that struggling is part of learning.\n\n"
    "## Format Rules\n"
    "- Start with encouragement or acknowledgment of their effort.\n"
    "- Ask ONE main question per turn. NEVER provide multiple-choice options (A/B/C/D). Always ask ONE open-ended question that requires the student to think and articulate their reasoning.\n"
    "- End each turn by asking: 'Does this help? Would you like a hint, a similar example, or shall I explain this differently?'\n"
    "- Match the student's language (English or Chinese).\n"
)

SYSTEM_PROMPT_TRANSLATE = (
    "You are an academic translator specialising in mathematics and computer science. "
    "Translate the text accurately. Format: **Translation**: [result] **Note**: [1-sentence explanation]."
)

SYSTEM_PROMPT_GENERAL = (
    "You are CogniBridge, a helpful AI tutor for UK university students. "
    "Be clear, concise, and use markdown formatting. "
    "Respond in the same language as the question."
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
        f"You are a UK university mathematics examiner. Review this solution for correctness:\n\n"
        f"Question: {question}\n\n"
        f"Solution to verify:\n{original_answer}\n\n"
        f"Check each step. If there's an error, correct it. "
        f"If correct, confirm. Provide your verified answer."
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

app = FastAPI(title="CogniBridge AI Backend", version="1.0")

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
                "enable_thinking": True,
            }, stream=True, timeout=120)

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
                    yield f"data: {json.dumps({'content': '\n\n---\n🔍 **Proof verification** (type: ' + qtype + ')...\n', 'topic': topic, 'verifier': True})}\n\n"
                    assessment = _verify_proof_v3(question, clean_text)
                    if assessment is not None:
                        icon = {"pass": "✅", "needs_revision": "⚠️", "fail": "❌"}.get(assessment.overall, "⚠️")
                        yield f"data: {json.dumps({'content': f"{icon} **Proof verdict: {assessment.overall.upper()}** (score {assessment.score:.2f})\n{assessment.feedback}\n", 'verifier': True})}\n\n"
                    else:
                        yield f"data: {json.dumps({'content': '⚠️ Proof verification unavailable; treat the above with caution.\n', 'verifier': True})}\n\n"
                elif is_weak:
                    # Weak topics: legacy cross-check verifier
                    yield f"data: {json.dumps({'content': '\n\n---\n🔍 **Verifier check** (topic: ' + topic + ')...\n', 'topic': topic, 'verifier': True})}\n\n"
                    verification = run_verifier(
                        question,
                        clean_text,
                        full_messages
                    )
                    if "correct" in verification.lower() or "confirm" in verification.lower():
                        yield f"data: {json.dumps({'content': '✅ **Verified**: Solution confirmed correct.\n', 'verifier': True})}\n\n"
                    else:
                        yield f"data: {json.dumps({'content': '⚠️ **Verifier note**: ' + verification[:500] + '\n', 'verifier': True})}\n\n"

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
    # Limit file size to 50MB
    if file_size > 50 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 50MB)")
    with open(file_path, "wb") as f:
        f.write(content)
    title = file.filename.rsplit(".", 1)[0]
    conn = get_db()
    conn.execute(
        "INSERT INTO documents (id,user_id,title,filename,file_path,category,source,file_size,file_type) VALUES (?,?,?,?,?,?,?,?,?)",
        (doc_id, current_user["id"], title, file.filename, safe_name, category, "upload", file_size, ext)
    )
    conn.commit(); conn.close()
    icons = {"pdf": "📄", "pptx": "📊"}
    return {"id": doc_id, "title": title, "filename": file.filename,
            "category": category, "icon": icons.get(ext, "📄"),
            "fileType": ext, "fileSize": file_size,
            "sizeText": f"{file_size/1024/1024:.1f} MB", "source": "upload"}

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
    icons = {"pdf": "📄", "pptx": "📊"}
    return [{"id": r["id"], "title": r["title"], "category": r["category"],
             "icon": icons.get(r["file_type"], "📄"), "desc": f"{r['file_size']/1024/1024:.1f} MB",
             "source": r["source"], "fileType": r["file_type"],
             "filename": r["filename"], "filePath": r["file_path"],
             "createdAt": r["created_at"]} for r in rows]

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
    conn.commit(); conn.close()
    file_path = os.path.join(UPLOAD_DIR, row["file_path"])
    # Prevent path traversal from database records
    if os.path.commonpath([os.path.abspath(file_path), os.path.abspath(UPLOAD_DIR)]) == os.path.abspath(UPLOAD_DIR):
        if os.path.exists(file_path):
            os.remove(file_path)
    return {"deleted": doc_id}

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
    "You are an examiner writing UK university first-year mathematics quiz questions.\n"
    "Requirements:\n"
    "- Topic: {topic}\n"
    "- Number of questions: {count}\n"
    "- Difficulty: {difficulty}\n"
    "- Question types: {qtype_desc}\n"
    "- Write ALL questions and options in English.\n"
    "{weak_context}"
    "Rules:\n"
    "- For MCQ: exactly 4 options, exactly one correct; distractors must be plausible.\n"
    "- Distribute the correct answers evenly across A, B, C and D.\n"
    "- In explanations, refer to the option's mathematical content, never its letter "
    "(option order is randomised afterwards).\n"
    "- For short-answer: the answer must be a single short mathematical expression or number.\n"
    "- Write EVERY mathematical expression in LaTeX, wrapped in $...$ (inline) or $$...$$ (display). "
    "Never output bare LaTeX commands like \\lim or \\frac without dollar delimiters.\n"
    "- Each question must include a concise step-by-step explanation (also LaTeX via $...$).\n"
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

def _quiz_generate_batch(topic: str, count: int, difficulty: str, qtype: str,
                         weak_context: str) -> list:
    """One model call that returns up to `count` parsed question dicts."""
    qtype_desc = {
        "MCQ": "multiple-choice only",
        "short": "short-answer (fill-in-the-blank) only",
        "mixed": "a mix of multiple-choice and short-answer",
    }.get(qtype, "multiple-choice only")
    prompt = QUIZ_PROMPT_TEMPLATE.format(
        topic=topic, count=count, difficulty=difficulty,
        qtype_desc=qtype_desc, weak_context=weak_context,
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
                movable = [o for o in opts if not re.search(r"none of (the above|these)", str(o), re.I)]
                tail = [o for o in opts if o not in movable]   # keep "None of the above" last
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
                             req.qtype, weak_context) for n in batch_sizes]
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
                                         req.qtype, weak_context)
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
    if current_user:
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
            avg_score, weak_topics, strong_topics, danger_topics)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (assessment_id, current_user["id"], req.knowledge_json, req.transition_json,
         req.quiz_correct, req.quiz_total, req.avg_score, req.weak_topics, 
         req.strong_topics, req.danger_topics)
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
        "created_at": row["created_at"]
    }

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

    # Day Streak: placeholder (future implementation)
    conn.close()
    return {
        "math_proficiency": math_proficiency,
        "documents_read": doc_count,
        "problems_solved": solved,
        "day_streak": 0,
    }

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    import os
    harness_version = os.getenv("HARNESS_VERSION", "v2")
    print("=" * 50)
    print("CogniBridge Backend Server")
    print(f"Model: {MODEL}")
    print(f"Translate Model: {TRANSLATE_MODEL}")
    print(f"Harness: V3 (ToRA + Proof Verifier + Smart Routing)")
    print(f"Fallback: HARNESS_VERSION={harness_version}")
    print(f"API Key: {DASHSCOPE_API_KEY[:15]}..." if DASHSCOPE_API_KEY else "API Key: ⚠️ NOT SET")
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