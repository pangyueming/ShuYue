# CogniBridge Harness V3 — 完整代码讲解与Pipeline流程图

> **用途**：向老师汇报、团队内部学习、新成员上手
> **面向读者**：初学者（有一定Python基础）
> **最后更新**：2026年8月14日（/api/chat 接入 V3 + ProofVerifier LLM 语义验证 + StepChecker 三态修复）

---

## 一、Harness V3 功能总览

### 1.1 什么是 Harness？

**Harness（驾驭器）** 是 CogniBridge 的"数学解题大脑"。它不是直接调用 AI 模型，而是在模型和题目之间加了一层**智能调度系统**，让 AI 更准、更稳、更省钱地解数学题。

**比喻**：
- 裸跑 Direct API = 让厨师（AI）直接看菜谱（题目）做菜
- Harness V2 = 给厨师配了一个助理（判断简单/复杂题）
- **Harness V3** = 给厨师配了**完整厨房团队**：配菜部、品控部、工具台、菜谱部

### 1.2 V3 完整功能架构

Harness V3 不是从零重写，而是在 V2 的 9 个核心能力之上叠加了 5 个新模块。下面是**完整功能清单**，分为【V2 继承】和【V3 新增】两类。

#### V2 继承功能（底层引擎，V3 仍全部保留）

| 功能 | 模块/函数 | 解决的问题 | 效果 |
|------|----------|-----------|------|
| **CoT 分步推理** | `build_prompt()` | 模型直接给答案，缺少过程 | 强制模型先推理再出答案，可读性提升 |
| **Few-shot 示例** | `prompts/few_shot.py` | 模型不懂输出格式 | 给 1~2 个同题型例题，教模型写 `<answer>` 标签 |
| **答案鲁棒抽取** | `LaneA._extract_answer()` / `LaneB._extract_answer()` | 模型写了正确答案但没套标签 | 5 级兜底：`<answer>` → `\boxed{}` → 关键词 → 最后数字 → 末尾 200 字符 |
| **自一致性投票** | `LaneB._vote()` | 单次采样随机出错 | 5 次 temperature=0.7 采样 → normalize → Counter 投票，取多数派 |
| **Verifier 精修** | `verification/` 各模块 | 模型“自信地”给出错误推理 | 对 Lane B 胜出者的完整解答做二次核验/纠错 |
| **SymPy 符号判分** | `AnswerVerifier` | 字符串匹配把 `1/2` 和 `0.5` 判为不同答案 | 用 SymPy 做符号/数值等价判断，减少误判 |
| **纠错白名单** | `answer_corrections.json` | 标准答案本身有歧义（如多解图题） | 人工维护的 gold 答案纠错表，免费收益 |
| **Lane A/B 级联路由** | `SmartRouter` | 简单题和复杂题用同样资源 | 简单题走 A（1 次调用），复杂题走 B（5 次调用），省 47% Token |
| **多运行模式** | `harness_v3.py --rescore-only / --verify-only` | 每次改判分逻辑都要重新调 API | 复用已存预测，免费重判或 verifier 精修 |

#### V3 新增功能（在 V2 之上叠加）

| 功能 | 模块 | 解决的问题 | 效果 |
|------|------|-----------|------|
| **ToRA 工具调用** | `tools/sympy_executor.py` + `LaneB._run_tora_turn()` | AI 算积分/矩阵时符号搞错（幻觉） | 让 AI 写 Python 代码用 SymPy 算，准确率 +20~30% |
| **Proof Verifier** | `verification/proof_verifier.py` | 证明题漏写 Base case / 归纳假设 | 自动检查证明结构完整性，证明题正确率 0%→87.5% |
| **Step Checker** | `verification/step_checker.py` | 中间步骤算错（如移项符号错） | 提取等式用 SymPy 验证 LHS=RHS，捕获过程错误 |
| **Notation Normalizer** | `tools/notation_mapper.py` | `z*` 和 `\bar{z}` 混用导致匹配失败 | 统一 UK 标准符号格式（50+ 条正则规则） |
| **多信号智能路由** | `core/router.py` | V2 只看关键词，误判率高 | 综合题型+知识点+长度+学生画像 6 维信号，省 38% Token |

### 1.3 题型与知识点路由分类（哪些走 A，哪些走 B）

Harness V3 的**核心设计哲学**是：简单题快且省，复杂题慢且稳。路由决策由 `SmartRouter` 根据**6 维信号加权评分**做出，阈值 `0.55`。

#### 题型分类（QuestionClassifier）

| 题型 | 检测规则 | 默认走向 | 说明 |
|------|---------|---------|------|
| **MCQ（选择题）** | 有 options 参数 / 文本含 "which of the following" | **Lane A** | 有标准选项，通常较简单；路由分 `-0.1` |
| **Short（简答题）** | 无特殊关键词，默认 fallback | **Lane A** | 求极限、求导、简单积分等 |
| **Long（论述题）** | 含 "explain / describe / discuss / justify" | **Lane B** | 需要展开论述，路由分 `+0.15` |
| **Multi-part（多部分题）** | 检测到 `(a)...(b)...(c)` 或 `Part A...` | **Lane B** | 子问题多，路由分 `+0.25` |
| **Proof（证明题）** | 含 "prove / show that / deduce / hence show" | **Lane B** | 最强信号，路由分 `+0.45`，**强制启用 Proof Verifier** |

#### 知识点分类（TopicDetector）

共 **16 个知识点**，按 Qwen3.6 的历史表现分为两类：

| 类别 | 知识点 | 关键词示例 | 路由影响 |
|------|--------|-----------|---------|
| **弱项知识点**（Qwen3.6 易错） | Proof_Techniques | prove, induction, contradiction | **强制 Lane B**，`+0.35` |
| | Discrete_Math | set theory, graph theory, combinatorics | **强制 Lane B**，`+0.35` |
| | Series_Convergence | converge, diverge, taylor series | **强制 Lane B**，`+0.35` |
| | Linear_Algebra | matrix, eigenvalue, determinant | **强制 Lane B**，`+0.35` |
| | Vector_Calculus | curl, divergence, green's theorem | **强制 Lane B**，`+0.35` |
| | Group_Theory | group, subgroup, isomorphism | **强制 Lane B**，`+0.35` |
| | Real_Analysis | supremum, metric space, compact | **强制 Lane B**，`+0.35` |
| **普通知识点** | Limits, Differentiation, Integration, Differential_Equations, Complex_Numbers, Probability, Statistics, Numerical_Methods, Optimisation | limit, derivative, integral, ODE, complex number, probability, hypothesis test, numerical, optimise | 视题型和长度决定；仅知识点匹配本身只 `+0.1` |

#### 路由评分示例

```
题目："Using ε-δ definition, prove lim(x→3)(2x+1)=7"

信号拆解：
├── 知识点 "Limits"（普通）          → +0.1
├── 题型 "Proof"                    → +0.45  ★最强信号
├── 关键词 "prove"                  → +0.2
├── 长度 12 词（短题）               → -0.1
├── 学生画像：无                    → 0
└── 复杂度标记：无                   → 0
────────────────────────────────────────
总分：0.65 ≥ 0.55  → 决策：Lane B
原因：["Question type: Proof", "Contains proof keywords"]
```

```
题目："Find the derivative of f(x)=x²+3x"

信号拆解：
├── 知识点 "Differentiation"（普通） → +0.1
├── 题型 "Short"                    → 0
├── 关键词：无                      → 0
├── 长度 8 词（短题）               → -0.1
└── 复杂度标记：无                   → 0
────────────────────────────────────────
总分：0.0 < 0.55  → 决策：Lane A
原因：["Short question (8 words)"]
```

#### Lane A vs Lane B 参数对比

| 参数 | Lane A（简单题） | Lane B（复杂题） |
|------|-----------------|-----------------|
| **调用次数** | 1 次 | 5 次（自一致性投票） |
| **temperature** | 0.0（确定性） | 0.7（多样性） |
| **ToRA 工具** | ❌ 关闭 | ✅ 按知识点开启 |
| **Proof Verifier** | ❌ 关闭 | ✅ 证明题开启 |
| **Step Checker** | ❌ 关闭 | ✅ 开启 |
| **平均延迟** | ~5s | ~25s |
| **平均 Token** | ~800 | ~3,000 |

### 1.4 基准测试结果

| 指标 | 裸跑 | V2 | **V3** |
|------|------|-----|--------|
| 整体正确率 | 70.9% | 74.6% | **89.1%** |
| 证明题正确率 | 0% | 0% | **87.5%** |
| Token 消耗 | 126K | 495K | **304K** |
| 平均延迟 | 10.8s | 45.1s | **24.4s** |

---

## 二、Pipeline 流程图

### 2.1 整体架构图（含 A/B 分叉与 B 内部分支）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  CogniBridge Harness V3 完整 Pipeline                        │
└─────────────────────────────────────────────────────────────────────────────┘

  用户输入题目
       │
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         ANALYSIS LAYER (core/)                          │
│  ┌─────────────────┐  ┌─────────────────────┐  ┌───────────────────┐   │
│  │  TopicDetector  │→ │ QuestionClassifier  │→ │   SmartRouter     │   │
│  │  16个知识点识别  │  │  5种题型分类         │  │  6维加权评分决策   │   │
│  └─────────────────┘  └─────────────────────┘  └───────────────────┘   │
│         │                      │                       │                 │
│         ▼                      ▼                       ▼                 │
│    "Integration"           "Proof"              score = 0.65            │
│    (普通知识点)            (最强信号)            ≥ 0.55?                │
└─────────────────────────────────────────────────────────────────────────┘
       │
       ▼
    ┌──┴──┐
    │     │
    ▼     ▼
┌─────────────┐      ┌─────────────────────────────────────────────────────┐
│   Lane A     │      │                   Lane B                             │
│  (简单通道)  │      │                 (复杂通道)                            │
│              │      │                                                      │
│ ┌──────────┐│      │  ┌─────────────────────────────────────────────────┐ │
│ │ 1次 API  ││      │  │           Step 1: 5次独立采样                       │ │
│ │temp=0.0  ││      │  │  for i in 1..5:                                   │ │
│ │          ││      │  │    ┌─────────────────────────────────────────┐   │ │
│ │ 答案提取  ││      │  │    │  子分支 A: 标准模式                      │   │ │
│ │(5级兜底) ││      │  │    │  ─────────────────────                    │   │ │
│ │          ││      │  │    │  直接调 API (temp=0.7) → 提取答案        │   │ │
│ │ 符号标准化││      │  │    └─────────────────────────────────────────┘   │ │
│ └──────────┘│      │  │                    │                              │ │
│      │      │      │  │    ┌─────────────────────────────────────────┐   │ │
│      ▼      │      │  │    │  子分支 B: ToRA 模式 (按知识点开启)      │   │ │
│  直接返回答案 │      │  │    │  ──────────────────────────────────────   │   │ │
│              │      │  │    │  模型输出推理                            │   │ │
│ 例: 求导数   │      │  │    │  ↓ 检测到 <tool>python...               │   │ │
│     简单极限 │      │  │    │  ↓ SymPy执行器(沙箱,5秒超时)            │   │ │
│              │      │  │    │  ↓ 返回计算结果给模型                    │   │ │
│              │      │  │    │  ↓ 模型继续推理（最多5轮）               │   │ │
│              │      │  │    └─────────────────────────────────────────┘   │ │
│              │      │  └─────────────────────────────────────────────────┘ │
│              │      │                    │                                   │
│              │      │  ┌─────────────────────────────────────────────────┐ │
│              │      │  │           Step 2: 自一致性投票                     │ │
│              │      │  │  normalize() → Counter() → 选多数派               │ │
│              │      │  │  confidence = 一致数 / 5                          │ │
│              │      │  └─────────────────────────────────────────────────┘ │
│              │      │                    │                                   │
│              │      │  ┌─────────────────────────────────────────────────┐ │
│              │      │  │           Step 3: Verifier 精修（按题型）           │ │
│              │      │  │  ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │ │
│              │      │  │  │ProofVerifier│ │StepChecker  │ │Answer      │  │ │
│              │      │  │  │证明结构检查  │ │逐步等式验证  │ │Verifier    │  │ │
│              │      │  │  │             │ │             │ │符号等价    │  │ │
│              │      │  │  │Base case?   │ │LHS = RHS?   │ │            │  │ │
│              │      │  │  │Inductive?   │ │Step 3 valid?│ │1/2 ≡ 0.5?  │  │ │
│              │      │  │  └─────────────┘ └─────────────┘ └────────────┘  │ │
│              │      │  └─────────────────────────────────────────────────┘ │
│              │      └─────────────────────────────────────────────────────┘
│              │                           │
│              └───────────────────────────┘
│                                          │
│                                          ▼
│                               ┌──────────────────────┐
│                               │     OUTPUT LAYER      │
│                               │  {                    │
│                               │    "answer": "...",   │
│                               │    "lane": "A/B",     │
│                               │    "confidence":0.8,  │
│                               │    "verified":true,   │
│                               │    "proof_assessment":│
│                               │      {overall:"pass"} │
│                               │  }                    │
│                               └──────────────────────┘
```

### 2.2 数据流时序图（以证明题为例）

```
用户          harness_v3        TopicDetector    QuestionClassifier    SmartRouter       LaneB          ProofVerifier
 │               │                   │                    │                  │              │                │
 │──"证明1+2+...+n=n(n+1)/2"──→│                   │                  │              │                │
 │               │──detect()────→│                   │                  │              │                │
 │               │←──"Proof_Techniques"──┤                  │              │                │
 │               │──classify()──────────────────────→│                  │              │                │
 │               │←──────────────"Proof"─────────────┤                  │              │                │
 │               │──route()────────────────────────────────────────→│              │                │
 │               │←────────────────────────────────────"Lane B"─────┤              │                │
 │               │──run(lane="B")─────────────────────────────────────────────────→│                │
 │               │                                                                 │──5次API调用    │
 │               │                                                                 │──投票选出答案  │
 │               │←────────────────────────────────────────────────────────────────│                │
 │               │──verify()──────────────────────────────────────────────────────────────────────→│
 │               │                                                                               │──检查结构
 │               │                                                                               │──Base case?✓
 │               │                                                                               │──Inductive step?✓
 │               │←──────────────────────────────────────────────────────────────────────────────────│
 │               │                                                                               │
 │←────────────返回结果(含proof_assessment)───────────────────────────────────────────────────────────│
```

---

## 三、逐文件代码详解

### 3.0 文件目录总览

```
harness_improve/
├── harness_v3.py              ← 【主入口】协调所有模块
├── integration/
│   └── server_bridge.py       ← 【桥接层】V2/V3 切换
├── models/
│   └── api_client.py          ← 【API封装】统一调用大模型
├── core/                      ← 【分析层】理解题目
│   ├── topic_detector.py      ← 知识点识别
│   ├── question_classifier.py ← 题型分类
│   └── router.py              ← 智能路由决策
├── lanes/                     ← 【解题层】执行求解
│   ├── lane_base.py           ← 抽象基类
│   ├── lane_a.py              ← 简单题：单样本
│   └── lane_b.py              ← 复杂题：多样本+ToRA
├── tools/                     ← 【工具层】辅助计算
│   ├── sympy_executor.py      ← SymPy 安全执行器
│   └── notation_mapper.py     ← 符号标准化
├── prompts/                   ← 【提示层】Prompt模板
│   ├── system_prompts.py      ← System Prompt
│   └── few_shot.py            ← Few-shot示例
└── verification/              ← 【验证层】检查答案
    ├── answer_verifier.py     ← 答案等价性
    ├── proof_verifier.py      ← 证明结构检查
    └── step_checker.py        ← 逐步符号验证
```

---

### 3.1 主入口：harness_v3.py

**作用**：协调所有模块的"总导演"

**核心函数**：`solve_question()`

```python
def solve_question(question_text, options=None, api_key=None, ...):
    # Step 1: 初始化所有组件
    client = APIClient(api_key=api_key, ...)      # ← 创建API客户端
    topic_detector = TopicDetector()               # ← 知识点识别器
    classifier = QuestionClassifier()              # ← 题型分类器
    router = SmartRouter(student_profile=...)      # ← 路由器
    
    # Step 2: 分析题目
    topic_match = topic_detector.detect(question_text)   # → "Integration"
    qtype_result = classifier.classify(question_text)    # → "Proof"
    
    # Step 3: 路由决策
    decision = router.route(question_text)               # → Lane B
    
    # Step 4: 构建Prompt
    prompt = build_prompt(question_text, qtype="Proof", use_tora=True)
    
    # Step 5: 执行Lane
    if decision.lane == "A":
        result = LaneA(client).run(prompt)               # 简单题
    else:
        result = LaneB(client).run(prompt, use_tora=True) # 复杂题+ToRA
    
    # Step 6: 验证（仅Lane B）
    if decision.use_proof_verifier:
        proof_assessment = ProofVerifier().verify(question, solution)
    
    # Step 7: 返回结果
    return {
        "answer": result.answer,
        "solution": result.solution,
        "topic": topic,
        "lane": decision.lane,
        ...
    }
```

**初学者要点**：
- `solve_question()` 是**唯一对外暴露的函数**
- 内部按**固定7步流水线**执行：初始化→分析→路由→构建Prompt→执行Lane→验证→返回
- 所有子模块都像**乐高积木**一样被组装在一起

---

### 3.2 API 封装：models/api_client.py

**作用**：统一封装对 DashScope（阿里云）API 的调用，处理重试、超时、流式

**核心类**：`APIClient`

```python
class APIClient:
    def __init__(self, api_key, base_url, model, timeout=180, retries=3):
        # 保存配置
        self.api_key = api_key
        self.model = model          # "qwen3.8-27b"
        self.timeout = timeout      # 180秒超时
        self.retries = retries      # 失败重试3次
        self.session = requests.Session()  # 复用TCP连接
    
    def chat_completion(self, messages, temperature=0.0, max_tokens=4096):
        # 第1次调用失败 → 等2秒 → 第2次 → 等4秒 → 第3次
        for attempt in range(1, self.retries + 1):
            try:
                return self._call_sync(url, payload)
            except Exception as e:
                if attempt < self.retries:
                    time.sleep(self.retry_delay * attempt)  # 指数退避
        
        return "", {}, f"Error: {e}"  # 全部失败返回错误
    
    def _call_sync(self, url, payload):
        # 实际发送HTTP POST请求
        resp = self.session.post(url, headers={...}, json=payload, timeout=self.timeout)
        return resp.json()["choices"][0]["message"]["content"], resp.json()["usage"]
```

**初学者要点**：
- 这是一个**通用HTTP客户端**，不是数学专用的
- `retries=3` 意味着网络波动时自动重试，不用手动处理
- `temperature=0.0` 让输出更确定（Lane A），`temperature=0.7` 让输出更多样（Lane B）
- `enable_thinking=True` 开启 Qwen3.6 的思考模式

---

### 3.3 知识点识别：core/topic_detector.py

**作用**：看题目里的关键词，判断属于哪个数学知识点

**核心类**：`TopicDetector`

```python
class TopicDetector:
    # 词表：16个知识点，每个配一组关键词
    TOPIC_LEXICON = [
        ("Limits", ["limit", "lim", "epsilon-delta", ...], 1.0),
        ("Integration", ["integral", "integrate", "by parts", ...], 1.0),
        ("Proof_Techniques", ["prove", "proof", "show that", ...], 1.2),
        # ... 共16个
    ]
    
    def detect(self, text: str) -> TopicMatch:
        text_lower = text.lower()
        best_match = TopicMatch("Other", 0.0, [])
        
        for topic_name, keywords, weight in self.TOPIC_LEXICON:
            matched = []
            for kw in keywords:
                if kw.lower() in text_lower:
                    matched.append(kw)      # 记录匹配到的关键词
            
            if matched:
                coverage = len(matched) / len(keywords)     # 覆盖率
                diversity_bonus = min(len(matched) * 0.1, 0.3)  # 多样性奖励
                score = (coverage + diversity_bonus) * weight   # 最终分数
                
                if score > best_match.score:
                    best_match = TopicMatch(topic_name, score, matched)
        
        return best_match  # 返回最高分的知识点
```

**示例**：

```
输入："Prove by induction that 1+2+...+n = n(n+1)/2"

匹配过程：
- "Proof_Techniques": 匹配到 "prove", "induction" → score = 0.43
- "Series_Convergence": 匹配到 "n(n+1)/2" → score = 0.15
- 其他：无匹配

输出：TopicMatch(name="Proof_Techniques", score=0.43, matched=["prove", "induction"])
```

**初学者要点**：
- 这是**基于关键词的文本分类**，不是AI模型判断的
- `weight=1.2` 表示证明类关键词权重更高（更容易被识别为证明题）
- `diversity_bonus` 奖励匹配到多个不同关键词的情况（防止只匹配到一个泛词）
- `WEAK_TOPICS` 集合标记了Qwen3.6不擅长的知识点（证明、离散数学等）

---

### 3.4 题型分类：core/question_classifier.py

**作用**：判断题目是选择题、证明题、计算题还是论述题

**核心类**：`QuestionClassifier`

```python
class QuestionClassifier:
    def classify(self, text, options=None):
        # 优先级1：有选项 → MCQ
        if options and len(options) >= 2:
            return ClassificationResult(QuestionType.MCQ, 1.0, ["Options provided"])
        
        # 优先级2：多部分题目
        part_count = self._count_parts(text)
        if part_count > 1:
            return ClassificationResult(QuestionType.MULTI_PART, 0.9, ...)
        
        # 优先级3：证明关键词
        if re.search(r"\bprove\b", text) or re.search(r"\bshow\s+that\b", text):
            return ClassificationResult(QuestionType.PROOF, 0.95, ...)
        
        # 优先级4：论述关键词
        if re.search(r"\bexplain\b", text) or re.search(r"\bdescribe\b", text):
            return ClassificationResult(QuestionType.LONG_ANSWER, 0.8, ...)
        
        # 默认：简答题
        return ClassificationResult(QuestionType.SHORT_ANSWER, 0.6, ["Default: short answer"])
```

**初学者要点**：
- 分类是**硬规则**（正则匹配），不是机器学习
- 优先级很重要：MCQ > Multi-part > Proof > Long > Short
- `_count_parts()` 用正则检测 "(a) ... (b) ... (c)" 这种多部分格式

---

### 3.5 智能路由：core/router.py

**作用**：综合多个信号，决定走 Lane A（简单）还是 Lane B（复杂）

**核心类**：`SmartRouter`

```python
class SmartRouter:
    def route(self, question_text, options, topic_override):
        lane_b_score = 0.0  # 分数越高，越应该走Lane B
        signals = []        # 记录决策原因
        
        # 信号1：弱项知识点 +0.35
        if topic in WEAK_TOPICS:
            lane_b_score += 0.35
            signals.append("Weak topic: Proof_Techniques")
        
        # 信号2：证明题型 +0.45
        if qtype == QuestionType.PROOF:
            lane_b_score += 0.45
            signals.append("Question type: Proof")
        
        # 信号3：证明关键词 +0.2
        if "prove" in text or "show that" in text:
            lane_b_score += 0.2
            signals.append("Contains proof keywords")
        
        # 信号4：学生历史（弱项+0.2，强项-0.15）
        if topic in student_profile.get("weak_topics", []):
            lane_b_score += 0.2
        
        # 信号5：题目长度（长题+0.15，短题-0.1）
        word_count = len(question_text.split())
        if word_count > 150:
            lane_b_score += 0.15
        
        # 信号6：复杂度标记
        if text.count("hence") + text.count("therefore") >= 3:
            lane_b_score += 0.1
        
        # 决策阈值：0.55
        if lane_b_score >= 0.55:
            return RouteDecision(lane="B", temperature=0.7, n_samples=5, use_tora=True)
        else:
            return RouteDecision(lane="A", temperature=0.0, n_samples=1, use_tora=False)
```

**示例决策**：

```
题目："Using ε-δ definition, prove lim(x→3)(2x+1)=7"

信号分析：
- 知识点 "Limits"（非弱项）：+0.1
- 题型 "Proof"：+0.45
- 关键词 "prove"：+0.2
- 长度 12 词（短题）：-0.1
- 总分：0.65 ≥ 0.55

决策：Lane B（复杂题）
原因：["Question type: Proof", "Contains proof keywords"]
```

**初学者要点**：
- 这是一个**加权评分系统**，类似垃圾邮件过滤器的原理
- 阈值 `0.55` 是经验值，可以调参
- `RouteDecision` 不仅决定 Lane，还决定 temperature、样本数、是否用 ToRA

---

### 3.6 抽象基类：lanes/lane_base.py

**作用**：定义 Lane 的通用接口，确保 LaneA 和 LaneB 有统一的输入输出

```python
class LaneResult:
    """统一的结果容器"""
    def __init__(self, answer="", solution="", usage={}, error="", confidence=1.0, ...):
        self.answer = answer        # 最终答案
        self.solution = solution    # 完整解题过程
        self.usage = usage          # Token消耗
        self.error = error          # 错误信息
        self.confidence = confidence  # 置信度（Lane B投票用）

class BaseLane(ABC):
    """抽象基类"""
    def __init__(self, client: APIClient):
        self.client = client        # 每个Lane都持有API客户端
    
    @abstractmethod
    def run(self, prompt, question_text, **kwargs) -> LaneResult:
        """子类必须实现这个方法"""
        pass
```

**初学者要点**：
- `ABC` 和 `@abstractmethod` 是 Python 的抽象基类机制
- 强制所有 Lane 必须实现 `run()` 方法，返回 `LaneResult`
- 这是**面向对象设计**中的"模板方法模式"

---

### 3.7 简单题通道：lanes/lane_a.py

**作用**：对简单题只调用一次 API，快速返回

```python
class LaneA(BaseLane):
    def run(self, prompt, question_text, **kwargs):
        # 1. 构建消息
        messages = [
            {"role": "system", "content": "You are a UK math tutor..."},
            {"role": "user", "content": prompt},
        ]
        
        # 2. 调用API（temperature=0，确定性输出）
        text, usage, error = self.client.chat_completion(
            messages=messages, temperature=0.0
        )
        
        # 3. 清洗<thinking>块
        text = re.sub(r"<thinking>.*?</thinking>", "", text)
        
        # 4. 提取答案（多种策略）
        answer = self._extract_answer(text)
        
        # 5. 符号标准化
        answer = NotationMapper.normalize(answer)
        
        return LaneResult(answer=answer, solution=text, usage=usage, confidence=1.0)
```

**答案提取策略**（`_extract_answer`）：

```
策略1：匹配 <answer>...</answer> 标签（最优先）
策略2：匹配 \boxed{...}（LaTeX标准格式）
策略3：匹配 "Answer: ..." / "Therefore ..." 等关键词
策略4：提取最后一个数字（兜底）
策略5：返回最后200个字符（最后的兜底）
```

**初学者要点**：
- `temperature=0.0` 让模型每次输出都一样（确定性）
- 置信度固定为 `1.0`（因为只有1个样本）
- `<thinking>` 是 Qwen3.6 思考模式的内部输出，用户不需要看到

---

### 3.8 复杂题通道：lanes/lane_b.py

**作用**：对复杂题调用5次 API，投票选出最一致的答案；支持 ToRA 工具调用

```python
class LaneB(BaseLane):
    def run(self, prompt, n_samples=5, temperature=0.7, use_tora=False):
        collected = []  # 收集5个样本的结果
        
        for i in range(n_samples):
            if use_tora:
                raw, usage = self._run_tora_turn(system_prompt, prompt)
            else:
                raw, usage, error = self.client.chat_completion(..., temperature=0.7)
            
            # 提取并标准化答案
            answer = self._extract_answer(raw)
            norm = NotationMapper.normalize_for_comparison(answer)
            collected.append((answer, norm, raw))
        
        # 投票：选出现次数最多的标准化答案
        pred, confidence = self._vote(collected)
        return LaneResult(answer=pred, confidence=confidence, n_samples=5)
    
    def _vote(self, collected):
        """自一致性投票"""
        from collections import Counter
        norm_counter = Counter(norm for _, norm, _ in collected if norm)
        winner_norm, count = norm_counter.most_common(1)[0]
        confidence = count / len(collected)  # 如 4/5 = 0.8
        return winner_answer, confidence
```

**ToRA 多轮交互**（`_run_tora_turn`）：

```
第1轮：模型输出推理 + <tool>python代码</tool>
         ↓
      SymPy执行器运行代码
         ↓
      返回结果给模型
         ↓
第2轮：模型基于结果继续推理
         ↓
      （如果没有<tool>标签则结束）
```

**示例 ToRA 流程**：

```
模型输出：
"I'll verify this integral with the calculator.
<tool>
python
import sympy as sp
x = sp.Symbol('x')
sp.integrate(x*sp.exp(x), x)
</tool>"

SymPy执行器运行代码 → 返回 "(x - 1)*exp(x)"

模型收到结果后继续：
"The calculator confirms the result is (x-1)e^x.
Therefore, ∫x·e^x dx = (x-1)e^x + C.
<answer>(x - 1)e^x + C</answer>"
```

**初学者要点**：
- 5 次调用 × 温度 0.7 = 5 个**不同但合理**的答案，投票找出共识
- `confidence=0.8` 表示 5 个中有 4 个一致，结果可信
- ToRA 模式最多 5 轮交互（防止无限循环）

---

### 3.9 SymPy 执行器：tools/sympy_executor.py

**作用**：安全执行模型生成的 Python/SymPy 代码

```python
class SymPyExecutor:
    def __init__(self, timeout=5):
        self.globals = self._build_safe_globals()  # 构建安全环境
    
    def _build_safe_globals(self):
        """只允许使用数学相关的函数"""
        safe_globals = {'__builtins__': {  # 极少的内置函数
            'abs': abs, 'max': max, 'min': min, 'sum': sum,
            'range': range, 'len': len, 'float': float, 'int': int,
        }}
        
        # 注入 SymPy 数学函数
        safe_globals['sympy'] = sp
        safe_globals['sp'] = sp
        safe_globals['integrate'] = sp.integrate
        safe_globals['diff'] = sp.diff
        safe_globals['Matrix'] = sp.Matrix
        safe_globals['sin'] = sp.sin
        safe_globals['cos'] = sp.cos
        # ... 共50+个数学函数
        
        return safe_globals
    
    def execute(self, code):
        """在受限环境中执行代码"""
        try:
            result = eval(code, self.globals, {})  # 沙箱执行
            return {
                'success': True,
                'result': str(result),
                'latex': sp.latex(result),  # 转LaTeX
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}
```

**安全机制**：

```
❌ 禁止：import os, open(), file操作, 网络请求
✅ 允许：sympy数学函数, 基本算术, 列表操作
⏱️ 超时：5秒（防止死循环）
```

**初学者要点**：
- `eval()` 在 Python 中很危险，但通过限制 `globals` 可以控制权限
- `__builtins__` 只放白名单函数，防止执行恶意代码
- `sp.latex()` 把数学结果转成 LaTeX，方便模型理解

---

### 3.10 符号标准化：tools/notation_mapper.py

**作用**：统一不同写法的数学符号

```python
class NotationMapper:
    UK_STANDARD_MAP = [
        # (正则模式, 替换结果, 说明)
        (r'z\s*\*', r'\\bar{z}', 'complex conjugate'),      # z* → \bar{z}
        (r'\\vec\{(\w+)\}', r'\\mathbf{\1}', 'vector bold'),  # \vec{v} → \mathbf{v}
        (r'∫', r'\\int', 'integral symbol'),                   # ∫ → \int
        (r'α', r'\\alpha', 'alpha'),                          # α → \alpha
        (r'≤', r'\\leq', 'less equal'),                      # ≤ → \leq
        # ... 共50+条规则
    ]
    
    @classmethod
    def normalize(cls, text):
        result = text
        for pattern, replacement, desc in cls.UK_STANDARD_MAP:
            result = re.sub(pattern, replacement, result)
        return result
```

**示例**：

```
输入："z* = 3 + 4i, |z*| = 5"
输出："\bar{z} = 3 + 4i, |\bar{z}| = 5"

输入："∫ x·e^x dx"
输出："\int x·e^x dx"
```

**初学者要点**：
- 这是**纯文本替换**，不需要AI模型
- 解决模型输出不一致的问题（有时写 `z*`，有时写 `\bar{z}`）
- 按知识点有偏好设置（如 Linear Algebra 用 `\mathbf{v}` 而不是 `\vec{v}`）

---

### 3.11 证明结构检查：verification/proof_verifier.py

**作用**：检查证明是否包含必要的结构要素

```python
class ProofVerifier:
    # 每种证明类型的检查清单
    RUBRICS = {
        ProofType.INDUCTION: {
            "sections": [
                ("base_case", ["base case", "n = 1", "first case"]),
                ("inductive_hypothesis", ["assume", "inductive hypothesis", "p(k)"]),
                ("inductive_step", ["therefore", "p(k+1)", "inductive step"]),
                ("conclusion", ["by induction", "qed", "proved"]),
            ]
        },
        ProofType.CONTRADICTION: {
            "sections": [
                ("assumption", ["suppose not", "assume", "for contradiction"]),
                ("derivation", ["then", "therefore", "implies"]),
                ("contradiction", ["contradiction", "absurd"]),
                ("conclusion", ["must be true", "qed"]),
            ]
        },
        # ... 还有 ε-δ、直接证明、逆否命题
    }
    
    def verify(self, question, solution):
        # 1. 检测证明类型
        proof_type = self.detect_proof_type(question, solution)
        
        # 2. 按清单检查每个必需部分
        sections = []
        for section_name, keywords in rubric["sections"]:
            matched = [kw for kw in keywords if kw in solution.lower()]
            present = len(matched) > 0
            
            if present:
                quality = "strong" if len(matched) >= 2 else "partial"
            else:
                quality = "missing"
            
            sections.append(SectionGrade(name=section_name, present=present, quality=quality))
        
        # 3. 计算总分
        score = sum(1 for s in sections if s.quality == "strong") / len(sections)
        
        # 4. 判定结果
        if score >= 0.8: overall = "pass"
        elif score >= 0.5: overall = "needs_revision"
        else: overall = "fail"
        
        return ProofAssessment(proof_type, sections, overall, score, feedback)
```

**示例输出**：

```
证明题："Prove 1+2+...+n = n(n+1)/2 by induction"

模型解答：
"Base case (n=1): LHS=1, RHS=1. ✓
 Assume true for n=k.
 For n=k+1: LHS = k(k+1)/2 + (k+1) = (k+1)(k+2)/2 = RHS.
 By induction, proved."

ProofVerifier 输出：
Proof Type: induction
Overall: PASS (score: 1.0)
✅ base_case: STRONG
✅ inductive_hypothesis: STRONG
✅ inductive_step: STRONG
✅ conclusion: STRONG
Feedback: Well-structured proof with all required elements.
```

**初学者要点**：
- **两层验证**：先跑结构清单（快、确定性、无网络），可选再用 LLM 做数学正确性语义评分（`verify(use_llm=True)`）
- 关键词存在性只能判断"结构是否完整"，**不能**判断"数学是否正确"——一个关键词全写全、但推理全错的证明，结构分照样 PASS
- 因此接入了 LLM grading（`SYSTEM_PROMPT_PROOF_VERIFIER`），让模型判断**数学正确性与逻辑严谨性**，而非只看关键词
- LLM 失败或未配置 client 时自动回退结构检查，不会崩溃
- 对老师汇报的价值：既能自动批改结构分，也能给出数学正确性反馈

---

### 3.12 逐步符号验证：verification/step_checker.py

**作用**：提取解题过程中的等式，用 SymPy 验证左右两边是否等价

```python
class StepChecker:
    def check_solution_steps(self, solution):
        # 1. 从文本中提取等式
        equations = self._extract_equations(solution)
        # → ["∫x·e^x dx = x·e^x - ∫e^x dx", "x·e^x - e^x + C", ...]
        
        # 2. 逐个验证
        for eq in equations:
            lhs, rhs = eq.split("=")  # 拆分左右
            result = self.executor.verify_expression(lhs, rhs)
            if not result["equivalent"]:
                errors.append(f"Step {i}: {lhs} ≠ {rhs}")
        
        return {"valid": len(errors)==0, "errors": errors}
```

**示例**：

```
模型输出：
"∫x·e^x dx = x·e^x - ∫e^x dx      ← Step 1
          = x·e^x - e^x + C       ← Step 2（这里容易算错符号）"

StepChecker 验证：
Step 1: "∫x·e^x dx" vs "x·e^x - ∫e^x dx" → ✅ 等价（integration by parts）
Step 2: "x·e^x - ∫e^x dx" vs "x·e^x - e^x + C" → ✅ 等价

如果模型写成：
"= x·e^x + e^x + C"  ← 符号错误

StepChecker 会报：
❌ Step 2: "x·e^x - e^x" not equivalent to "x·e^x + e^x"
```

**初学者要点**：
- 这是**过程检查**，不是只看最终答案
- 可以捕获中间步骤的符号错误（AI 最容易犯的错）
- 目前只检查显式等式（有 "=" 的行）
- **三态判定**：每步结果是 `valid=True`（等价）/ `False`（确实不等价）/ `None`（无法验证，如含积分符号、或 RHS 是纯数值的解）。`None` 不会被误报成错误，而是归入 `unverifiable`
- **已修复两个隐患**：旧版"验证失败就当对"（`except: return valid=True`）会漏掉所有解析错误；旧版 `'0' in diff` 字符串包含判断会把 `x²-10`（含字符 `0`）误判成与 `x²` 等价。现改用 SymPy 符号等价判断（`simplify(lhs-rhs) == 0`），并诚实返回三态

---

### 3.13 Prompt 模板：prompts/system_prompts.py + few_shot.py

**system_prompts.py**：定义不同模式下的 System Prompt

```python
SYSTEM_PROMPT_SOLVE = (
    "You are CogniBridge, an expert UK university mathematics tutor. "
    "You specialise in first-year undergraduate mathematics..."
)

SYSTEM_PROMPT_TORA = (
    "You are CogniBridge... You have access to a Python/SymPy calculator. "
    "When you need to perform complex calculations, write: <tool>python...</tool>"
)

def get_system_prompt(mode):
    return {
        "solve": SYSTEM_PROMPT_SOLVE,
        "tora": SYSTEM_PROMPT_TORA,
        "guide": SYSTEM_PROMPT_GUIDE,
        ...
    }[mode]
```

**few_shot.py**：给模型看示例，教它输出格式

```python
FEW_SHOT_TORA = """
Example (Tool-integrated):
Question: Evaluate ∫ x·e^x dx
Solution: I'll use integration by parts.
<tool>
python
import sympy as sp
x = sp.Symbol('x')
sp.integrate(x*sp.exp(x), x)
</tool>
The calculator returns: (x - 1)*exp(x).
<answer>(x - 1)e^x + C</answer>
"""
```

**初学者要点**：
- System Prompt 是**给AI的"身份设定"**，决定它的角色和行为
- Few-shot 是**给AI的"例题示范"**，教它输出什么格式
- ToRA 的 Prompt 必须包含 `<tool>python...<tool>` 的示例，否则模型不会用

---

### 3.14 桥接层：integration/server_bridge.py

**作用**：让 server.py 可以同时调用 V2 和 V3，通过环境变量切换

```python
# 导入 V2（稳定版）
from harness_uk_math import solve_question as _solve_question_v2

# 导入 V3（改进版）
from harness_v3 import solve_question as _solve_question_v3

def solve_question(question_text, ..., use_v3=None):
    # 如果没传 use_v3，就读环境变量
    if use_v3 is None:
        use_v3 = os.getenv("HARNESS_VERSION", "v2") == "v3"
    
    if use_v3:
        return _solve_question_v3(...)   # 走 V3
    else:
        return _solve_question_v2(...)   # 走 V2（默认）
```

**初学者要点**：
- 这是**适配器模式**，让调用方不用关心底层是 V2 还是 V3
- 只需改 `.env` 里的 `HARNESS_VERSION=v3`，不用改代码
- V3 出问题时，改回 `v2` 立即恢复

---

### 3.15 服务集成：server.py `/api/chat` 接入 V3（2026-08-14 新增）

**背景**：`server.py` 的 `/api/chat`（Math Tutor 聊天主入口）原本用一套**简化词表**（`infer_topic` + `should_use_verifier`，仅 11 个 topic），**没有**调用 Harness V3 的 SmartRouter / ProofVerifier，导致学生聊天时其实走的是阉割版逻辑。

**改造后**：`/api/chat` 现在直接复用 V3 的分析层与验证层：

```python
# server.py 顶部（带 try/except 回退）
from core.topic_detector import TopicDetector
from core.question_classifier import QuestionClassifier
from core.router import SmartRouter
from verification.proof_verifier import ProofVerifier

# chat 内：用 V3 分析层替代简化 infer_topic
analysis = _analyze_question_v3(question)  # → topic / qtype / lane / is_proof
```

**流式结束后**按路由结果做后处理：

| 情形 | 行为 |
|------|------|
| 证明题（`is_proof`） | 调 `ProofVerifier(use_llm=True)` 做 **LLM 语义验证**，输出 verdict + score + feedback |
| 弱项知识点（`is_weak`） | 保留原 LLM 交叉验证器（`run_verifier`）兜底 |
| 其他 | 无后处理，保持流式速度 |

**关键取舍**：流式对话**没有**接入 Lane B 的"5 次采样投票 + ToRA 多轮工具调用"——那需要非流式，会破坏前端的打字机体验。需要完整投票/ToRA 时走 `/api/solve` 端点（`solve_question()` 完整 pipeline）。

---

## 四、向老师汇报的要点总结

### 4.1 项目定位

> "智学桥 Harness V3 是一个**AI 数学解题的增强框架**，不是替代大模型，而是在模型前面加了一层智能调度系统，让 Qwen3.6 解英国大学数学题的准确率从 74.6% 提升到 89.1%，特别是在证明题上从 0% 提升到 87.5%。"

### 4.2 技术亮点（完整版：V2 基础 + V3 增强）

#### V2 底层引擎（V3 全部保留并增强）

| 亮点 | 说明 | 收益 |
|------|------|------|
| **CoT 分步推理 + Few-shot** | 强制模型先推理再给答案，按题型给例题示范 | 可读性提升，格式规范 |
| **答案鲁棒抽取** | 5 级兜底策略，专治"模型写对答案但忘套标签" | 减少 15% 漏判 |
| **自一致性投票** | Lane B 5 次采样 + normalize + Counter 多数派 | 降低随机错误 |
| **SymPy 符号判分** | 不比对字符串，直接算符号/数值等价 | `1/2` ≡ `0.5` 不再误判 |
| **纠错白名单** | 人工维护 gold 答案纠错表，支持多解图题 | 免费收益，无需调 API |
| **Lane A/B 级联** | 简单题 1 次调用，复杂题 5 次调用 | 省 47% Token |
| **多运行模式** | `--rescore-only` / `--verify-only` 复用已存预测 | 改判分逻辑零成本 |

#### V3 新增模块

| 亮点 | 说明 | 收益 |
|------|------|------|
| **ToRA 工具调用** | 让 AI "手算"变"计算器算"，SymPy 沙箱执行 | 符号计算准确率 +20~30% |
| **Proof Verifier** | 自动检查证明结构（Base case / 归纳步 / 结论） | 证明题 0% → 87.5% |
| **Step Checker** | 提取解题过程等式，逐句验证 LHS = RHS | 捕获中间步骤符号错误 |
| **Notation Normalizer** | 50+ 条正则统一 UK 数学符号格式 | 解决 `z*` vs `\bar{z}` 匹配失败 |
| **多信号智能路由** | 综合题型+知识点+长度+学生画像 6 维信号 | 误判率降低，再省 38% Token |

### 4.3 与现有工作的对比

| 特性 | 裸调 API | Harness V2 | **Harness V3** |
|------|----------|------------|---------------|
| CoT 分步推理 | ❌ 无 | ✅ 有 | ✅ 有（Prompt 模板化） |
| Few-shot 示例 | ❌ 无 | ✅ 有 | ✅ 有（按题型动态选择） |
| 答案鲁棒抽取 | ❌ 无 | ✅ 5级兜底 | ✅ 5级兜底 + 符号标准化 |
| 自一致性投票 | ❌ 无 | ✅ 5次采样 | ✅ 5次采样 + ToRA 子分支 |
| SymPy 符号判分 | ❌ 无 | ✅ 有 | ✅ 有（复用为 AnswerVerifier） |
| 纠错白名单 | ❌ 无 | ✅ 有 | ✅ 有 |
| Lane A/B 路由 | ❌ 无 | ✅ 关键词 | ✅ 6维多信号 |
| 证明题支持 | ❌ 无 | ❌ 无 | ✅ Proof Verifier |
| 工具调用 | ❌ 无 | ❌ 无 | ✅ ToRA |
| 逐步验证 | ❌ 无 | ❌ 无 | ✅ Step Checker |
| 符号标准化 | ❌ 无 | ❌ 无 | ✅ Notation Mapper |
| 学生画像自适应 | ❌ 无 | ❌ 无 | ✅ 强弱 topic 动态调分 |

### 4.4 可复现性

```bash
# 1. 安装依赖
pip install sympy requests

# 2. 设置API密钥
export DASHSCOPE_API_KEY=sk-...

# 3. 运行测试
python harness_v3.py --question "Prove by induction that 1+2+...+n=n(n+1)/2"

# 4. 查看结果
# Topic: Proof_Techniques
# Lane: B (confidence: 0.95)
# Verified: True
# proof_assessment: {overall: "pass", score: 1.0}
```

---

## 五、附录：文件清单与行数

| 文件 | 行数 | 核心类/函数 | 复杂度 |
|------|------|------------|--------|
| `harness_v3.py` | 273 | `solve_question()` | ⭐⭐⭐ 协调者 |
| `models/api_client.py` | 137 | `APIClient` | ⭐⭐ 网络IO |
| `core/topic_detector.py` | 185 | `TopicDetector` | ⭐ 文本匹配 |
| `core/question_classifier.py` | 140 | `QuestionClassifier` | ⭐ 正则匹配 |
| `core/router.py` | 157 | `SmartRouter` | ⭐⭐ 加权评分 |
| `lanes/lane_base.py` | 51 | `BaseLane`, `LaneResult` | ⭐ 抽象类 |
| `lanes/lane_a.py` | 79 | `LaneA` | ⭐⭐ API调用+提取 |
| `lanes/lane_b.py` | 193 | `LaneB` | ⭐⭐⭐ 投票+ToRA |
| `tools/sympy_executor.py` | 254 | `SymPyExecutor` | ⭐⭐⭐ 沙箱执行 |
| `tools/notation_mapper.py` | 180 | `NotationMapper` | ⭐ 正则替换 |
| `verification/proof_verifier.py` | 246 | `ProofVerifier` | ⭐⭐ 规则引擎 |
| `verification/step_checker.py` | 170 | `StepChecker` | ⭐⭐ 符号验证 |
| `verification/answer_verifier.py` | 123 | `AnswerVerifier` | ⭐⭐ 等价性检查 |
| `prompts/system_prompts.py` | 85 | `get_system_prompt()` | ⭐ 字符串常量 |
| `prompts/few_shot.py` | 73 | `get_few_shot()` | ⭐ 字符串常量 |
| `integration/server_bridge.py` | 199 | `solve_question()` | ⭐⭐ 路由切换 |

**总计**：约 2,300 行 Python 代码

---

*本文档面向初学者，力求用通俗语言解释每段代码的作用和原理。*
*如需深入了解某个模块，可以进一步阅读对应源码中的注释。*
