# CogniBridge 智学桥

AI 驱动的 K12 → 高等数学衔接学习平台，专为英国大学 STEM 专业大一新生设计。

> 核心问题：A-Level 数学（计算导向）到大学数学（证明导向）的认知范式断层。

## 功能

| 功能 | 说明 |
|------|------|
| **Pre-Assessment** | 3 分钟诊断测试，识别知识漏洞，生成个性化学习路径（云端同步） |
| **Math Tutor** | AI 辅导（General 直接解题 / Deep Socratic 引导），支持公式渲染与资料引用 |
| **AI Quiz** | 智能出题，每道题经解题引擎交叉验证；MCQ + 填空，答题记录云端统计 |
| **Function Plotter** | 2D/3D 函数绘图、圆锥曲线可视化 |
| **Reader** | PDF/PPTX 文档阅读，翻译、高亮（4色+笔记）、AI 引用问答 + 页面上下文自由问答 |
| **Notes** | 笔记管理，标签筛选，与 Reader / PDF 笔记三方联动 |
| **Bookshelf** | 6 分类文档管理（含 Notes 分类），PDF/PPTX 上传 |

## 完整用户系统

每个用户拥有独立的个性化体验，所有数据云端持久化：

- **注册 / 登录 / 游客模式**（游客数据本地保存，登录后自动迁移上云）
- **按用户隔离的数据**：书架文档、笔记、阅读高亮、前测结果、学习计划进度、答题记录
- **换设备无缝续用**：登录即从云端恢复全部数据
- **安全**：PBKDF2 密码哈希 + JWT（密钥首次启动自动生成，部署唯一）

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Tailwind CSS + PDF.js + Plotly.js + KaTeX + Lucide Icons |
| 后端 | FastAPI + SQLite + JWT (python-jose) |
| AI 主力模型 | Qwen3.6-35B-A3B（阿里云百炼） |
| AI 翻译/判分模型 | Qwen-Turbo（成本更低） |
| Harness 引擎 | **V3**（ToRA + Proof Verifier + Smart Routing） |

## 快速部署（clone 即用）

```bash
git clone https://github.com/pangyueming/CogniBridge.git
cd CogniBridge/code_v2

# 1. 安装依赖
pip install -r requirements.txt

# 2. 配置 API 密钥（唯一必填项）
cp .env.example .env
# 编辑 .env，填入你的 DASHSCOPE_API_KEY（阿里云百炼控制台获取）

# 3. 启动后端
python server.py
# 首次启动自动完成：SQLite 建库 + JWT 密钥生成并写入 .env

# 4. 打开前端
# 浏览器访问 code_v2/index.html → 注册账号 → 开始使用
```

**无需手动建库、无需配置密钥体系**——SQLite 数据库与 JWT SECRET_KEY 均在首次启动时自动初始化。

## 项目文档

- [`PROJECT_STATUS_AND_ROADMAP.md`](PROJECT_STATUS_AND_ROADMAP.md) — 项目进度、技术路线、里程碑
- [`harness_design/harness_improve/HARNESS_V3_GUIDE.md`](harness_design/harness_improve/HARNESS_V3_GUIDE.md) — Harness V3 完整技术文档

## 作者

庞越明 (Yueming) — Queen Mary University of London

## 许可证

MIT
