"""
Harness v2-UK — Adapted for UK Higher Mathematics
Based on harness_v2.py (Gaokao version), modified for British university math.

Key changes from Gaokao version:
1. Topic lexicon → UK higher math topics (Limits, Proofs, Linear Algebra, etc.)
2. Weak topics → UK-specific (Proofs, Discrete Math, Series Convergence)
3. Prompts → English, UK university context
4. Answer extraction → UK conventions (proofs, multi-part answers)
5. Scoring → Support proof verification + symbolic equivalence
6. Question types → MCQ / Short Answer / Proof / Long Answer

Architecture preserved: Route → Lane A/B → Vote → Verify → Score
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests

# ============================================================================
# CONFIGURATION
# ============================================================================

DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen3.6-35b-a3b"

# --- UK Higher Math Topic Lexicon (replaces Chinese Gaokao lexicon) ---
TOPIC_LEXICON = [
    # Calculus / Analysis
    ("Limits", ["limit", "lim", "epsilon-delta", "ε-δ", "squeeze theorem",
                "l'hôpital", "l'hopital", "continuity", "continuous",
                "indeterminate form", "0/0", "∞/∞"]),
    ("Differentiation", ["derivative", "differentiat", "tangent line",
                         "chain rule", "product rule", "quotient rule",
                         "implicit differentiation", "stationary point",
                         "critical point", "optimisation", "maxim", "minim"]),
    ("Integration", ["integral", "integrate", "antiderivative",
                     "integration by parts", "substitution",
                     "definite integral", "Riemann sum", "area under"]),
    ("Series_Convergence", ["series", "converge", "diverge",
                            "ratio test", "comparison test", "integral test",
                            "power series", "Taylor series", "Maclaurin",
                            "geometric series", "harmonic series",
                            "absolute convergence", "Σ", "sum to"]),
    ("Differential_Equations", ["differential equation", "ODE",
                                 "first order", "second order",
                                 "separable", "homogeneous",
                                 "particular solution", "general solution"]),

    # Linear Algebra
    ("Linear_Algebra", ["matrix", "matrices", "determinant",
                        "eigenvalue", "eigenvector", "eigenvalue",
                        "vector space", "subspace", "linear independence",
                        "linear transformation", "basis", "dimension",
                        "rank", "null space", "column space",
                        "Gram-Schmidt", "diagonalis", "orthogonal"]),

    # Discrete Mathematics
    ("Discrete_Math", ["set theory", "union", "intersection",
                       "complement", "Venn", "cardinality",
                       "propositional logic", "truth table",
                       "logical equivalence", "implication",
                       "contradiction", "tautology",
                       "graph theory", "vertex", "edge", "tree",
                       "Euler", "Hamiltonian", "bipartite",
                       "combinatorics", "permutation", "combination",
                       "pigeonhole", "binomial coefficient",
                       "recurrence", "recursive"]),

    # Probability & Statistics
    ("Probability", ["probability", "Bayes", "conditional probability",
                     "random variable", "expected value", "variance",
                     "distribution", "normal", "binomial", "Poisson",
                     "joint", "marginal", "independence"]),
    ("Statistics", ["statistic", "hypothesis test", "confidence interval",
                    "p-value", "regression", "correlation",
                    "standard deviation", "mean", "median",
                    "sampling", "estimation"]),

    # Proofs & Logic
    ("Proof_Techniques", ["prove", "proof", "show that",
                          "by contradiction", "by induction",
                          "contrapositive", "if and only if", "iff",
                          "QED", "hence show"]),

    # Other
    ("Complex_Numbers", ["complex number", "real part", "imaginary",
                         "modulus", "argument", "polar form",
                         "De Moivre", "Euler's formula"]),
    ("Vector_Calculus", ["curl", "divergence", "gradient",
                         "line integral", "surface integral",
                         "Green's theorem", "Stokes", "Gauss"]),
    ("Numerical_Methods", ["numerical", "approximation", "Newton-Raphson",
                           "Euler method", "Runge-Kutta",
                           "truncation error", "round-off"]),
    ("Optimisation", ["optimise", "optimize", "linear programming",
                       "Lagrange multiplier", "constraint",
                       "objective function", "simplex"]),
]

# --- China-track zh keyword aliases (appended in place; topic IDs unchanged).
# Without these, Chinese questions fall through to "Other" and mis-route.
_ZH_ALIASES = {
    "Limits": ["极限", "洛必达", "夹逼", "无穷小", "连续性", "渐近"],
    "Differentiation": ["导数", "求导", "微分", "链式法则", "切线", "极值", "驻点", "拐点"],
    "Integration": ["积分", "原函数", "分部积分", "换元", "定积分", "不定积分", "被积"],
    "Series_Convergence": ["级数", "泰勒", "麦克劳林", "等比级数", "调和级数", "敛散", "幂级数"],
    "Differential_Equations": ["微分方程", "通解", "特解", "齐次方程", "初值问题"],
    "Linear_Algebra": ["矩阵", "行列式", "特征值", "特征向量", "线性无关", "线性相关",
                        "向量空间", "线性方程组", "秩", "逆矩阵", "转置", "相似对角化"],
    "Discrete_Math": ["离散", "集合论", "命题逻辑", "真值表", "图论", "排列组合",
                       "递推", "鸽巢", "抽屉原理", "生成函数"],
    "Probability": ["概率", "贝叶斯", "条件概率", "随机变量", "期望", "方差",
                     "正态分布", "二项分布", "泊松", "均匀分布", "独立"],
    "Statistics": ["统计", "假设检验", "置信区间", "回归", "最小二乘", "抽样", "显著性"],
    "Proof_Techniques": ["证明", "求证", "试证", "反证", "数学归纳法", "归纳法",
                          "充要", "当且仅当", "证毕", "得证", "任取"],
    "Complex_Numbers": ["复数", "实部", "虚部", "辐角", "共轭", "棣莫弗", "复平面"],
    "Vector_Calculus": ["旋度", "散度", "梯度", "曲线积分", "曲面积分",
                         "格林公式", "斯托克斯", "高斯公式", "向量场"],
    "Numerical_Methods": ["数值", "牛顿迭代", "龙格库塔", "插值", "截断误差", "差分"],
    "Optimisation": ["最优化", "线性规划", "拉格朗日乘数", "约束", "目标函数", "凸函数"],
}
TOPIC_LEXICON = [
    (name, list(kws) + _ZH_ALIASES.get(name, []))
    for (name, kws) in TOPIC_LEXICON
]

# --- UK Weak Topics (Qwen3.6 struggles with these in UK context) ---
# Based on our research: proof-heavy topics and abstract algebra
WEAK_TOPICS = {
    "Proof_Techniques",      # ε-δ proofs, contradiction proofs
    "Discrete_Math",         # Graph theory, logic — unfamiliar pattern
    "Series_Convergence",    # Comparison/ratio test applications
    "Linear_Algebra",        # Abstract vector space proofs
    "Vector_Calculus",       # Multi-step vector operations
}

# --- Few-shot examples (UK university style, English) ---
FEW_SHOT_MCQ = (
    "Example (Multiple Choice):\n"
    "Question: Evaluate lim(x→0) sin(x)/x\n"
    "  A. 0    B. 1    C. Does not exist    D. ∞\n"
    "Solution: This is a fundamental limit. As x→0, sin(x)≈x, so sin(x)/x≈x/x=1.\n"
    "<answer>B</answer>\n\n"
)
FEW_SHOT_SHORT = (
    "Example (Short Answer):\n"
    "Question: Find the derivative of f(x) = x³·e^x\n"
    "Solution: Using the product rule: f'(x) = 3x²·e^x + x³·e^x = x²·e^x(3+x)\n"
    "<answer>x^2 * e^x * (3 + x)</answer>\n\n"
)
FEW_SHOT_PROOF = (
    "Example (Proof):\n"
    "Question: Prove that for any real numbers a,b: a²+b² ≥ 2ab\n"
    "Solution: (a-b)² ≥ 0 [square is non-negative]\n"
    "a² - 2ab + b² ≥ 0\n"
    "Therefore a² + b² ≥ 2ab. QED\n"
    "<answer>Proof: (a-b)^2 >= 0 implies a^2+b^2 >= 2ab</answer>\n\n"
)
FEW_SHOT_EXAMPLES = {"MCQ": FEW_SHOT_MCQ, "Short": FEW_SHOT_SHORT, "Proof": FEW_SHOT_PROOF}


# ============================================================================
# CORE FUNCTIONS (adapted from harness_v2.py)
# ============================================================================

def infer_topic(text: str) -> str:
    """Identify the UK math topic from question text."""
    t = str(text).lower()
    for name, keywords in TOPIC_LEXICON:
        if any(k.lower() in t for k in keywords):
            return name
    return "Other"


def route(row: dict, topic_name: str) -> str:
    """Route to Lane A (simple) or Lane B (complex/proof-heavy)."""
    if topic_name in WEAK_TOPICS:
        return "B"
    # Also route proofs to B regardless of topic
    question_text = str(row.get("question_text", "")).lower()
    if any(w in question_text for w in ["prove", "show that", "prove that"]):
        return "B"
    return "A"


def detect_question_type(row: dict) -> str:
    """Detect UK question type: MCQ / Short / Proof / Long."""
    text = str(row.get("question_text", "")).lower()
    if row.get("options"):
        return "MCQ"
    if any(w in text for w in ["prove", "show that", "prove that", "deduce"]):
        return "Proof"
    if any(w in text for w in ["explain", "describe", "discuss", "compare"]):
        return "Long"
    return "Short"


def extract_answer_uk(response: str, qtype: str) -> str:
    """Extract answer from UK-format response."""
    text = str(response or "")

    # Filter out <thinking> blocks (Qwen3.6 thinking mode)
    text = re.sub(r"<thinking>.*?</thinking>", "", text, flags=re.DOTALL)
    text = text.strip()

    # Try <answer> tag first
    m = re.search(r"<answer>(.*?)</answer>", text, re.DOTALL)
    if m:
        return m.group(1).strip()

    # Try \boxed{}
    m = re.search(r"\\boxed\{([^{}]+)\}", text)
    if m:
        return m.group(1).strip()

    # Try "Answer:" or "The answer is" or "Therefore" — zh: 答案是/所以/因此/故
    m = re.search(r"(?:answer is|answer:|therefore|hence|thus|the result is"
                  r"|答案是|答案为|答案:|所以|因此|故|于是|得到|其值为|即为)\s*[:：]?\s*([^\n.。]{1,60})",
                  text, re.IGNORECASE)
    if m:
        ans = m.group(1).strip().rstrip(".,;，。；")
        # Filter out non-answer phrases
        if ans and len(ans) > 1 and not any(w in ans.lower() for w in
            ["we have", "it follows", "by the", "from the", "since",
             "我们", "由此", "根据", "由于"]):
            return ans

    # For MCQ: find single letter A/B/C/D
    if qtype == "MCQ":
        m = re.search(r'\b([A-E])\b', text[-200:])  # Look in last 200 chars
        if m:
            return m.group(1)

    # Fallback: last number/expression in response
    m = re.findall(r"-?\d+(?:\.\d+)?(?:/\d+)?(?:π|pi)?", text)
    if m:
        return m[-1]

    return text[-200:].strip() if text else ""


def normalize_uk(ans: str) -> str:
    """Normalize UK math answers for comparison."""
    if not ans:
        return ""
    s = str(ans).strip().lower()
    # Standardise notation
    s = s.replace("\\frac", "")      # \frac{1}{2} → {1}{2}
    s = s.replace(" ", "")           # Remove spaces
    s = s.replace("\\,", "").replace("\\;", "").replace("\\!", "")
    s = s.replace("{", "(").replace("}", ")")  # Braces → parens
    s = s.replace("\\pi", "pi")
    s = s.replace("\\times", "*").replace("\\cdot", "*")
    s = s.replace("^", "**")         # ^ → ** for Python
    s = s.replace("\\sqrt", "sqrt")
    s = s.replace("\\infty", "inf")
    s = s.replace("\\leq", "<=").replace("\\geq", ">=")
    s = s.replace("\\neq", "!=")
    # Remove trailing punctuation
    s = s.rstrip(".,;:")
    return s


def score_smart_uk(pred: str, gold: str, corrections: dict, qid: str = "") -> tuple:
    """Smart scoring for UK math: symbolic + string + corrections."""
    if not pred or not gold:
        return False, "empty"

    # 1. Check corrections whitelist
    accepted = corrections.get(qid, {}).get("accepted_answers", [])
    if accepted:
        for candidate in [gold] + accepted:
            if normalize_uk(pred) == normalize_uk(candidate):
                return True, "correction"

    np = normalize_uk(pred)
    ng = normalize_uk(gold)

    # 2. Exact match (after normalisation)
    if np == ng:
        return True, "exact"

    # 3. Symbolic equivalence via SymPy
    try:
        from sympy import sympify, simplify, Symbol
        # Try to compare as expressions
        pred_expr = sympify(np, locals={"x": Symbol("x"), "n": Symbol("n"),
                                         "t": Symbol("t"), "k": Symbol("k")})
        gold_expr = sympify(ng, locals={"x": Symbol("x"), "n": Symbol("n"),
                                         "t": Symbol("t"), "k": Symbol("k")})
        if simplify(pred_expr - gold_expr) == 0:
            return True, "symbolic"
    except Exception:
        pass

    # 4. MCQ: single letter match
    if len(np) == 1 and len(ng) == 1 and np.isalpha() and ng.isalpha():
        return np == ng, "mcq" if np == ng else "no_match"

    # 5. Numeric tolerance
    try:
        if abs(float(pred) - float(gold)) < 1e-6:
            return True, "numeric"
    except (ValueError, TypeError):
        pass

    return False, "no_match"


# ============================================================================
# PROMPT BUILDERS (UK university style)
# ============================================================================

def build_prompt_uk(row: dict, few_shot: bool = False) -> str:
    """Build CoT prompt for UK university mathematics."""
    question = row.get("question_text", "")
    qtype = detect_question_type(row)
    options = row.get("options", [])

    if qtype == "MCQ" and options:
        option_text = "\n".join(f"  {chr(65+i)}. {opt}" for i, opt in enumerate(options))
        rule = "Select the single correct option (A/B/C/D)."
    elif qtype == "Proof":
        option_text = ""
        rule = "Provide a rigorous mathematical proof with clear logical steps."
    elif qtype == "Long":
        option_text = ""
        rule = "Provide a detailed explanation with mathematical justification."
    else:
        option_text = ""
        rule = "Provide the final answer in simplified form."

    instruction = (
        "You are a tutor for first-year mathematics at a Chinese Sino-foreign joint "
        "university (中外合办大学), solving an exam question. "
        "Respond in the language of the question (默认中文，术语中英对照).\n"
        "Follow these steps:\n"
        "1. Identify the key concepts and theorems involved.\n"
        "2. Show clear step-by-step working with proper mathematical notation.\n"
        "3. State your final answer clearly.\n"
        f"4. {rule}\n"
        "5. Put your final answer in <answer>...</answer> tags."
    )

    prefix = FEW_SHOT_EXAMPLES.get(qtype, "") if few_shot else ""
    prompt = f"{prefix}{instruction}\n\nQuestion Type: {qtype}\n\nQuestion:\n{question}\n{option_text}"
    return prompt.strip()


def build_verify_prompt_uk(row: dict, reasoning: str) -> str:
    """Build verifier prompt for UK math — acts as exam moderator."""
    question = row.get("question_text", "")
    options = row.get("options", [])
    option_text = "\n".join(f"  {chr(65+i)}. {opt}" for i, opt in enumerate(options)) if options else ""

    instruction = (
        "You are a university mathematics examiner (moderator) for a Chinese "
        "Sino-foreign joint university. "
        "Review the student's solution below for correctness:\n\n"
        "1. Check each step of the calculation/reasoning.\n"
        "2. Identify any errors and provide corrections.\n"
        "3. If the solution is correct, confirm the answer.\n"
        "4. Provide your verified final answer in <answer>...</answer> tags."
    )

    reasoning = str(reasoning or "").strip() or "(No solution provided)"
    return f"{instruction}\n\nQuestion:\n{question}\n{option_text}\n\nStudent's Solution:\n{reasoning}".strip()


# ============================================================================
# SYSTEM PROMPT (China track: Sino-foreign joint programme bridging tutor)
# ============================================================================

SYSTEM_PROMPT_UK = (
    "You are 数跃 (数跃), an expert tutor for first-year students at a "
    "Chinese Sino-foreign joint university (BUPT-QMUL style) bridging from the "
    "Gaokao to English-medium university mathematics: "
    "calculus / mathematical analysis (极限、微分、积分、级数), linear algebra / "
    "advanced algebra (矩阵、行列式、向量空间), discrete mathematics, probability, "
    "and mathematical proofs. "
    "Respond in the language of the question (默认中文); gloss key terms bilingually "
    "(e.g. 极限 limit, 特征值 eigenvalue); notation follows the English course "
    "textbooks, with Gaokao-habit correspondences shown when helpful. "
    "You solve problems with rigorous step-by-step reasoning. "
    "Always show your full working and clearly indicate your final answer."
)


# ============================================================================
# MODEL CALLING (same architecture as original, minimal changes)
# ============================================================================

def call_model(session, base_url, api_key, model, content, temperature,
               timeout=180, max_tokens=4096, stream=False, request_deadline=None):
    """Call Qwen3.6-35B-A3B via OpenAI-compatible API."""
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT_UK},
            {"role": "user", "content": content},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
        "enable_thinking": True,
    }
    if stream:
        payload["stream_options"] = {"include_usage": True}

    response = session.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        stream=stream,
        timeout=timeout,
    )
    response.raise_for_status()

    if stream:
        parts, usage, started = [], {}, time.monotonic()
        for raw_line in response.iter_lines(decode_unicode=True):
            if request_deadline and time.monotonic() - started > request_deadline:
                response.close()
                raise requests.Timeout(f"Stream exceeded {request_deadline}s deadline")
            if not raw_line or not raw_line.startswith("data:"):
                continue
            data = raw_line[5:].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if event.get("usage"):
                usage = event["usage"]
            choices = event.get("choices") or []
            if choices:
                delta = choices[0].get("delta", {}).get("content")
                if delta:
                    parts.append(delta)
        return "".join(parts), usage

    body = response.json()
    return body["choices"][0]["message"]["content"], body.get("usage", {})


def call_with_retry(session, content, temperature, api_key, model, base_url,
                    retries=3, retry_delay=2, timeout=180, max_tokens=4096,
                    stream=False, request_deadline=None):
    """Call model with automatic retry."""
    error = None
    for attempt in range(1, retries + 1):
        try:
            resp, usage = call_model(
                session, base_url, api_key, model, content, temperature,
                timeout, max_tokens, stream, request_deadline
            )
            return resp, usage, None
        except (requests.RequestException, KeyError, ValueError) as exc:
            body = ""
            resp_obj = getattr(exc, "response", None)
            if resp_obj is not None:
                body = (resp_obj.text or "")[:2000]
            error = f"{type(exc).__name__}: {exc}" + (f"; response={body}" if body else "")
            if attempt < retries:
                time.sleep(retry_delay * attempt)
    return "", {}, error


# ============================================================================
# LANE A & B (same logic, UK-adapted extraction)
# ============================================================================

def run_lane_a(row, content, api_key, model, base_url, session):
    """Lane A: single call, temperature=0, for simpler questions."""
    qtype = detect_question_type(row)
    resp, usage, error = call_with_retry(
        session, content, 0.0, api_key, model, base_url
    )
    if error:
        return {"pred": "", "raw": "", "usage": {}, "error": error, "samples": []}
    ans = extract_answer_uk(resp, qtype)
    sample = {"sample": 1, "answer": ans, "raw_response": resp, "temperature": 0.0}
    return {"pred": ans, "raw": resp, "usage": usage, "error": None, "samples": [sample]}


def run_lane_b(row, content, api_key, model, base_url, session,
              n_samples=5, temperature=0.7, resample_threshold=0.0, resample_extra=0):
    """Lane B: self-consistency voting, for complex/proof questions."""
    qtype = detect_question_type(row)
    collected, usage_total = [], {}

    def sample_n(n):
        last_err = None
        for _ in range(n):
            resp, usage, error = call_with_retry(
                session, content, temperature, api_key, model, base_url
            )
            if error:
                last_err = error
                continue
            ans = extract_answer_uk(resp, qtype)
            collected.append((ans, normalize_uk(ans) if ans else "", resp))
            for k, v in (usage or {}).items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    usage_total[k] = usage_total.get(k, 0) + v
        return last_err

    last_error = sample_n(n_samples)

    def vote():
        norm_counter = Counter(norm for _, norm, _ in collected if norm)
        if norm_counter:
            winner_norm, top = norm_counter.most_common(1)[0]
            pred = next(ans for ans, norm, _ in collected if norm == winner_norm)
            return pred, round(top / max(len(collected), 1), 3)
        return "", 0.0

    pred, confidence = vote()

    # Low confidence resampling
    if resample_threshold > 0 and resample_extra > 0 and confidence < resample_threshold and collected:
        err2 = sample_n(resample_extra)
        if err2:
            last_error = err2
        pred, confidence = vote()

    samples = [{"sample": idx, "answer": ans, "raw_response": resp, "temperature": temperature}
               for idx, (ans, _, resp) in enumerate(collected, 1)]
    error = last_error if not collected else None
    return {"pred": pred, "raw": collected[0][2] if collected else "", "usage": usage_total,
            "error": error, "samples": samples, "confidence": confidence, "n": len(collected)}


def run_verifier(row, reasoning, api_key, model, base_url, session):
    """Verifier: cross-check the winning solution."""
    prompt = build_verify_prompt_uk(row, reasoning)
    resp, usage, error = call_with_retry(
        session, prompt, 0.0, api_key, model, base_url
    )
    if error:
        return {"verifier_answer": "", "verifier_raw": "", "usage": {}, "error": error}
    qtype = detect_question_type(row)
    ans = extract_answer_uk(resp, qtype)
    return {"verifier_answer": ans, "verifier_raw": resp, "usage": usage, "error": None}


# ============================================================================
# INTERACTIVE MODE (for live tutoring, not just benchmarking)
# ============================================================================

def solve_question(question_text: str, options: list = None, api_key: str = None,
                   model: str = DEFAULT_MODEL, base_url: str = DEFAULT_BASE_URL,
                   student_level: str = "first_year") -> dict:
    """
    Solve a single UK math question (for live tutoring integration).

    Args:
        question_text: The math question in English
        options: List of options for MCQ (None for non-MCQ)
        api_key: DashScope API key
        model: Model name
        base_url: API endpoint
        student_level: "first_year" | "second_year" | "postgraduate"

    Returns:
        {
            "answer": final answer,
            "solution": full solution text,
            "topic": identified topic,
            "lane": "A" or "B",
            "confidence": vote confidence (0-1),
            "verified": whether verifier was used,
            "usage": token usage,
        }
    """
    if not api_key:
        api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        raise ValueError("DASHSCOPE_API_KEY not set")

    row = {"question_text": question_text, "options": options or []}
    topic = infer_topic(question_text)
    lane = route(row, topic)
    qtype = detect_question_type(row)

    session = requests.Session()
    prompt = build_prompt_uk(row, few_shot=False)

    if lane == "A":
        result = run_lane_a(row, prompt, api_key, model, base_url, session)
    else:
        result = run_lane_b(row, prompt, api_key, model, base_url, session)

    # Verifier for Lane B
    verified = False
    final_answer = result["pred"]
    if lane == "B" and result["pred"]:
        vres = run_verifier(row, result["raw"], api_key, model, base_url, session)
        if vres["verifier_answer"].strip():
            final_answer = vres["verifier_answer"]
            verified = True

    return {
        "answer": final_answer,
        "solution": result["raw"],
        "topic": topic,
        "question_type": qtype,
        "lane": lane,
        "confidence": result.get("confidence", 1.0),
        "verified": verified,
        "usage": result.get("usage", {}),
        "n_samples": result.get("n", 1),
    }


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

def main():
    """Interactive test mode — solve a single question from command line."""
    p = argparse.ArgumentParser(description="数跃 UK Math Harness")
    p.add_argument("--question", "-q", help="Math question to solve")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--base-url", default=os.getenv("QWEN_BASE_URL", DEFAULT_BASE_URL))
    p.add_argument("--api-key-env", default="DASHSCOPE_API_KEY")
    p.add_argument("--n-samples", type=int, default=5)
    p.add_argument("--temperature", type=float, default=0.7)
    p.add_argument("--max-tokens", type=int, default=4096)
    p.add_argument("--timeout", type=float, default=180)
    p.add_argument("--retries", type=int, default=3)
    args = p.parse_args()

    if not args.question:
        # Demo mode: solve a sample UK math question
        args.question = (
            "Using the ε-δ definition, prove that lim(x→2) (3x+1) = 7. "
            "Then evaluate lim(x→0) sin(3x)/x."
        )

    print(f"\n{'='*60}")
    print(f"Question: {args.question}")
    print(f"{'='*60}\n")

    result = solve_question(args.question, api_key=os.getenv(args.api_key_env),
                            model=args.model, base_url=args.base_url)

    print(f"Topic: {result['topic']}")
    print(f"Type: {result['question_type']}")
    print(f"Lane: {result['lane']} (confidence: {result['confidence']})")
    print(f"Verified: {result['verified']}")
    print(f"\n--- Solution ---\n{result['solution']}")
    print(f"\n--- Final Answer ---\n{result['answer']}")
    print(f"\n--- Usage ---\n{json.dumps(result['usage'], indent=2)}")


if __name__ == "__main__":
    main()
