# 数跃 ShuYue

AI 驱动的高考 → 中外合办大学数学衔接学习平台，专为北邮-QMUL 式中外合办项目的大一新生设计。

> **核心问题**：高考数学（中文计算）→ 全英文大学数学（证明导向）的**双重断层**——数学范式 + 语言适应。

## 功能

| 功能 | 说明 |
|------|------|
| **学前诊断** | 3 分钟个性化断层分析，识别高中知识薄弱点 + 大学衔接预警，生成个性化学习路径 |
| **AI 辅导** | 通用模式（直接解答） / 引导模式（苏格拉底式提问），支持公式渲染、资料上传、术语中英对照 |
| **AI 出题** | 智能出题，每题经 Harness 引擎交叉验证。MCQ + 填空，难度可选，支持**中英文出题语言切换** |
| **函数画板** | 2D/3D 函数绘图，圆锥曲线可视化 |
| **阅读器** | PDF/PPTX 文档阅读 + 划词翻译、高亮（4色+笔记）、AI 引用问答 + **扫描教材经 MinerU AI 重排**（重排版阅读 / 公式渲染 / 整书检索问答，用户自备 MinerU API Key） |
| **笔记单词库** | 笔记管理（标签筛选、Reader 同步）+ **单词本**（数学术语自动提取 + 阅读划词收录 + AI 概念溯源一键收词 + 词单分组） |
| **知识图谱** | 分层科技树：高中基础 → 衔接断层 → 大学双轨课程，掌握度随学习动态更新 |
| **书架** | 6 分类文档管理（课件/教材/习题/真题/文献/笔记），PDF/PPTX 上传 |

## 双语桥接（核心差异化）

中外合办学生同时面对中文和英文教材，数跃提供**全链路双语支持**：

- **Harness 中文管道**：16 个数学主题中英双语词表，中文问题正确路由 + 证明判定
- **跨语言 RAG 检索**：中文问题可命中英文教材（"上确界"→"supremum"），反之亦然
- **双语出题**：英文题干（考试语言）+ 中文解析带术语对照；或全中文出题
- **AI 人设**：中外合办桥接导师——中文回答 + 术语首现中英对照
- **单词本**：数学英文专业表达 + 对应翻译 + 教材出处回跳

## 用户系统

每个用户拥有独立的个性化学习空间，数据云端持久化：

- **注册 / 登录 / 游客模式**（游客数据本地保存，登录后自动迁移上云）
- **多用户数据完全隔离**：文档、笔记、高亮、阅读进度、答题记录、学习计划、单词本
- **多设备无缝同步**：登录即从云端恢复全部数据
- **安全**：密码哈希 + JWT，密钥首次启动自动生成并持久化

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vanilla JS 模块化架构（17 模块）+ Tailwind CSS + PDF.js + Plotly.js + KaTeX + Lucide Icons |
| 后端 | FastAPI + SQLite + JWT |
| AI 推理模型 | Qwen3.6-35B-A3B（阿里云百炼） |
| AI 翻译/术语提取 | Qwen-Turbo（成本更低） |
| 嵌入模型 | text-embedding-v4（多语言，支持中英跨语言检索） |
| Harness 引擎 | **V3**（ToRA 工具调用 + Proof Verifier 证明验证 + Smart Routing 智能路由 + **中文管道**） |
| 扫描件解析 | **MinerU**（BYOT 模式，用户自备 API Key，Fernet 加密存储）+ FTS5/向量混合检索 |

## 快速开始（clone 并运行）

```bash
git clone https://github.com/pangyueming/ShuYue.git
cd ShuYue/code_v2

# 1. 安装依赖
pip install -r requirements.txt

# 2. 配置 API 密钥（唯一必需）
# 编辑 .env，填入你的 DASHSCOPE_API_KEY（从阿里云百炼控制台获取）

# 3. 启动服务
python server.py
# 首次启动自动完成：SQLite 数据库 + JWT 密钥自动生成并写入 .env
# 服务运行在 http://localhost:8001

# 4. 打开前端
# 浏览器打开 code_v2/index.html → 注册账号 → 开始使用
```

**无需手动创建数据库、配置环境变量或获取密钥**——SQLite 数据库和 JWT 密钥在首次启动时自动初始化。

## 姊妹项目

数跃是**独立仓库**（2026-09 从 CogniBridge 的 china-track 分支独立而来）：

| 仓库 | 赛道 | 说明 |
|------|------|------|
| [ShuYue](https://github.com/pangyueming/ShuYue) | 中国赛道 | 高考 → 北邮中外合办（本仓库） |
| [CogniBridge](https://github.com/pangyueming/CogniBridge) | UK 赛道 | A-Level → 英国大学 |

## 项目文档

- [`PROJECT_STATUS_AND_ROADMAP.md`](PROJECT_STATUS_AND_ROADMAP.md) — 项目进度、技术路线、工程细节
- [`harness_design/harness_improve/scripts/BENCHMARK_CN_REPORT.md`](harness_design/harness_improve/scripts/BENCHMARK_CN_REPORT.md) — 双语基准测试报告（83.3%，中英完全对称）

## 作者

越明 (Yueming) · 北京邮电大学（中外合办）

## 许可证

MIT
