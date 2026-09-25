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

_SYSTEM_BASE = (
    "你是数跃 (ShuYue)，中外合办大学（北邮-QMUL式）一年级 AI 学习助手，"
    "学生来自高考体系、学习英文授课的大学数学。中文回答为主，关键术语首次出现附英文对照。"
    "你可以调用工具查询学生的教材与学习状态；需要精确解数学题时优先调用 solve_problem。"
    "出题生成与写操作（存书架/记笔记）暂未开放，请如实告知并尽力用现有能力帮助学生。"
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


def run_agent(message: str, history: list, user_skill, user_id):
    """
    Generator of SSE strings. history = [{"role","content"}] prior turns.
    user_skill = explicitly selected skill name (from + menu / / command) or None.
    """
    from agent import decision as D
    from agent import tools as T
    from server import skill_loader

    actions = []
    used_tokens = 0

    # ---------- 1. Decision layer (F1 intent + F2 skill) ----------
    dec = D.decide_intent(message)
    intent, conf = dec["intent"], dec["confidence"]
    skill = user_skill
    skill_src = "user" if user_skill else None
    if not skill and intent in ("chat", "solve"):
        m = D.match_skill(message, skill_loader.list_skills())
        if m["skill"] and m["confidence"] >= 0.75:
            skill = m["skill"]
            skill_src = "auto"
    yield _sse({"type": "decision", "intent": intent, "confidence": conf,
                "skill": skill, "skill_source": skill_src})
    if skill:
        yield _sse({"type": "status", "text": f"已启用技能：{skill_loader.skill_label(skill)}"})

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

    # ---------- 2b. chat: direct stream, no tools ----------
    if intent not in D.TOOL_LOOP_INTENTS:
        messages = [{"role": "system", "content": system_prompt}] + history[-12:] + \
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
            # A5 degrade — fall through to non-stream single call
            try:
                msg, _ = _upstream(messages, stream=False)
                full = msg.get("content") or ""
                yield _sse({"type": "text", "delta": full})
                yield _sse({"type": "actions", "items": actions})
                return
            except Exception as e:
                yield _sse({"type": "error", "text": f"生成失败：{str(e)[:120]}"})
                return

    # ---------- 2c. tool loop with the 27b (A1) ----------
    # Guests see only solve_problem: state/search tools cannot work without a
    # user, and letting the model call them just burns loop steps.
    tool_specs = T.TOOL_SPECS if user_id else \
        [s for s in T.TOOL_SPECS if s["function"]["name"] == "solve_problem"]
    messages = [{"role": "system", "content": system_prompt}] + history[-12:] + \
               [{"role": "user", "content": message}]
    final_text = ""
    for step in range(MAX_STEPS):   # E4 step cap
        try:
            if used_tokens > MAX_LOOP_TOKENS:   # E4 token budget
                yield _sse({"type": "status", "text": "已达本次对话工具预算上限，直接作答"})
                messages.append({"role": "user", "content": "（预算提示：不要再调用工具，直接给出最终回答）"})
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
            yield _sse({"type": "tool_call", "name": name, "args": _brief(args)})
            tr = T.execute_tool(name, args, user_id)
            actions.append({"kind": name, "text": tr["summary"]})
            yield _sse({"type": "tool_result", "name": name, "summary": tr["summary"]})
            messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                             "content": json.dumps(tr["data"], ensure_ascii=False)[:4000]})
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
