# CogniBridge 智学桥

AI 驱动的 K12 → 高等数学衔接学习平台，专为英国大学 STEM 专业大一新生设计。

> 核心问题：A-Level 数学（计算导向）到大学数学（证明导向）的认知范式断层。

## 功能

| 功能 | 说明 |
|------|------|
| **Pre-Assessment** | 3 分钟诊断测试，识别知识漏洞，生成个性化学习路径 |
| **Math Tutor** | AI 辅导（General 直接解题 / Deep Socratic 引导），支持公式渲染与资料引用 |
| **Function Plotter** | 2D/3D 函数绘图、圆锥曲线可视化 |
| **Reader** | PDF/PPTX 文档阅读，支持翻译、高亮（4色+笔记）、AI 引用问答 |
| **Notes** | 笔记管理，标签筛选，与 Reader 联动 |
| **Bookshelf** | 5 分类文档管理，支持 PDF/PPTX 上传 |

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Tailwind CSS + PDF.js + Plotly.js + KaTeX |
| 后端 | FastAPI + SQLite + JWT (python-jose) |
| AI 主力模型 | Qwen3.6-35B-A3B（阿里云百炼） |
| AI 翻译模型 | Qwen-Turbo（成本更低） |
| Harness 引擎 | **V3**（ToRA + Proof Verifier + Smart Routing） |

## 快速启动

```bash
cd code_v2
pip install -r requirements.txt

# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DASHSCOPE_API_KEY

# 2. 启动后端
python server.py
# 服务运行在 http://localhost:8000

# 3. 打开前端
# 浏览器直接打开 code_v2/index.html
```

## 项目文档

- [`PROJECT_STATUS_AND_ROADMAP.md`](PROJECT_STATUS_AND_ROADMAP.md) — 项目进度、技术路线、里程碑
- [`harness_design/harness_improve/HARNESS_V3_GUIDE.md`](harness_design/harness_improve/HARNESS_V3_GUIDE.md) — Harness V3 完整技术文档

## 作者

越明 (Yueming) — Queen Mary University of London

## 许可证

MIT
