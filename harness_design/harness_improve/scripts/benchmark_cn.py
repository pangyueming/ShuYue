"""
China-track bilingual benchmark (BUPT Sino-foreign joint programme).

Runs test_set_cn.json (zh + en, MCQ/Short/Proof) through Harness V3 and
reports accuracy against the UK-track V3 baseline (89.1%).

Grading:
  MCQ   — extracted letter (A-D) vs known answer
  Short — normalised answer contains one of the accepted variants
  Proof — bilingual ProofVerifier verdict: pass = correct,
          needs_revision counted separately (partial), fail = wrong

Usage:  python benchmark_cn.py [--workers 4] [--limit N]
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # harness_improve/
sys.path.insert(0, ROOT)

ENV_PATH = os.path.join(ROOT, "..", "..", "code_v2", ".env")


def load_env(path):
    key = None
    model = "qwen3.8-27b"
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"\s*(DASHSCOPE_API_KEY|MODEL)\s*=\s*(.+)", line)
                if m:
                    if m.group(1) == "DASHSCOPE_API_KEY":
                        key = m.group(2).strip()
                    else:
                        model = m.group(2).strip()
    except OSError:
        pass
    return key or os.getenv("DASHSCOPE_API_KEY"), model


def norm(s):
    """Loose normalisation for short-answer comparison."""
    s = str(s or "").strip().lower()
    s = re.sub(r"\$", "", s)
    s = re.sub(r"[\s\\{}]+", "", s)
    s = s.replace("²", "^2").replace("³", "^3")
    return s


def grade(item, resp):
    """Return (verdict, detail) — verdict in {correct, partial, wrong, error}."""
    if resp is None:
        return "error", "no response"
    ans = str(resp.get("answer", "") or "")
    if item["qtype"] == "MCQ":
        m = re.search(r"\b([A-D])\b", ans.upper())
        got = m.group(1) if m else "?"
        return ("correct" if got == item["answer"] else "wrong"), f"got {got}"
    if item["qtype"] == "Short":
        for acc in item["answer"]:
            if norm(acc) in norm(ans) or norm(ans) == norm(acc):
                return "correct", f"match {acc}"
        return "wrong", f"got '{ans[:40]}'"
    # Proof
    pa = resp.get("proof_assessment")
    if not pa:
        # Proof question routed to Lane A (no verifier) — treat by presence of an answer
        return ("partial", "no verifier (lane A)") if ans else ("wrong", "empty")
    overall = pa.get("overall")
    if overall == "pass":
        return "correct", f"{pa.get('proof_type')} {pa.get('score')}"
    if overall == "needs_revision":
        return "partial", f"{pa.get('proof_type')} {pa.get('score')}"
    return "wrong", f"{pa.get('proof_type')} {pa.get('score')}"


def run_one(solve, item, api_key, model):
    t0 = time.time()
    try:
        resp = solve(
            question_text=item["q"],
            options=item.get("options"),
            api_key=api_key,
            model=model,
        )
        return item, resp, time.time() - t0, None
    except Exception as e:  # noqa: BLE001
        return item, None, time.time() - t0, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    api_key, model = load_env(ENV_PATH)
    if not api_key:
        print("FATAL: DASHSCOPE_API_KEY not found in", ENV_PATH)
        return 1

    from harness_v3 import solve_question  # after sys.path setup

    data = json.load(open(os.path.join(HERE, "test_set_cn.json"), encoding="utf-8"))
    questions = data["questions"][: args.limit or None]

    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(run_one, solve_question, q, api_key, model) for q in questions]
        for f in as_completed(futs):
            item, resp, dt, err = f.result()
            verdict, detail = grade(item, resp)
            rows.append({
                "id": item["id"], "lang": item["lang"], "qtype": item["qtype"],
                "verdict": verdict, "detail": detail,
                "lane": (resp or {}).get("lane"), "topic": (resp or {}).get("topic"),
                "secs": round(dt, 1), "err": err,
            })
            mark = {"correct": "✓", "partial": "◐", "wrong": "✗", "error": "!"}[verdict]
            print(f"  {mark} {item['id']:14s} {verdict:8s} lane={rows[-1]['lane']} "
                  f"topic={rows[-1]['topic']} {dt:5.1f}s  {detail}" + (f"  ERR={err}" if err else ""))

    rows.sort(key=lambda r: r["id"])
    def acc(sub, v=None):
        n = [r for r in sub if r["verdict"] == (v or r["verdict"])]
        pass_n = sum(1 for r in sub if r["verdict"] == "correct")
        return pass_n, len(sub)

    print("\n" + "=" * 60)
    print("中国赛道双语基准（Harness V3 + 中文管道）")
    print("=" * 60)
    groups = {
        "总体": rows,
        "中文题": [r for r in rows if r["lang"] == "zh"],
        "英文题": [r for r in rows if r["lang"] == "en"],
        "MCQ": [r for r in rows if r["qtype"] == "MCQ"],
        "Short": [r for r in rows if r["qtype"] == "Short"],
        "Proof(验证器pass)": [r for r in rows if r["qtype"] == "Proof"],
    }
    for name, sub in groups.items():
        p, n = acc(sub)
        part = sum(1 for r in sub if r["verdict"] == "partial")
        if n == 0:
            continue
        line = f"{name:18s} {p}/{n}  = {p/n*100:5.1f}%"
        if name.startswith("Proof"):
            line += f"   (needs_revision 另计 {part})"
        print(line)
    avg = sum(r["secs"] for r in rows) / max(len(rows), 1)
    print(f"\n平均耗时 {avg:.1f}s/题（{args.workers} 并发）")
    print(f"对照基线：UK 赛道英文 55 题基准 = {data['baseline_uk_v3']*100:.1f}%")

    out = os.path.join(HERE, "benchmark_cn_results.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print("明细已写入", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
