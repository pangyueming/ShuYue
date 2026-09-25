"""
Agent V4 · Decision Layer (F1 gatekeeper + F2 skill matcher + F4 cascade).

AnyJev-style: a small fast model (qwen3.8-flash, thinking OFF) makes typed
decisions with a confidence score; low-confidence cases escalate to the
generation model once (F4). Prompts are the exact set that scored full marks
in agent-lab/decision_probe.py (12/12 intent + 10/10 skill + 8/8 equivalence).

Every failure degrades SILENTLY to {intent: "chat"} — the agent loop then
behaves like the legacy chat path (A5 fallback), so the decision layer can
never take the product down.
"""
import json
import os
import urllib.request

DECISION_MODEL = os.getenv("DECISION_MODEL", "qwen3.8-flash")
_FALLBACK_MODEL = os.getenv("MODEL", "qwen3.8-27b")
CASCADE_THRESHOLD = 0.85   # F4: below this, re-ask with the big model

_INTENTS = ["solve", "chat", "quiz_request", "vocab_add", "simple_query", "file_op"]

# Intents that should be served by the tool loop rather than plain chat.
TOOL_LOOP_INTENTS = {"solve", "quiz_request", "file_op"}

_intent_sys = (
    "你是路由器。将学生消息分类为一个意图并输出JSON。\n"
    f"意图={_INTENTS}\n"
    "判定要点：\n"
    "- simple_query 仅限查询学生个人学习数据（进度/复习安排/计划/统计/词汇量），如'今天该复习什么''我进度怎样'。\n"
    "- 概念/知识讲解类问题（'X是什么''什么是X''X怎么理解''为什么…'）属于 chat，绝不是 simple_query。"
    "例如：'极限的直观理解是什么'→chat；'supremum 是什么意思'→chat。\n"
    "- 要求出题/做题练习→quiz_request；上传/保存文件→file_op；明确解一道具体题→solve。\n"
    "- 学习规划/方法求助（'帮我攻克X''怎么学X''如何复习X'）→chat（solve 仅限给出了具体题目）。\n"
    "输出: {\"intent\": \"...\", \"confidence\": 0.0-1.0}"
)

_skill_sys_tpl = (
    "你是技能选择器。根据学生消息选择最匹配的技能，输出JSON。\n"
    "技能列表:\n{skills}\nnone: 以上都不匹配\n"
    "输出: {{\"skill\": \"...\", \"confidence\": 0.0-1.0}}"
)


def _call(model, system, user, timeout=20, max_tokens=100):
    """One tiny JSON decision call. Returns parsed dict or raises."""
    from server import DASHSCOPE_API_KEY, BASE_URL  # late import avoids cycles
    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user[:2000]}],
        "temperature": 0.0,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "enable_thinking": False,   # decisions must stay fast/cheap
    }).encode()
    req = urllib.request.Request(BASE_URL, data=body, headers={
        "Authorization": "Bearer " + DASHSCOPE_API_KEY,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    txt = data["choices"][0]["message"].get("content", "{}")
    obj = json.loads(txt)
    obj["confidence"] = float(obj.get("confidence", 0) or 0)
    return obj


def decide_intent(text: str) -> dict:
    """F1 — {intent, confidence}. Never raises; falls back to chat."""
    try:
        out = _call(DECISION_MODEL, _intent_sys, text)
        intent = str(out.get("intent", "chat")).strip()
        if intent not in _INTENTS:
            intent = "chat"
        conf = out["confidence"]
        # F4 cascade: uncertain routing gets one big-model retry
        if conf < CASCADE_THRESHOLD and DECISION_MODEL != _FALLBACK_MODEL:
            try:
                out2 = _call(_FALLBACK_MODEL, _intent_sys, text)
                if str(out2.get("intent", "")).strip() in _INTENTS:
                    return {"intent": out2["intent"].strip(), "confidence": out2["confidence"]}
            except Exception:
                pass
        return {"intent": intent, "confidence": conf}
    except Exception:
        return {"intent": "chat", "confidence": 0.0}


def match_skill(text: str, skills: list) -> dict:
    """F2 — {skill|None, confidence}. skills = [{name,label,description}]."""
    if not skills:
        return {"skill": None, "confidence": 0.0}
    listing = "\n".join(
        f"{s['name']}: {(s.get('description') or '')[:60]}" for s in skills)
    sys_prompt = _skill_sys_tpl.format(skills=listing)
    try:
        out = _call(DECISION_MODEL, sys_prompt, text)
        skill = str(out.get("skill", "")).strip()
        valid = {s["name"] for s in skills}
        if skill and skill in valid:
            return {"skill": skill, "confidence": out["confidence"]}
        return {"skill": None, "confidence": out["confidence"]}
    except Exception:
        return {"skill": None, "confidence": 0.0}


def auto_title(first_message: str) -> str:
    """G1 — name a workspace from its first message (4-10 chars)."""
    try:
        out = _call(DECISION_MODEL,
                    "用4-10个字为学习对话起一个简短名字，只输出名字本身，不要标点。",
                    first_message)
        # response_format guarantees a JSON object — tolerate plain text too
        for v in out.values():
            if isinstance(v, str) and v.strip():
                return v.strip()[:16]
    except Exception:
        pass
    return first_message.strip()[:12] or "新工作台"


def answer_equivalence(gold: str, student: str) -> dict:
    """F3 — quiz soft-grading fast path. {equivalent, confidence}."""
    try:
        out = _call(
            DECISION_MODEL,
            "你是数学答案等价判断器。判断学生答案与标准答案是否数学等价，输出JSON。\n"
            "注意: 符号差异(x^2与x²)、等值形式(1/2与0.5、e^0与1、ln(e)与1)视为等价。\n"
            "输出: {\"equivalent\": true/false, \"confidence\": 0.0-1.0}",
            f"标准答案: {gold}\n学生答案: {student}")
        return {"equivalent": bool(out.get("equivalent", False)),
                "confidence": out["confidence"]}
    except Exception:
        return {"equivalent": None, "confidence": 0.0}
