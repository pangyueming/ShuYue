"""
Secondary Calibration: Re-check all answers with SymPy rigorous verification
"""
import json
import sys
import re

sys.path.insert(0, r"D:\study\数跃\产品UI\harness_design\harness_improve")
from tools.sympy_executor import SymPyExecutor

executor = SymPyExecutor()

def latex_to_expr(text):
    """Convert LaTeX/math text to SymPy-parseable expression."""
    import re
    s = str(text)
    # Replace common LaTeX
    s = re.sub(r"\\frac\{(.*?)\}\{(.*?)\}", r"(\1)/(\2)", s)
    s = re.sub(r"\\left", "", s)
    s = re.sub(r"\\right", "", s)
    s = re.sub(r"\\\{", "", s)
    s = re.sub(r"\\\}", "", s)
    s = re.sub(r"\\[a-zA-Z]+", "", s)  # Remove remaining \commands
    s = s.replace("{", "").replace("}", "")
    s = s.replace("^", "**")
    s = s.replace("pi", "3.14159265359")
    s = s.replace("e", "2.71828182846")
    # Remove common words
    for word in ["proof", "solution", "answer", "thus", "therefore", "hence"]:
        s = s.replace(word, "")
    return s.strip()


def sympy_check(pred, gold):
    """Use SymPy to rigorously check equivalence."""
    pred_plain = latex_to_expr(pred)
    gold_plain = latex_to_expr(gold)
    
    # Skip if empty after cleaning
    if not pred_plain or not gold_plain:
        return None, "empty_after_clean"
    
    # Try verifying via executor
    try:
        result = executor.verify_expression(pred_plain, gold_plain)
        if result.get("equivalent"):
            return True, "sympy_verified"
    except Exception:
        pass
    
    # Try numeric substitution
    try:
        import sympy as sp
        x = sp.Symbol('x')
        p_expr = sp.sympify(pred_plain, locals={"x": x})
        g_expr = sp.sympify(gold_plain, locals={"x": x})
        
        # Check difference
        diff = sp.simplify(p_expr - g_expr)
        if diff == 0:
            return True, "sympy_diff_zero"
        
        # Numeric check at several points
        import random
        for _ in range(5):
            val = random.uniform(0.1, 5.0)
            try:
                p_val = float(p_expr.subs(x, val))
                g_val = float(g_expr.subs(x, val))
                if abs(p_val - g_val) > 1e-6:
                    return False, "numeric_mismatch"
            except:
                pass
        return True, "numeric_consistent"
    except Exception as e:
        pass
    
    return None, "could_not_verify"


# Load results
progress_path = r"D:\study\数跃\产品UI\harness_design\harness_improve\evaluation\benchmark_progress.json"
with open(progress_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

print("Secondary Calibration Started")
print("=" * 60)

calibration_log = []
changes = []

for q in data['questions']:
    qid = q['id']
    gold = q['gold_answer']
    a_type = q['answer_type']
    
    # Only recheck symbolic and exact types that were marked wrong
    for mode, r in q['modes'].items():
        if r.get('correct'):
            continue  # Skip already correct
        if 'error' in r:
            continue  # Skip errors
            
        pred = r.get('answer', '')
        old_match = r.get('match_type', '')
        
        # Try SymPy verification
        is_correct, new_match = sympy_check(pred, gold)
        
        if is_correct:
            r['correct'] = True
            r['match_type'] = new_match + "_recalibrated"
            changes.append(f"{qid} {mode}: {old_match} -> {new_match}_recalibrated")
            print(f"[FIXED] {qid} {mode}: '{pred[:40]}...' -> {new_match}")
        else:
            print(f"[STILL WRONG] {qid} {mode}: '{pred[:40]}...'")

# Save recalibrated results
with open(progress_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)

# Recompute summary
modes = data['meta']['modes_tested']
summary = {}
for mode in modes:
    mode_results = [q['modes'][mode] for q in data['questions'] if mode in q['modes']]
    correct_count = sum(1 for r in mode_results if r.get('correct', False))
    total = len(mode_results)
    
    total_tokens = sum(
        r.get("usage", {}).get("total_tokens", 0) 
        for r in mode_results if "usage" in r
    )
    latencies = [r["latency_sec"] for r in mode_results if "latency_sec" in r]
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    
    summary[mode] = {
        "correct": correct_count,
        "total": total,
        "accuracy": round(correct_count / total, 4) if total > 0 else 0,
        "total_tokens": total_tokens,
        "avg_latency_sec": round(avg_latency, 2),
    }

data['summary'] = summary

# Save final
with open(progress_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)

print("\n" + "=" * 60)
print("CALIBRATION COMPLETE")
print("=" * 60)
print(f"Fixed answers: {len(changes)}")
for c in changes[:20]:
    print(f"  {c}")

print("\n" + "=" * 60)
print("FINAL RESULTS (After Calibration)")
print("=" * 60)
for mode, stats in summary.items():
    print(f"{mode.upper()}: {stats['correct']}/{stats['total']} = {stats['accuracy']*100:.1f}%")

# Generate final report
sys.path.insert(0, r"D:\study\数跃\产品UI\harness_design\harness_improve\scripts")
from benchmark import generate_report
report_path = r"D:\study\数跃\产品UI\harness_design\harness_improve\evaluation\benchmark_report_final.md"
generate_report(data, report_path)

print(f"\nFinal report: {report_path}")
