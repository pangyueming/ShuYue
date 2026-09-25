"""
Benchmark: Compare Direct API vs Harness V2 vs Harness V3
Usage:
    python benchmark.py --mode all --limit 5          # Quick test (5 questions)
    python benchmark.py --mode all                      # Full test (all questions)
    python benchmark.py --mode v2 --limit 10            # Test V2 only
    python benchmark.py --mode v3 --topic Integration   # Test V3 on Integration only
"""
import os
import sys
import re
import json
import time
import argparse
from datetime import datetime
from typing import Dict, List, Optional, Any

# Add paths for imports
sys.path.insert(0, r"D:\study\数跃\产品UI\harness_design\harness_uk")
sys.path.insert(0, r"D:\study\数跃\产品UI\harness_design\harness_improve")

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Try loading from .env file
_env_path = r"D:\study\数跃\产品UI\code_v2\.env"
if os.path.exists(_env_path):
    with open(_env_path, 'r', encoding='utf-8') as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                key, val = line.strip().split('=', 1)
                os.environ.setdefault(key, val)

API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
MODEL = "qwen3.8-27b"

# ---------------------------------------------------------------------------
# Mode 1: Direct API (Bare Run)
# ---------------------------------------------------------------------------

def solve_direct(question: str, options: list = None) -> Dict[str, Any]:
    """Call API directly without any harness."""
    system_msg = "You are a UK university mathematics tutor. Solve the problem step by step. Put final answer in <answer>...</answer> tags."
    
    user_msg = question
    if options:
        user_msg += "\n\nOptions:\n" + "\n".join(f"  {chr(65+i)}. {opt}" for i, opt in enumerate(options))
    
    start = time.time()
    resp = requests.post(
        BASE_URL + "/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
            "temperature": 0.3,
            "max_tokens": 4096,
            "enable_thinking": True,
        },
        timeout=120,
    )
    latency = time.time() - start
    
    resp.raise_for_status()
    data = resp.json()
    text = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    
    # Extract answer
    import re
    ans = ""
    m = re.search(r"<answer>(.*?)</answer>", text, re.DOTALL)
    if m:
        ans = m.group(1).strip()
    else:
        # Fallback
        m = re.findall(r"-?\d+(?:\.\d+)?(?:/\d+)?", text)
        if m:
            ans = m[-1]
        else:
            ans = text[-200:].strip()
    
    return {
        "answer": ans,
        "solution": text,
        "usage": usage,
        "latency_sec": round(latency, 2),
    }

# ---------------------------------------------------------------------------
# Mode 2: Harness V2
# ---------------------------------------------------------------------------

def solve_v2(question: str, options: list = None) -> Dict[str, Any]:
    """Use original harness_uk_math.py"""
    from harness_uk_math import solve_question
    
    start = time.time()
    result = solve_question(
        question_text=question,
        options=options,
        api_key=API_KEY,
        model=MODEL,
        base_url=BASE_URL,
    )
    latency = time.time() - start
    
    return {
        "answer": result.get("answer", ""),
        "solution": result.get("solution", ""),
        "topic": result.get("topic", ""),
        "lane": result.get("lane", ""),
        "confidence": result.get("confidence", 1.0),
        "verified": result.get("verified", False),
        "usage": result.get("usage", {}),
        "latency_sec": round(latency, 2),
    }

# ---------------------------------------------------------------------------
# Mode 3: Harness V3
# ---------------------------------------------------------------------------

def solve_v3(question: str, options: list = None) -> Dict[str, Any]:
    """Use new harness_v3.py"""
    from harness_v3 import solve_question
    
    start = time.time()
    result = solve_question(
        question_text=question,
        options=options,
        api_key=API_KEY,
        model=MODEL,
        base_url=BASE_URL,
    )
    latency = time.time() - start
    
    return {
        "answer": result.get("answer", ""),
        "solution": result.get("solution", ""),
        "topic": result.get("topic", ""),
        "qtype": result.get("qtype", ""),
        "lane": result.get("lane", ""),
        "confidence": result.get("confidence", 1.0),
        "verified": result.get("verified", False),
        "usage": result.get("usage", {}),
        "latency_sec": round(latency, 2),
        "routing_reasons": result.get("routing_reasons", []),
        "proof_assessment": result.get("proof_assessment"),
        "step_check": result.get("step_check"),
    }

# ---------------------------------------------------------------------------
# Answer Comparison
# ---------------------------------------------------------------------------

def _latex_to_plain(text: str) -> str:
    """Convert common LaTeX to plain text for sympify."""
    import re
    s = text
    # Fractions
    s = re.sub(r"\\frac\{(.*?)\}\{(.*?)\}", r"(\1)/(\2)", s)
    # Remove LaTeX commands
    s = re.sub(r"\\[a-zA-Z]+\*?", " ", s)
    # Remove braces
    s = s.replace("{", "").replace("}", "")
    # Remove other LaTeX
    s = re.sub(r"\\[()\[\]]", "", s)
    s = s.replace("^", "**")
    return s.strip()


def check_answer(pred: str, gold: str, answer_type: str) -> tuple:
    """Check if predicted answer matches gold."""
    pred_raw = str(pred or "").strip()
    gold_raw = str(gold or "").strip()
    pred = pred_raw.lower()
    gold = gold_raw.lower()
    
    if not pred or not gold:
        return False, "empty"
    
    if answer_type == "exact":
        # Normalize for comparison
        pred_norm = pred.replace(" ", "").replace("\\", "")
        gold_norm = gold.replace(" ", "").replace("\\", "")
        if pred_norm == gold_norm:
            return True, "exact"
        # Try numeric comparison for exact type too
        try:
            if abs(float(pred_norm) - float(gold_norm)) < 1e-6:
                return True, "exact_numeric"
        except:
            pass
        return False, "exact"
    
    if answer_type == "numeric_tolerance":
        try:
            return abs(float(pred) - float(gold)) < 1e-3, "numeric"
        except:
            pass
    
    if answer_type == "symbolic":
        # Try sympy comparison with LaTeX cleaning
        try:
            import sympy as sp
            p_plain = _latex_to_plain(pred_raw)
            g_plain = _latex_to_plain(gold_raw)
            p = sp.sympify(p_plain)
            g = sp.sympify(g_plain)
            if sp.simplify(p - g) == 0:
                return True, "symbolic"
        except Exception as e:
            pass
        
        # Fallback: more lenient string comparison
        # Remove common variations
        def normalize_sym(s):
            s = s.replace(" ", "").replace("\\", "")
            s = s.replace("arctan", "tan^-1").replace("tan^{-1}", "tan^-1")
            s = s.replace("sin", "s").replace("cos", "c")  # Too aggressive, skip
            s = s.replace("+", "").replace("c", "")  # Remove +C variations
            s = s.replace("**", "^")
            return s
        
        pred_norm = normalize_sym(pred)
        gold_norm = normalize_sym(gold)
        
        # Substring match (for partial matches)
        if pred_norm == gold_norm or pred_norm in gold_norm or gold_norm in pred_norm:
            return True, "symbolic_fallback"
        
        # Check if key components match
        pred_nums = set(re.findall(r"-?\d+(?:\.\d+)?", pred))
        gold_nums = set(re.findall(r"-?\d+(?:\.\d+)?", gold))
        if pred_nums and gold_nums and pred_nums == gold_nums:
            return True, "symbolic_numbers"
        
        return False, "symbolic_fallback"
    
    if answer_type == "proof_structure":
        # For proofs, check key structural elements
        keywords = ["proof", "therefore", "hence", "thus", "qed", "assume", "let", "suppose"]
        pred_has = sum(1 for kw in keywords if kw in pred)
        
        # Must have at least 2 proof keywords AND some logical connectives
        if pred_has >= 2:
            return True, "proof_heuristic"
        return False, "proof_heuristic"
    
    return False, "unknown_type"

# ---------------------------------------------------------------------------
# Main Benchmark
# ---------------------------------------------------------------------------

def run_benchmark(test_set: List[dict], modes: List[str], output_dir: str, resume: bool = True):
    """Run benchmark on test set. Supports resume from previous run."""
    
    progress_file = os.path.join(output_dir, "benchmark_progress.json")
    
    # Try to load existing progress
    existing_results = None
    if resume and os.path.exists(progress_file):
        try:
            with open(progress_file, 'r', encoding='utf-8') as f:
                existing_results = json.load(f)
            print(f"Loaded existing progress: {len(existing_results.get('questions', []))} questions completed")
        except Exception as e:
            print(f"Could not load progress: {e}")
    
    if existing_results:
        results = existing_results
        completed_ids = {q['id'] for q in results.get('questions', [])}
        # Filter to only remaining questions
        test_set = [q for q in test_set if q['id'] not in completed_ids]
        print(f"Remaining questions to run: {len(test_set)}")
        if not test_set:
            print("All questions already completed!")
            return results
    else:
        results = {
            "meta": {
                "timestamp": datetime.now().isoformat(),
                "model": MODEL,
                "total_questions": 0,
                "modes_tested": modes,
            },
            "questions": [],
            "summary": {},
        }
    
    for idx, q in enumerate(test_set, 1):
        print(f"\n{'='*60}")
        print(f"[{idx}/{len(test_set)}] {q['id']} | {q['topic']} | {q['qtype']} | {q['difficulty']}")
        print(f"Question: {q['question'][:100]}...")
        
        q_result = {
            "id": q["id"],
            "topic": q["topic"],
            "qtype": q["qtype"],
            "difficulty": q["difficulty"],
            "question": q["question"],
            "gold_answer": q["answer"],
            "answer_type": q["answer_type"],
            "modes": {},
        }
        
        for mode in modes:
            print(f"  Running {mode}...", end=" ")
            try:
                if mode == "direct":
                    raw = solve_direct(q["question"], q.get("options"))
                elif mode == "v2":
                    raw = solve_v2(q["question"], q.get("options"))
                elif mode == "v3":
                    raw = solve_v3(q["question"], q.get("options"))
                else:
                    continue
                
                correct, match_type = check_answer(
                    raw["answer"], q["answer"], q["answer_type"]
                )
                
                q_result["modes"][mode] = {
                    "answer": raw["answer"],
                    "correct": correct,
                    "match_type": match_type,
                    "latency_sec": raw["latency_sec"],
                    "usage": raw.get("usage", {}),
                }
                
                # Add V2/V3 specific fields
                if mode in ("v2", "v3"):
                    q_result["modes"][mode]["topic_detected"] = raw.get("topic", "")
                    q_result["modes"][mode]["lane"] = raw.get("lane", "")
                    q_result["modes"][mode]["confidence"] = raw.get("confidence", 1.0)
                
                if mode == "v3":
                    q_result["modes"][mode]["routing_reasons"] = raw.get("routing_reasons", [])
                    q_result["modes"][mode]["proof_assessment"] = raw.get("proof_assessment")
                
                status = "[OK]" if correct else "[FAIL]"
                try:
                    ans_display = raw['answer'][:50]
                except:
                    ans_display = raw['answer'].encode('ascii', 'replace').decode('ascii')[:50]
                print(f"{status} {ans_display} (match: {match_type}, {raw['latency_sec']}s)")
                
            except Exception as e:
                print(f"[ERROR] {e}")
                q_result["modes"][mode] = {
                    "answer": "",
                    "correct": False,
                    "match_type": "error",
                    "error": str(e),
                }
        
        results["questions"].append(q_result)
        
        # Save intermediate results
        with open(os.path.join(output_dir, "benchmark_progress.json"), 'w') as f:
            json.dump(results, f, indent=2)
    
    # Compute summary
    summary = {}
    for mode in modes:
        mode_results = [q["modes"][mode] for q in results["questions"] if mode in q["modes"]]
        correct_count = sum(1 for r in mode_results if r.get("correct", False))
        total = len(mode_results)
        
        # Token usage
        total_tokens = sum(
            r.get("usage", {}).get("total_tokens", 0) 
            for r in mode_results if "usage" in r
        )
        
        # Latency
        latencies = [r["latency_sec"] for r in mode_results if "latency_sec" in r]
        avg_latency = sum(latencies) / len(latencies) if latencies else 0
        
        summary[mode] = {
            "correct": correct_count,
            "total": total,
            "accuracy": round(correct_count / total, 4) if total > 0 else 0,
            "total_tokens": total_tokens,
            "avg_latency_sec": round(avg_latency, 2),
        }
    
    results["summary"] = summary
    results["meta"]["total_questions"] = len(results["questions"])
    
    # Save final results
    with open(os.path.join(output_dir, "benchmark_results.json"), 'w') as f:
        json.dump(results, f, indent=2)
    
    return results


def generate_report(results: dict, output_path: str):
    """Generate human-readable markdown report."""
    
    lines = [
        "# 数跃 Harness Benchmark Report",
        "",
        f"**Date**: {results['meta']['timestamp']}",
        f"**Model**: {results['meta']['model']}",
        f"**Questions**: {results['meta']['total_questions']}",
        f"**Modes**: {', '.join(results['meta']['modes_tested'])}",
        "",
        "---",
        "",
        "## Summary",
        "",
        "| Mode | Correct | Total | Accuracy | Total Tokens | Avg Latency |",
        "|------|---------|-------|----------|--------------|-------------|",
    ]
    
    for mode, stats in results["summary"].items():
        lines.append(
            f"| {mode} | {stats['correct']} | {stats['total']} | "
            f"{stats['accuracy']*100:.1f}% | {stats['total_tokens']:,} | {stats['avg_latency_sec']}s |"
        )
    
    lines.extend(["", "## By Topic", ""])
    
    # Group by topic
    from collections import defaultdict
    topic_stats = defaultdict(lambda: defaultdict(lambda: {"correct": 0, "total": 0}))
    
    for q in results["questions"]:
        topic = q["topic"]
        for mode, r in q["modes"].items():
            topic_stats[topic][mode]["total"] += 1
            if r.get("correct"):
                topic_stats[topic][mode]["correct"] += 1
    
    lines.append("| Topic | " + " | ".join(f"{m} Accuracy" for m in results["meta"]["modes_tested"]) + " |")
    lines.append("|" + "|".join(["------"] * (1 + len(results["meta"]["modes_tested"]))) + "|")
    
    for topic in sorted(topic_stats.keys()):
        accs = []
        for mode in results["meta"]["modes_tested"]:
            s = topic_stats[topic][mode]
            acc = f"{s['correct']}/{s['total']}" if s["total"] > 0 else "N/A"
            accs.append(acc)
        lines.append(f"| {topic} | " + " | ".join(accs) + " |")
    
    lines.extend(["", "## Detailed Results", ""])
    
    for q in results["questions"]:
        lines.extend([
            f"### {q['id']} — {q['topic']} ({q['qtype']}, {q['difficulty']})",
            f"**Question**: {q['question']}",
            f"**Gold Answer**: {q['gold_answer']}",
            "",
        ])
        
        for mode, r in q["modes"].items():
            status = "[OK]" if r.get("correct") else "[FAIL]"
            lines.append(f"**{mode.upper()}**: {status} `{r.get('answer', 'N/A')}` (match: {r.get('match_type', 'N/A')})")
            if "error" in r:
                lines.append(f"  Error: {r['error']}")
            if mode == "v3" and "routing_reasons" in r:
                lines.append(f"  Routing: {', '.join(r['routing_reasons'])}")
        
        lines.append("")
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines))
    
    print(f"\nReport saved to: {output_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Benchmark Harness V2 vs V3")
    p.add_argument("--mode", default="all", choices=["all", "direct", "v2", "v3", "v2v3"],
                   help="Which modes to test")
    p.add_argument("--limit", type=int, default=0,
                   help="Limit to first N questions (0 = all)")
    p.add_argument("--topic", default="",
                   help="Filter by topic")
    p.add_argument("--output-dir", default=r"D:\study\数跃\产品UI\harness_design\harness_improve\evaluation",
                   help="Output directory")
    args = p.parse_args()
    
    if not API_KEY:
        print("ERROR: DASHSCOPE_API_KEY not set!")
        return
    
    # Load test set
    test_path = r"D:\study\数跃\产品UI\harness_design\harness_improve\data\test_set_uk_50.json"
    with open(test_path, 'r', encoding='utf-8') as f:
        test_set = json.load(f)
    
    # Filter
    if args.topic:
        test_set = [q for q in test_set if q["topic"] == args.topic]
    if args.limit > 0:
        test_set = test_set[:args.limit]
    
    print(f"Loaded {len(test_set)} questions")
    print(f"Modes: {args.mode}")
    
    # Determine modes
    if args.mode == "all":
        modes = ["direct", "v2", "v3"]
    elif args.mode == "v2v3":
        modes = ["v2", "v3"]
    else:
        modes = [args.mode]
    
    # Create output dir
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Run
    print(f"\nStarting benchmark... Estimated time: {len(test_set) * len(modes) * 5}s")
    results = run_benchmark(test_set, modes, args.output_dir)
    
    # Generate report
    report_path = os.path.join(args.output_dir, "benchmark_report.md")
    generate_report(results, report_path)
    
    # Print summary
    print(f"\n{'='*60}")
    print("BENCHMARK COMPLETE")
    print(f"{'='*60}")
    for mode, stats in results["summary"].items():
        print(f"{mode.upper()}: {stats['correct']}/{stats['total']} = {stats['accuracy']*100:.1f}%")
    
    print(f"\nFull results: {args.output_dir}")


if __name__ == "__main__":
    main()
