"""
Re-evaluate benchmark results with improved answer checking
"""
import json
import re
import os
import sys

sys.path.insert(0, r"D:\study\数跃\产品UI\harness_design\harness_improve\scripts")
from benchmark import check_answer

# Load progress
progress_path = r"D:\study\数跃\产品UI\harness_design\harness_improve\evaluation\benchmark_progress.json"
with open(progress_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f"Loaded {len(data['questions'])} questions")

# Re-evaluate all answers
for q in data['questions']:
    gold = q['gold_answer']
    a_type = q['answer_type']
    
    for mode, r in q['modes'].items():
        if 'answer' in r and 'error' not in r:
            correct, match_type = check_answer(r['answer'], gold, a_type)
            r['correct'] = correct
            r['match_type'] = match_type

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

# Save re-evaluated results
with open(progress_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)

print("\n" + "="*60)
print("RE-EVALUATION COMPLETE (with improved symbolic checking)")
print("="*60)
for mode, stats in summary.items():
    print(f"{mode.upper()}: {stats['correct']}/{stats['total']} = {stats['accuracy']*100:.1f}%")

# Generate report
from benchmark import generate_report
report_path = r"D:\study\数跃\产品UI\harness_design\harness_improve\evaluation\benchmark_report.md"
generate_report(data, report_path)

print(f"\nReport saved to: {report_path}")
