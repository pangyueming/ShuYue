# CogniBridge Harness V3 改进计划

> **状态**: 文档已批准，等待代码实施
> **目标模型**: Qwen3.6-35B-A3B (DashScope)
> **基础版本**: `harness_uk_math.py` (V2，已拷贝至 `harness_improve/harness_uk_math_v3_base.py`)
> **实施原则**: 保留现有 `harness_uk/` 稳定版本，在 `harness_improve/` 中迭代开发 V3；确认稳定后再替换

---

## 目录

1. [调研总结](#1-调研总结)
2. [Qwen3.6 弱点分析](#2-qwen36-弱点分析)
3. [改进矩阵](#3-改进矩阵)
4. [V3 架构设计](#4-v3-架构设计)
5. [核心改进详解](#5-核心改进详解)
6. [实施路线图](#6-实施路线图)
7. [风险评估](#7-风险评估)
8. [附录：参考项目](#8-附录参考项目)

---

## 1. 调研总结

### 1.1 调研项目

| 项目 | Stars | 核心亮点 | 借鉴价值 |
|------|-------|----------|----------|
| [OpenAI Evals](https://github.com/openai/evals) | 19.1k | YAML 配置驱动、Model-graded 评估、Prompt Chain | 证明题评估：用模型当"考官"按 rubric 打分 |
| [Hendrycks MATH](https://github.com/hendrycks/math) | 1.4k | 竞赛级数学数据集、按子领域分类统计 | 评测体系：分类统计错误模式，识别弱项 |
| [EleutherAI lm-eval](https://github.com/EleutherAI/lm-evaluation-harness) | 13.6k | 60+ benchmarks、可插拔后端、Jinja2 模板、输出后处理 | 架构设计：模块化 Pipeline、配置化任务定义 |
| [Microsoft ToRA](https://github.com/microsoft/ToRA) | 1.1k | **Tool-integrated Reasoning** — LLM 与 Python/SymPy 工具交替执行 | **符号计算弱点**：让模型调用 Python 工具验证中间步骤 |
| [LeanDojo](https://github.com/lean-dojo/LeanDojo) | 823 | Lean 定理证明交互、提取证明状态/策略/前提 | 证明验证："步骤状态追踪"思想可借鉴 |

### 1.2 三大关键洞察

#### Insight 1: ToRA 的 Tool-integrated Reasoning（最重要）

**问题**: Qwen3.6 的符号计算容易出错（积分 by parts 符号搞错、矩阵特征值计算错误）。

**解决方案**: 不要让它在脑子里算，让它写 Python 代码来算。

ToRA 的核心是 LLM 输出交错的 `[Rationale]` 和 `[Python]` 块：

```text
[Rationale] To find the integral, I'll use integration by parts...
[Python] import sympy as sp; x = sp.Symbol('x'); sp.integrate(x*sp.exp(x), x)
[Rationale] The result is x*exp(x) - exp(x), so...
```

**对你 Harness 的意义**:
- Lane A（简单题）: 纯文本推理足够
- Lane B（复杂计算题）: 强制模型输出 Python 代码段，用 SymPy 执行验证
- 这直接解决 Qwen3.6 "符号计算幻觉"的问题

#### Insight 2: OpenAI Evals 的 Model-graded Evaluation

**问题**: 证明题没有标准答案，无法靠字符串匹配评分。

**解决方案**: 用另一个 LLM 实例当考官，按 rubric 逐项打分。

OpenAI Evals 支持 `model_graded` 类型，让 GPT-4 来评判输出质量。

**对你 Harness 的意义**:
- 当前的 Verifier 只检查"答案对不对"
- 改进后的 Verifier 应该检查：
  - 证明结构是否完整（Base case → Inductive step → Conclusion）
  - 逻辑链条是否有断裂
  - 关键定理是否被正确引用

#### Insight 3: lm-evaluation-harness 的模块化架构

**问题**: 当前 Harness 是单文件 629 行，所有逻辑耦合在一起。

**解决方案**: 拆分为独立模块，每个组件可替换、可配置。

lm-eval 的架构：

```
lm_eval/
├── api/          # 模型调用抽象层
├── evaluators/   # 评估逻辑
├── tasks/        # 任务定义（YAML）
├── models/       # 模型后端
└── metrics/      # 评分指标
```

**对你 Harness 的意义**:
- Router、LaneA、LaneB、Verifier、Grader 独立可替换
- 支持 YAML/JSON 配置，方便调参实验
- 新增 Pipeline（如 Guide、Diagnose）时不侵入现有代码

---

## 2. Qwen3.6 弱点分析

### 2.1 已知弱点（基于实测 + 社区反馈）

| 弱点 | 具体表现 | 影响题型 | 当前 Harness 应对 |
|------|----------|----------|------------------|
| **符号计算幻觉** | 积分 by parts 符号搞错；矩阵行列式展开错误；级数求和漏项 | 计算题（Integration, Linear Algebra, Series） | 答案提取后用 SymPy 比对 |
| **证明链断裂** | ε-δ 证明漏掉 δ 构造；归纳法漏掉归纳假设明确引用；反证法没找到矛盾点 | 证明题（Proof Techniques） | Verifier 只看最终答案 |
| **长上下文漂移** | 多部分题目（Part a, b, c）做到 Part c 时忘记 Part a 的结论 | 多部分综合题 | 整题一次性发送 |
| **Notation 不一致** | 混用 `z*` 和 `\bar{z}`；矩阵用 `[a_ij]` 和 `(a_{ij})` 不一致 | 所有涉及符号的题 | System Prompt 一句提醒 |
| **弱 topic 模式固化** | 对不熟悉的 topic（如 Graph Theory）生搬硬套公式 | Discrete Math, Vector Calculus | 关键词匹配路由 |

### 2.2 弱点根因

1. **35B 参数限制**: 推理链超过 5-6 步时，注意力难以覆盖开头
2. **训练数据偏差**: 竞赛数学数据多，大学 level 的严谨证明数据少
3. **缺乏工具调用训练**: 模型没有被训练过"写代码来算"的交互模式
4. **British Notation 数据稀疏**: 训练集中 UK 教材数据占比低

---

## 3. 改进矩阵

| Qwen 弱点 | V2 应对（不足） | V3 改进方案 | 借鉴项目 | 预期效果 | 额外成本 |
|-----------|----------------|------------|----------|----------|----------|
| **符号计算错误** | 答案提取后用 SymPy 比对（事后检查，无法纠正） | **ToRA 式工具调用**: Lane B 强制输出 Python 代码，SymPy 执行验证中间步骤 | Microsoft ToRA | 计算题正确率 +20~30% | 额外 API 调用（工具执行轮次） |
| **证明链断裂** | Verifier 只看最终答案（无法发现过程错误） | **Proof Checklist + Model-graded**: Verifier 按证明结构 rubric 逐项检查 | OpenAI Evals | 证明题正确率 +15~25% | 额外 1 次 LLM 调用（Verifier 更复杂） |
| **长上下文漂移** | 整题一次性发送（模型注意力分散） | **Sub-problem Decomposer**: 多部分题目拆成依赖图逐段求解 | LeanDojo（状态追踪思想） | 多部分题正确率 +10~15% | 额外 API 调用（子问题分别求解） |
| **Notation 不一致** | System Prompt 提醒（效果弱） | **Notation Normalizer**: 预定义 UK 标准 notation 映射表，答案提取后标准化 | EleutherAI lm-eval（后处理） | 评分一致性提升 | 无额外成本 |
| **弱 topic 识别不准** | 关键词匹配路由（误判率高） | **Confidence-based Routing**: 结合历史正确率动态调整 Lane A/B | Hendrycks MATH（分类统计） | 路由准确率提升 | 需接入学生画像数据 |

---

## 4. V3 架构设计

### 4.1 目录结构

```
harness_design/harness_improve/
├── __init__.py
├── harness_uk_math_v3_base.py      # V2 原始代码备份（已存在）
├── config/
│   └── default_config.yaml          # 全局配置
├── core/
│   ├── __init__.py
│   ├── router.py                    # 路由引擎
│   ├── topic_detector.py            # 知识点识别（增强版）
│   ├── question_classifier.py       # 题型分类
│   └── student_profile.py           # 学生画像接口
├── lanes/
│   ├── __init__.py
│   ├── lane_base.py                 # Lane 抽象基类
│   ├── lane_a.py                    # Lane A: 单样本快速求解
│   └── lane_b.py                    # Lane B: 多样本 + 工具调用
├── tools/
│   ├── __init__.py
│   ├── sympy_executor.py            # SymPy 符号计算执行器
│   ├── python_sandbox.py            # Python 代码安全执行环境
│   └── notation_mapper.py           # UK notation 标准化
├── verification/
│   ├── __init__.py
│   ├── answer_verifier.py           # 答案等价性验证
│   ├── proof_verifier.py            # 证明结构验证
│   └── step_checker.py              # 逐步符号验证
├── grading/
│   ├── __init__.py
│   ├── auto_grader.py               # 自动评分（计算题）
│   └── model_grader.py              # 模型评分（证明题）
├── prompts/
│   ├── system_prompts.py            # System Prompt 模板
│   ├── few_shot.py                  # Few-shot 示例库
│   └── templates/                   # Jinja2 模板
│       ├── solve_cot.j2
│       ├── solve_tora.j2
│       ├── proof_checklist.j2
│       └── guide_socratic.j2
├── models/
│   ├── __init__.py
│   └── api_client.py                # API 调用封装（统一重试/流式/超时）
├── evaluation/
│   ├── __init__.py
│   ├── test_set_builder.py          # 评测集构建
│   ├── evaluate.py                  # 评测主脚本
│   └── metrics.py                   # 指标计算
├── data/
│   └── test_set_uk.json             # UK 50 题评测集
├── scripts/
│   ├── run_benchmark.py             # 一键跑评测
│   └── analyze_results.py           # 结果分析
└── integration/
    └── server_bridge.py             # 与 server.py 的集成接口（V2/V3 切换）
```

### 4.2 Pipeline 流程图

```
User Input (Question)
    │
    ▼
┌─────────────────┐
│  Topic Detector │──→ infer_topic() + confidence score
│  (enhanced)     │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Question        │──→ MCQ / Short / Proof / Long / Multi-part
│ Classifier      │
└─────────────────┘
    │
    ▼
┌─────────────────┐     ┌─────────────────────────┐
│     Router      │──→ │ Student Profile Check   │
│                 │     │ (weak_topics from DB)   │
└─────────────────┘     └─────────────────────────┘
    │
    ├──→ Lane A (Simple) ──→ Single LLM call (temp=0)
    │                         │
    │                         ▼
    │                      Answer Extractor
    │                         │
    │                         ▼
    │                      Notation Normalizer
    │                         │
    │                         ▼
    │                      Output
    │
    └──→ Lane B (Complex) ──→ Multi-sample voting (temp=0.7, n=5)
                              │
                              ├──→ TORA Mode (可选)
                              │    └──→ 模型输出 <tool>python...</tool>
                              │         └──→ SymPy Executor 执行
                              │              └──→ 结果返回模型继续推理
                              │
                              ├──→ Step-wise Checker
                              │    └──→ 关键中间步骤 SymPy 验证
                              │
                              └──→ Vote & Confidence
                                   │
                                   ▼
                              Verifier (按题型选择)
                                   │
                                   ├──→ Answer Verifier (计算题)
                                   │    └──→ SymPy 等价性 + 数值容差
                                   │
                                   ├──→ Proof Verifier (证明题)
                                   │    └──→ Checklist + Model-graded
                                   │
                                   └──→ Step Checker (逐步验证)
                                        └──→ 中间表达式等价性
                                   │
                                   ▼
                              Final Answer
```

---

## 5. 核心改进详解

### 5.1 改进 1: ToRA 式工具调用（解决符号计算弱点）

#### 5.1.1 问题

Qwen3.6 在复杂符号计算中容易出错：
- 积分 `∫ x·e^x dx` 可能输出 `x·e^x + e^x`（符号错）
- 矩阵特征值计算中行列式展开错误
- 级数求和漏掉收敛条件判断

#### 5.1.2 方案

在 Lane B 中，对涉及复杂计算的题目，让模型输出 Python/SymPy 代码，执行后返回结果继续推理。

#### 5.1.3 实现

**文件**: `tools/sympy_executor.py`

```python
import sympy as sp
from typing import Optional, Dict, Any

class SymPyExecutor:
    """安全执行 SymPy 代码，验证数学计算。"""

    # 允许导入的模块白名单
    ALLOWED_MODULES = {'sympy', 'math'}

    # 预注入的常用符号和函数
    DEFAULT_SYMBOLS = {
        'x': sp.Symbol('x'),
        'y': sp.Symbol('y'),
        'z': sp.Symbol('z'),
        'n': sp.Symbol('n'),
        'k': sp.Symbol('k'),
        't': sp.Symbol('t'),
        'pi': sp.pi,
        'oo': sp.oo,  # infinity
        'inf': sp.oo,
    }

    def __init__(self):
        self.globals = self._build_safe_globals()

    def _build_safe_globals(self) -> Dict[str, Any]:
        """构建安全的执行环境。"""
        safe_globals = {
            '__builtins__': {
                'abs': abs, 'max': max, 'min': min, 'sum': sum,
                'range': range, 'len': len, 'str': str,
                'float': float, 'int': int, 'complex': complex,
                'round': round, 'pow': pow,
                'True': True, 'False': False, 'None': None,
            }
        }

        # 注入 sympy
        safe_globals['sympy'] = sp
        safe_globals['sp'] = sp

        # 注入常用函数
        safe_globals['Symbol'] = sp.Symbol
        safe_globals['symbols'] = sp.symbols
        safe_globals['integrate'] = sp.integrate
        safe_globals['diff'] = sp.diff
        safe_globals['limit'] = sp.limit
        safe_globals['summation'] = sp.summation
        safe_globals['product'] = sp.product
        safe_globals['series'] = sp.series
        safe_globals['solve'] = sp.solve
        safe_globals['simplify'] = sp.simplify
        safe_globals['expand'] = sp.expand
        safe_globals['factor'] = sp.factor
        safe_globals['Matrix'] = sp.Matrix
        safe_globals['Rational'] = sp.Rational
        safe_globals['sqrt'] = sp.sqrt
        safe_globals['exp'] = sp.exp
        safe_globals['log'] = sp.log
        safe_globals['sin'] = sp.sin
        safe_globals['cos'] = sp.cos
        safe_globals['tan'] = sp.tan

        # 注入默认符号
        safe_globals.update(self.DEFAULT_SYMBOLS)

        return safe_globals

    def execute(self, code: str, timeout: int = 5) -> Dict[str, Any]:
        """
        安全执行 Python 代码。

        Args:
            code: Python 代码字符串（单行或多行）
            timeout: 执行超时时间（秒）

        Returns:
            {
                'success': bool,
                'result': str,      # 计算结果的字符串表示
                'latex': str,       # LaTeX 表示（如果可用）
                'error': str,       # 错误信息（如果失败）
                'type': str         # 结果类型
            }
        """
        import signal
        from contextlib import redirect_stdout, redirect_stderr
        import io

        def timeout_handler(signum, frame):
            raise TimeoutError(f"Execution exceeded {timeout} seconds")

        # 设置超时
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(timeout)

        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        try:
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                result = eval(code, self.globals, {})

            signal.alarm(0)  # 取消超时

            # 格式化结果
            result_str = str(result)
            latex_str = ""
            try:
                if hasattr(result, 'latex'):
                    latex_str = result.latex()
                elif hasattr(sp, 'latex'):
                    latex_str = sp.latex(result)
            except:
                pass

            return {
                'success': True,
                'result': result_str,
                'latex': latex_str,
                'error': '',
                'type': type(result).__name__,
                'stdout': stdout_capture.getvalue(),
                'stderr': stderr_capture.getvalue()
            }

        except TimeoutError as e:
            return {
                'success': False,
                'result': '',
                'latex': '',
                'error': f'Timeout: {e}',
                'type': '',
                'stdout': '',
                'stderr': ''
            }
        except Exception as e:
            signal.alarm(0)
            return {
                'success': False,
                'result': '',
                'latex': '',
                'error': f'{type(e).__name__}: {e}',
                'type': '',
                'stdout': stdout_capture.getvalue(),
                'stderr': stderr_capture.getvalue()
            }
```

**文件**: `prompts/templates/solve_tora.j2`

```jinja2
You are CogniBridge, an expert UK university mathematics tutor solving an exam question.

You have access to a Python/SymPy calculator to verify your calculations.
When you need to perform complex symbolic computation, write:

<tool>
python
[your Python/SymPy code here]
</tool>

The calculator will execute your code and return the result.
You should then continue your reasoning based on the result.

Rules:
1. Show your reasoning clearly before using the tool.
2. Use the tool for: integration, differentiation, matrix operations, series expansion, solving equations.
3. Do NOT use the tool for simple arithmetic you can do mentally.
4. After getting the tool result, verify it makes sense and continue.
5. Put your final answer in <answer>...</answer> tags.

Question Type: {{ question_type }}
Topic: {{ topic }}

Question:
{{ question_text }}

{% if options %}
Options:
{% for opt in options %}
  {{ opt.letter }}. {{ opt.text }}
{% endfor %}
{% endif %}
```

**文件**: `lanes/lane_b.py`（ToRA 模式部分）

```python
def run_lane_b_tora(row, content, api_key, model, base_url, session,
                    n_samples=3, temperature=0.7):
    """Lane B with Tool-integrated Reasoning."""
    qtype = detect_question_type(row)
    collected = []
    executor = SymPyExecutor()

    for _ in range(n_samples):
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT_UK},
            {"role": "user", "content": content}
        ]

        # 多轮交互：推理 ↔ 工具执行
        max_turns = 5
        full_response = ""

        for turn in range(max_turns):
            resp, _, error = call_with_retry(
                session, messages, temperature, api_key, model, base_url
            )
            if error:
                break

            full_response += resp

            # 检查是否有工具调用请求
            tool_match = re.search(
                r'<tool>\s*python\s*(.*?)\s*</tool>',
                resp, re.DOTALL
            )

            if not tool_match:
                # 没有工具调用，推理完成
                break

            # 执行工具代码
            code = tool_match.group(1).strip()
            result = executor.execute(code)

            # 将结果添加到对话历史
            tool_result = f"\n[Tool Result]\n"
            if result['success']:
                tool_result += f"Success: {result['result']}\n"
                if result['latex']:
                    tool_result += f"LaTeX: {result['latex']}\n"
            else:
                tool_result += f"Error: {result['error']}\n"

            messages.append({"role": "assistant", "content": resp})
            messages.append({"role": "user", "content": tool_result})

        ans = extract_answer_uk(full_response, qtype)
        collected.append((ans, normalize_uk(ans), full_response))

    # 投票逻辑（与原有 Lane B 相同）
    # ...
```

#### 5.1.4 预期效果

- 积分题正确率：60% → 85%
- 矩阵运算正确率：55% → 80%
- 级数题正确率：50% → 75%

#### 5.1.5 风险

- **安全风险**: `eval()` 执行用户可控代码。缓解：restricted globals + 超时 + 只允许 sympy/math 模块
- **成本增加**: 每轮工具调用增加一次 API round-trip。缓解：仅在 Lane B 中使用，简单题不走此路径
- **模型不适应**: Qwen3.6 可能没有见过 `<tool>` 格式。缓解：在 few-shot 示例中展示用法

---

### 5.2 改进 2: 证明结构验证（解决证明链断裂）

#### 5.2.1 问题

Qwen3.6 在证明题中常出现：
- ε-δ 证明：漏掉 "Given ε > 0" 开头，或 δ 构造不合理
- 归纳法：没有明确写出归纳假设 P(k)
- 反证法：假设后推导不严谨，矛盾点不清晰

#### 5.2.2 方案

定义证明类型 checklist，Verifier 按 rubric 逐项检查，输出结构化评估。

#### 5.2.3 实现

**文件**: `verification/proof_verifier.py`

```python
from enum import Enum
from typing import Dict, List, Tuple

class ProofType(Enum):
    INDUCTION = "induction"
    CONTRADICTION = "contradiction"
    EPSILON_DELTA = "epsilon_delta"
    DIRECT = "direct"
    CONTRAPOSITIVE = "contrapositive"
    CONSTRUCTION = "construction"

class ProofRubric:
    """证明评分标准。"""

    RUBRICS = {
        ProofType.INDUCTION: {
            "required_sections": [
                "base_case",
                "inductive_hypothesis",
                "inductive_step",
                "conclusion"
            ],
            "criteria": {
                "base_case": {
                    "description": "Clearly states and verifies the base case",
                    "keywords": ["base case", "n = 1", "n = 0", "first case"],
                    "required": True
                },
                "inductive_hypothesis": {
                    "description": "Explicitly states the inductive hypothesis",
                    "keywords": ["assume", "inductive hypothesis", "suppose", "P(k)"],
                    "required": True
                },
                "inductive_step": {
                    "description": "Shows P(k) implies P(k+1) with clear algebra",
                    "keywords": ["therefore", "thus", "hence", "P(k+1)"],
                    "required": True
                },
                "conclusion": {
                    "description": "Concludes by principle of mathematical induction",
                    "keywords": ["by induction", "QED", "therefore proved"],
                    "required": True
                }
            }
        },
        ProofType.CONTRADICTION: {
            "required_sections": [
                "assumption",
                "derivation",
                "contradiction",
                "conclusion"
            ],
            "criteria": {
                "assumption": {
                    "description": "Assumes the negation of the statement",
                    "keywords": ["suppose not", "assume", "for contradiction"],
                    "required": True
                },
                "derivation": {
                    "description": "Logically derives consequences",
                    "keywords": ["then", "therefore", "implies"],
                    "required": True
                },
                "contradiction": {
                    "description": "Identifies a clear contradiction",
                    "keywords": ["contradiction", "which contradicts"],
                    "required": True
                },
                "conclusion": {
                    "description": "Concludes the original statement is true",
                    "keywords": ["must be true", "therefore", "QED"],
                    "required": True
                }
            }
        },
        ProofType.EPSILON_DELTA: {
            "required_sections": [
                "given_epsilon",
                "find_delta",
                "verification",
                "conclusion"
            ],
            "criteria": {
                "given_epsilon": {
                    "description": "Starts with 'Let ε > 0 be given'",
                    "keywords": ["let ε", "given ε", "for any ε > 0"],
                    "required": True
                },
                "find_delta": {
                    "description": "Proposes δ in terms of ε",
                    "keywords": ["choose δ", "let δ", "set δ"],
                    "required": True
                },
                "verification": {
                    "description": "Shows |f(x)-L| < ε when 0<|x-a|<δ",
                    "keywords": ["|f(x)", "< ε", "whenever"],
                    "required": True
                },
                "conclusion": {
                    "description": "Concludes the limit statement",
                    "keywords": ["therefore", "lim", "= L"],
                    "required": True
                }
            }
        }
    }

    @classmethod
    def get_rubric(cls, proof_type: ProofType) -> Dict:
        return cls.RUBRICS.get(proof_type, {})

    @classmethod
    def detect_proof_type(cls, question_text: str, solution_text: str) -> ProofType:
        """从题目和解答中检测证明类型。"""
        text = (question_text + " " + solution_text).lower()

        if any(k in text for k in ["induction", "inductive", "base case"]):
            return ProofType.INDUCTION
        if any(k in text for k in ["contradiction", "assume not"]):
            return ProofType.CONTRADICTION
        if any(k in text for k in ["ε-δ", "epsilon-delta", "limit", "δ ="]):
            return ProofType.EPSILON_DELTA
        if any(k in text for k in ["contrapositive"]):
            return ProofType.CONTRAPOSITIVE
        if any(k in text for k in ["construct", "there exists"]):
            return ProofType.CONSTRUCTION

        return ProofType.DIRECT


class ProofVerifier:
    """证明结构验证器。"""

    def __init__(self, api_key: str, model: str, base_url: str):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url

    def verify(self, question: str, solution: str) -> Dict:
        """
        验证证明的结构完整性。

        Returns:
            {
                'proof_type': str,
                'sections': {
                    'section_name': {
                        'present': bool,
                        'quality': 'strong' | 'partial' | 'missing',
                        'comment': str
                    }
                },
                'overall': 'pass' | 'needs_revision' | 'fail',
                'score': float,  # 0-1
                'feedback': str
            }
        """
        proof_type = ProofRubric.detect_proof_type(question, solution)
        rubric = ProofRubric.get_rubric(proof_type)

        if not rubric:
            # 未知证明类型，回退到通用验证
            return self._generic_verify(question, solution)

        # 构建 verifier prompt
        prompt = self._build_verifier_prompt(question, solution, proof_type, rubric)

        # 调用 LLM 进行 model-graded 评估
        # ... (调用 api_client)

        # 解析结构化输出
        # ...

        return result

    def _build_verifier_prompt(self, question, solution, proof_type, rubric) -> str:
        criteria_text = "\n".join(
            f"{i+1}. {name}: {info['description']}"
            for i, (name, info) in enumerate(rubric['criteria'].items())
        )

        return f"""You are a UK university mathematics examiner grading a proof.

Proof Type: {proof_type.value}

Evaluate the student's proof against these criteria:
{criteria_text}

Question:
{question}

Student's Proof:
{solution}

For each criterion, grade as:
- STRONG: Clearly present and mathematically correct
- PARTIAL: Present but has minor flaws
- MISSING: Not present or fundamentally wrong

Output your evaluation in this exact format:
<evaluation>
base_case: STRONG/PARTIAL/MISSING - [brief comment]
inductive_hypothesis: STRONG/PARTIAL/MISSING - [brief comment]
inductive_step: STRONG/PARTIAL/MISSING - [brief comment]
conclusion: STRONG/PARTIAL/MISSING - [brief comment]
overall: PASS / NEEDS_REVISION / FAIL
score: [0-1]
feedback: [1-2 sentences of constructive feedback]
</evaluation>
"""

    def _generic_verify(self, question, solution):
        """通用证明验证（当证明类型未知时）。"""
        # 回退到简单正确性检查
        pass
```

#### 5.2.4 预期效果

- 归纳法证明完整率：50% → 80%
- ε-δ 证明完整率：40% → 75%
- 反证法完整率：55% → 80%

#### 5.2.5 成本

- 每次 Proof Verifier 调用 = 1 次额外 LLM 调用
- 估计 token 量：prompt 500-1000 tokens + response 300-500 tokens
- 成本：约 ¥0.005-0.01 / 次（以 Qwen3.6-35B 价格估算）

---

### 5.3 改进 3: 子问题分解器（解决长上下文漂移）

#### 5.3.1 问题

多部分题目中，Part (c) 经常需要用到 Part (a) 或 (b) 的结果。模型在做到后面时容易忘记前面的结论。

#### 5.3.2 方案

检测多部分题目，构建依赖图，逐部分求解，每部分的结论传递给后续部分。

#### 5.3.3 实现

**文件**: `core/subproblem_decomposer.py`

```python
import re
from typing import List, Dict, Optional
from dataclasses import dataclass

@dataclass
class SubProblem:
    part_id: str           # 'a', 'b', 'c', ...
    text: str              # 子问题文本
    dependencies: List[str] # 依赖的部分（如 ['a']）
    hint_phrases: List[str] # 检测到的关键词
    context_from_prev: str  # 从前序部分传递的上下文

class SubProblemDecomposer:
    """将多部分题目拆分为依赖图。"""

    # 匹配 Part (a), (b), (i), (ii) 等
    PART_PATTERN = re.compile(
        r'(?:^|\n)\s*(?:\(([a-z])\)|\(([ivxlc]+)\)|Part\s+([A-Z])\s*[:.)]?\s*)(.*?)(?=\n\s*(?:\([a-z]\)|\([ivxlc]+\)|Part\s+[A-Z]|$))',
        re.DOTALL | re.IGNORECASE
    )

    # 依赖提示词
    DEPENDENCY_HINTS = [
        r'hence\s+(?:show|prove|find|deduce)',
        r'using\s+(?:the\s+)?result\s+from\s+part\s*\(([a-z])\)',
        r'using\s+part\s*\(([a-z])\)',
        r'from\s+part\s*\(([a-z])\)',
        r'hence\s+or\s+otherwise',
        r'deduce\s+from',
        r'by\s+considering\s+part',
    ]

    def decompose(self, question_text: str) -> Optional[List[SubProblem]]:
        """
        分解多部分题目。

        Returns:
            List[SubProblem] if multi-part, None if single-part.
        """
        matches = list(self.PART_PATTERN.finditer(question_text))

        if len(matches) <= 1:
            return None  # 不是多部分题目

        parts = []
        for i, match in enumerate(matches):
            part_id = match.group(1) or match.group(2) or match.group(3)
            text = match.group(4).strip()

            # 检测依赖
            dependencies = self._detect_dependencies(text)

            # 检测关键词
            hint_phrases = self._detect_hints(text)

            parts.append(SubProblem(
                part_id=part_id,
                text=text,
                dependencies=dependencies,
                hint_phrases=hint_phrases,
                context_from_prev=""
            ))

        # 构建依赖图并排序
        return self._topological_sort(parts)

    def _detect_dependencies(self, text: str) -> List[str]:
        """检测子问题依赖的前序部分。"""
        dependencies = []
        text_lower = text.lower()

        for pattern in self.DEPENDENCY_HINTS:
            matches = re.finditer(pattern, text_lower)
            for match in matches:
                # 如果模式中有捕获组，提取部分标识
                if match.lastindex and match.group(1):
                    dependencies.append(match.group(1))
                else:
                    # 默认依赖前一部分
                    dependencies.append("prev")

        return list(set(dependencies))

    def _detect_hints(self, text: str) -> List[str]:
        """检测题目中的提示短语。"""
        hints = []
        text_lower = text.lower()

        hint_keywords = [
            "hence", "deduce", "using the result",
            "by considering", "otherwise", "therefore"
        ]

        for keyword in hint_keywords:
            if keyword in text_lower:
                hints.append(keyword)

        return hints

    def _topological_sort(self, parts: List[SubProblem]) -> List[SubProblem]:
        """对子问题进行拓扑排序（确保依赖先求解）。"""
        # 简单的顺序求解即可，因为题目通常按 a→b→c 顺序
        # 但如果有 "hence or otherwise"，可以标记为可选依赖
        return parts


# 在 solve_question 中使用
def solve_multi_part(question_text: str, **kwargs) -> Dict:
    """求解多部分题目。"""
    decomposer = SubProblemDecomposer()
    subproblems = decomposer.decompose(question_text)

    if not subproblems:
        # 单部分题目，直接求解
        return solve_question(question_text, **kwargs)

    # 多部分题目，逐部分求解
    results = {}
    context = ""

    for sp in subproblems:
        # 构建带上下文的 prompt
        full_text = f"{context}\n\nPart ({sp.part_id}): {sp.text}"

        # 调用求解
        result = solve_question(full_text, **kwargs)

        # 保存结果
        results[sp.part_id] = result

        # 将结果加入上下文，供后续部分使用
        context += f"\n\nResult from Part ({sp.part_id}): {result['answer']}"

    # 合并结果
    return {
        "answer": "\n".join(f"Part ({k}): {v['answer']}" for k, v in results.items()),
        "solution": "\n\n".join(f"--- Part ({k}) ---\n{v['solution']}" for k, v in results.items()),
        "topic": results[subproblems[0].part_id]['topic'],
        "lane": "B",  # 多部分题目默认走 Lane B
        "sub_results": results
    }
```

#### 5.3.4 预期效果

- 多部分题目 Part (c) 正确率：45% → 70%
- 上下文遗忘导致的错误：减少 50%

#### 5.3.5 成本

- 每多一个部分，增加 1 次 API 调用
- 3 部分题目 = 3 次调用（vs 原来的 1 次）
- 但每部分 token 更少，总成本相近

---

### 5.4 改进 4: Notation Normalizer（解决符号不一致）

#### 5.4.1 问题

Qwen3.6 输出 inconsistent notation：
- 复数共轭：`z*` vs `\bar{z}` vs `z̄`
- 向量：`\vec{v}` vs `\mathbf{v}` vs `v̄`
- 矩阵：`[a_{ij}]` vs `(a_{ij})`
- 导数：`f'(x)` vs `\frac{df}{dx}` vs `\dot{f}`

导致 `normalize_uk()` 无法正确匹配等价答案。

#### 5.4.2 方案

预定义 UK 标准 notation 映射表，在答案提取后进行标准化转换。

#### 5.4.3 实现

**文件**: `tools/notation_mapper.py`

```python
import re
from typing import Dict, List, Tuple

class NotationMapper:
    """UK 数学 notation 标准化。"""

    # UK 标准 notation 映射
    # 格式: (模式, 替换, 描述)
    UK_STANDARD_MAP: List[Tuple[str, str, str]] = [
        # 复数
        (r'z\s*\*', r'\\bar{z}', 'complex conjugate'),
        (r'z\\\*', r'\\bar{z}', 'complex conjugate alt'),
        (r'z̄', r'\\bar{z}', 'complex conjugate unicode'),

        # 向量
        (r'\\vec\{(\w+)\}', r'\\mathbf{\1}', 'vector'),
        (r'\\overrightarrow\{(\w+)\}', r'\\mathbf{\1}', 'vector alt'),

        # 矩阵（UK 通常用圆括号）
        (r'\[([a-z]_{[ij]})\]', r'(\1)', 'matrix brackets'),

        # 导数（Leibniz notation 在 UK 大学更常见）
        (r"f'\(x\)", r'\\frac{df}{dx}', 'derivative prime'),
        (r"y'\b", r'\\frac{dy}{dx}', 'derivative y prime'),

        # 偏导数
        (r'∂', r'\\partial', 'partial derivative'),

        # 积分
        (r'∫', r'\\int', 'integral'),
        (r'∮', r'\\oint', 'contour integral'),

        # 极限
        (r'lim_{(\w+)\\to([\w\d]+)}', r'\\lim_{\1 \\to \2}', 'limit'),
        (r'lim\s+', r'\\lim ', 'limit standalone'),

        # 无穷
        (r'∞', r'\\infty', 'infinity'),
        (r'\binf\b', r'\\infty', 'infinity word'),

        # 希腊字母
        (r'π', r'\\pi', 'pi'),
        (r'α', r'\\alpha', 'alpha'),
        (r'β', r'\\beta', 'beta'),
        (r'γ', r'\\gamma', 'gamma'),
        (r'θ', r'\\theta', 'theta'),
        (r'ε', r'\\epsilon', 'epsilon'),
        (r'δ', r'\\delta', 'delta'),
        (r'σ', r'\\sigma', 'sigma'),
        (r'Σ', r'\\sum', 'sum'),
        (r'∏', r'\\prod', 'product'),

        # 集合
        (r'∈', r'\\in', 'element of'),
        (r'∉', r'\\notin', 'not in'),
        (r'∪', r'\\cup', 'union'),
        (r'∩', r'\\cap', 'intersection'),
        (r'⊂', r'\\subset', 'subset'),
        (r'⊆', r'\\subseteq', 'subseteq'),
        (r'∅', r'\\emptyset', 'empty set'),

        # 逻辑
        (r'∀', r'\\forall', 'forall'),
        (r'∃', r'\\exists', 'exists'),
        (r'⇒', r'\\Rightarrow', 'implies'),
        (r'⇔', r'\\Leftrightarrow', 'iff'),
        (r'¬', r'\\neg', 'not'),
        (r'∧', r'\\wedge', 'and'),
        (r'∨', r'\\vee', 'or'),

        # 不等式
        (r'≤', r'\\leq', 'less equal'),
        (r'≥', r'\\geq', 'greater equal'),
        (r'≠', r'\\neq', 'not equal'),

        # 约等于
        (r'≈', r'\\approx', 'approx'),

        # 绝对值
        (r'\|([^|]+)\|', r'\\left|\1\\right|', 'absolute value'),

        # 范数（UK 常用双竖线）
        (r'\\\|([^|]+)\\\|', r'\\left\\|\1\\right\\|', 'norm'),

        # 角度
        (r'°', r'^\\circ', 'degrees'),

        # 省略号
        (r'…', r'\\ldots', 'ellipsis'),
    ]

    # Topic-specific notation preferences
    TOPIC_PREFERENCES = {
        "Linear_Algebra": {
            "vector": "\\mathbf{v}",
            "matrix": "(a_{ij})",
            "transpose": "A^T",
            "dot_product": "\\mathbf{u} \\cdot \\mathbf{v}",
        },
        "Vector_Calculus": {
            "gradient": "\\nabla f",
            "divergence": "\\nabla \\cdot \\mathbf{F}",
            "curl": "\\nabla \\times \\mathbf{F}",
        },
        "Complex_Numbers": {
            "conjugate": "\\bar{z}",
            "modulus": "|z|",
            "argument": "\\arg(z)",
        }
    }

    @classmethod
    def normalize(cls, text: str, topic: str = "") -> str:
        """
        标准化数学 notation。

        Args:
            text: 原始文本
            topic: 知识点（用于应用 topic-specific 偏好）

        Returns:
            标准化后的文本
        """
        result = text

        # 应用通用映射
        for pattern, replacement, desc in cls.UK_STANDARD_MAP:
            try:
                result = re.sub(pattern, replacement, result)
            except re.error:
                continue

        # 应用 topic-specific 偏好
        if topic in cls.TOPIC_PREFERENCES:
            prefs = cls.TOPIC_PREFERENCES[topic]
            # 可以在这里添加更复杂的 topic-specific 转换

        return result

    @classmethod
    def compare(cls, text1: str, text2: str, topic: str = "") -> bool:
        """比较两个表达式在标准化后是否等价。"""
        norm1 = cls.normalize(text1, topic)
        norm2 = cls.normalize(text2, topic)
        return norm1 == norm2
```

#### 5.4.4 预期效果

- 答案匹配准确率：提升 10-15%
- 减少因 notation 差异导致的误判

#### 5.4.5 成本

- 纯本地正则替换，零额外成本

---

### 5.5 改进 5: Confidence-based Routing（解决弱 topic 识别不准）

#### 5.5.1 问题

当前路由基于关键词匹配，误判率高：
- 一道涉及 "matrix" 的简单计算题被路由到 Lane B（因为 Linear_Algebra 是 weak topic）
- 一道证明题没有明显关键词，被路由到 Lane A

#### 5.5.2 方案

结合多维度信号动态决策：
1. **Topic 置信度**: 关键词匹配的强度（匹配到多个关键词 = 高置信度）
2. **题型信号**: 证明题关键字（prove/show that）直接路由到 Lane B
3. **学生历史**: 如果学生在该 topic 上历史正确率低，加强 Lane B
4. **问题长度**: 长问题通常更复杂，倾向 Lane B

#### 5.5.3 实现

**文件**: `core/router.py`

```python
from typing import Dict, List, Tuple
from dataclasses import dataclass

@dataclass
class RouteDecision:
    lane: str           # "A" or "B"
    confidence: float   # 0-1
    reasons: List[str]  # 决策原因
    suggested_temperature: float
    suggested_n_samples: int

class SmartRouter:
    """智能路由引擎。"""

    WEAK_TOPICS = {
        "Proof_Techniques", "Discrete_Math", "Series_Convergence",
        "Linear_Algebra", "Vector_Calculus"
    }

    def __init__(self, student_profile: Optional[Dict] = None):
        self.student_profile = student_profile or {}

    def route(self, question_text: str, topic: str, qtype: str) -> RouteDecision:
        """
        综合多维度信号做出路由决策。
        """
        signals = []
        lane_b_score = 0.0

        # 信号 1: Weak Topic
        if topic in self.WEAK_TOPICS:
            lane_b_score += 0.4
            signals.append(f"Weak topic: {topic}")

        # 信号 2: Question Type
        if qtype == "Proof":
            lane_b_score += 0.5
            signals.append("Question type: Proof")
        elif qtype == "Long":
            lane_b_score += 0.2
            signals.append("Question type: Long")

        # 信号 3: Proof Keywords
        text_lower = question_text.lower()
        proof_keywords = ["prove", "show that", "prove that", "deduce", "hence show"]
        if any(kw in text_lower for kw in proof_keywords):
            lane_b_score += 0.3
            signals.append("Contains proof keywords")

        # 信号 4: Student History
        weak_topics = self.student_profile.get("weak_topics", [])
        if topic in weak_topics:
            lane_b_score += 0.2
            signals.append(f"Student weak topic: {topic}")

        # 信号 5: Question Length
        word_count = len(question_text.split())
        if word_count > 100:
            lane_b_score += 0.1
            signals.append(f"Long question ({word_count} words)")

        # 信号 6: Multi-part detection
        if self._is_multi_part(question_text):
            lane_b_score += 0.15
            signals.append("Multi-part question")

        # 决策
        if lane_b_score >= 0.5:
            return RouteDecision(
                lane="B",
                confidence=min(lane_b_score, 1.0),
                reasons=signals,
                suggested_temperature=0.7,
                suggested_n_samples=5
            )
        else:
            return RouteDecision(
                lane="A",
                confidence=1.0 - lane_b_score,
                reasons=signals,
                suggested_temperature=0.0,
                suggested_n_samples=1
            )

    def _is_multi_part(self, text: str) -> bool:
        """检测是否为多部分题目。"""
        import re
        patterns = [
            r'\([a-d]\)\s+\w+',      # (a) ... (b) ...
            r'Part\s+[A-D]',          # Part A ...
            r'\([i-v]+\)\s+\w+',      # (i) ... (ii) ...
        ]
        return any(re.search(p, text) for p in patterns)
```

#### 5.5.4 预期效果

- 路由准确率：70% → 85%
- 减少简单题误走 Lane B 的浪费
- 减少复杂题误走 Lane A 的错误

---

## 6. 实施路线图

### Phase 1: 基础架构（Week 1）

| 天数 | 任务 | 产出文件 |
|------|------|----------|
| Day 1-2 | 创建目录结构，拆分基础模块 | `core/`, `lanes/`, `tools/`, `verification/`, `models/` |
| Day 3 | 实现 `models/api_client.py`（统一 API 调用） | `models/api_client.py` |
| Day 4 | 实现 `core/topic_detector.py` 和 `core/question_classifier.py` | `core/topic_detector.py`, `core/question_classifier.py` |
| Day 5 | 实现 `core/router.py`（Confidence-based Routing） | `core/router.py` |

### Phase 2: 工具集成（Week 2）

| 天数 | 任务 | 产出文件 |
|------|------|----------|
| Day 1-2 | 实现 `tools/sympy_executor.py` | `tools/sympy_executor.py` |
| Day 3 | 实现 TORA Prompt 模板 | `prompts/templates/solve_tora.j2` |
| Day 4-5 | 在 `lane_b.py` 中集成 TORA 模式 | `lanes/lane_b.py` |

### Phase 3: 验证增强（Week 3）

| 天数 | 任务 | 产出文件 |
|------|------|----------|
| Day 1-2 | 实现 `verification/proof_verifier.py` | `verification/proof_verifier.py` |
| Day 3 | 实现 `verification/step_checker.py` | `verification/step_checker.py` |
| Day 4-5 | 增强 `verification/answer_verifier.py` | `verification/answer_verifier.py` |

### Phase 4: 评测体系（Week 4）

| 天数 | 任务 | 产出文件 |
|------|------|----------|
| Day 1-2 | 构建 50 题 UK 评测集 | `data/test_set_uk.json` |
| Day 3 | 实现 `evaluation/evaluate.py` | `evaluation/evaluate.py` |
| Day 4 | 跑基准测试，记录 V2 vs V3 对比 | `evaluation/results/` |
| Day 5 | 调优和修复 | 各模块 |

### Phase 5: 集成上线（Week 5）

| 天数 | 任务 | 产出文件 |
|------|------|----------|
| Day 1-2 | 实现 `integration/server_bridge.py`（V2/V3 切换） | `integration/server_bridge.py` |
| Day 3 | 在 `server.py` 中增加 V3 路由（可选切换） | `server.py` 修改 |
| Day 4-5 | 端到端测试，灰度上线 | 测试报告 |

---

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| **ToRA 模式模型不适应** | 中 | 高 | 在 few-shot 中展示 `<tool>` 用法；如果效果不好，回退到纯 CoT |
| **Python 代码执行安全** | 低 | 高 | Restricted globals + 超时 + 模块白名单；定期审计 |
| **Proof Verifier 成本过高** | 中 | 中 | 仅在 Lane B 的证明题使用；可配置开关 |
| **Sub-problem 分解误判** | 中 | 中 | 添加 "强制单部分求解" 开关；误判时用户可反馈 |
| **Notation Mapper 过度替换** | 低 | 低 | 添加替换日志；定期 review 替换规则 |
| **整体延迟增加** | 高 | 中 | Lane B 的 TORA 模式增加 1-2 轮交互；提供进度指示 |

---

## 8. 附录：参考项目

### 8.1 OpenAI Evals
- **GitHub**: https://github.com/openai/evals
- **借鉴点**: Model-graded evaluation 理念；YAML 配置化任务定义
- **使用场景**: 证明题质量评估

### 8.2 Hendrycks MATH Dataset
- **GitHub**: https://github.com/hendrycks/math
- **借鉴点**: 分类统计错误模式；题型标签体系
- **使用场景**: 评测集构建；错误分析

### 8.3 EleutherAI lm-evaluation-harness
- **GitHub**: https://github.com/EleutherAI/lm-evaluation-harness
- **借鉴点**: 模块化架构；可插拔后端；Jinja2 模板
- **使用场景**: Harness 整体架构设计

### 8.4 Microsoft ToRA
- **GitHub**: https://github.com/microsoft/ToRA
- **论文**: https://arxiv.org/abs/2309.17452
- **借鉴点**: Tool-integrated Reasoning；交错推理与工具调用
- **使用场景**: 符号计算增强

### 8.5 LeanDojo
- **GitHub**: https://github.com/lean-dojo/LeanDojo
- **借鉴点**: 证明步骤状态追踪；依赖图构建
- **使用场景**: 子问题分解器设计

---

## 9. 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-08-12 | v0.1 | 初始文档创建，基于 Qwen3.6 弱点分析和开源项目调研 |

---

> **下一步**: 确认本计划后，开始 Phase 1 实施：创建目录结构并拆分基础模块。
