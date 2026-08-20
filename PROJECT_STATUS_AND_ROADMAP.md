# 智学桥 CogniBridge — 项目进度与技术路线总览
# Project Progress & Technical Roadmap

> **用途**：新窗口/新协作者快速了解项目全貌
> **最后更新**：2026年8月17日（Dashboard 真实统计上线 + UI 重构完成）

---

## 一、项目概述

| 项目 | 内容 |
|------|------|
| **名称** | 智学桥 CogniBridge |
| **定位** | AI驱动的K12→高等数学衔接学习平台 |
| **核心问题** | A-Level数学（计算）→大学数学（证明）的认知范式断层 |
| **目标市场** | 英国高等教育（本地学生 + 国际留学生） |
| **目标用户** | Queen Mary等英国大学的STEM专业大一新生 |
| **项目负责人** | 越明 (Yueming) |

---

## 二、功能完成状态

### ✅ 已完成（可交互）

| # | 功能 | 状态 | 技术要点 |
|---|------|------|---------|
| 1 | **Pre-Assessment 前测** | ✅ 完整 | 4步流程→诊断报告→自动跳转Dashboard + 结果保存到后端数据库(assessments表) + 支持查看最新结果 |
| 2 | **Math Tutor AI辅导** | ✅ 完整 | General/Deep双模式 + Qwen3.6流式回复(Harness路由) + 上传资料引用 + 快捷示例 + 练习题生成 + A-Level知识联系按钮 + KaTeX公式渲染 + System Prompt冲突修复 + Socratic引导增强(5级脚手架) |
| 3 | **Function Plotter 函数画板** | ✅ 完整 | 2D多函数叠加 + 3D曲面 + 圆锥曲线(圆/椭圆/抛物线/双曲线) + 参数可调 |
| 4 | **Reader 文档阅读器** | ✅ 完整 | PDF.js Canvas+TextLayer(透明文字精确对齐) + PPTX解析(JSZip+图片提取) + 翻译(专用端点+语言检测)/高亮(4色+笔记+持久化)/笔记 + AI引用问答弹窗(引用修复) + 笔记面板收起/展开 + PDF自适应缩放 + 高亮自动恢复 |
| 5 | **Notes 笔记管理** | ✅ 完整 | 全屏编辑器 + 标签筛选 + localStorage持久化 + Reader笔记自动同步到Notes页面 + PDF笔记(书架Notes分类上传的PDF在笔记页显示，点击跳Reader打开，双向删除同步) |
| 6 | **Bookshelf 书架** | ✅ 完整 | 6分类(Slides/Textbooks/Exercises/Exam Papers/Research Papers/Notes) + PDF/PPTX上传 + 分类选择弹窗 + Dashboard/Bookshelf/Reader三处同步 + Notes分类与笔记页联动 |
| 7 | **Dashboard 仪表板** | ✅ 部分 | 统计卡片(真实数据: Math Proficiency←assessments, Documents Read←documents)✅ + 书架动态✅ + Math Skill Breakdown(前测后填充✅) + Study Plan(前测后填充✅) + Recent Activity(占位) |
| 8 | **AI Chat弹窗** | ✅ 完整 | 文档引用→自动分析→多轮对话 + Explain/Example/HS Link快捷按钮 + KaTeX渲染 |
| 9 | **导航系统** | ✅ 完整 | 侧边栏折叠(Notion风格) + 深色/浅色模式 + 面包屑 + 10个页面 |

### ❌ 未完成

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 1 | **Knowledge Graph 知识图谱** | ❌ 占位 | 纯placeholder |
| 2 | **Student Forum 学生论坛** | ❌ 占位 | 分类侧栏有HTML，帖子列表是placeholder |
| 3 | **Recent Activity 学习动态** | ❌ 占位 | Dashboard中占位 |
| 4 | **前端→后端数据库连接** | ✅ 已完成 | 书架/笔记/上传/Reader全量调后端API，数据持久化到SQLite |
| 5 | **用户认证(JWT)** | ✅ 已完成 | 注册/登录/游客模式/数据迁移/忘记密码/密码重置完整闭环 + apiFetch统一封装 + DB列迁移修复 |
| 6 | **User Profile 用户资料** | ✅ 已完成 | 个人资料页（姓名/大学/专业/年级/A-Level成绩/Further Math）+ 头像首字母 + 侧边栏下拉菜单（Profile/Log Out） |
| 7 | **UI 增强** | ✅ 已完成 | Lucide 图标库替代 emoji + 密码强度检测 + Dashboard 数字滚动动画 + Study Plan 拖拽删除 |

---

## 三、文件结构

```
D:\study\智学桥\
├── 产品UI\
│   ├── code_v2\
│   │   ├── index.html          ← 主应用前端（所有功能在此文件中，~1600行）
│   │   ├── server.py            ← 后端服务（FastAPI + Harness，510行）
│   │   ├── requirements.txt    ← Python依赖
│   │   ├── .env                ← API密钥（不在源码中）
│   │   ├── cognibridge.db      ← SQLite数据库
│   │   ├── uploads\            ← 文件存储目录
│   │   ├── PROJECT_STATUS_AND_ROADMAP.md ← 本文档
│   │   ├── 技术路线A_单模型方案.md
│   │   └── 技术路线B_多小模型方案.md
│   └── harness_design\
│       ├── harness_uk\               ← V2 稳定版（保留）
│       │   ├── harness_uk_math.py   ← UK数学Harness引擎 V2（628行）
│       │   ├── README.md
│       │   └── answer_corrections.json
│       ├── harness_improve\          ← V3 改进版（已上线）
│       │   ├── harness_v3.py        ← V3 主入口
│       │   ├── integration/
│       │   │   └── server_bridge.py ← V2/V3 切换桥接
│       │   ├── core/                ← 路由+知识点识别
│       │   ├── lanes/               ← Lane A/B 实现
│       │   ├── tools/               ← SymPy执行器+Notation标准化
│       │   ├── verification/        ← Proof Verifier+Step Checker
│       │   ├── models/              ← API客户端封装
│       │   ├── prompts/             ← Prompt模板
│       │   └── evaluation/          ← 基准测试报告
│       └── harness_design\         ← 原始高考Harness设计文档
├── 函数画板\
│   ├── index.html              ← 独立函数画板
│   └── code\                   ← 分类整理版
├── ui-prototype\
│   └── index.html              ← 原型版（功能最全但代码未分类）
├── 项目调研\                    ← 5份调研文档
├── 智学桥v2修改计划.pdf          ← 原始PPT计划
├── 智学桥_*.doc                 ← 各功能设计文档（15+份）
└── 智学桥_*.pptx                ← PPT幻灯片
```

---

## 四、技术架构

### 4.1 当前技术栈

| 层 | 技术 | 版本/来源 |
|----|------|----------|
| **前端框架** | Tailwind CSS | CDN |
| **图标库** | Lucide Icons | unpkg CDN |
| **PDF渲染** | PDF.js | 3.11.174 (cdnjs) |
| **PPTX解析** | JSZip | 3.10.1 (cdnjs) |
| **函数绘图** | Plotly.js | 2.35.2 (cdn.plot.ly) |
| **表达式解析** | math.js | 12.4.1 (cdnjs) |
| **公式渲染** | KaTeX | 0.16.11 (jsdelivr) |
| **后端框架** | FastAPI + uvicorn | Python 3.13 |
| **数据库** | SQLite | 内置 |
| **认证授权** | JWT (python-jose) + bcrypt (passlib) | Token有效期7天 |
| **AI模型(主力)** | Qwen3.6-35B-A3B | 阿里云百炼 |
| **AI模型(翻译)** | Qwen-Turbo | 阿里云百炼（成本更低） |

### 4.2 后端服务（server.py）

**启动方式：**
```bash
cd D:\study\智学桥\产品UI\code_v2
pip install fastapi uvicorn requests python-dotenv python-multipart
python server.py
# 运行在 http://localhost:8000
```

**API端点（12个）：**

| 端点 | 方法 | Harness | 功能 | 前端已连接？ |
|------|------|---------|------|------------|
| `/health` | GET | — | 健康检查 | ✅ |
| `/api/chat` | POST | ✅ 路由+Verifier | AI流式对话 | ✅ |
| `/api/solve` | POST | ✅ 路由+Verifier | 完整解题 | 测试通过 |
| `/api/translate` | POST | ✅ 便宜模型 | 翻译(Qwen-Turbo) + 自动语言检测 | ✅ 专用端点 |
| `/api/documents/upload` | POST | — | 上传PDF/PPTX | ✅ |
| `/api/documents` | GET | — | 列出文档 | ✅ |
| `/api/documents/{id}/file` | GET | — | 下载文件 | ✅ |
| `/api/documents/{id}` | DELETE | — | 删除文档 | ✅ |
| `/api/notes` | GET | — | 笔记列表 | ✅ |
| `/api/notes` | POST | — | 创建笔记 | ✅ |
| `/api/notes/{id}` | PUT | — | 更新笔记 | ✅ |
| `/api/notes/{id}` | DELETE | — | 删除笔记 | ✅ |
| `/api/auth/register` | POST | — | 用户注册 | 🔄 |
| `/api/auth/login` | POST | — | 用户登录 | 🔄 |
| `/api/auth/me` | GET | — | 获取当前用户 | 🔄 |
| `/api/auth/forgot-password` | POST | — | 忘记密码 | ✅ |
| `/api/auth/reset-password` | POST | — | 密码重置 | ✅ |
| `/api/highlights` | GET | — | 高亮列表 | ✅ |
| `/api/highlights` | POST | — | 创建高亮 | ✅ |
| `/api/highlights/{id}` | PUT | — | 更新高亮颜色/笔记 | ✅ |
| `/api/highlights/{id}` | DELETE | — | 删除高亮 | ✅ |

### 4.3 Harness工程（V3 已上线）

**状态**：✅ V3 已通过 `server_bridge.py` 接入 `server.py`，默认运行 V3，保留 V2 回退通道

**代码位置：**
- V3 主入口：`产品UI/harness_design/harness_improve/harness_v3.py`
- V2 稳定版：`产品UI/harness_design/harness_uk/harness_uk_math.py`（保留备份）
- 切换桥接：`产品UI/harness_design/harness_improve/integration/server_bridge.py`
- 环境控制：`产品UI/code_v2/.env` → `HARNESS_VERSION=v3`

**Harness V3 核心组件：**

| 组件 | 文件 | 功能 | 新增/改进 |
|------|------|------|----------|
| `TopicDetector` | `core/topic_detector.py` | 知识点识别（16个UK数学知识点） | ✅ 新增置信度评分 |
| `QuestionClassifier` | `core/question_classifier.py` | 题型分类（MCQ/Short/Proof/Long/Multi） | ✅ 新增 |
| `SmartRouter` | `core/router.py` | 智能路由（Lane A/B 决策） | ✅ 多信号综合决策 |
| `LaneA` | `lanes/lane_a.py` | 单样本快速求解 | 🔄 重构 |
| `LaneB` | `lanes/lane_b.py` | 多样本投票 + ToRA工具调用 | ✅ 新增ToRA模式 |
| `SymPyExecutor` | `tools/sympy_executor.py` | 安全执行Python/SymPy代码 | ✅ 新增 |
| `NotationMapper` | `tools/notation_mapper.py` | UK数学符号标准化 | ✅ 新增 |
| `ProofVerifier` | `verification/proof_verifier.py` | 证明结构完整性检查 | ✅ 新增 |
| `StepChecker` | `verification/step_checker.py` | 中间步骤符号验证 | ✅ 新增 |
| `APIClient` | `models/api_client.py` | 统一API调用（重试/超时/流式） | 🔄 重构 |

**Harness V3 数据流：**
```
用户提问
    ↓
TopicDetector → 识别知识点（带置信度）
    ↓
QuestionClassifier → 识别题型（Proof/MCQ/Short/Long）
    ↓
SmartRouter → 综合决策（弱项+题型+长度+历史）
    ↓
    ├── Lane A（简单题）→ 单样本调用 → 快速返回
    └── Lane B（复杂题）→ 多样本投票 + ToRA工具调用
            ↓
        SymPy执行器验证中间计算
            ↓
        ProofVerifier检查证明结构（归纳法/ε-δ/反证）
            ↓
        NotationMapper标准化答案格式
    ↓
返回前端（附路由原因+验证报告）
```

**V3 vs V2 基准测试（55题 UK 高等教育数学）：**

| 指标 | V2 | V3 | 提升 |
|------|-----|-----|------|
| **整体正确率** | 74.6% | **89.1%** | +14.5pp |
| **证明题正确率** | 0% | **87.5%** | +87.5pp |
| **Token消耗** | 495K | 304K | -38% |
| **平均延迟** | 45.1s | 24.4s | -46% |

**关键提升点：**
- **证明题**：从 0/8 到 7/8，Proof Verifier 强制检查证明结构（Base case/Inductive step/Conclusion）
- **符号计算**：ToRA 工具调用让模型写 Python/SymPy 验证积分/矩阵运算
- **智能路由**：Confidence-based Routing 减少误判，比 V2 省 38% Token

### 4.4 Pipeline架构（设计中）

Pipeline层封装Harness，提供任务特定的前后处理：

| Pipeline | 任务 | Harness调用 | 后处理 |
|----------|------|-----------|--------|
| MathSolvePipeline | 直接解题 | solve_question() | +知识点出处 +易懂解释 +练习题 +A-Level联系 |
| MathGuidePipeline | 引导解题 | 内部解题(不展示) | →生成引导问题 →评估学生回答 |
| TranslationPipeline | 翻译 | 直调便宜模型 | +术语提取 +中外差异标注 |
| QuizGenPipeline | 出题 | 基于topic | →生成3道变式题 |
| ReadingQAPipeline | 文档问答 | 直调模型 | →引用文字分析 |

**相关文档：**
- `技术路线A_单模型方案.md` — 单模型(Qwen3.6)方案
- `技术路线B_多小模型方案.md` — 多模型(Harness+Pipeline)方案
- `智学桥_AI辅导双模式功能说明.doc` — General/Deep双模式

---

## 五、AI API配置

### 主力模型
```
模型：qwen3.6-35b-a3b（阿里云百炼）
端点：https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
密钥：存储在 .env 文件中（DASHSCOPE_API_KEY=sk-ws-...）
```

### 翻译模型（成本减半）
```
模型：qwen-7b-instruct
用途：翻译任务（不需要大模型推理能力）
成本：¥0.001/千tokens（主力模型的一半）
```

### 前端配置
```javascript
// code_v2/index.html 第962-963行
const AI_BACKEND_URL = 'http://localhost:8000';
const USE_BACKEND = true;  // ✅ 走后端Harness
```

### 备选Fallback
```javascript
// 后端不可用时自动降级为直连Qwen API
// Fallback密钥在前端kimiCallFallback()函数中
```

---

## 六、数据库设计

### SQLite（cognibridge.db）

```sql
-- 文档表（书架）
documents(
    id TEXT PRIMARY KEY,
    title TEXT,           -- 文档标题
    filename TEXT,        -- 原始文件名
    file_path TEXT,       -- 服务器存储路径
    category TEXT,        -- slides/textbooks/exercises/exam-papers/research-papers
    source TEXT,          -- upload
    file_size INTEGER,    -- 字节数
    file_type TEXT,       -- pdf/pptx
    created_at TEXT
)

-- 笔记表
notes(
    id TEXT PRIMARY KEY,
    title TEXT,
    tag TEXT,             -- 标签(如Calculus, Reading Note)
    content TEXT,
    source TEXT,          -- manual/reader
    created_at TEXT,
    updated_at TEXT
)
```

### 当前完整数据库 Schema
```sql
-- 用户表（JWT认证）
users(
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    university TEXT DEFAULT 'Queen Mary University of London',
    major TEXT DEFAULT 'Computer Science',
    year TEXT DEFAULT 'freshman',
    a_level_grade TEXT,
    further_math INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)

-- 密码重置表（忘记密码方案A占位）
password_resets(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
)

-- 文档表（书架）— 已扩展 user_id
 documents(
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT DEFAULT 'upload',
    file_size INTEGER DEFAULT 0,
    file_type TEXT DEFAULT 'pdf',
    created_at TEXT DEFAULT (datetime('now'))
)

-- 笔记表 — 已扩展 user_id
 notes(
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    title TEXT DEFAULT '',
    tag TEXT DEFAULT '',
    content TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
)

-- 前测结果表
assessments(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    knowledge_json TEXT,
    transition_json TEXT,
    quiz_correct INTEGER,
    quiz_total INTEGER,
    avg_score INTEGER,
    weak_topics TEXT,
    strong_topics TEXT,
    danger_topics TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)

-- 学习计划表
study_plans(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    plan_json TEXT,
    progress_json TEXT,
    week_number INTEGER DEFAULT 1,
    last_updated TEXT DEFAULT (datetime('now'))
)

-- 高亮表（Reader文本高亮）
highlights(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    document_id TEXT NOT NULL REFERENCES documents(id),
    page INTEGER NOT NULL,
    text TEXT NOT NULL,
    color TEXT DEFAULT '#faad14',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
)
```

---

## 七、用户系统技术路线（实施中）

### 7.1 核心决策

| 项目 | 决策 | 说明 |
|------|------|------|
| **认证方式** | JWT（单Token） | 无状态，FastAPI原生支持，未来前后端分离/移动端复用 |
| **Token有效期** | 7天 | 英国学生讨厌频繁登录，教育场景安全性要求适中 |
| **注册字段** | 邮箱 + 密码 + 姓名（3个） | 最小化注册流程，<10秒完成 |
| **密码策略** | ≥6位，至少1字母+1数字 | 强度提示但不强制，符合英国学生习惯 |
| **游客模式** | ✅ 允许 | 数据存localStorage，登录后自动迁移到后端 |
| **文档上传** | 游客禁止 | 提示"登录后保存到云端" |
| **邮箱验证** | ❌ 不验证 | 注册立即可用，先让用户进来体验 |
| **忘记密码** | 方案A（占位） | 后端生成重置Token打印到控制台，用户手动复制链接 |
| **用户头像** | 姓名首字母 | 如"Y"，不上传图片 |

### 7.2 游客模式 vs 登录用户

| 功能 | 游客（Guest） | 登录用户 |
|------|--------------|----------|
| AI辅导（Math Tutor） | ✅ 可用 | ✅ 可用 |
| 函数画板 | ✅ 可用 | ✅ 可用 |
| Reader阅读器 | ✅ 可用 | ✅ 可用 |
| 创建笔记 | ✅ 存localStorage | ✅ 存后端数据库 |
| 上传PDF/PPTX | ❌ 禁止 | ✅ 存后端+磁盘 |
| 前测诊断 | ✅ 存localStorage | ✅ 存后端数据库 |
| 学习进度 | ✅ 存localStorage | ✅ 后端持久化 |
| 多设备同步 | ❌ 无 | ✅ 刷新后从后端加载 |
| 数据安全 | ⚠️ 刷新/清缓存丢失 | ✅ 云端持久 |

### 7.3 数据迁移流程

```
游客使用 → 点击"Save Progress"或访问Dashboard
    ↓
弹出提示："Sign in to save your progress permanently"
    ↓
登录/注册成功
    ↓
自动迁移：localStorage(cb_notes_guest + cb_pretest + cb_plan)
    ↓
POST /api/notes  (每条笔记)
POST /api/assessments  (前测结果)
    ↓
清理游客数据 → 刷新页面 → 从后端加载
```

### 7.4 新增后端依赖

```text
python-jose[cryptography]   # JWT生成与验证
passlib[bcrypt]             # 密码哈希（bcrypt）
```

### 7.5 实施阶段

| 阶段 | 任务 | 预估工作量 |
|------|------|-----------|
| Phase 1 | 后端：JWT工具 + users/password_resets表 + 注册/登录/忘记密码API | 2h |
| Phase 2 | 后端：现有API加get_current_user + user_id过滤 | 1h |
| Phase 3 | 后端：assessments/study_plans表 + API | 1h |
| Phase 4 | 前端：page-login + page-forgot-password UI | 2h |
| Phase 5 | 前端：apiFetch封装 + 现有fetch替换 + Sidebar改造 | 1.5h |
| Phase 6 | 前端：游客数据迁移 + 路由守卫 + 密码强度 | 1.5h |
| **总计** | | **约9小时** |

---

## 八、关键调研数据

### 英国教育市场
- EdTech市场：1123家企业，15亿英镑，年增8.8%
- 中国留学生：15-18万人
- 67%学生需要AI但仅36%受训(Jisc n=15,398)
- 51%担忧AI错误答案(HEPI n=1,041)

### 四维断层模型
1. **认知范式断层**：从"用机器"到"造机器"（计算→证明）
2. **前置知识断层**：基础知识漏洞（A-Level Further Maths非必修）
3. **教学方式脱节**：抽象轰炸（ε-δ定义第一课就来）
4. **情绪心理障碍**：冒名顶替综合征（"我是不是不适合学数学"）

### 政策背书
- DfE《Generative AI in Education》(2025.8更新)
- DfE《Post-16 Education White Paper》(2025.10)：数学断层是升学最大障碍
- 英国《International Education Strategy 2026》

---

## 八、PPT制作进度

### 已完成
- ✅ 故事引入幻灯片（灵感起源，含英文标注版）
- ✅ 营销策略幻灯片（核心推广渠道，含英文标注版）
- ✅ 社会价值幻灯片（v4，四柱横向流程，含彩色光晕）

### 待制作
- ⬜ 产品功能介绍
- ⬜ 技术架构(Harness+Pipeline)
- ⬜ 团队介绍
- ⬜ 商业模式
- ⬜ 融资计划

---

## 九、修复与变更记录

### 2026-08-17：deepseek 分支同步合并

| # | 变更 | 说明 |
|---|------|------|
| 1 | **UI 全面重构** | Lucide Icons 替代 emoji（更专业统一）；Notion 风格配色（低饱和度暖灰）；Dashboard 数字滚动动画（count-up）；Study Plan 拖拽删除 |
| 2 | **User Profile 新增** | 个人资料页（编辑姓名/大学/专业/年级/A-Level成绩/Further Math）；侧边栏用户信息下拉菜单（Profile / Log Out）；头像首字母自动生成 |
| 3 | **密码强度检测** | 注册页实时显示密码强度（Weak/Medium/Strong），要求 ≥6 位 + 至少 1 字母 + 1 数字 |
| 4 | **页面访问控制** | `LOGIN_REQUIRED_PAGES` / `LOGIN_RECOMMENDED_PAGES` 机制，未登录用户访问受限页面时提示登录 |
| 5 | **游客数据迁移** | `migrateGuestData()` 函数：登录后自动将 `localStorage` 中的游客笔记迁移到后端数据库 |
| 6 | **Dashboard 真实统计** | 后端新增 `GET /api/stats` 端点；Math Proficiency 读取 `assessments.avg_score`，Documents Read 读取 `documents` 表计数；前端 `loadUserStats()` 初始化时拉取并触发动画 |
| 7 | **AI Chat 弹窗拖拽** | Reader AI Chat 弹窗 Header 区域支持拖拽移动，实现边读边问 |
| 8 | **品牌统一** | Math Tutor / Reader AI Chat 中移除 Qwen 模型名显示，统一为 "CogniBridge AI" |
| 9 | **书架 Notes 分类 + PDF 笔记同步** | 书架新增第6分类 Notes；上传到该分类的 PDF 自动出现在笔记页（PDF 徽章卡片，点击跳 Reader 打开）；删除双向同步（笔记页硬删除→书架同步消失；书架回收站/恢复/永久删除→笔记页实时联动） |

### 2026-08-13 ~ 2026-08-14：修复迭代

### 9.1 Bug 修复

| # | 问题 | 根因 | 修复方案 |
|---|------|------|---------|
| 1 | **SSE `list index out of range` 崩溃** | Qwen3.6 thinking 模式下 API 返回 `choices: []` 空数组，后端 `choices[0]` 抛异常 | 后端加空数组保护 `event.get("choices", [])`，`req.messages[-1]` 做空数组保护 |
| 2 | **System Prompt 冲突** | 前端 `tutorSend` 硬编码旧 Prompt 与后端新 Prompt 同时发给模型，导致 AI 混合格式 | 后端 `/api/chat` 过滤掉前端传来的 `system` 消息；前端 Deep 模式 sysMsg 精简为纯身份声明 |
| 3 | **Reader AI Chat 引用丢失** | 引用文本放进了 `system` message，被后端过滤 | 引用文本移到 `user` message 中发送 |
| 4 | **翻译功能失效** | 前端直接调用 `/api/chat` 翻译浪费 token；后端翻译模型 `qwen-7b-instruct` 已不存在 | 前端改用 `/api/translate` 专用端点；后端新增自动语言检测 + 中英互翻 + 改用 `qwen-turbo` |

### 9.2 安全修复

| # | 问题 | 修复 |
|---|------|------|
| 1 | 前端硬编码 `FALLBACK_KEY` | ❌ 已删除，Fallback 直接报错提示用户检查后端 |
| 2 | XSS 漏洞 | `escapeHtmlTutor`/`escapeHtml` 补充 `"` 和 `'` 转义，应用到所有 `innerHTML` 插入点 |
| 3 | 文件下载越权 | `get_document_file` 改为 `if not current_user or row["user_id"] != current_user["id"]` |
| 4 | 文件上传路径遍历 | 加 `os.path.basename` + `commonpath` 校验 + 50MB 限制 |

### 9.3 功能增强

| # | 功能 | 说明 |
|---|------|------|
| 1 | **Auth 闭环修复** | 后端 `init_db()` 加 `_ensure_column` 幂等迁移（补 `user_id` + 回填旧数据）；前端 10 处裸 `fetch()` 替换为 `apiFetch()`，增强 `apiFetch` 支持 `FormData` |
| 2 | **Socratic 引导增强** | 重写 `SYSTEM_PROMPT_GUIDE`（Diagnose→Strategy→Intent 决策流程、6 种教学手法、5 级脚手架、学生信号识别）；前端 Deep 模式新增 `💡 Need a hint` / `🆘 I am stuck` 按钮 |
| 3 | **Reader Highlight（全新）** | 后端新增 `highlights` 表 + 4 个 API 端点；前端颜色选择器（4 色）+ 可选笔记 + 侧边栏列表 + 点击跳转 + 持久化（后端+localStorage 双备份）+ 自动恢复 |

---

## 十、后续开发优先级

### 已完成（本次迭代）

| 优先级 | 功能 | 状态 |
|--------|------|------|
| 🔴 **P0** | **用户认证(JWT) + 游客模式** | ✅ 已完成 |
| 🔴 **P0** | **前端连接后端** | ✅ 已完成 |
| 🔴 **P0** | **Harness V3（ToRA+Proof Verifier）** | ✅ 已上线 |
| 🔴 **P0** | **Dashboard 统计卡片真实数据** | ✅ 已完成（Math Proficiency + Documents Read） |
| 🔴 **P0** | **前测结果存数据库** | ✅ 已完成（POST /api/assessments + GET /api/assessments/latest） |
| 🟡 **P1** | **UI 重构（deepseek 分支）** | ✅ 已完成（Lucide/Profile/密码强度/拖拽） |

### 待完成

| 优先级 | 功能 | 状态 | 预估工作量 | 阻塞/说明 |
|--------|------|------|-----------|----------|
| 🟡 **P1** | **Knowledge Graph** | ❌ 占位 | 3-5天 | 纯 placeholder，需设计节点关系 + D3.js/vis.js 渲染 |
| 🟡 **P1** | **Student Forum** | ❌ 占位 | 3-5天 | 分类侧栏有 HTML，帖子列表是 placeholder，需后端帖子/评论/点赞表 |
| 🟡 **P1** | **Recent Activity** | ❌ 占位 | 2天 | Dashboard 中 placeholder，需记录用户行为日志 |
| 🟢 **P2** | **Problems Solved 计数** | ❌ 未做 | 2天 | Math Tutor 每次完成对话时 +1，需新增 `user_stats` 表或扩展 users 表 |
| 🟢 **P2** | **Day Streak 连续登录** | ❌ 未做 | 2天 | 需记录每日登录日期，计算连续天数 |
| 🟢 **P2** | **忘记密码（真实邮件）** | ❌ 未做 | 1天 | 当前仅打印 token 到控制台，需接入 SendGrid/Resend |
| 🟢 **P2** | **Google OAuth登录** | ❌ 未做 | 半天 | 需注册 Google Cloud OAuth 应用 |
| 🟢 **P2** | **Harness V3 持续优化** | 🔄 迭代中 | 持续 | 证明题准确率已达 87.5%，可继续优化其他 topic |
| 🔵 **P3** | **自适应学习画像** | ❌ 未做 | 1周 | 基于学生行为数据（阅读/解题/高亮）动态调整学习路径 |
| 🔵 **P3** | **AI 联动画板** | ❌ 未做 | 2天 | Math Tutor 输入函数公式，自动调用 Plotter 渲染 |
| 🔵 **P3** | **Harness 扩展多学科** | ❌ 未做 | 2周 | 当前仅数学，需重写 TopicDetector/Prompt/Verifier 以支持物理/CS |

### 已完成里程碑

| 日期 | 里程碑 | 说明 |
|------|--------|------|
| 2026-08-12 | Harness V3 上线 | 55题基准测试：V3 89.1% vs V2 74.6%，证明题 0%→87.5% |
| 2026-08-14 | 修复迭代 + Reader高亮上线 | SSE崩溃修复 + System Prompt冲突修复 + 安全加固(XSS/权限) + 翻译重构(qwen-turbo) + Reader高亮持久化(4色+笔记+后端同步) |
| 2026-08-17 | deepseek 分支 UI 重构合并 | Lucide图标替代emoji + User Profile页面 + 密码强度检测 + Dashboard动画 + Study Plan拖拽 + 游客数据迁移 |

---

## 十、新窗口快速上手

### 1. 启动后端
```bash
cd D:\study\智学桥\产品UI\code_v2
pip install -r requirements.txt
python server.py
# 后端运行在 http://localhost:8000
# Harness V3 自动启用（ToRA+Proof Verifier+Smart Routing+完整UK Math Harness）
# 如需回退到 V2：修改 .env → HARNESS_VERSION=v2，重启服务
```

### 环境变量配置（`.env`）
```bash
DASHSCOPE_API_KEY=sk-ws-...       # 阿里云百炼API密钥
MODEL=qwen3.6-35b-a3b              # 主力模型
TRANSLATE_MODEL=qwen-turbo         # 翻译模型（成本更低）
SECRET_KEY=your-secret-key         # JWT签名密钥（生产环境必须修改）
HARNESS_VERSION=v3                 # Harness版本：v3(默认) 或 v2(回退)
PORT=8000
HOST=0.0.0.0
```

### 2. 打开前端
```bash
# 浏览器打开
D:\study\智学桥\产品UI\code_v2\index.html
# 前端 USE_BACKEND=true → 自动调后端
```

### 3. 核心文件
```
前端代码：    D:\study\智学桥\产品UI\code_v2\index.html
后端代码：    D:\study\智学桥\产品UI\code_v2\server.py
Harness V3： D:\study\智学桥\产品UI\harness_design\harness_improve\harness_v3.py
Harness V2： D:\study\智学桥\产品UI\harness_design\harness_uk\harness_uk_math.py
切换桥接：   D:\study\智学桥\产品UI\harness_design\harness_improve\integration\server_bridge.py
数据库：     D:\study\智学桥\产品UI\code_v2\cognibridge.db
环境变量：   D:\study\智学桥\产品UI\code_v2\.env
调研文档：   D:\study\智学桥\项目调研\
PPT文件：    D:\study\智学桥\智学桥_*.pptx
```

### 4. 用户信息
```
项目用户名：越明 (Yueming)
学校：Queen Mary University of London
专业：信息与计算科学 / Computer Science
```

### 5. 模型配置
```
主力模型：Qwen3.6-35B-A3B（阿里云百炼）
翻译模型：Qwen-Turbo（成本更低）
思考模式：enable_thinking=True（已开启）
Harness版本：V3（默认）/ V2（回退）
API密钥：.env文件中 DASHSCOPE_API_KEY
```

---

*最后更新：2026年8月17日*
*版本：code_v2 + server.py + harness_v3.py（Harness V3 + deepseek UI 重构）*
*状态：功能迭代阶段（前端 UI 重构完成，用户认证+资料页完成，Harness V3 已接入）*