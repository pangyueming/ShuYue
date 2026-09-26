---
name: weekly-review
description: 周复习导学。当学生说"这周该复习什么/帮我安排复习"时激活。基于知识图谱弱项+学习进度+SRS，生成分日复习计划。
label: 周复习
---

# 周复习导学 (Weekly Review)

## 铁律
- **必须先调 get_knowledge_map 和 get_study_state**，基于真实数据规划。
- 复习计划要具体到"哪天做什么"，不说空话。
- 结合学生当前教学周（大学课程进度）。

## 数据依赖
- **必需**：前测数据 + 当前教学周
- **推荐**：有 quiz 历史和计划进度（数据越全，计划越准）
- 工具链：`get_knowledge_map + get_study_state → 生成分日计划`
- 缺前测 → "先做个3分钟诊断" + start_assessment

## 生成流程

### 第一步：综合状态
```
调 get_knowledge_map → weak_topics, current_week
调 get_study_state → plan_progress, recent_quizzes, vocab_count
```

### 第二步：匹配教学进度
```
当前教学周 = N → 本周课程涉及的主题
匹配规则：
  week 1-4 → 数列极限/函数极限/连续
  week 5-8 → 导数/中值定理/积分
  week 9-12 → 行列式/矩阵/向量空间
  week 13-16 → 级数/多元/复习
```

### 第三步：生成分日计划
```
每周 5 个学习日 + 2 个复习日：
  周一/周三：本周新课预习（结合教材）
  周二/周四：弱项突破（结合图谱）
  周五：综合练习（generate_quiz 验证）
  周六：错题复盘 + SRS 术语复习
  周日：休息或轻度浏览
```

## 输出格式

```markdown
# 📅 本周复习计划（第N周）

## 本周焦点
- 课程进度：第N周 — [主题]
- 你的弱项：A、B | 断层：C

## 分日安排
| 日期 | 主题 | 具体任务 | 预计时间 |
|------|------|---------|:---:|
| 周一 | 预习ε-δ | 读教材§2.1 + 做3道理解题 | 45min |
| 周二 | 弱项：数列 | generate_quiz(数列, 5题) | 30min |
| 周五 | 综合练习 | generate_quiz(Mixed, 10题) | 50min |
| 周六 | 复习巩固 | 术语复习 + 公式速查 | 20min |

## 💡 提示
- 你的计划任务「XX」已完成，继续保持
- 词汇量 N 个 — 本周新增目标 10 个
```

## 边界
- 与 exam-prep 的区别：exam-prep 是短期冲刺（N天），weekly-review 是常态周计划。
- 学生同时问"快考试了+这周复习什么" → 优先 exam-prep。
