import json

with open(r'D:\study\智学桥\产品UI\harness_design\harness_improve\evaluation\benchmark_progress.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

completed_ids = [q['id'] for q in data['questions']]
print('Completed:', len(completed_ids), 'questions')

with open(r'D:\study\智学桥\产品UI\harness_design\harness_improve\data\test_set_uk_50.json', 'r', encoding='utf-8') as f:
    all_q = json.load(f)

remaining = [q for q in all_q if q['id'] not in completed_ids]
print('Remaining:', len(remaining), 'questions')
for q in remaining:
    print(' ', q['id'], '|', q['topic'], '|', q['qtype'])
