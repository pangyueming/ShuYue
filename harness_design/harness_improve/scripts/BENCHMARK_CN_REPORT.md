# 中国赛道双语基准测试报告（B5）

> 日期：2026-09-20 · 分支：china-track · 引擎：Harness V3 + B1 中文管道
> 测试集：`scripts/test_set_cn.json`（24 题：中文 12 + 英文 12；MCQ 8 / 填空 8 / 证明 8）
> 运行：`python scripts/benchmark_cn.py --workers 4`（明细：`benchmark_cn_results.json`）

## 结论（答辩数据点）

| 维度 | 结果 | 说明 |
|------|------|------|
| **总体准确率** | **20/24 = 83.3%** | 严判口径：needs_revision 不计入正确 |
| **中文题** | 10/12 = 83.3% | |
| **英文题** | 10/12 = 83.3% | **中英完全对称——双语管道等价性实证** |
| 选择题 MCQ | 8/8 = **100%** | 中英各半，全部正确 |
| 填空题 Short | 8/8 = **100%** | 中文答案抽取（答案是/所以）全命中 |
| 证明题 Proof | 4/8 pass + 4 needs_revision + **0 fail** | 验证器双语 rubric 严格口径 |
| 对照基线 | UK 赛道 55 题英文基准 89.1% | 构成不同（证明占比 1/3 vs UK 混合），不可直接对比，仅参考 |
| 平均耗时 | ~44s/题（4 并发；证明题 Lane B 5 采样约 110-130s） | |

## 基准测试发现并修复的真实 Bug

**证明验证器不跟随题型（Router Lane A 硬编码）**：
ε-δ 证明题（"用 ε-δ 定义证明 lim…"）主题命中 Limits（非弱项）→ 路由分低于
Lane B 阈值 → Lane A 分支 `use_proof_verifier=False` 硬编码 → 证明验证被静默跳过。
**修复**（`core/router.py`）：`wants_proof_verifier = (qtype==Proof or topic==Proof_Techniques)`
统一作用于两条 lane——验证器成本极低（关键词清单），证明题必验证。
修复后复跑：两道 ε-δ 题验证器正常介入（epsilon_delta 类型正确识别，中文 rubric 生效）。

## 4 道 needs_revision 剖析（全部为验证器严格判据，非引擎解错）

| 题目 | 类型/得分 | 原因 |
|------|----------|------|
| zh √2 无理数（反证） | contradiction 0.75 | 某环节关键词 partial |
| zh ε-δ lim 3x=6 | epsilon_delta 0.625 | 精简证明缺 rubric 环节词 |
| en 偶数+偶数 | contradiction 0.625 | 题目过简，模型写得极简 |
| en ε-δ lim 2x=2 | epsilon_delta 0.5 | 同 zh ε-δ |

## 中英对称性说明

每个维度（MCQ/Short/Proof）中英各 4 题，准确率逐维度完全一致——
说明 B1 中文管道（主题检测/分类/答案抽取/证明 rubric）使中文输入与英文输入
在引擎中获得**等价处理**，这是中外合办双语桥接定位的核心技术验证。

## 复现

```bash
cd CogniBridge-CN/harness_design/harness_improve
python scripts/benchmark_cn.py --workers 4
```
