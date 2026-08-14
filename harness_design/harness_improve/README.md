# CogniBridge Harness V3

> **状态**: ✅ 已上线（通过 server_bridge.py 接入 server.py）
> **默认版本**: V3（可通过环境变量回退到 V2）
> **基准测试**: 55 题 UK 数学，V3 正确率 89.1% vs V2 74.6%

---

## 接入状态

V3 已通过 `server_bridge.py` 接入 `code_v2/server.py`，当前生产环境默认运行 V3。

```python
# server.py 现在使用（无需修改业务代码）
from server_bridge import solve_question

# 默认走 V3（由 .env 中 HARNESS_VERSION=v3 控制）
result = solve_question(question_text="...", api_key="...")

# 紧急回退到 V2：修改 .env → HARNESS_VERSION=v2，重启服务
```

---

## 基准测试结果（55 题 UK 高等教育数学）

| 模式 | 正确率 | Token 消耗 | 平均延迟 |
|------|--------|-----------|----------|
| **裸跑 (Direct API)** | 70.9% | 126K | 10.8s |
| **Harness V2** | 74.6% | 495K | 45.1s |
| **Harness V3** | **89.1%** | 304K | 24.4s |

**V3 提升**: +14.5pp vs V2，+18.2pp vs 裸跑

### 按 Topic 对比

| Topic | V2 | V3 | 提升 |
|-------|-----|-----|------|
| **Proof_Techniques** | 0% | **87.5%** | +87.5pp |
| Limits | 80% | **100%** | +20pp |
| Linear_Algebra | 100% | 100% | - |
| Probability | 100% | 100% | - |
| Series | 100% | 100% | - |

---

## V3 核心改进

### 1. ToRA 式工具调用
- **文件**: `lanes/lane_b.py` + `tools/sympy_executor.py`
- **作用**: 复杂计算题让模型写 Python/SymPy 代码验证
- **效果**: 符号计算准确率显著提升

### 2. 证明结构验证
- **文件**: `verification/proof_verifier.py`
- **作用**: 检查证明是否包含必要结构（Base case / Inductive step / Conclusion）
- **效果**: 证明题从 0% → 87.5%

### 3. 智能路由 (Confidence-based)
- **文件**: `core/router.py`
- **作用**: 综合题型/长度/历史动态选择 Lane A/B
- **效果**: 比 V2 省 38% Token，快 46%

### 4. Notation Normalizer
- **文件**: `tools/notation_mapper.py`
- **作用**: 统一 `z*` / `\bar{z}` 等符号变体
- **效果**: 答案匹配一致性提升

### 5. Step Checker
- **文件**: `verification/step_checker.py`
- **作用**: 验证解题中间步骤的符号等价性
- **效果**: 减少中间步骤错误

---

## 目录结构

```
harness_improve/
├── harness_uk_math_v3_base.py      # V2 原始代码备份
├── harness_v3.py                    # V3 主入口
├── UPDATE_PLAN.md                   # 改进方案文档
├── README.md                        # 本文件
├── integration/
│   └── server_bridge.py             # V2/V3 切换桥接
├── models/
│   └── api_client.py                # 统一 API 客户端
├── core/
│   ├── topic_detector.py            # 知识点识别（增强版）
│   ├── question_classifier.py       # 题型分类
│   └── router.py                    # 智能路由
├── lanes/
│   ├── lane_base.py
│   ├── lane_a.py                    # 单样本快速求解
│   └── lane_b.py                    # 多样本 + ToRA
├── tools/
│   ├── sympy_executor.py            # SymPy 安全执行器
│   └── notation_mapper.py           # 符号标准化
├── prompts/
│   ├── system_prompts.py            # Prompt 模板
│   └── few_shot.py                  # Few-shot 示例
├── verification/
│   ├── answer_verifier.py           # 答案等价性
│   ├── proof_verifier.py            # 证明结构验证
│   └── step_checker.py              # 逐步检查
├── evaluation/
│   └── benchmark_report_final.md    # 最终测试报告
└── data/
    └── test_set_uk_50.json          # 55 题测试集
```

---

## 回退操作（紧急）

如果 V3 出现问题，10 秒内回退到 V2：

```bash
# 1. 修改 .env
HARNESS_VERSION=v2

# 2. 重启服务
python server.py
```

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `code_v2/server.py` | 已接入 server_bridge |
| `code_v2/.env` | 已设置 HARNESS_VERSION=v3 |
| `harness_improve/harness_v3.py` | V3 主入口 |
| `harness_improve/integration/server_bridge.py` | V2/V3 桥接 |
| `harness_improve/evaluation/benchmark_report_final.md` | 测试报告 |

---

## 参考项目

| 项目 | 借鉴点 |
|------|--------|
| [OpenAI Evals](https://github.com/openai/evals) | Model-graded 评估 |
| [Hendrycks MATH](https://github.com/hendrycks/math) | 分类统计评测体系 |
| [EleutherAI lm-eval](https://github.com/EleutherAI/lm-evaluation-harness) | 模块化架构 |
| [Microsoft ToRA](https://github.com/microsoft/ToRA) | Tool-integrated Reasoning |
| [LeanDojo](https://github.com/lean-dojo/LeanDojo) | 证明步骤追踪 |
