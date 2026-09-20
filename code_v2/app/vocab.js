// ===== 单词本 (Vocabulary Book) — math terminology for Sino-foreign joint programme =====
// Two-level navigation (like Notes page): doc list → click → term detail → back.
// Three capture paths: auto-extract after parse / reader selection / AI concept tracing.

let vocabData = [];
let vocabSearchQ = '';
let vocabEditingId = null;
let vocabLoaded = false;
let vocabFilterTag = '';
let vocabAllTags = [];
let vocabCurrentDoc = null; // null = doc list view, {id, title} = term detail view

function vocabTabSwitch(tab) {
    const btnN = document.getElementById('notes-tab-btn');
    const btnV = document.getElementById('vocab-tab-btn');
    const paneN = document.getElementById('notes-pane');
    const paneV = document.getElementById('vocab-pane');
    const actionBtn = document.getElementById('notes-page-action-btn');
    if (tab === 'vocab') {
        btnV.style.borderColor = 'var(--accent)'; btnV.style.color = 'var(--accent)';
        btnN.style.borderColor = 'var(--border)'; btnN.style.color = 'var(--text-muted)';
        paneN.style.display = 'none';
        paneV.style.display = '';
        if (actionBtn) {
            actionBtn.innerHTML = iconHtml('book-marked', 13) + ' 新建单词本';
            actionBtn.onclick = vocabCreateBook;
        }
        if (!vocabLoaded) vocabInit();
    } else {
        btnN.style.borderColor = 'var(--accent)'; btnN.style.color = 'var(--accent)';
        btnV.style.borderColor = 'var(--border)'; btnV.style.color = 'var(--text-muted)';
        paneV.style.display = 'none';
        paneN.style.display = '';
        if (actionBtn) {
            actionBtn.innerHTML = iconHtml('notebook-pen', 13) + ' 新建笔记';
            actionBtn.onclick = notesNewNote;
        }
    }
}

// ===== Create custom vocab book (named by user) =====
function vocabCreateBook() {
    const name = prompt('输入单词本名称（如：第一章极限术语、易忘词、线代词汇）');
    if (!name || !name.trim()) return;
    const tag = name.trim();
    // Open as custom book detail view (tag-based, green icon)
    vocabCurrentDoc = { id: 'tag:' + tag, title: tag, isCustom: true, tag: tag };
    vocabEditingId = null;
    vocabRender();
    showNotification('单词本「' + tag + '」已创建，开始添加术语吧', 'success');
}

async function vocabInit() {
    await vocabLoad();
    vocabRender();
    vocabLoaded = true;
}

async function vocabLoad() {
    const token = localStorage.getItem('cb_cn_token');
    if (!token) { vocabData = []; vocabAllTags = []; return; }
    try {
        const params = [];
        if (vocabSearchQ) params.push('q=' + encodeURIComponent(vocabSearchQ));
        const url = '/api/vocab' + (params.length ? '?' + params.join('&') : '');
        const res = await apiFetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const all = await res.json();
        const tagSet = new Set();
        all.forEach(v => { if (v.tag) tagSet.add(v.tag); });
        vocabAllTags = Array.from(tagSet).sort();
        vocabData = vocabFilterTag ? all.filter(v => v.tag === vocabFilterTag) : all;
    } catch (e) {
        console.error('vocabLoad:', e);
        if (vocabSearchQ) return;
        vocabData = []; vocabAllTags = [];
    }
}

// ===== Render dispatcher: doc list view OR term detail view =====
function vocabRender() {
    // Update count
    const countEl = document.getElementById('vocab-count');
    if (countEl) countEl.textContent = vocabData.length + ' 词';

    if (vocabCurrentDoc) {
        vocabRenderDocDetail();
    } else {
        vocabRenderDocList();
    }
}

// ===== Level 1: Document list (like notes card list) =====
function vocabRenderDocList() {
    const listView = document.getElementById('vocab-list-view');
    const detailView = document.getElementById('vocab-detail-view');
    if (listView) listView.style.display = '';
    if (detailView) detailView.style.display = 'none';

    const container = document.getElementById('vocab-doc-list');
    if (!container) return;

    if (!vocabData.length) {
        if (vocabSearchQ) {
            container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
                <div style="font-size:13px;">没有匹配"${escapeHtml(vocabSearchQ)}"的术语</div>
                <button class="btn-secondary" style="margin-top:12px;padding:6px 16px;font-size:12px;" onclick="vocabClearSearch()">清空搜索</button>
            </div>`;
        } else {
            container.innerHTML = `<div style="text-align:center;padding:60px 20px;">
                <div style="font-size:36px;margin-bottom:12px;color:var(--text-muted);"><i data-lucide="book-marked" style="width:36px;height:36px;"></i></div>
                <div style="font-size:14px;color:var(--text-secondary);margin-bottom:6px;">单词本还是空的</div>
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">上传教材自动提取术语，或在阅读时划词收入</div>
                <div style="display:flex;gap:8px;justify-content:center;">
                    <button class="btn-primary" style="padding:6px 16px;font-size:12px;" onclick="showPage('bookshelf')">上传教材</button>
                    <button class="btn-secondary" style="padding:6px 16px;font-size:12px;" onclick="vocabAdd()">手动添加</button>
                </div>
            </div>`;
        }
        refreshIcons();
        return;
    }

    // Group: source_doc_id (auto-extracted) | tag-only (custom books) | neither (manual)
    const groups = new Map();
    vocabData.forEach(v => {
        let key, title, icon, color, type;
        if (v.source_doc_id) {
            key = v.source_doc_id;
            title = v.source_title || '未知文档';
            icon = 'book-open';
            color = 'var(--accent)';
            type = 'auto';
        } else if (v.tag) {
            key = 'tag:' + v.tag;
            title = v.tag;
            icon = 'notebook-pen';
            color = 'var(--green)';
            type = 'custom';
        } else {
            key = '__manual__';
            title = '手动添加';
            icon = 'pencil';
            color = 'var(--text-muted)';
            type = 'manual';
        }
        if (!groups.has(key)) {
            groups.set(key, { title, icon, color, type, docId: key, entries: [] });
        }
        groups.get(key).entries.push(v);
    });

    // Sort: auto books first (alpha), then custom (alpha), then manual
    const typeOrder = { auto: 0, custom: 1, manual: 2 };
    const sorted = Array.from(groups.values()).sort((a, b) => {
        if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
        return a.title.localeCompare(b.title);
    });

    const typeLabel = { auto: '自动提取', custom: '自定义', manual: '手动收录' };
    container.innerHTML = sorted.map(g => `
        <div class="card" style="padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;cursor:pointer;transition:transform .15s;" onclick="vocabOpenDoc('${g.docId}','${escapeHtml(g.title)}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
            <div style="width:42px;height:42px;border-radius:10px;background:var(--bg-tag);display:flex;align-items:center;justify-content:center;color:${g.color};flex-shrink:0;">
                <i data-lucide="${g.icon}" style="width:20px;height:20px;"></i>
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.title)}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                    ${typeLabel[g.type]} · ${g.entries.length} 词
                </div>
            </div>
            <span style="font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--text-secondary);">${g.entries.length}</span>
            <i data-lucide="chevron-right" style="width:16px;height:16px;color:var(--text-muted);"></i>
        </div>
    `).join('');
    refreshIcons();
}

function vocabOpenDoc(docId, title) {
    // Determine book type from docId prefix
    const isCustom = docId.startsWith('tag:');
    const tag = isCustom ? docId.replace('tag:', '') : null;
    vocabCurrentDoc = { id: docId, title: title, isCustom: isCustom, tag: tag };
    vocabEditingId = null;
    vocabRender();
}

function vocabCloseDoc() {
    vocabCurrentDoc = null;
    vocabEditingId = null;
    vocabRender();
}

// ===== Level 2: Term detail view (terms from one document, horizontal flow) =====
function vocabRenderDocDetail() {
    const listView = document.getElementById('vocab-list-view');
    const detailView = document.getElementById('vocab-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = '';

    const headerEl = document.getElementById('vocab-doc-header');
    const listEl = document.getElementById('vocab-term-list');
    if (!headerEl || !listEl) return;

    // Filter terms: custom books filter by tag, doc books by source_doc_id
    const cd = vocabCurrentDoc;
    let terms;
    if (cd.isCustom) {
        terms = vocabData.filter(v => !v.source_doc_id && v.tag === cd.tag);
    } else if (cd.id === '__manual__') {
        terms = vocabData.filter(v => !v.source_doc_id && !v.tag);
    } else {
        terms = vocabData.filter(v => v.source_doc_id === cd.id);
    }
    const isManual = cd.id === '__manual__';
    const icon = cd.isCustom ? 'notebook-pen' : (isManual ? 'pencil' : 'book-open');
    const iconColor = cd.isCustom ? 'var(--green)' : 'var(--accent)';

    headerEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
            <span style="color:${iconColor};display:flex;">${iconHtml(icon, 20)}</span>
            <span style="font-size:18px;font-weight:650;color:var(--text-primary);">${escapeHtml(cd.title)}</span>
            <span style="font-size:11px;color:var(--text-muted);padding:2px 8px;border-radius:999px;background:var(--bg-tag);">${cd.isCustom ? '自定义' : '自动提取'}</span>
            <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);margin-left:auto;">${terms.length} 词</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn-secondary" style="font-size:11px;padding:4px 12px;display:inline-flex;align-items:center;gap:4px;" onclick="vocabAddToDoc('${cd.id}')">${iconHtml('plus', 11)}添加术语</button>
        </div>
    `;

    if (!terms.length) {
        listEl.innerHTML = `<div style="text-align:center;padding:40px 20px;">
            <div style="margin-bottom:8px;color:var(--text-muted);"><i data-lucide="book-marked" style="width:28px;height:28px;"></i></div>
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px;">此单词本暂无术语</div>
            <div style="font-size:11px;color:var(--text-muted);">点击上方"+ 添加术语"开始收录</div>
        </div>`;
        refreshIcons();
        return;
    }

    // Horizontal flow layout: each term = "english 中文" separated by spacing
    // Click to edit inline. In custom books, hide tag chips (redundant).
    let html = '<div style="display:flex;flex-wrap:wrap;gap:10px 18px;padding:4px 0;">';
    terms.forEach(v => {
        if (vocabEditingId === v.id) {
            html += vocabRenderEditInline(v);
        } else {
            const showPage = v.source_page && v.source_doc_id && !cd.isCustom && cd.id !== '__manual__';
            const pageChip = showPage
                ? `<span onclick="event.stopPropagation();vocabJumpSource('${v.source_doc_id}',${v.source_page})" style="font-family:var(--font-mono);font-size:9px;color:var(--accent);cursor:pointer;margin-left:2px;">p.${v.source_page}</span>`
                : '';
            const tagChip = v.tag && !cd.isCustom
                ? `<span style="font-size:9px;padding:1px 6px;border-radius:999px;background:var(--bg-tag);color:var(--text-muted);margin-left:4px;">${escapeHtml(v.tag)}</span>`
                : '';
            html += `<span onclick="vocabEdit('${v.id}')" title="点击编辑" style="display:inline-flex;align-items:baseline;gap:4px;padding:6px 12px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border);cursor:pointer;font-size:13px;transition:border-color .15s;" onmouseover="this.style.borderColor='${cd.isCustom ? 'var(--green)' : 'var(--accent)'}'" onmouseout="this.style.borderColor='var(--border)'">
                <span style="font-family:var(--font-mono);font-weight:600;color:var(--text-primary);">${escapeHtml(v.term_en)}</span>
                <span style="color:var(--text-secondary);font-size:12px;">${escapeHtml(v.term_zh || '')}</span>
                ${pageChip}${tagChip}
                <i data-lucide="x" style="width:10px;height:10px;color:var(--text-muted);opacity:.4;margin-left:4px;flex-shrink:0;" onclick="event.stopPropagation();vocabDelete('${v.id}','${escapeHtml(v.term_en)}')"></i>
            </span>`;
        }
    });
    html += '</div>';
    listEl.innerHTML = html;
    refreshIcons();
}

// Inline edit (appears in place of the term chip)
function vocabRenderEditInline(v) {
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:var(--bg-card);border:2px solid var(--accent);">
        <input id="vocab-edit-en" class="input" style="width:130px;font-family:var(--font-mono);font-size:12px;padding:4px 8px;" value="${escapeHtml(v.term_en)}" placeholder="英文">
        <input id="vocab-edit-zh" class="input" style="width:90px;font-size:12px;padding:4px 8px;" value="${escapeHtml(v.term_zh || '')}" placeholder="中文">
        <button class="btn-primary" style="font-size:10px;padding:3px 10px;border-radius:4px;" onclick="vocabSaveEditInline('${v.id}')">✓</button>
        <button class="btn-secondary" style="font-size:10px;padding:3px 10px;border-radius:4px;" onclick="vocabCancelEdit()">✕</button>
    </span>`;
}

function vocabSaveEditInline(id) {
    const en = (document.getElementById('vocab-edit-en') || {}).value || '';
    const zh = (document.getElementById('vocab-edit-zh') || {}).value || '';
    if (!en.trim()) { showNotification('英文术语不能为空', 'warning'); return; }
    apiFetch('/api/vocab/' + id, {
        method: 'PUT',
        body: JSON.stringify({ term_en: en.trim(), term_zh: zh.trim() })
    }).then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showNotification('已更新', 'success');
        vocabEditingId = null;
        return vocabLoad();
    }).then(() => vocabRender()).catch(e => showNotification('保存失败', 'error'));
}

function vocabAddToDoc(docId) {
    // Add a new term inline in current doc view
    const newId = '__new__';
    const cd = vocabCurrentDoc || {};
    const isCustom = docId.startsWith('tag:');
    const isManual = docId === '__manual__';
    vocabData.unshift({
        id: newId, term_en: '', term_zh: '', definition: '',
        tag: isCustom ? docId.replace('tag:', '') : '',
        source_doc_id: (!isManual && !isCustom) ? docId : null,
        source_page: null
    });
    vocabEditingId = newId;
    vocabRender();
    // After render, hook up save to create via POST
    const origSave = vocabSaveEditInline;
    window.vocabSaveEditInline = function(id) {
        if (id !== '__new__') { origSave(id); return; }
        const en = (document.getElementById('vocab-edit-en') || {}).value || '';
        const zh = (document.getElementById('vocab-edit-zh') || {}).value || '';
        if (!en.trim()) { showNotification('英文术语不能为空', 'warning'); return; }
        const body = { term_en: en.trim(), term_zh: zh.trim() };
        if (!isManual && !isCustom) { body.source_doc_id = docId; }
        if (isCustom) { body.tag = docId.replace('tag:', ''); }
        apiFetch('/api/vocab', { method: 'POST', body: JSON.stringify(body) })
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                showNotification('已添加', 'success');
                if (typeof logActivity === 'function') logActivity('vocab', '添加术语 · ' + en.trim());
                vocabEditingId = null;
                return vocabLoad();
            }).then(() => vocabRender())
            .catch(e => showNotification('添加失败', 'error'));
    };
    const inp = document.getElementById('vocab-edit-en');
    if (inp) inp.focus();
}

function vocabEdit(id) {
    vocabEditingId = id;
    vocabRender();
    const inp = document.getElementById('vocab-edit-en');
    if (inp) inp.focus();
}

function vocabCancelEdit() {
    // Remove __new__ from data if present
    if (vocabEditingId === '__new__') {
        vocabData = vocabData.filter(v => v.id !== '__new__');
    }
    vocabEditingId = null;
    vocabRender();
}

async function vocabDelete(id, termEn) {
    if (!confirm('确定删除 "' + termEn + '" 吗？')) return;
    try {
        const res = await apiFetch('/api/vocab/' + id, { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showNotification('已删除', 'success');
        await vocabLoad();
        vocabRender();
    } catch (e) {
        showNotification('删除失败', 'error');
    }
}

function vocabAdd() {
    // From empty state: open custom book creation
    vocabCreateBook();
}

function vocabClearSearch() {
    vocabSearchQ = '';
    const inp = document.getElementById('vocab-search-input');
    if (inp) inp.value = '';
    vocabLoad().then(() => vocabRender());
}

function vocabFilterTagSet(tag) {
    vocabFilterTag = tag;
    vocabLoad().then(() => vocabRender());
}

function vocabNewTag() {
    const name = prompt('新建词单名称（如：第一章极限、线代词汇、易忘词）');
    if (!name || !name.trim()) return;
    const tag = name.trim();
    if (vocabAllTags.includes(tag)) { showNotification('词单已存在', 'warning'); return; }
    vocabAllTags.push(tag);
    vocabFilterTag = tag;
    vocabRender();
    showNotification('词单已创建', 'success');
}

let vocabSearchTimer = null;
function vocabSearchInput(v) {
    clearTimeout(vocabSearchTimer);
    vocabSearchTimer = setTimeout(async () => {
        vocabSearchQ = v.trim();
        await vocabLoad();
        vocabRender();
    }, 300);
}

function vocabJumpSource(docId, page) {
    for (const cat of Object.keys(bsData)) {
        const idx = bsData[cat].findIndex(d => d.id === docId);
        if (idx !== -1) {
            showPage('reader');
            setTimeout(() => readerOpenDoc(cat, idx, page), 100);
            return;
        }
    }
    showNotification('找不到原文档', 'warning');
}

// ===== Reader capture: called from float menu "收入单词本" =====
async function vocabCaptureFromSelection(text, docId, page) {
    if (!text || text.length < 2) return;
    const panel = document.getElementById('reader-action-panel');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = `<div class="card" style="border-left:4px solid var(--purple);background:rgba(124,92,224,.04);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            ${iconHtml('book-plus',16)}
            <span style="font-size:13px;font-weight:600;color:var(--text-primary);">收入单词本</span>
        </div>
        <div style="font-family:var(--font-mono);font-size:14px;color:var(--text-primary);margin-bottom:8px;">${escapeHtml(text.substring(0, 100))}</div>
        <div id="vocab-capture-status" style="font-size:12px;color:var(--text-muted);">${iconHtml('loader',12)} AI 正在查询翻译...</div>
        <div id="vocab-capture-form" style="display:none;">
            <input id="vocab-capture-zh" class="input" style="width:100%;font-size:13px;margin-bottom:6px;" placeholder="中文翻译">
            <input id="vocab-capture-def" class="input" style="width:100%;font-size:12px;margin-bottom:6px;" placeholder="定义（可选）">
            <input id="vocab-capture-tag" class="input" style="width:100%;font-size:12px;" placeholder="词单（可选）" list="vocab-capture-tags" value="${escapeHtml(vocabFilterTag)}">
            <datalist id="vocab-capture-tags">
                ${vocabAllTags.map(t => `<option value="${escapeHtml(t)}">`).join('')}
            </datalist>
            <div style="display:flex;gap:6px;margin-top:8px;">
                <button class="btn-primary" style="flex:1;padding:6px;font-size:12px;" onclick="vocabSaveCapture('${escapeHtml(text.substring(0, 200))}','${docId || ''}',${page || 0})">保存</button>
                <button class="btn-secondary" style="padding:6px 12px;font-size:12px;" onclick="document.getElementById('reader-action-panel').style.display='none'">取消</button>
            </div>
        </div>
    </div>`;
    refreshIcons();

    try {
        const res = await fetch(AI_BACKEND_URL + '/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.substring(0, 200), target_lang: 'auto' })
        });
        const d = await res.json();
        const translation = d.translation || '';
        const zhMatch = translation.match(/\*\*翻译\*\*:?\s*(.+?)(?:\*\*|$)/s) || translation.match(/\*\*Translation\*\*:?\s*(.+?)(?:\*\*|$)/s);
        const defMatch = translation.match(/\*\*释义\*\*:?\s*(.+)$/s) || translation.match(/\*\*Note\*\*:?\s*(.+)$/s);
        const zhInput = document.getElementById('vocab-capture-zh');
        const defInput = document.getElementById('vocab-capture-def');
        if (zhInput && zhMatch) zhInput.value = zhMatch[1].trim().substring(0, 60);
        if (defInput && defMatch) defInput.value = defMatch[1].trim().substring(0, 200);
    } catch (e) { /* AI prefill failed */ }

    const status = document.getElementById('vocab-capture-status');
    const form = document.getElementById('vocab-capture-form');
    if (status) status.style.display = 'none';
    if (form) form.style.display = 'block';
    refreshIcons();
}

async function vocabSaveCapture(text, docId, page) {
    const zh = (document.getElementById('vocab-capture-zh') || {}).value || '';
    const def = (document.getElementById('vocab-capture-def') || {}).value || '';
    const tag = (document.getElementById('vocab-capture-tag') || {}).value || '';
    try {
        const body = {
            term_en: text.substring(0, 80),
            term_zh: zh.trim(),
            definition: def.trim(),
            source_text: text.substring(0, 200),
            tag: tag.trim()
        };
        if (docId) { body.source_doc_id = docId; body.source_page = page || 1; }
        const res = await apiFetch('/api/vocab', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showNotification('已收入单词本：' + text.substring(0, 30), 'success');
        if (typeof logActivity === 'function') logActivity('vocab', '收入术语 · ' + text.substring(0, 30));
        const panel = document.getElementById('reader-action-panel');
        if (panel) panel.style.display = 'none';
        vocabLoaded = false;
    } catch (e) {
        showNotification('保存失败', 'error');
    }
}

async function vocabCaptureFromConcept(termEn, termZh, docId, page) {
    try {
        const body = { term_en: termEn, term_zh: termZh || '', definition: '' };
        if (docId) { body.source_doc_id = docId; body.source_page = page || 1; }
        const res = await apiFetch('/api/vocab', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showNotification('已收入单词本：' + termEn, 'success');
        if (typeof logActivity === 'function') logActivity('vocab', '收入术语 · ' + termEn);
        vocabLoaded = false;
    } catch (e) {
        showNotification('保存失败', 'error');
    }
}
