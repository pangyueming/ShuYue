# 智学桥 CogniBridge — 项目进度与技术路线总览
# Project Progress & Technical Roadmap

> **用途**：新窗口/新协作者快速了解项目全貌
> **最后更新**：2026年9月12日（Aurora Glass 模块化前端上线 + 真实 Day Streak + 后端启动容错；详见 #25-27）

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
| 2b | **AI Quiz 智能出题** | ✅ 完整 | 可验证出题流水线：服务端Prompt模板(强制JSON+LaTeX包裹+均匀答案分布) → **Harness交叉验证**(Lane A 并行解题+AnswerVerifier比对，单题45s超时) → **选项随机打乱**(破除LLM位置偏差，保护None-of-above) → 答题判分(MCQ比对/填空SymPy本地判分+turbo兜底，$定界符自动剥离) → 结果入库。题型MCQ+填空，题数1-15自定义，弱项自动预选(💡)，答案不下发前端(QUIZ_CACHE暂存)，题目/选项/解析KaTeX渲染。联动Problems Solved统计 |
| 3 | **Function Plotter 函数画板** | ✅ 完整 | 2D多函数叠加 + 3D曲面 + 圆锥曲线(圆/椭圆/抛物线/双曲线) + 参数可调 |
| 4 | **Reader 文档阅读器** | ✅ 完整 | PDF.js Canvas+TextLayer(透明文字精确对齐) + PPTX解析(JSZip+图片提取) + 翻译(专用端点+语言检测)/高亮(4色+笔记+持久化)/笔记 + AI引用问答弹窗(引用修复) + 笔记面板收起/展开 + PDF自适应缩放 + 高亮自动恢复 + **MinerU 扫描件AI重排**（详见第2.5节） |
| 5 | **Notes 笔记管理** | ✅ 完整 | 全屏编辑器 + 标签筛选 + localStorage持久化 + Reader笔记自动同步到Notes页面 + PDF笔记(书架Notes分类上传的PDF在笔记页显示，点击跳Reader打开，双向删除同步) |
| 6 | **Bookshelf 书架** | ✅ 完整 | 6分类(Slides/Textbooks/Exercises/Exam Papers/Research Papers/Notes) + PDF/PPTX上传 + 分类选择弹窗 + Dashboard/Bookshelf/Reader三处同步 + Notes分类与笔记页联动 |
| 7 | **Dashboard 仪表板** | ✅ 部分 | 统计卡片(真实数据: Math Proficiency←assessments, Documents Read←documents)✅ + 书架动态✅ + Math Skill Breakdown(前测后填充✅) + Study Plan(前测后填充✅) + Recent Activity(占位) |
| 8 | **AI Chat弹窗** | ✅ 完整 | 文档引用→自动分析→多轮对话 + Explain/Example/HS Link快捷按钮 + KaTeX渲染 |
| 9 | **导航系统** | ✅ 完整 | 侧边栏折叠(Notion风格) + 深色/浅色模式 + 面包屑 + 10个页面 |

### ❌ 未完成

### 2.5 ✅ MinerU 扫描教材 AI 重排（2026-09-05 上线，code_v2）

**解决的核心问题**：英国大学教材大量为扫描版 PDF（图片无文本层）——划词翻译/高亮/笔记/AI引用问答全部失效。

**架构**（BYOT：用户自带 MinerU Token，平台承担嵌入/问答费用）：

```
上传 PDF ──判断器(pypdf抽样5页,均值<30字符=扫描件)──┬─ 原生文本PDF → 现有PDF.js路径（MinerU全程隐身）
                                                    └─ 扫描件 → 弹门户征询（上传时即问，不等阅读时）
         用户 Enable（首次引导注册 mineru.net + 存API Key）→ 后台队列解析
         MinerU云端(用户自己的Key,2000页/天) → 分卷≤190页 → content_list(带page_idx)
         → 分块600字 → SQLite FTS5 trigram + DashScope text-embedding-v4 → RRF混合检索
         → 阅读器重排版视图（标题分级/KaTeX公式/表格成型/—Page N—分隔）
         → 划词/翻译/高亮/笔记全部复活
         → Chat AI 沿用页面上下文模式：重排版每页自带 dataset.text，
           扫描书的页面级 AI 问答与原生 PDF 体验一致
         → 完成通知：全局10秒追踪器 + 强制确认弹窗（Open Book/OK），任意页面可达
```

**新增文件**：`code_v2/mineru_client.py`（云端解析客户端：分卷/提交/轮询/合并，page_idx 偏移）、`code_v2/rag.py`（分块/FTS5/嵌入/RRF检索/引用问答，英文提示词 [Page N] 格式）

**server.py 变更**：
- `init_db` 增列迁移：documents +needs_ocr/ai_declined/parse_status/parse_error；users +mineru_token_enc；新表 doc_chunks/chunks_fts(trigram)/doc_embeddings（旧库无感升级）
- 上传：50MB→200MB；内置扫描件判断器
- 后台单线程解析队列（SystemExit 不再杀死 worker）；逐卷重试×3
- 新端点×8：PUT/GET `/api/user/mineru-token`（Fernet加密存 `.mineru_secret` 派生密钥，只写不读）、GET `/api/documents/parsing`、POST `/api/documents/{id}/parse`、GET `/parse`、POST `/decline-ai`、GET `/pages/{n}`（结构化块：标题级别/公式LaTeX/表格HTML/bbox）

**前端变更（index.html）**：
- Reader：解析完成的书默认打开**重排版视图**（docview：惰性渲染/页分隔线/KaTeX），工具栏 `📄 Original Pages ⇄ 📝 Reformatted` 切换；原书页模式对扫描页注入 bbox 透明文本层（划词生态复活）；`✨ Enable AI` 常驻反悔入口
- Chat AI：沿用原有**页面上下文模式**（不接整书检索）——重排版视图与 bbox 覆盖层都为扫描页提供 dataset.text，页面级问答对扫描书同样可用
- 书架/Dashboard 卡片：`Read + ✨ MinerU` 双按钮、状态徽章（⏳解析中/✅ MinerU parsed/⚠️ Parsing failed）、悬停✨（Dashboard）、绿色 MinerU 徽章
- 门户三态弹窗（引导→征询→进度）+ 全局追踪器 + 完成强制确认弹窗

**实时进度（v2 迭代）**：
- `GET /api/documents/parsing` 返回每个任务的 `phase/pages_done/total_pages` 实时进度
- 书架卡片：标题下方橙色**进度条**（百分比 + `x/y pages`）；建索引阶段为流动动画条
- Dashboard 卡片：底部 3px 细进度条 + 右下角百分比角标
- 全局追踪器每 10 秒按 `data-mineru-progress` 标记**原位更新**进度元素（不整格重渲染，悬停状态不闪）
- 完成时序：弹窗弹出时进度条停在最后状态 → 用户点 `OK`/`Open Book` 确认后才翻绿徽章（严格"确认后消失"）

**API Key 三层防护（v3 迭代）**：
1. **保存时活体校验**：`PUT /api/user/mineru-token` 先格式预检，再向 MinerU 发轻量探针（GET 不存在的 batch id：401/403=坏 Key 拒存，其他=有效；网络异常宽松放行）；前端 Save 按钮 "Validating key…" 状态 + 被拒红字提示
2. **解析中快速失败**：`MineruAuthError` 专用异常（401/403 触发），**不吃 3 次重试**直接 failed，状态返回 `error_type:'auth'` + 人性化文案
3. **一键修复回路**：auth 失败 UI（进度弹窗/确认弹窗）→「Update MinerU Key」直达换 Key 页（走活体校验）→ 保存成功 →「↻ Retry Parse」一键续解析，**分卷缓存保护已完成的卷不重烧额度**

**容错与恢复（v3 迭代）**：
- **防重复征询**：门户打开先查当前状态——解析中直接进进度页，已完成直接进重排版（不再反复问"要不要 Enable"）
- **孤儿恢复**：服务器重启后 `_resume_orphaned_parses()` 自动把中断任务重新入队；`trigger_parse` 检测"DB 显示进行中但 worker 无记录"也会重入队
- **分卷缓存**：每卷解析结果落盘 `partXX.content_list.json`，重试/重启只补失败卷
- **content_list 短路**：若最终产物已存在，跳过 MinerU 直接重建索引（quota 零消耗）——曾靠此机制避免了 465 页的重复解析

**依赖**：requirements.txt + `pypdf`、`cryptography`（Anaconda base 已装）

**数据目录**：`code_v2/mineru_data/{doc_id}/`（content_list.json / pages.json / parts/ 及分卷缓存）

**已知边界**：MinerU 单文件 200 页限制（服务端自动分卷）；公式识别质量需人工抽查（推荐 preview 对照法）；FTS5 trigram 需 SQLite≥3.34（现环境 3.51 ✓）；删除文档时同步清理解析数据与索引；同一 PDF 重复上传会各自独立解析（MinerU 云端疑似按文件去重，实测同文件 42 秒返回）。

**备份**：`code_v2/backup_mineru_20260905_2100/`（集成前原始 server.py / index.html / requirements.txt / cognibridge.db）

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 1 | **Knowledge Graph 知识图谱** | ❌ 占位 | 纯placeholder |
| 2 | **Student Forum 学生论坛** | ❌ 占位 | 分类侧栏有HTML，帖子列表是placeholder |
| 3 | **Recent Activity 学习动态** | ❌ 占位 | Dashboard中占位 |
| 4 | **前端→后端数据库连接** | ✅ 已完成 | 书架/笔记/上传/Reader全量调后端API，数据持久化到SQLite |
| 5 | **用户认证(JWT)** | ✅ 产品级 | 注册/登录/游客模式/数据迁移/忘记密码/密码重置完整闭环 + apiFetch统一封装 + **全量数据云端同步**(前测result_json整包/学习计划状态/书架/笔记/高亮/答题记录) + **登出内存清零**(换账号零残留) + **SECRET_KEY首次自动生成持久化**(部署唯一) + 换设备登录即恢复 |
| 6 | **User Profile 用户资料** | ✅ 已完成 | 个人资料页（姓名/大学/专业/年级/A-Level成绩/Further Math）+ 头像首字母 + 侧边栏下拉菜单（Profile/Log Out） |
| 7 | **UI 增强** | ✅ 已完成 | Lucide 图标库替代 emoji + 密码强度检测 + Dashboard 数字滚动动画 + Study Plan 拖拽删除 |

---

## 三、文件结构

```
D:\study\智学桥\
├── 产品UI\
│   ├── code_v2\
│   │   ├── index.html          ← 应用外壳（56KB，引用 app/styles 模块）【2026-09-12 起】
│   │   ├── index-legacy.html   ← 旧单文件前端备份（355KB 全功能版）
│   │   ├── app\                ← 16 个 JS 模块 + vendor\ 特效引擎（246 函数）
│   │   │   ├── auth.js         ← 登录/注册/JWT + apiFetch（AI_BACKEND_URL 在此）
│   │   │   ├── router.js/cmdk.js ← Hash 路由 + ⌘K 命令面板
│   │   │   ├── tutor.js/quiz.js/pretest.js/notes.js/plotter.js
│   │   │   ├── bookshelf.js/reader.js/reader-notes.js/dashboard.js/ui.js/init.js
│   │   │   ├── mineru.js       ← MinerU 门户/追踪器/配额/docview 渲染
│   │   │   └── vendor\         ← BorderBeam/LiquidGooey/ThinkingOrb 等 6 特效
│   │   ├── styles\             ← tokens/base/legacy/components/pages 5 个 CSS
│   │   ├── server.py            ← 后端服务（FastAPI + Harness，~2500行）
│   │   ├── rag.py / mineru_client.py ← RAG 检索层 / MinerU 云端客户端
│   │   ├── requirements.txt    ← Python依赖
│   │   ├── .env                ← API密钥（不在源码中）
│   │   ├── cognibridge.db      ← SQLite数据库（业务 + RAG 知识库同库）
│   │   ├── uploads\ / mineru_data\ ← 文件存储 / 解析产物
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
| 10 | **Reader Chat AI（页面上下文自由问答）** | Reader 工具栏新增 ✨Chat AI 按钮；自动捕获当前页文本(≤2000字符)注入首条用户消息；蓝色上下文条标识；无文档时降级普通聊天；与引用模式互不干扰 |
| 11 | **AI 回复渲染增强** | 聊天气泡 markdown 渲染补齐：#~#### 标题、有序列表、**表格**(对齐解析/自适应深浅色/超宽横向滚动/流式安全)，Math Tutor 与 AI Chat 双端同步生效 |
| 12 | **AI Quiz 智能出题（实施中）** | 三段式可验证出题流水线 GENERATE→VERIFY→GRADE；Harness 交叉验证确保题目答案正确；填空题本地 SymPy 判分零 token；quiz_results 入库 + Problems Solved 统计联动 |
| 13 | **完整用户系统（产品级）** | 前测 result_json 整包云端存取（零失真跨设备恢复）；学习计划状态 GET/PUT /api/plan 云同步（防抖1s）；authLogout 内存全清（换账号零残留）；SECRET_KEY 首次自动生成持久化 .env；登录管线统一（书架→笔记→计划→前测→统计）；双账号隔离实测通过 |
| 14 | **课程对齐型衔接计划（全新）** | 16周双轨时间轴（📐数学分析/🔢高等代数，按《工科数学分析基础》+北大版《高等代数》章节映射，CURRICULUM常量可编辑）；Just-in-Time补漏（高中依赖自评none/fuzzy→🔧任务，截止=开课周）+ 预警点📖预习；当前教学周选择（前测步骤1+Profile，云同步）；**Quiz证据闭环**（GET /api/quiz/history + <50%强制插入当周补漏带📊徽章 / 连续≥90%豁免自评弱项）；替换旧三组视图 |
| 15 | **AI Quiz 完成** | 出题等待时长提示（ETA按配置动态）；KaTeX 公式渲染（题目/选项/解析）；选项随机打乱破除 LLM 位置偏差（NOTA 保护）；题数 1-15 自定义 |
| 16 | **Chat AI 整书问答（Whole Book RAG）** | 输入区上方 📄Page/📚Whole book 模式切换（仅对已 MinerU 解析的书显示，默认页模式）；每条消息独立检索（POST /api/documents/{id}/search：属主校验+RRF混合检索+同页去重取3块）；摘录注入用户消息并要求 [Page N] 引用；检索不可用自动降级页模式+toast；上下文条实时显示命中页码 |
| 17 | **内置双语使用指南（虚拟文档）** | 前端常量 GUIDE_PAGES **九页**双语手册（EN主文+CN副行）：欢迎导览/前测→能力图/学习计划时间轴/自适应闭环/Math Tutor/AI Quiz 详解/Reader 与 Chat AI/**Function Plotter**/整理同步速查；含侧边栏导览、掌握度条、时间轴、模式chips、浮动菜单、函数示例 6 种 CSS 示意图（另留 img 块支持真截图）；永久钉在书架 Textbooks 首位（游客可见）；复用 docview 渲染+KaTeX+dataset.text；每次会话首次进 Reader 自动打开；零后端改动 |
| 18 | **MinerU 扫描书双语指南（虚拟文档）** | 第二张钉住卡 🔬（P2 位）：五页——What is MinerU（含 mineru.net + GitHub 链接块）/为何需要/四步获取 API Key（免费 2000页/天）/在应用中使用（进度条/换Key续解析）/隐私与 FAQ（Fernet 只写不读、BYOT 边界）；**征询弹窗新增"❓ What is MinerU?"一键跳转**；readerOpenGuide 参数化支持多指南；零后端改动 |
| 19 | **RAG 分类限定 + 原生教材入库 + 配额系统** | RAG 索引/检索仅限 Textbooks 分类（其他分类解析照常供阅读、不建索引，search 返回 not_textbook）；原生文字教材新增"✨ Index"按钮（征询弹窗文案变体，解析后默认保持原 PDF 视图）；mineru_usage 表按日记账（仅计真实提交分卷）+ trigger_parse 事前配额拦截(429)+worker 每卷兜底 + 弹窗实时显示 "MinerU Today: X / 2,000 pages · resets daily" + 超限预警弹窗（明日续解析零消耗） |
| 20 | **自动教材锚定（跨书检索，异步引用条）** | `rag.retrieve_multi` 跨书检索（问题向量仅算一次；**双路共识**：块须同时进入稠密/稀疏两路 Top-10 才算命中，杜绝弱相关误引）；`POST /api/textbooks/search` 自动圈定用户已索引教材（响应含 doc_id）；Chat AI 与 Math Tutor **非阻塞**异步触发——AI 立即流式作答，命中后答案上方浮现绿色引用条 `📚 书名 · p.X`，未命中不显示；**检索白名单：Chat AI 仅 Exercises/Exam Papers 分类的文档触发**（Tutor 恒可触发）；显式 📚 模式与游客自动跳过 |
| 21 | **教材速览浮窗（边学边做）** | 点击引用条 → 教材原文浮窗（~30ms 拉取单页结构化块）：**标题栏拖拽** + **CSS resize:both 原生拉伸** + 多命中页标签切换 + docview 级渲染（标题分级/KaTeX 公式/表格）；与 AI Chat 弹窗双窗并排自由移动；**↗ Reader 按钮**一键升级——保留 AI 窗、docview 秒开（不下载整本 PDF）、复用跨视图保位机制精准落到目标页 |
| 22 | **弹窗迷你阅读器 + 划词三件套 + 专属菜单** | 弹窗升级为全教材连续阅读（占位页+滑窗懒渲染）；**弹窗专属浮动菜单**（position:absolute 在弹窗内，弹窗坐标系定位+边界钳制，按钮直调 tbPeekAction）——翻译/高亮（4色+笔记，POST /api/highlights 按教材 docId+弹窗页码，Reader 同步）/笔记（POST /api/notes，Notes 页同步）/Ask AI（Chat 窗开着=追加追问不打断；没开=新引用会话）；**打开时适配列宽后冻结**（浏览器视口语义，拉伸零文字重排）；性能优化：占位页单次 innerHTML 批量构建 + rAF 后再 observe + 弹窗页码追踪器缓存列表；**"🔍 Searching your textbooks…" 检索中提示**（命中→替换为绿色引用条，未命中→300ms 淡出）；Reader docview 虚拟化（react-window/PDF.js 模式）：批量构建+滑窗观察（~40 页）+rAF 延迟注册，深跳秒开 |
| 23 | **答案概念溯源（Post-Answer Concept Tracing）** | AI 回答完毕后异步提取回答中使用的定理/公式/方法名（qwen-turbo 后置提取，不阻塞答案显示）→ 对每个概念跨书 RAG 检索（双路共识）→ 在答案下方显示 "📚 Key concepts in your textbooks" 紫色区块，每条可点击打开教材浮窗；可见状态条 "🔎 Searching key concepts…" + 失败友好提示；适用范围：Math Tutor（General+Deep）+ Reader Chat AI（exercises/exam-papers 范围）；后端新增 `POST /api/textbooks/concepts` 端点 |
| 24 | **Math Tutor UI 紧凑化** | Hero 区域压缩（标题+模式按钮同行、去副标题、减小 padding），chat-shell 加 max-height 限制+overflow 滚动，输入框始终在视口内无需下拉；快捷 chips 字号缩小 |
| 25 | **Aurora Glass 模块化前端（2026-09-12 上线）** | 355KB 单文件 index.html 重构为模块化架构：`index.html`(56KB 外壳) + `app\` 16 个 JS 模块（auth/nav/router/cmdk/tutor/quiz/pretest/notes/plotter/bookshelf-data/bookshelf/reader/reader-notes/dashboard/ui/init/mineru，共 246 函数）+ `styles\` 5 个 CSS（tokens/base/legacy/components/pages，token 单一真源，:root 浅色 + body.dark 深色默认）+ `app\vendor\` 6 个视觉特效引擎（BorderBeam 流光边框/LiquidGooey 液态指示器/ThinkingOrb 思考球等，全部带 prefers-reduced-motion 降级）。**新特性**：Hash 路由（#/dashboard 12 条，后退/深链/路由守卫）；⌘K 命令面板（模糊搜索+键盘导航）；极光场深色玻璃拟态设计系统（三方 UI 对决评审 8.5/9.2 第一名）；bento 式 Dashboard（掌握度圆环+滚动快照 delta+本地活动日志+Continue 续读卡）；登录/表单按钮流光特效。**全功能等价移植**：docview 虚拟化+滑窗+错峰渲染、瞬时落页（scrollBehavior:'auto' 双保险）、±1 锚定修正、锚定/概念溯源/浮窗三件套、MinerU 全家桶（gate/追踪器/配额/换Key回路）、游客模式+内置指南——逐项契约验证通过（47 处 apiFetch + 8 处直连全落点）。旧版备份为 `index-legacy.html` |
| 26 | **真实 Day Streak（去假数据）** | `GET /api/stats` 后端纯 SQL 从既有四表（quiz_results/documents/notes/highlights 的日期列）UNION 去重得活跃日集合，倒推连续天数（今日未活跃宽限昨日）；前端 ui.js 删除 `\|\|14`/`\|\|156` 演示兜底——登录用户所见即真实数据（游客仍见 DOM 演示值）。实测：当日建笔记 → streak=1；间隔>1 天 → 0 |
| 27 | **后端启动容错（书架重试横幅）** | 修复"后端启动窗口期刷新页面→数据像丢了"的静默吞错问题：bookshelf.js 区分网络层失败（后端启动中）与 HTTP 错误——网络层失败自动重试 3 次（2s/4s/6s 退避+toast 提示 Backend starting）；最终失败在书架/Dashboard 网格内联渲染 "Backend not reachable — your data is safe. [Retry now]" 横幅（替代空白格），点击立即重拉。配合 2026-09-08 诊断的根因（catch 只弹一次 toast 即放弃），彻底消除"数据消失"错觉 |

### 2026-09-12：用户后端微调（集成前已完成）

| # | 修改 | 说明 |
|---|------|------|
| a | `/api/chat` 验证器输出 12 处去 emoji | ✅→PASS、⚠️→NEEDS REVISION、❌→FAIL、🔍 移除——与新 UI 无 emoji 规范统一（纯文案，不改逻辑） |
| b | documents upload/list 响应 icon 字段改为 Lucide 图标名 | 📄→`file-text`、📊→`presentation`——新 bookshelf.js `iconHtml()` 直接消费；旧前端用自带 categoryIcon() 不受影响 |
| c | server.py 全文 UTF-8 乱码修复 | 鈥?→—、馃挕→💡 等 mojibake 清理；备份 `server.py.bak_去emoji前` |

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
SECRET_KEY=                         # 留空=首次启动自动生成唯一密钥并写回.env（推荐）
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

*最后更新：2026年9月12日*
*版本：code_v2 + server.py + harness_v3.py + Aurora Glass 模块化前端（app\ 16 模块 + styles\ 5 CSS）*
*状态：Aurora Glass 前端上线 + 真实 Streak + 后端启动容错（未推送 GitHub——待用户验证后推送）*