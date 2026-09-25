"""
Agent V4 · Read Tools (B1 solve_problem · B2 search_textbook · B3 get_study_state).

Tools wrap EXISTING backend capabilities (Harness V3, cross-book RAG, state
aggregation) — the agent never touches storage directly, everything is bound
to the requesting user (E3). Every handler returns
    {"summary": str, "data": object}
where summary is one line for the status feed and data is the (truncated)
payload injected back into the loop context (A6 budget).
"""
import json

# ---- OpenAI tools schema (subset surfaced to the model in P2) ----
TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "solve_problem",
            "description": "调用解题引擎（Harness V3，双车道+验证器）求解一道具体的数学题，返回带验证的解答。当学生给出需要计算的题目时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "题目全文（保留数学符号）"},
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_textbook",
            "description": "在学生已索引的教材中检索内容（中英文跨语言：中文问题可命中英文教材，反之亦然）。当学生问'我的教材里有没有讲X'或需要教材出处时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索词（概念名即可）"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_study_state",
            "description": "获取学生当前学习状态：前测掌握度、薄弱知识点、最近答题正确率、学习计划进度、词汇量。当学生问'我该复习什么/进度怎么样/薄弱点'时使用。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

VALID_TOOLS = {t["function"]["name"] for t in TOOL_SPECS}


def _no_login():
    return {"summary": "未登录，无法查询个人数据", "data": {"note": "guest"}}


# ---- B1: solve via Harness V3 ----
def _solve(question: str, user_id) -> dict:
    from server import solve_question, DASHSCOPE_API_KEY, MODEL, BASE_URL
    try:
        result = solve_question(
            question_text=question,
            options=None,
            api_key=DASHSCOPE_API_KEY,
            model=MODEL,
            base_url=BASE_URL.replace("/chat/completions", ""),
        )
        answer = str(result.get("answer", "")).strip()
        solution = str(result.get("solution", "") or "")[:3000]   # A6 truncation
        verified = "已验证" if result.get("verified") else "未验证"
        topic = result.get("topic", "")
        return {
            "summary": f"已解出（{topic} · {result.get('lane', '?')}道 · {verified}）：{answer[:60]}",
            "data": {"answer": answer, "topic": topic, "verified": result.get("verified"),
                     "solution": solution},
        }
    except Exception as e:
        return {"summary": f"解题引擎失败：{str(e)[:80]}", "data": {"error": str(e)[:200]}}


# ---- B2: cross-book RAG ----
def _search(query: str, user_id) -> dict:
    if not user_id:
        return _no_login()
    from server import get_db, rag, DASHSCOPE_API_KEY
    conn = get_db()
    try:
        books = conn.execute(
            "SELECT id, title FROM documents WHERE user_id=? AND category='textbooks' AND parse_status='done'",
            (user_id,),
        ).fetchall()
        if not books:
            return {"summary": "学生暂无已解析教材", "data": {"note": "no_textbooks"}}
        hits = rag.retrieve_multi(conn, [b["id"] for b in books], query,
                                  DASHSCOPE_API_KEY, topk=3)
        titles = {b["id"]: b["title"] for b in books}
        out = []
        for h in hits:
            out.append({"book": titles.get(h["doc_id"], h["doc_id"]),
                        "page": h["page"], "text": h["text"][:400]})   # A6 truncation
        locs = "、".join(f"{o['book']} p.{o['page']}" for o in out[:3]) if out else "无匹配"
        return {"summary": f"检索到 {len(out)} 处：{locs}", "data": {"chunks": out}}
    except Exception as e:
        return {"summary": f"检索失败：{str(e)[:80]}", "data": {"error": str(e)[:200]}}
    finally:
        conn.close()


# ---- B3: study state aggregation ----
def _state(user_id) -> dict:
    if not user_id:
        return _no_login()
    from server import get_db
    conn = get_db()
    try:
        a = conn.execute(
            "SELECT avg_score, weak_topics, strong_topics FROM assessments "
            "WHERE user_id=? ORDER BY created_at DESC LIMIT 1", (user_id,)).fetchone()
        quizzes = conn.execute(
            "SELECT topic, score, total FROM quiz_results WHERE user_id=? "
            "ORDER BY created_at DESC LIMIT 5", (user_id,)).fetchall()
        plan = conn.execute(
            "SELECT state_json FROM study_plans WHERE user_id=? "
            "ORDER BY last_updated DESC LIMIT 1", (user_id,)).fetchone()
        vocab_n = conn.execute(
            "SELECT COUNT(*) c FROM vocab_entries WHERE user_id=?", (user_id,)).fetchone()["c"]
    finally:
        conn.close()
    weak = (a["weak_topics"] or "") if a else ""
    quiz_lines = [f"{q['topic']}: {q['score']}/{q['total']}" for q in quizzes]
    plan_done = 0
    plan_total = 0
    if plan and plan["state_json"]:
        try:
            st = json.loads(plan["state_json"])
            prog = st.get("progress", {})
            comp = st.get("completed", {})
            keys = set(prog) | set(comp)
            plan_total = len(keys)
            plan_done = sum(1 for k in keys if comp.get(k) or (prog.get(k) or 0) >= 100)
        except Exception:
            pass
    data = {
        "assessment": {"avg_score": a["avg_score"] if a else None,
                       "weak_topics": [t for t in weak.split(",") if t.strip()][:5]},
        "recent_quizzes": quiz_lines,
        "plan": {"done": plan_done, "total": plan_total},
        "vocab_count": vocab_n,
    }
    summary = (f"掌握度{data['assessment']['avg_score']}%·"
               f"计划{plan_done}/{plan_total}·最近{len(quiz_lines)}次练习·词汇{vocab_n}")
    return {"summary": summary, "data": data}


def execute_tool(name: str, args: dict, user_id) -> dict:
    """Dispatch with E3 binding. Unknown names return a graceful summary."""
    try:
        if name == "solve_problem":
            return _solve(str(args.get("question", ""))[:2000], user_id)
        if name == "search_textbook":
            return _search(str(args.get("query", ""))[:200], user_id)
        if name == "get_study_state":
            return _state(user_id)
    except Exception as e:
        return {"summary": f"工具执行异常：{str(e)[:80]}", "data": {"error": str(e)[:200]}}
    return {"summary": f"工具 {name} 暂不可用", "data": {}}
