# 技术路线A：单模型方案（Qwen3-30B-A3B�?# Single Model Architecture

---

## 文档信息

| 项目 | 内容 |
|------|------|
| 方案名称 | 单模型统一架构 |
| 核心模型 | Qwen3.6-35B-A3B |
| 部署方式 | API调用（阿里云百炼 / 硅基流动�?|
| 适用阶段 | 原型验证 �?早期商业�?|
| 文档版本 | v1.0 |

---

## 一、架构总览

```
┌──────────────────────────────────────────────�?�?             用户请求                          �?�?  (选中文字 / 提问 / 上传资料 / 翻译)          �?└──────────────────┬───────────────────────────�?                   �?┌──────────────────────────────────────────────�?�?          统一API入口                          �?�?                                             �?�?  POST /api/ai/chat                          �?�?  {                                          �?�?    task: "math_solve" | "translate" |       �?�?          "explain" | "quiz_gen" | ...,      �?�?    messages: [...],                         �?�?    context: "引用的文档文�?                  �?�?  }                                          �?└──────────────────┬───────────────────────────�?                   �?┌──────────────────────────────────────────────�?�?        Prompt工程�?                          �?�?                                             �?�?  根据 task_type 选择对应的System Prompt       �?�?  ├── math_solve: "你是高等数学解题专家..."    �?�?  ├── translate: "你是学术翻译专家..."         �?�?  ├── explain: "用大一学生能懂的方式解�?.."    �?�?  └── quiz_gen: "基于知识点生�?道变式题..."    �?└──────────────────┬───────────────────────────�?                   �?┌──────────────────────────────────────────────�?�?        Qwen3.6-35B-A3B                        �?�?                                             �?�?  单一模型处理所有任�?                         �?�?  ├── 数学推理与解�?�?                       �?�?  ├── 苏格拉底式引�?�?                       �?�?  ├── 学术翻译 �?                            �?�?  ├── 出题举一反三 �?                        �?�?  ├── 知识点梳�?�?                          �?�?  ├── 文档摘要 �?                            �?�?  └── 多轮对话 �?                            �?└──────────────────┬───────────────────────────�?                   �?┌──────────────────────────────────────────────�?�?        响应处理                               �?�?  ├── Markdown渲染（加�?列表/代码�?           �?�?  ├── 流式输出（逐字显示�?                    �?�?  └── 历史记录存储                             �?└──────────────────────────────────────────────�?```

---

## 二、核心优�?
| 优势 | 说明 |
|------|------|
| **简�?* | 只需对接一个API，一个模型，一套配�?|
| **快速落�?* | 从Kimi切换到Qwen只需改API地址和模型名 |
| **推理能力�?* | Qwen3.6-35B-A3B的MoE架构，数学推理接近GPT-4水平 |
| **成本可控** | MoE模型只激活部分参数，推理成本低于同等规模Dense模型 |
| **上下文长** | 支持32K+上下文，足够处理完整章节+对话历史 |

---

## 三、各功能的Prompt设计

### 3.1 AI辅导 �?General Mode（直接解题）

```python
SYSTEM_PROMPT_MATH_SOLVE = """你是CogniBridge，一位英国大学数学辅导老师�?
你的任务是：
1. 基于学生上传的参考资料，直接解答数学问题
2. 给出完整、严谨的解题步骤
3. 标注知识点的出处（如"Stewart Calculus §1.4"�?4. 用简单易懂的方式解释每一�?5. 最后询问是否需要类似练习题巩固

格式要求�?- 解题步骤用编号列�?- 关键概念加粗
- 如果学生用中文提问，用中文回答；英文提问则英文回�?
参考资料：{uploaded_materials}
"""

# 调用示例
response = await qwen_api.chat({
    "model": "qwen3.6-35b-a3b",
    "messages": [
        {"role": "system", "content": SYSTEM_PROMPT_MATH_SOLVE},
        {"role": "user", "content": "求极�?lim(x�?) sin(x)/x"}
    ],
    "temperature": 0.3,
    "max_tokens": 2000,
    "stream": True
})
```

### 3.2 AI辅导 �?Deep Learning Mode（引导式�?
```python
SYSTEM_PROMPT_MATH_GUIDE = """你是CogniBridge，一位擅长苏格拉底式教学的数学辅导老师�?
核心规则�?- 绝对不要直接给出答案
- 通过提问引导学生一步步自己推导
- 每次只问一个问题，给出2-4个选项
- 学生答对 �?继续深入下一�?- 学生答错 �?不批评，换个角度重新引导
- 连续答对3�?�?加速引�?- 连续答错2�?�?提供更详细的提示

当前进度�?- 学生水平：{student_level}
- 对话轮次：{turn_count}
- 已完成步骤：{completed_steps}
"""
```

### 3.3 文档翻译

```python
SYSTEM_PROMPT_TRANSLATE = """你是学术翻译专家，专攻数学和计算机科学领域�?
任务：将以下英文翻译为中�?要求�?1. 准确传达学术含义
2. 专业术语首次出现时给出中英对�?3. 保留数学符号和公式不�?4. 符合中文学术表达习惯

格式�?**翻译**：[翻译内容]
**术语**：[术语1] = [中文]；[术语2] = [中文]
"""
```

### 3.4 AI出题（举一反三�?
```python
SYSTEM_PROMPT_QUIZ = """你是数学出题专家�?
任务：基于以下知识点，生�?道变式练习题
要求�?1. 难度递进（基础 �?中等 �?挑战�?2. 每题附完整解�?3. 考察同一知识点的不同应用场景
4. 用英文出题（适配英国大学环境�?
知识点：{knowledge_point}
学生当前水平：{student_level}
"""
```

### 3.5 文档引用问答

```python
SYSTEM_PROMPT_DOC_QA = """你是CogniBridge文档助手�?
学生从文档中选中了以下文字，请分析其核心含义并给出通俗解释�?
引用文字�?"{selected_text}"

回答要求�?1. 先总结这段文字的核心意思（1-2句）
2. 用大一新生能理解的方式解释
3. 如果涉及数学概念，联系高中知识帮助理�?4. 如有必要，给出一个具体例�?"""
```

---

## 四、API调用配置

### 4.1 阿里云百炼配�?
```yaml
# config.yaml
model:
  name: "qwen3.6-35b-a3b"
  provider: "dashscope"  # 阿里云百�?  api_key: "${DASHSCOPE_API_KEY}"
  endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

# 不同任务的参�?task_configs:
  math_solve:
    temperature: 0.2      # 低温�?= 严谨
    max_tokens: 2000
    top_p: 0.8

  math_guide:
    temperature: 0.5      # 中温�?= 有创意的引导
    max_tokens: 800
    top_p: 0.9

  translate:
    temperature: 0.1      # 极低温度 = 准确翻译
    max_tokens: 1000

  quiz_gen:
    temperature: 0.7      # 较高温度 = 多样化出�?    max_tokens: 3000

  doc_qa:
    temperature: 0.3
    max_tokens: 1500

  general_chat:
    temperature: 0.6
    max_tokens: 1000
```

### 4.2 前端调用（当前code_v2适配�?
```javascript
// 只需�?KIMI 相关配置替换�?Qwen
const QWEN_API_KEY = 'your-dashscope-api-key';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

async function qwenChat(messages, onChunk, onDone, onError) {
    const response = await fetch(QWEN_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${QWEN_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'qwen3.6-35b-a3b',
            messages: messages,
            temperature: 0.3,
            stream: true,
        }),
    });
    // ... 流式处理逻辑（与Kimi相同，OpenAI兼容格式�?}
```

---

## 五、成本估�?
| 场景 | 日调用量 | tokens/�?| 日tokens | 日成�?| 月成�?|
|------|---------|----------|---------|--------|--------|
| AI辅导解题 | 500�?| 1,500 | 75�?| ¥1.5 | ¥45 |
| 文档翻译 | 300�?| 800 | 24�?| ¥0.5 | ¥15 |
| 引导式对�?| 200�?| 2,000 | 40�?| ¥0.8 | ¥24 |
| 出题 | 100�?| 2,500 | 25�?| ¥0.5 | ¥15 |
| **总计** | | | **164�?* | **¥3.3** | **~¥99** |

---

## 六、局限性与应对

| 局�?| 影响 | 应对方案 |
|------|------|---------|
| 不能理解图片 | 无法分析几何�?函数�?| 文字描述代替（用户自己描述） |
| 不能OCR公式 | PDF中的公式截图无法识别 | PDF.js提取文字层（文字版公式可读） |
| 通用翻译不如专业模型 | 非数学领域的翻译质量一�?| 集中在数�?CS领域使用 |
| 单点依赖 | Qwen服务宕机 = 全站不可�?| 备选Kimi API作为failover |

---

## 七、迁移路径（从Kimi �?Qwen�?
```
当前：code_v2/index.html 中硬编码 Kimi API
    �?步骤1：注册阿里云百炼，获取API Key
    �?步骤2：替�?个变�?    const KIMI_KEY �?const QWEN_KEY
    const KIMI_URL �?const QWEN_URL
    model: 'moonshot-v1-8k' �?model: 'qwen3.6-35b-a3b'
    �?步骤3：调整System Prompt（可选，现有prompt也能用）
    �?完成
```

---

## 八、总结

| 维度 | 评分 | 说明 |
|------|------|------|
| 实现速度 | ⭐⭐⭐⭐�?| �?行代码即可切�?|
| 数学能力 | ⭐⭐⭐⭐�?| Qwen3数学推理顶级 |
| 成本 | ⭐⭐⭐⭐ | ~¥99/月（1000用户�?|
| 多模�?| ⭐⭐ | 不支持图片理�?|
| 可扩展�?| ⭐⭐�?| 后续可平滑迁移到多模型方�?|
| 推荐阶段 | 原型 �?早期上线 | 够用，简单，快�?|

---

*文档版本：v1.0*
*创建日期�?026�?�?0�?