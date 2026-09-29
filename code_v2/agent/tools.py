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
    {
        "type": "function",
        "function": {
            "name": "list_documents",
            "description": "列出学生书架上的全部文档（标题+分类）。当学生问'我有哪些文档/书架里有什么'时使用。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_document",
            "description": "读取学生书架中某文档的文本内容（按标题模糊匹配）。当学生问'X文档讲了什么/X的第几章'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "文档标题（模糊匹配）"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_vocab",
            "description": "对学生书架中的某文档触发数学术语提取（提取结果存入单词本）。当学生说'帮我提取X的术语'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "文档标题（模糊匹配）"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_vocab_term",
            "description": "将一个数学术语收入学生的单词本。当学生说'把X记到单词本/X记一下'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "term_en": {"type": "string", "description": "英文术语"},
                    "term_zh": {"type": "string", "description": "中文翻译"},
                    "definition": {"type": "string", "description": "简短定义（可选）"},
                },
                "required": ["term_en"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_note",
            "description": "将内容保存为学生的一条笔记。当学生说'记成笔记/保存这个解法'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "笔记标题"},
                    "content": {"type": "string", "description": "笔记内容（Markdown）"},
                    "tag": {"type": "string", "description": "标签（来源文档名，如分析某PDF时传该文档标题）"},
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_quiz",
            "description": "为学生预填出题配置并跳转出题页（主题+数量+难度）。当学生说'给我出N道X题'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "数学主题"},
                    "count": {"type": "integer", "description": "题目数量 1-15"},
                    "difficulty": {"type": "string", "enum": ["Easy", "Medium", "Hard", "Mixed"]},
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_knowledge_map",
            "description": "获取学生知识图谱掌握度摘要：薄弱知识点、已掌握知识点、衔接断层预警、当前教学周。当学生问'我哪里弱/掌握得怎么样/接下来学什么'时使用。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "plot_function",
            "description": "将函数表达式预填到函数画板并跳转（学生可在画板上交互操作）。当学生说'画一下X/可视化X的图像'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "函数表达式，如 sin(x)/x"},
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_study_guide",
            "description": "为指定文档按需生成知识指南（章节+术语表+模式库）。当学生选中了文档导航技能并@引用一份未蒸馏的文档时使用。首次生成约30秒。",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "文档标题（模糊匹配）"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_quiz_mistakes",
            "description": "获取学生最近的测验错题详情（题目、对错、所属主题）。当学生要求'整理错题/错题本/分析错题'时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "最多返回几条错题（默认10）"},
                },
            },
        },
    },
]

VALID_TOOLS = {t["function"]["name"] for t in TOOL_SPECS}

# P3: tools that write user data — require per-session approval (E1)
WRITE_TOOLS = {"extract_vocab", "add_vocab_term", "create_note", "generate_quiz", "update_plan_task", "generate_study_guide"}


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
        srs = conn.execute(
            "SELECT topic, stability, last_review_at, lapses FROM srs_queue "
            "WHERE user_id=?", (user_id,)).fetchall()
    finally:
        conn.close()
    # P9: FSRS memory narration — R(t) per topic, due backlog, weakest first
    from agent import fsrs as _F
    from server import _days_since as _dd
    mem = []
    for r in srs:
        rr = _F.retrievability(r["stability"], _dd(r["last_review_at"]))
        mem.append({"topic": r["topic"], "R": round(rr, 2),
                    "S": round(r["stability"], 2), "lapses": r["lapses"]})
    mem.sort(key=lambda x: x["R"])
    due_mem = [m for m in mem if m["R"] < _F.REMIND_R]
    mem_lines = []
    for m in (due_mem or mem)[:4]:
        state = "待复习" if m["R"] < _F.REMIND_R else "稳固"
        mem_lines.append(f"{m['topic']}：记忆保持{int(m['R']*100)}%（{state}）")
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
        "memory": {"due_count": len(due_mem),
                   "due_topics": [m["topic"] for m in due_mem[:5]],
                   "narration": mem_lines},
    }
    _as = data['assessment']['avg_score']
    summary = (f"掌握度{_as if _as is not None else '未测'}%·"
               f"计划{plan_done}/{plan_total}·最近{len(quiz_lines)}次练习·词汇{vocab_n}·"
               f"{len(due_mem)}项记忆待巩固")
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
        # ---- P3 read tools ----
        if name == "list_documents":
            return _list_docs(user_id)
        if name == "read_document":
            return _read_doc(str(args.get("title", ""))[:200], user_id)
        # ---- P3 write tools (permission-checked in loop.py before dispatch) ----
        if name == "extract_vocab":
            return _extract_vocab(str(args.get("title", ""))[:200], user_id)
        if name == "add_vocab_term":
            return _add_vocab(str(args.get("term_en", ""))[:80],
                              str(args.get("term_zh", ""))[:60] or "",
                              str(args.get("definition", ""))[:200] or "", user_id)
        if name == "create_note":
            return _create_note(str(args.get("title", ""))[:80],
                                str(args.get("content", ""))[:4000], user_id,
                                str(args.get("tag", ""))[:60])
        if name == "generate_quiz":
            return _gen_quiz(str(args.get("topic", ""))[:60],
                             args.get("count"), args.get("difficulty"), user_id)
        if name == "update_plan_task":
            return _update_plan(str(args.get("task_name", ""))[:120], user_id)
        # ---- P3.8: knowledge graph + plotter + assessment ----
        if name == "get_knowledge_map":
            return _knowledge_map(user_id)
        if name == "plot_function":
            return _plot(str(args.get("expression", ""))[:100])
        if name == "start_assessment":
            return {"summary": "已准备好学前诊断（3分钟）——点击跳转开始",
                    "data": {"link": "pretest"}}
        if name == "generate_study_guide":
            return _gen_guide(str(args.get("title", ""))[:200], user_id)
        if name == "get_quiz_mistakes":
            return _quiz_mistakes(user_id, args.get("limit"))
    except Exception as e:
        return {"summary": f"工具执行异常：{str(e)[:80]}", "data": {"error": str(e)[:200]}}
    return {"summary": f"工具 {name} 暂不可用", "data": {}}


# ===================== P3 tools =====================

# ---- B5: list bookshelf docs ----
def _list_docs(user_id) -> dict:
    if not user_id:
        return _no_login()
    from server import get_db
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT title, category, parse_status FROM documents "
            "WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
            (user_id,)).fetchall()
    finally:
        conn.close()
    if not rows:
        return {"summary": "书架为空", "data": {"docs": []}}
    docs = [{"title": r["title"], "category": r["category"]} for r in rows]
    return {"summary": f"书架 {len(docs)} 份文档", "data": {"docs": docs}}


# ---- B4: read a document's text (pages.json, capped) — C13: uses study_guide when available ----
def _read_doc(title_query: str, user_id) -> dict:
    if not user_id:
        return _no_login()
    if not title_query:
        return {"summary": "缺少文档标题", "data": {}}
    from server import get_db, MINERU_DATA_DIR
    import os as _os
    import json as _json
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, title, study_guide FROM documents WHERE user_id=? AND title LIKE ? "
            "ORDER BY created_at DESC LIMIT 1", (user_id, f"%{title_query}%")).fetchall()
        if not rows:
            return {"summary": f"未找到「{title_query}」", "data": {}}
        doc_id, title = rows[0]["id"], rows[0]["title"]
        study_guide_raw = rows[0]["study_guide"]
    finally:
        conn.close()

    # C13: if study_guide exists, return structured chapter navigation instead of raw text
    if study_guide_raw:
        try:
            guide = _json.loads(study_guide_raw)
            chapters = guide.get("chapters", [])
            glossary = guide.get("glossary", [])
            patterns = guide.get("patterns", [])
            chapter_list = "\n".join(
                f"  {c['id']}: {c['title']} — {c.get('summary', '')[:60]}"
                for c in chapters)
            glossary_sample = ", ".join(
                f"{g.get('term_en','?')}({g.get('term_zh','?')})"
                for g in glossary[:10])
            data = {
                "title": title, "doc_id": doc_id,
                "mode": "study_guide",
                "chapters": [{"id": c["id"], "title": c["title"],
                              "summary": c.get("summary", "")} for c in chapters],
                "glossary": glossary[:20],
                "patterns": patterns,
            }
            return {
                "summary": f"《{title}》知识指南：{len(chapters)}章 · {len(glossary)}术语 · {len(patterns)}模式",
                "data": data,
            }
        except Exception:
            pass  # guide parse failed — fall through to raw text

    # Fallback: raw text
    pages_path = _os.path.join(MINERU_DATA_DIR, doc_id, "pages.json")
    if not _os.path.exists(pages_path):
        from server import ensure_pages_json
        if not ensure_pages_json(doc_id):
            return {"summary": f"「{title}」无可提取文本", "data": {}}
    try:
        pages = _json.load(open(pages_path, encoding="utf-8"))
    except Exception:
        return {"summary": f"「{title}」读取失败", "data": {}}
    text = "\n".join((p.get("text") or "") for p in pages)[:6000]   # A6 truncation
    return {"summary": f"已读取「{title}」（{len(pages)}页，截取前6000字）",
            "data": {"title": title, "doc_id": doc_id, "text": text}}


# ---- B7: trigger vocab extraction on an existing doc ----
def _extract_vocab(title_query: str, user_id) -> dict:
    if not user_id:
        return _no_login()
    from server import get_db, extract_vocab_for_doc
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, title FROM documents WHERE user_id=? AND title LIKE ? "
            "ORDER BY created_at DESC LIMIT 1", (user_id, f"%{title_query}%")).fetchone()
        if not row:
            conn.close()
            return {"summary": f"未找到「{title_query}」", "data": {}}
        n = extract_vocab_for_doc(conn, user_id, row["id"], "slides")
        conn.commit()
        return {"summary": f"已从「{row['title']}」提取 {n} 个术语",
                "data": {"extracted": n, "doc": row["title"],
                         "link": "vocab"}}
    finally:
        try: conn.close()
        except Exception: pass


# ---- B8: add a vocab term ----
def _add_vocab(term_en: str, term_zh: str, definition: str, user_id) -> dict:
    if not user_id:
        return _no_login()
    if not term_en.strip():
        return {"summary": "缺少术语", "data": {}}
    from server import get_db
    import time as _time
    import json as _json
    conn = get_db()
    try:
        vid = f"vocab_{int(_time.time()*1000)}"
        conn.execute(
            "INSERT OR IGNORE INTO vocab_entries (id,user_id,term_en,term_zh,definition) "
            "VALUES (?,?,?,?,?)", (vid, user_id, term_en.strip(), term_zh, definition))
        conn.commit()
    finally:
        conn.close()
    return {"summary": f"已收录「{term_en}」→{term_zh or '待补'}",
            "data": {"term_en": term_en, "term_zh": term_zh, "link": "vocab"}}


# ---- B9: create a note ----
def _create_note(title: str, content: str, user_id, tag: str = "") -> dict:
    if not user_id:
        return _no_login()
    if not content.strip():
        return {"summary": "笔记内容为空", "data": {}}
    # auto-extract title from content if not provided or too generic
    if not title.strip() or title.strip() in ("AI 助手笔记", "AI Agent 笔记", "笔记"):
        first_line = content.strip().split("\n")[0]
        # strip markdown/LaTeX markers for a clean title
        import re as _re
        clean = _re.sub(r'[#*$`\\{}\[\]]', '', first_line).strip()
        title = clean[:40] if clean else "学习笔记"
    from server import get_db
    import time as _time
    conn = get_db()
    try:
        nid = f"note_{int(_time.time()*1000)}"
        conn.execute(
            "INSERT INTO notes (id,user_id,title,content,tag,source) VALUES (?,?,?,?,?,?)",
            (nid, user_id, title, content, (tag or "").strip()[:60], "agent"))
        conn.commit()
    finally:
        conn.close()
    return {"summary": f"已存笔记「{title}」",
            "data": {"note_id": nid, "title": title, "tag": tag, "link": "notes"}}


# ---- B10 (A方案): prefill quiz config → frontend jumps to quiz page ----
def _gen_quiz(topic: str, count, difficulty, user_id) -> dict:
    try:
        n = int(count) if count else 5
        n = max(1, min(15, n))
    except (TypeError, ValueError):
        n = 5
    diff = str(difficulty or "Mixed")
    if diff not in ("Easy", "Medium", "Hard", "Mixed"):
        diff = "Mixed"
    return {"summary": f"已预填出题：{topic or '综合'} × {n} 题 · {diff}（点击跳转出题页）",
            "data": {"topic": topic, "count": n, "difficulty": diff, "link": "quiz"}}


# ---- B11: mark a plan task done ----
def _update_plan(task_name: str, user_id) -> dict:
    if not user_id:
        return _no_login()
    import json as _json
    from server import get_db
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT state_json FROM study_plans WHERE user_id=? "
            "ORDER BY last_updated DESC LIMIT 1", (user_id,)).fetchone()
        if not row or not row["state_json"]:
            return {"summary": "尚无学习计划（先做前测）", "data": {}}
        state = _json.loads(row["state_json"])
        completed = state.setdefault("completed", {})
        # find matching task key
        key = None
        for k in list(state.get("progress", {}).keys()) + list(completed.keys()):
            if task_name and task_name[:20] in k:
                key = k; break
        if not key:
            return {"summary": f"计划中未找到「{task_name}」相关任务", "data": {}}
        completed[key] = True
        conn.execute("UPDATE study_plans SET state_json=? WHERE user_id=?",
                     (_json.dumps(state, ensure_ascii=False), user_id))
        conn.commit()
        return {"summary": f"已标记完成：{key.split('|')[-1][:40]}",
                "data": {"task": key, "link": "plan"}}
    finally:
        try: conn.close()
        except Exception: pass


# ---- P3.8: knowledge graph summary (from assessments result_json) ----
def _knowledge_map(user_id) -> dict:
    if not user_id:
        return _no_login()
    import json as _json
    from server import get_db
    conn = get_db()
    try:
        a = conn.execute(
            "SELECT result_json FROM assessments WHERE user_id=? "
            "ORDER BY created_at DESC LIMIT 1", (user_id,)).fetchone()
        quizzes = conn.execute(
            "SELECT topic, score, total FROM quiz_results WHERE user_id=? "
            "ORDER BY created_at DESC LIMIT 10", (user_id,)).fetchall()
    finally:
        conn.close()
    if not a or not a["result_json"]:
        return {"summary": "尚未做学前诊断——先做个 3 分钟测试解锁知识图谱",
                "data": {"link": "pretest"}}
    try:
        r = _json.loads(a["result_json"])
    except Exception:
        return {"summary": "诊断数据异常", "data": {}}
    weak = [t for t in (r.get("weakTopics") or []) if t][:8]
    strong = [t for t in (r.get("strongTopics") or []) if t][:5]
    danger = [t.get("n", "") if isinstance(t, dict) else t
              for t in (r.get("dangerTopics") or [])][:3]
    warnings = [t.get("n", "") if isinstance(t, dict) else t
                for t in (r.get("warningTopics") or [])][:3]
    week = r.get("currentWeek", "?")
    avg = r.get("avgScore", 0)
    quiz_lines = [f"{q['topic']}: {q['score']}/{q['total']}" for q in quizzes]
    data = {
        "avg_score": avg, "current_week": week,
        "weak_topics": weak, "strong_topics": strong,
        "bridge_dangers": danger, "bridge_warnings": warnings,
        "recent_quizzes": quiz_lines,
        "link": "graph",
    }
    summary = (f"掌握度{avg}% · 第{week}周 · "
               f"薄弱{len(weak)}项({'、'.join(weak[:3])}…) · "
               f"断层预警{len(danger)}个")
    return {"summary": summary, "data": data}


# ---- P3.8: plot function → prefill plotter ----
def _plot(expr: str) -> dict:
    if not expr.strip():
        return {"summary": "缺少函数表达式", "data": {}}
    return {"summary": f"已预填函数 y = {expr}（点击跳转画板）",
            "data": {"expression": expr, "link": "plotter"}}


# ---- P5 C13: on-demand study guide generation (for any document) ----
def _gen_guide(title_query: str, user_id) -> dict:
    if not user_id:
        return _no_login()
    if not title_query.strip():
        return {"summary": "缺少文档标题", "data": {}}
    from server import get_db
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, title, study_guide FROM documents WHERE user_id=? AND title LIKE ? "
            "ORDER BY created_at DESC LIMIT 1", (user_id, f"%{title_query}%")).fetchone()
        if not row:
            return {"summary": f"未找到「{title_query}」", "data": {}}
        if row["study_guide"]:
            return {"summary": f"《{row['title']}》已有知识指南（无需重新生成）",
                    "data": {"title": row["title"]}}
        doc_id, title = row["id"], row["title"]
    finally:
        conn.close()
    # Direct call to the shared generation function (no HTTP round-trip)
    try:
        from server import _generate_guide_core
        g = _generate_guide_core(doc_id, title)
        return {"summary": f"已为《{title}》生成知识指南：{g.get('chapters',0)}章 · {g.get('glossary',0)}术语 · {g.get('patterns',0)}模式",
                "data": {"title": title, "doc_id": doc_id,
                         "chapters": g.get("chapters", 0),
                         "glossary": g.get("glossary", 0),
                         "patterns": g.get("patterns", 0)}}
    except Exception as e:
        return {"summary": f"生成失败：{err_msg[:80]}", "data": {}}


# ---- P5 C15: get student's quiz mistakes with detail ----
def _quiz_mistakes(user_id, limit) -> dict:
    if not user_id:
        return _no_login()
    import json as _json
    try:
        n = int(limit) if limit else 10
    except (TypeError, ValueError):
        n = 10
    n = max(1, min(30, n))
    from server import get_db
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT topic, score, total, detail_json, created_at FROM quiz_results "
            "WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
            (user_id,)).fetchall()
    finally:
        conn.close()
    if not rows:
        return {"summary": "尚无测验记录——先做一套练习", "data": {"link": "quiz"}}
    mistakes = []
    for r in rows:
        try:
            detail = _json.loads(r["detail_json"] or "[]")
            for d in detail:
                if d.get("ok") is False:
                    mistakes.append({
                        "question": (d.get("q") or "")[:200],
                        "topic": r["topic"],
                        "date": r["created_at"],
                    })
        except Exception:
            pass
    if not mistakes:
        return {"summary": f"最近 {len(rows)} 次测验全对，没有错题 🎉", "data": {"total_quizzes": len(rows)}}
    return {"summary": f"最近 {len(rows)} 次测验中有 {len(mistakes)} 道错题",
            "data": {"mistakes": mistakes[:n], "total": len(mistakes),
                     "topics": list(set(m["topic"] for m in mistakes))}}
