# 技术路线B：多小模型方案（Harness + Pipeline�?# Multi-Model Architecture

---

## 文档信息

| 项目 | 内容 |
|------|------|
| 方案名称 | Harness + Pipeline 多模型协�?|
| 核心模型 | qwen3.6-35b-a3b（主力）+ 多个专业小模�?|
| 部署方式 | Harness统一调度，按任务路由到最优模�?|
| 适用阶段 | 商业�?�?规模�?|
| 文档版本 | v1.0 |

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────────�?�?                    用户请求                                  �?└────────────────────────┬─────────────────────────────────────�?                         �?┌──────────────────────────────────────────────────────────────�?�?                  AI Harness（调度层�?                        �?�?                                                             �?�? ┌─────────────�? ┌──────────────�? ┌──────────────────�?  �?�? │ModelRouter  �? │CacheManager  �? │QualityChecker    �?  �?�? │任务→模型映射 �? │Redis缓存     �? │结果验�?自动重试  �?  �?�? └──────┬──────�? └──────┬───────�? └────────┬─────────�?  �?�?        └────────────────┼────────────────────�?            �?�?                         �?                                  �?�?             ┌──────────────────────�?                      �?�?             �? PipelineManager     �?                      �?�?             �? 任务→流水线映射      �?                      �?�?             └──────────┬───────────�?                      �?└─────────────────────────┼────────────────────────────────────�?                          �?┌──────────────────────────────────────────────────────────────�?�?                  Pipeline Layer（流水线层）                    �?�?                                                             �?�? ┌───────────�?┌───────────�?┌───────────�?┌───────────�? �?�? │MathSolve  �?│MathGuide  �?│Translation�?│QuizGen    �? �?�? │Pipeline   �?│Pipeline   �?│Pipeline   �?│Pipeline   �? �?�? │直接解�?   �?│引导式解题  �?│学术翻�?   �?│出题举一反三�? �?�? └─────┬─────�?└─────┬─────�?└─────┬─────�?└─────┬─────�? �?�?       �?            �?            �?            �?         �?�? ┌─────┴─────�?┌─────┴─────�?                          �? �?�? │GraphBuild �?│ReadingQ&A �?                          �? �?�? │Pipeline   �?│Pipeline   �?                          �? �?�? │知识图�?   �?│文档引用问答│                           �? �?�? └───────────�?└───────────�?                          �? �?└──────────────────────────────────────────────────────────────�?                          �?┌──────────────────────────────────────────────────────────────�?�?               Model API Layer（模型API层）                     �?�?                                                             �?�? ┌─────────────────�?┌──────────────�?┌─────────────────�? �?�? │Qwen3-30B-A3B    �?│Qwen-Math-7B  �?│DeepSeek-R1-7B   �? �?�? │主力模�?         �?│数学专�?      �?│推理专�?         �? �?�? │通用NLP/对话     �?│解�?出题      �?│逻辑推理/评估     �? �?�? │�?.002/1k tokens �?│�?.002/1k     �?│�?.003/1k       �? �?�? └─────────────────�?└──────────────�?└─────────────────�? �?�?                                                             �?�? ┌─────────────────�?┌──────────────�?┌─────────────────�? �?�? │Qwen-7B-Instruct �?│GLM-4-Flash   �?│Kimi(备�?       �? �?�? │翻�?写作        �?│免费通用       �?│Failover         �? �?�? │�?.001/1k tokens �?│�?/1k (免费)  �?│�?.003/1k       �? �?�? └─────────────────�?└──────────────�?└─────────────────�? �?└──────────────────────────────────────────────────────────────�?```

---

## 二、Harness 各组件设�?
### 2.1 ModelRouter（模型路由器�?
```python
class ModelRouter:
    """根据任务类型和复杂度选择最优模�?""

    ROUTING_TABLE = {
        # task_type �?{primary, fallback, params}
        "math_solve": {
            "primary": "qwen3.6-35b-a3b",      # 主力：MoE推理�?            "fallback": "qwen-math-7b",       # 备选：数学专用
            "temperature": 0.2,
            "max_tokens": 2000,
        },
        "math_guide": {
            "primary": "qwen3.6-35b-a3b",      # 引导对话需要强推理
            "fallback": "qwen-math-7b",
            "temperature": 0.5,
            "max_tokens": 800,
        },
        "translate": {
            "primary": "qwen-7b-instruct",   # 翻译不需要大模型
            "fallback": "qwen3.6-35b-a3b",
            "temperature": 0.1,
            "max_tokens": 1000,
        },
        "quiz_gen": {
            "primary": "qwen-math-7b",       # 数学专用出题
            "fallback": "qwen3.6-35b-a3b",
            "temperature": 0.7,
            "max_tokens": 3000,
        },
        "reasoning": {
            "primary": "deepseek-r1-7b",     # 推理专用
            "fallback": "qwen3.6-35b-a3b",
            "temperature": 0.3,
            "max_tokens": 2000,
        },
        "general_chat": {
            "primary": "glm-4-flash",        # 免费！通用对话
            "fallback": "qwen-7b-instruct",
            "temperature": 0.6,
            "max_tokens": 1000,
        },
        "doc_summary": {
            "primary": "glm-4-flash",        # 免费！摘要任务简�?            "fallback": "qwen-7b-instruct",
            "temperature": 0.3,
            "max_tokens": 800,
        },
    }

    def route(self, task_type, complexity="medium"):
        config = self.ROUTING_TABLE.get(task_type, self.ROUTING_TABLE["general_chat"])

        # 成本优化：简单任务优先用免费模型
        if complexity == "low" and task_type in ["translate", "doc_summary"]:
            return {"model": "glm-4-flash", "temperature": 0.3}  # 免费

        return config

    def failover(self, failed_model, task_type):
        """主模型失败时自动切换"""
        config = self.ROUTING_TABLE.get(task_type, {})
        return config.get("fallback", "glm-4-flash")
```

### 2.2 CacheManager（缓存管理器�?
```python
class CacheManager:
    """Redis缓存 �?减少重复API调用"""

    CACHE_TTL = {
        "math_solve": 86400,     # 24小时（数学答案不变）
        "translate": 604800,     # 7天（翻译结果稳定�?        "quiz_gen": 0,           # 不缓存（每次生成不同题目�?        "math_guide": 0,         # 不缓存（对话是动态的�?        "doc_summary": 86400,    # 24小时
    }

    async def get(self, task_type, content_hash):
        """检查缓�?""
        if self.CACHE_TTL.get(task_type, 0) == 0:
            return None  # 此任务类型不缓存

        key = f"cache:{task_type}:{content_hash}"
        cached = await redis.get(key)
        return json.loads(cached) if cached else None

    async def set(self, task_type, content_hash, result):
        """写入缓存"""
        ttl = self.CACHE_TTL.get(task_type, 0)
        if ttl > 0:
            key = f"cache:{task_type}:{content_hash}"
            await redis.setex(key, ttl, json.dumps(result))

    def hash(self, content):
        """生成内容哈希"""
        import hashlib
        return hashlib.md5(content.encode()).hexdigest()
```

### 2.3 QualityChecker（质量检查器�?
```python
class QualityChecker:
    """检查AI输出质量"""

    async def check(self, task_type, result, original_input):
        checks = {
            "math_solve": self._check_math,
            "translate": self._check_translation,
            "quiz_gen": self._check_quiz,
        }

        checker = checks.get(task_type, self._check_default)
        return await checker(result, original_input)

    async def _check_math(self, result, question):
        """数学答案验证：用另一个模型交叉验�?""
        verify = await harness.call_model("deepseek-r1-7b", {
            "task": "verify_answer",
            "question": question,
            "answer": result,
        })
        return verify.get("is_correct", True)  # 默认信任

    def _check_translation(self, result, original):
        """翻译质量：检查术语一致�?""
        if len(result) < len(original) * 0.3:
            return False  # 翻译太短，可能有问题
        return True

    def _check_quiz(self, result, knowledge_point):
        """出题质量：检查是否覆盖知识点"""
        if knowledge_point.lower() not in result.lower():
            return False
        return True
```

---

## 三、Pipeline 详细设计

### 3.1 Pipeline 基类

```python
class BasePipeline:
    """所有Pipeline的基�?""

    def __init__(self, harness):
        self.harness = harness  # 持有Harness引用

    async def run(self, **kwargs):
        raise NotImplementedError

    async def call_model(self, model_name, messages, **kwargs):
        """通过Harness调用模型（自动缓�?failover�?""
        return await self.harness.execute(model_name, messages, **kwargs)
```

### 3.2 MathSolvePipeline（直接解�?�?General Mode�?
```python
class MathSolvePipeline(BasePipeline):
    """直接解题：理解→识别知识点→解题→讲解→出题"""

    async def run(self, question, uploaded_materials=None, student_level="intermediate"):
        results = {}

        # Stage 1: 理解题目（主力模型）
        results['understanding'] = await self.call_model('qwen3.6-35b-a3b', [
            {"role": "system", "content": "分析这道数学题的类型和考察的知识点�?},
            {"role": "user", "content": question}
        ], temperature=0.2, max_tokens=500)

        # Stage 2: 解题（数学专用模型，成本更低�?        results['solution'] = await self.call_model('qwen-math-7b', [
            {"role": "system", "content": SOLVE_PROMPT},
            {"role": "user", "content": f"题目：{question}\n分析：{results['understanding']}"}
        ], temperature=0.2, max_tokens=2000)

        # Stage 3: 生成讲解脚本（免费模型即可）
        results['explanation'] = await self.call_model('glm-4-flash', [
            {"role": "system", "content": "将解题过程转换为通俗讲解，模拟老师讲课风格�?},
            {"role": "user", "content": results['solution']}
        ], temperature=0.5, max_tokens=1000)

        # Stage 4: 举一反三出题（数学专用）
        results['quiz'] = await self.call_model('qwen-math-7b', [
            {"role": "system", "content": "基于解题过程，生�?道变式练习题，含解析�?},
            {"role": "user", "content": results['solution']}
        ], temperature=0.7, max_tokens=2000)

        return results
```

### 3.3 MathGuidePipeline（引导式 �?Deep Learning Mode�?
```python
class MathGuidePipeline(BasePipeline):
    """苏格拉底式引导：不给答案，通过提问引导学生推导"""

    async def run(self, question, student_level, history):
        # Stage 1: 理解题目（主力模型）
        understanding = await self.call_model('qwen3.6-35b-a3b', [
            {"role": "system", "content": "分析数学题，但不要给出答案�?},
            {"role": "user", "content": question}
        ], temperature=0.3, max_tokens=500)

        # Stage 2: 评估学生当前状态（推理模型�?        if history:
            evaluation = await self.call_model('deepseek-r1-7b', [
                {"role": "system", "content": "评估学生在引导过程中的表现�?},
                {"role": "user", "content": f"题目：{question}\n对话历史：{json.dumps(history)}"}
            ], temperature=0.3, max_tokens=300)
        else:
            evaluation = {"status": "start", "attempts": 0}

        # Stage 3: 生成下一步引导（主力模型�?        guidance = await self.call_model('qwen3.6-35b-a3b', [
            {"role": "system", "content": GUIDE_SYSTEM_PROMPT},
            {"role": "user", "content": self._build_guide_prompt(
                question, understanding, evaluation, history
            )}
        ], temperature=0.5, max_tokens=800)

        return {"guidance": guidance, "evaluation": evaluation}

    def _build_guide_prompt(self, question, understanding, evaluation, history):
        if not history:
            return f"这是新题目。先问学生一个引导性问题。\n题目：{question}"
        elif evaluation.get("attempts", 0) >= 2:
            return f"学生已尝试{evaluation['attempts']}次，给更详细的提示�?
        else:
            return f"继续引导学生下一步。当前进度：{evaluation}"
```

### 3.4 TranslationPipeline（学术翻译）

```python
class TranslationPipeline(BasePipeline):
    """学术翻译：术语识别→翻译→差异标�?""

    async def run(self, text, source_lang="en", target_lang="zh"):
        # Stage 1: 术语识别（轻量模型，成本低）
        terms = await self.call_model('qwen-7b-instruct', [
            {"role": "system", "content": "提取文本中的数学/CS专业术语�?},
            {"role": "user", "content": text}
        ], temperature=0.1, max_tokens=500)

        # Stage 2: 翻译（轻量模型足够）
        translation = await self.call_model('qwen-7b-instruct', [
            {"role": "system", "content": f"学术翻译。术语参考：{terms}"},
            {"role": "user", "content": text}
        ], temperature=0.1, max_tokens=1000)

        # Stage 3: 差异标注（免费模型）
        differences = await self.call_model('glm-4-flash', [
            {"role": "system", "content": "对比中英表达差异，标注需要注意的地方�?},
            {"role": "user", "content": f"原文：{text}\n译文：{translation}"}
        ], temperature=0.3, max_tokens=500)

        return {"translation": translation, "terms": terms, "differences": differences}
```

### 3.5 QuizGenerationPipeline（智能出题）

```python
class QuizGenerationPipeline(BasePipeline):
    """举一反三出题：知识点→多题型→难度递进"""

    async def run(self, knowledge_point, difficulty="medium", count=3):
        # Stage 1: 分析知识点结构（推理模型�?        analysis = await self.call_model('deepseek-r1-7b', [
            {"role": "system", "content": "分析这个知识点的核心要点和常见考察方式�?},
            {"role": "user", "content": knowledge_point}
        ], temperature=0.3, max_tokens=500)

        # Stage 2: 生成题目（数学专用模型）
        quiz = await self.call_model('qwen-math-7b', [
            {"role": "system", "content": QUIZ_GEN_PROMPT},
            {"role": "user", "content": f"知识点：{knowledge_point}\n分析：{analysis}\n生成{count}道题，难度{difficulty}"}
        ], temperature=0.7, max_tokens=3000)

        return {"quiz": quiz, "analysis": analysis}
```

---

## 四、模型选型与成�?
### 4.1 模型配置�?
```yaml
# models.yaml
models:
  qwen3.6-35b-a3b:
    provider: dashscope
    role: "主力模型 �?通用NLP/数学推理/引导对话"
    cost: 0.002    # ¥/千tokens
    strengths: "MoE架构，推理强�?2K上下�?
    use_for: ["math_solve", "math_guide", "doc_qa", "reasoning"]

  qwen-math-7b:
    provider: dashscope
    role: "数学专用 �?解题/出题"
    cost: 0.002
    strengths: "数学领域微调，解题准确率�?
    use_for: ["math_solve_secondary", "quiz_gen"]

  deepseek-r1-7b:
    provider: siliconflow
    role: "推理专用 �?知识点识�?答案验证"
    cost: 0.003
    strengths: "思维链推理，逻辑判断"
    use_for: ["reasoning", "quality_check"]

  qwen-7b-instruct:
    provider: dashscope
    role: "轻量通用 �?翻译/写作/摘要"
    cost: 0.001
    strengths: "快、便宜、够�?
    use_for: ["translate", "writing_assist"]

  glm-4-flash:
    provider: zhipu
    role: "免费备�?�?简单任�?
    cost: 0.0       # 免费�?    strengths: "零成本，简单任务够�?
    use_for: ["general_chat", "doc_summary", "fallback"]

  kimi:
    provider: moonshot
    role: "Failover �?主模型全部不可用�?
    cost: 0.003
    strengths: "128K长上下文，稳�?
    use_for: ["failover"]
```

### 4.2 月成本估算（1000活跃用户�?
| 模型 | 日tokens | 月成�?|
|------|---------|--------|
| qwen3.6-35b-a3b（主力） | 80�?| ¥48 |
| Qwen-Math-7B（数学） | 30�?| ¥18 |
| DeepSeek-R1-7B（推理） | 20�?| ¥18 |
| Qwen-7B（翻译） | 15�?| ¥4.5 |
| GLM-4-Flash（免费） | 10�?| ¥0 |
| Kimi（备选） | 5�?| ¥4.5 |
| **总计** | **160�?* | **~¥93** |

**对比单模型方案（~¥99/月），多模型方案成本更低**（因为免费模�?缓存覆盖了大量简单任务）�?
---

## 五、与单模型方案对�?
| 维度 | 单模型（qwen3.6-35b-a3b�?| 多模型（Harness+Pipeline�?|
|------|----------------------|--------------------------|
| 实现复杂�?| �?极简（改3行代码） | ⭐⭐�?中等（需Python后端�?|
| 月成�?| ~¥99 | ~¥93 |
| 数学推理 | ⭐⭐⭐⭐�?| ⭐⭐⭐⭐�?|
| 翻译质量 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 系统稳定�?| ⭐⭐⭐（单点依赖�?| ⭐⭐⭐⭐⭐（自动failover�?|
| 响应速度 | ⭐⭐⭐⭐（大模型慢） | ⭐⭐⭐⭐⭐（小模型快+缓存�?|
| 可扩展�?| ⭐⭐�?| ⭐⭐⭐⭐�?|
| 上线时间 | 1�?| 2-3�?|

---

## 六、实施路�?
```
Phase 1（现在）：单模型跑�?  └── code_v2/index.html + Qwen3 API直连
      �?验证产品PMF
Phase 2�?-2月后）：加缓存层
  └── 后端加Redis �?常见问题0成本
      �?用户量增�?Phase 3�?-6月后）：完整Harness
  └── Python微服�?+ ModelRouter + QualityChecker
      �?规模�?Phase 4�?�?）：多模�?+ 监控
  └── 全套Pipeline + 实时成本监控 + A/B测试
```

---

## 七、总结

**推荐策略：先用单模型验证产品，再用多模型降本增效�?*

- **现在**：技术路线A（单模型），1天内上线
- **用户>500�?*：加缓存层（Redis），成本�?0%
- **用户>2000�?*：完整Harness+Pipeline，成本降50%+稳定性提�?
两个方案不矛盾，单模型是多模型的基础，随时可以平滑迁移�?
---

*文档版本：v1.0*
*创建日期�?026�?�?0�?