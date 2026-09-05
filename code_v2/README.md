# CogniBridge — Product UI Framework

Pure UI framework with no pre-rendered content. Every page shows clean placeholder states ready for functional implementation.

## Structure

```
产品UI框架图/
├── code_v2/
│   ├── index.html        ← Single-file UI framework (HTML + CSS + JS)
│   ├── server.py         ← FastAPI backend (auth/docs/notes/quiz/harness + MinerU endpoints)
│   ├── mineru_client.py  ← MinerU cloud parsing client (split/submit/poll/merge)
│   ├── rag.py            ← RAG layer (chunks + FTS5 trigram + embeddings + hybrid retrieval)
│   └── README.md         ← This file
└── (screenshots/design files can be added here)
```

## Pages

| Page | Status | Description |
|------|--------|-------------|
| Dashboard | ✅ Framework | Stats + Bookshelf + Study Plan + Skill Breakdown (all placeholders) |
| Pre-Assessment | ✅ Framework | Welcome screen with start/skip buttons |
| Math Tutor | ✅ Framework | General/Deep mode switch + chat area placeholder |
| Function Plotter | ✅ Framework | 2D/3D mode switch + plot area placeholder |
| Reader | ✅ Framework | 3-panel layout: Bookshelf sidebar + Reading area + Notes (MinerU AI re-layout for scanned PDFs integrated: reformatted view, page-context AI chat, live progress bars, API-key 3-layer validation) |
| Knowledge Graph | ✅ Framework | Graph placeholder + legend |
| Student Forum | ✅ Framework | Category sidebar + posts list placeholder |
| Bookshelf | ✅ Framework | 5 category tabs + grid placeholder |

## Features

- ✅ Collapsible sidebar (Notion-style toggle)
- ✅ Dark/Light mode toggle
- ✅ Breadcrumb navigation
- ✅ CSS variables for theming (all colors via `:root` + `body.dark`)
- ✅ Responsive placeholder boxes with action buttons
- ✅ No external dependencies except Tailwind CDN

## Usage

1. Open `index.html` in browser
2. Click sidebar items to navigate
3. Toggle sidebar with ⊞ button
4. Toggle dark mode with 🌙/☀️ button

## Next Steps

Fill each page with real functionality:
1. Wire up Pre-Assessment flow
2. Connect Math Tutor to AI API
3. Integrate Plotly.js for Function Plotter
4. Add PDF.js for Reader
5. Build interactive Knowledge Graph
6. Implement Forum backend
7. Add file upload for Bookshelf