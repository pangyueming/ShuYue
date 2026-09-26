"""
Agent V4 · Core Loop (A1) — hand-rolled, no framework (decision D1).

Flow (per user message):
  1. F1 decision layer routes the message (intent + auto skill F2).
  2. simple_query  -> tool direct + flash answer   (skips the 27b entirely)
     chat          -> 27b direct stream (skill injected; no tools schema)
     tool intents  -> tool loop with 27b (messages+tools -> tool_calls ->
                      execute -> feed back), <=6 steps, token/step budget (E4).
  3. Every stage emits typed events for the frontend SSE stream (A3):
       {"type":"decision", ...}   routing result (intent/confidence/effective skill)
       {"type":"status","text"}   small status line for the live feed
       {"type":"text","delta"}    streamed answer text
       {"type":"tool_call",...}   a tool was requested
       {"type":"tool_result",...} tool finished (summary for the status line)
       {"type":"actions",...}     end-of-turn summary card payload
  4. Any failure degrades to the plain chat path (A5) — the loop can never
     leave the user without an answer.

Budget guards (A6/E4): MAX_STEPS tool rounds, MAX_LOOP_TOKENS total tokens
across loop calls; each tool result is truncated in tools.py before re-entry.
"""
import json
import re

MAX_STEPS = 6
MAX_LOOP_TOKENS = 12000
_DAILY_WRITE_OPS = {}   # (kind,user_id) → date / count  (E2, process-lifetime)

_SYSTEM_BASE = (
    "你是数跃 (ShuYue)，中外合办大学（北邮-QMUL式）一年级 AI 学习助手，"
    "学生来自高考体系、学习英文授课的大学数学。中文回答为主，关键术语首次出现附英文对照。"
    "你拥有工具能力。以下情况**必须调用对应工具**，不要只文字回答：\n"
    "- 学生要求出题/做题练习 → 必须调 generate_quiz（传 topic/count/difficulty）\n"
    "- 学生要求画图/可视化/绘图 → 必须调 plot_function（传 expression）\n"
    "- 学生要求收录术语到单词本 → 必须调 add_vocab_term\n"
    "- 学生要求存笔记/保存解法 → 必须调 create_note（title 从内容提炼，给描述性标题如'ε-δ 极限证明方法'，不要写'AI笔记'）\n"
    "- 学生问掌握度/哪里弱/图谱状态 → 调 get_knowledge_map\n"
    "- 学生要求查教材内容/章节结构 → 调 read_document（有知识指南时返回结构化章节导航）\n"
    "- 学生问教材中某术语定义 → 先调 read_document 查 glossary，没找到再调 search_textbook\n"
    "- 学生要求列书架文件 → 调 list_documents\n"
    "- 学生要求标记计划任务完成 → 调 update_plan_task\n"
    "- 学生要求做测试/诊断 → 调 start_assessment\n"
    "- 学生选了文档导航技能并@引用文档 → 先调 generate_study_guide（如无指南）→ 再调 read_document\n"
    "\n"
    "**文档上传自动分析**（学生说'我上传了《X》，请分析'时）：\n"
    "1. 先调 read_document(X) 读取内容\n"
    "2. 再调 extract_vocab(X) 提取术语\n"
    "3. 最后调 create_note(标题从内容提炼, 内容=摘要+关键概念, tag=X文档名) 保存笔记\n"
    "   ⚠️ tag 参数必须传来源文档名（如《数学分析》），让学生知道笔记来自哪份文档\n"
    "完成后汇报做了哪几件事，附跳转链接。\n"
    "\n"
    "**数学题求解——按难度分级**：\n"
    "- 简单题（标准极限、基本求导、已知公式、直接计算）→ **直接流式回答**，附简要过程，不需要调工具\n"
    "- 复杂题（证明题、多步推理、需要验证的题目、学生要求验证）→ 调用 solve_problem\n"
    "\n"
    "只有纯闲聊、概念讲解、学习建议、或以上工具都不匹配时，才直接文字回答。\n"
    "调用工具后，用工具返回的数据回答学生，并提及可跳转的入口。"
)

_SIMPLE_QA_SYS = (
    "你是数跃学习助手。下面是学生的问题和系统查到的学习状态数据（JSON）。"
    "用简洁友好的中文回答学生的问题，只依据数据说话，数据里没有的信息不要编造。"
    "可以在结尾给一条下一步学习建议。"
)


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _upstream(messages, tools=None, stream=False, temperature=0.3, max_tokens=2000):
    """One 27b call (non-stream or stream-iter). Returns (text, usage) or streams lines."""
    from server import DASHSCOPE_API_KEY, BASE_URL, MODEL
    import requests as _r
    payload = {"model": MODEL, "messages": messages, "temperature": temperature,
               "max_tokens": max_tokens, "stream": stream, "enable_thinking": False}
    if tools:
        payload["tools"] = tools
    resp = _r.post(BASE_URL, headers={"Authorization": f"Bearer {DASHSCOPE_API_KEY}",
                                      "Content-Type": "application/json"},
                   json=payload, stream=stream, timeout=120)
    resp.raise_for_status()
    if not stream:
        data = resp.json()
        msg = data["choices"][0]["message"]
        usage = (data.get("usage") or {}).get("total_tokens", 0)
        return msg, usage
    return resp


def run_agent(message: str, history: list, user_skill, user_id, approved_tools=None):
    """
    Generator of SSE strings. history = [{"role","content"}] prior turns.
    user_skill = explicitly selected skill name (from + menu / / command) or None.
    approved_tools = session-scoped write-tool approvals (E1, client-held);
    write tools not in this set emit a permission_request event and are NOT
    executed — the frontend shows a confirm card and re-sends with the tool
    approved (one extra round-trip, first use per tool per session only).
    """
    from agent import decision as D
    from agent import tools as T
    from server import skill_loader

    actions = []
    used_tokens = 0
    approved = set(approved_tools or [])

    def _rate_limited():
        """E2: per-user daily cap on write operations (soft, in-memory)."""
        if not user_id:
            return False
        import time as _t
        today = _t.strftime("%Y-%m-%d")
        key = ("write_ops", user_id, today)
        global _DAILY_WRITE_OPS
        if _DAILY_WRITE_OPS.get(("write_ops", user_id)) != today:
            _DAILY_WRITE_OPS[("write_ops", user_id)] = today
            _DAILY_WRITE_OPS[("count", user_id)] = 0
        if _DAILY_WRITE_OPS.get(("count", user_id), 0) >= 50:
            return True
        _DAILY_WRITE_OPS[("count", user_id)] = _DAILY_WRITE_OPS.get(("count", user_id), 0) + 1
        return False

    # ---------- 1. Decision layer (F1 intent + F2 skill) ----------
    dec = D.decide_intent(message)
    intent, conf = dec["intent"], dec["confidence"]
    skill = user_skill
    skill_src = "user" if user_skill else None
    if not skill:
        # P5: auto-match skills for ALL intents (was chat/solve only —
        # weekly-review was missed when intent=simple_query)
        m = D.match_skill(message, skill_loader.list_skills())
        if m["skill"] and m["confidence"] >= 0.75:
            skill = m["skill"]
            skill_src = "auto"
    yield _sse({"type": "decision", "intent": intent, "confidence": conf,
                "skill": skill, "skill_source": skill_src})
    if skill:
        yield _sse({"type": "status", "text": f"已启用技能：{skill_loader.skill_label(skill)}"})

    # Intent-based tool hint: decision layer already classified the message;
    # inject a direct instruction so the model reliably calls the right tool
    _TOOL_HINTS = {
        "quiz_request": "\n（系统提示：学生要求出题，必须调用 generate_quiz 工具，传入 topic、count、difficulty 参数）",
        "vocab_add": "\n（系统提示：学生要求收录术语，必须调用 add_vocab_term 工具）",
        "file_op": "\n（系统提示：学生要求文件操作，检查是否有匹配工具）",
    }
    if intent in _TOOL_HINTS:
        message = message + _TOOL_HINTS[intent]

    # ---------- 2a. simple_query: tool direct + flash answer (zero 27b) ----------
    if intent == "simple_query" and conf >= 0.85:
        yield _sse({"type": "tool_call", "name": "get_study_state"})
        tr = T.execute_tool("get_study_state", {}, user_id)
        yield _sse({"type": "tool_result", "name": "get_study_state", "summary": tr["summary"]})
        actions.append({"kind": "state", "text": tr["summary"]})
        try:
            import urllib.error
            # reuse the decision model for a friendly rendering
            from agent.decision import _call
            out = _call(D.DECISION_MODEL, _SIMPLE_QA_SYS +
                        '\n输出: {"answer": "完整回答"}',
                        f"学生问题：{message}\n状态数据：{json.dumps(tr['data'], ensure_ascii=False)}",
                        max_tokens=500)
            text = str(out.get("answer") or "")
            if not text:
                for v in out.values():
                    if isinstance(v, str) and len(v) > len(text):
                        text = v
            if not text:
                text = tr["summary"]
        except Exception:
            text = tr["summary"]
        yield _sse({"type": "text", "delta": text})
        yield _sse({"type": "actions", "items": actions})
        return

    # ---------- shared: skill instruction injection ----------
    skill_body = skill_loader.load_skill(skill) if skill else None
    system_prompt = _SYSTEM_BASE
    if skill_body:
        system_prompt += ("\n\n===== 当前启用的教学技能 [" + skill_loader.skill_label(skill)
                          + "] =====\n请严格遵守以下教学方法的每一个要求：\n\n" + skill_body)
    # P3 G5: preserve system-role history items (long-term memory injection)
    # while keeping the tail of user/assistant turns
    _sys_hist = [m for m in history if m.get("role") == "system"]
    _usr_hist = [m for m in history if m.get("role") != "system"][-12:]
    _hist = _sys_hist + _usr_hist

    # ---------- 2b. guest / degraded chat: direct stream, no tools ----------
    # Guests get streaming chat (their only tool is solve_problem in the loop
    # below — but simple questions stream directly for zero-latency feel).
    # Logged-in users skip this entirely: ALL intents go through the unified
    # tool loop below, where the model decides whether to call tools or just
    # answer (opencode pattern: always offer tools, let the model choose).
    if not user_id:
        messages = [{"role": "system", "content": system_prompt}] + _hist + \
                   [{"role": "user", "content": message}]
        full = ""
        try:
            resp = _upstream(messages, stream=True)
            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    ev = json.loads(payload)
                    delta = (ev.get("choices") or [{}])[0].get("delta", {}).get("content", "")
                except Exception:
                    continue
                if delta:
                    full += delta
                    yield _sse({"type": "text", "delta": delta})
            if not full:
                raise RuntimeError("empty stream")
            yield _sse({"type": "actions", "items": actions})
            return
        except Exception:
            try:
                msg, _ = _upstream(messages, stream=False)
                full = msg.get("content") or ""
                yield _sse({"type": "text", "delta": full})
                yield _sse({"type": "actions", "items": actions})
                return
            except Exception as e:
                yield _sse({"type": "error", "text": f"生成失败：{str(e)[:120]}"})
                return

    # ---------- 2c. unified tool loop (A1) — ALL logged-in intents ----------
    # Every message gets the full tool surface; the model decides whether to
    # call a tool or answer directly. This replaces the old chat/tool split
    # (which made read/write/graph/plot tools unreachable for "chat" intents).
    tool_specs = T.TOOL_SPECS
    messages = [{"role": "system", "content": system_prompt}] + _hist + \
               [{"role": "user", "content": message}]
    final_text = ""
    tool_history = []   # P4 H2: track tools for the plan card
    for step in range(MAX_STEPS):   # E4 step cap
        try:
            if used_tokens > MAX_LOOP_TOKENS:   # E4 token budget
                yield _sse({"type": "status", "text": "已达本次对话工具预算上限，直接作答"})
                messages.append({"role": "user", "content": "（预算提示：不要再调用工具，直接给出最终回答）"})
            # emit feedback so the user never sees a silent gap
            if step == 0:
                yield _sse({"type": "status", "text": "AI 正在分析..."})
            else:
                yield _sse({"type": "status", "text": f"正在组织回答... (step {step + 1})"})
            msg, usage = _upstream(messages, tools=tool_specs, stream=False)
            used_tokens += usage
        except Exception as e:
            yield _sse({"type": "error", "text": f"生成失败：{str(e)[:120]}"})
            return

        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            content = msg.get("content") or ""
            if not content.strip():
                # model stopped without tool calls AND without text — nudge once
                messages.append({"role": "user",
                                 "content": "（请直接给出最终回答，不要再调用工具）"})
                continue
            final_text = content
            # STREAM the final answer: re-issue without tools for word-by-word output
            yield _sse({"type": "status", "text": "streaming answer..."})
            try:
                resp = _upstream(messages, tools=None, stream=True)
                streamed = ""
                for line in resp.iter_lines(decode_unicode=True):
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        ev = json.loads(payload)
                        delta = (ev.get("choices") or [{}])[0].get("delta", {}).get("content", "")
                    except Exception:
                        continue
                    if delta:
                        streamed += delta
                        yield _sse({"type": "text", "delta": delta})
                if streamed:
                    final_text = streamed
                else:
                    yield _sse({"type": "text", "delta": final_text})
            except Exception:
                # streaming failed — fall back to the non-streaming result we already have
                yield _sse({"type": "text", "delta": final_text})
            break

        messages.append({"role": "assistant", "content": msg.get("content") or "",
                         "tool_calls": tool_calls})
        for tc in tool_calls:
            fn = (tc.get("function") or {})
            name = fn.get("name", "")
            raw_args = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw_args)
            except Exception:
                args = {}
            if name not in T.VALID_TOOLS:
                yield _sse({"type": "tool_result", "name": name,
                            "summary": f"未知工具 {name}，已忽略"})
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                                 "content": json.dumps({"error": f"unknown tool {name}"},
                                                       ensure_ascii=False)})
                continue
            # E1: write tools need session-scoped approval
            if name in T.WRITE_TOOLS and name not in approved:
                yield _sse({"type": "permission_request", "name": name,
                            "args": _brief(args),
                            "hint": _perm_hint(name)})
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                                 "content": json.dumps(
                                     {"status": "pending_user_approval",
                                      "note": "用户尚未授权此操作，请先告知用户需要做什么，等待授权后重试。"},
                                     ensure_ascii=False)})
                actions.append({"kind": "permission", "text": f"待授权：{name}"})
                continue
            # E2: daily cap
            if name in T.WRITE_TOOLS and _rate_limited():
                yield _sse({"type": "tool_result", "name": name,
                            "summary": "今日写操作已达上限（50次/天），明天再试"})
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                                 "content": json.dumps({"error": "rate_limited"},
                                                       ensure_ascii=False)})
                continue
            yield _sse({"type": "tool_call", "name": name, "args": _brief(args)})
            tr = T.execute_tool(name, args, user_id)
            actions.append({"kind": name, "text": tr["summary"],
                            "link": tr["data"].get("link"),
                            "data": {k: v for k, v in tr["data"].items()
                                     if k in ("topic", "count", "difficulty", "expression", "title")}})
            yield _sse({"type": "tool_result", "name": name, "summary": tr["summary"],
                        "link": tr["data"].get("link"),
                        "data": {k: v for k, v in tr["data"].items()
                                 if k in ("topic", "count", "difficulty", "expression", "title")}})
            messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                             "content": json.dumps(tr["data"], ensure_ascii=False)[:4000]})
            # P4 H2: plan card — emit step progress
            tool_history.append({"name": name, "summary": tr["summary"],
                                 "link": tr["data"].get("link")})
            yield _sse({"type": "plan_step", "index": len(tool_history) - 1,
                        "total_planned": None,   # unknown until done; frontend uses count
                        "name": name, "summary": tr["summary"],
                        "link": tr["data"].get("link")})
            # P4 E5: audit log (timeout=5 to avoid SQLite lock contention with the tool's own writes)
            if user_id:
                try:
                    import sqlite3 as _sq
                    from server import DB_PATH as _dbp
                    _c = _sq.connect(_dbp, timeout=5)
                    _c.execute(
                        "INSERT INTO tool_audit_log (user_id,session_id,tool_name,args_summary,result_summary) "
                        "VALUES (?,?,?,?,?)",
                        (user_id, "", name,
                         json.dumps(_brief(args), ensure_ascii=False)[:200],
                         tr["summary"][:200]))
                    _c.commit(); _c.close()
                except Exception:
                    pass
    else:
        # loop exhausted without a final answer — force one plain turn (A5)
        messages.append({"role": "user", "content": "（请直接给出最终回答，不要再调用工具）"})
        try:
            msg, _ = _upstream(messages, stream=False)
            final_text = msg.get("content") or ""
            yield _sse({"type": "text", "delta": final_text})
        except Exception as e:
            yield _sse({"type": "error", "text": f"生成失败：{str(e)[:120]}"})
            return

    yield _sse({"type": "actions", "items": actions})


def _brief(args: dict) -> dict:
    """Truncate tool args for the status feed."""
    out = {}
    for k, v in (args or {}).items():
        s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
        out[k] = s[:80]
    return out


def _perm_hint(name: str) -> str:
    return {
        "extract_vocab": "AI 将从你的文档中提取术语存入单词本",
        "add_vocab_term": "AI 将向你的单词本添加一个术语",
        "create_note": "AI 将保存一条笔记",
        "generate_quiz": "AI 将预填出题配置并跳转出题页",
        "update_plan_task": "AI 将标记你的学习计划任务为已完成",
        "generate_study_guide": "AI 将为此文档生成知识指南（约30秒，只需一次）",
    }.get(name, f"AI 请求执行写操作 {name}")
