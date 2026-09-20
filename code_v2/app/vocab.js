// ===== 单词本 (Vocabulary Book) — math terminology for Sino-foreign joint programme =====
// Three capture paths: auto-extract after parse / reader selection / AI concept tracing.
// Readwise-inspired: capture + organize + search; every term keeps its source context.

let vocabData = [];
let vocabSearchQ = '';
let vocabEditingId = null;
let vocabLoaded = false;
let vocabFilterTag = '';  // '' = all
let vocabAllTags = [];    // unique tags from all entries

function vocabTabSwitch(tab) {
    const btnN = document.getElementById('notes-tab-btn');
    const btnV = document.getElementById('vocab-tab-btn');
    const paneN = document.getElementById('notes-pane');
    const paneV = document.getElementById('vocab-pane');
    if (tab === 'vocab') {
        btnV.style.borderColor = 'var(--accent)'; btnV.style.color = 'var(--accent)';
        btnN.style.borderColor = 'var(--border)'; btnN.style.color = 'var(--text-muted)';
        paneN.style.display = 'none';
        paneV.style.display = '';
        if (!vocabLoaded) vocabInit();
    } else {
        btnN.style.borderColor = 'var(--accent)'; btnN.style.color = 'var(--accent)';
        btnV.style.borderColor = 'var(--border)'; btnV.style.color = 'var(--text-muted)';
        paneV.style.display = 'none';
        paneN.style.display = '';
    }
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
        // Load all entries for tag extraction, then filter client-side by tag
        const params = [];
        if (vocabSearchQ) params.push('q=' + encodeURIComponent(vocabSearchQ));
        const url = '/api/vocab' + (params.length ? '?' + params.join('&') : '');
        const res = await apiFetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const all = await res.json();
        // Extract unique tags
        const tagSet = new Set();
        all.forEach(v => { if (v.tag) tagSet.add(v.tag); });
        vocabAllTags = Array.from(tagSet).sort();
        // Filter by selected tag
        vocabData = vocabFilterTag ? all.filter(v => v.tag === vocabFilterTag) : all;
    } catch (e) {
        console.error('vocabLoad:', e);
        if (vocabSearchQ) return;
        vocabData = []; vocabAllTags = [];
    }
}

function vocabRender() {
    // Tag chips row
    const tagsRow = document.getElementById('vocab-tags');
    if (tagsRow) {
        let html = `<button class="chip" onclick="vocabFilterTagSet('')" style="${!vocabFilterTag ? 'border-color:var(--accent);color:var(--accent);' : ''}padding:4px 12px;font-size:11px;">全部</button>`;
        vocabAllTags.forEach(t => {
            html += ` <button class="chip" onclick="vocabFilterTagSet('${escapeHtml(t)}')" style="${vocabFilterTag === t ? 'border-color:var(--accent);color:var(--accent);' : ''}padding:4px 12px;font-size:11px;">${escapeHtml(t)}</button>`;
        });
        html += ` <button class="chip" onclick="vocabNewTag()" style="padding:4px 12px;font-size:11px;color:var(--text-muted);border-style:dashed;">+ 新建词单</button>`;
        tagsRow.innerHTML = html;
    }

    const countEl = document.getElementById('vocab-count');
    if (countEl) countEl.textContent = vocabData.length + ' 词';

    const list = document.getElementById('vocab-list');
    if (!list) return;

    if (!vocabData.length) {
        if (vocabSearchQ) {
            list.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
                <div style="font-size:13px;">没有匹配"${escapeHtml(vocabSearchQ)}"的术语</div>
                <button class="btn-secondary" style="margin-top:12px;padding:6px 16px;font-size:12px;" onclick="vocabClearSearch()">清空搜索</button>
            </div>`;
        } else {
            list.innerHTML = `<div style="text-align:center;padding:60px 20px;">
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

    list.innerHTML = vocabData.map(v => {
        if (vocabEditingId === v.id) return vocabRenderEditCard(v);
        return vocabRenderCard(v);
    }).join('');
    refreshIcons();
}

function vocabRenderCard(v) {
    const srcPill = v.source_doc_id
        ? `<span onclick="vocabJumpSource('${v.source_doc_id}',${v.source_page || 1})" title="查看原文" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--accent);cursor:pointer;padding:2px 8px;border-radius:999px;background:rgba(122,107,255,.06);border:1px solid rgba(122,107,255,.15);white-space:nowrap;">${iconHtml('book-open',10)}${escapeHtml(v.source_title || '文档')}·p.${v.source_page || '?'}</span>`
        : '';
    const tagPill = v.tag
        ? `<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:var(--bg-tag);border:1px solid var(--border);color:var(--text-muted);white-space:nowrap;">${escapeHtml(v.tag)}</span>`
        : '';
    return `<div class="card" style="padding:12px 16px;margin-bottom:8px;display:flex;align-items:flex-start;gap:12px;transition:transform .15s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform=''">
        <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
                <span style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(v.term_en)}</span>
                <span style="font-size:13px;color:var(--text-secondary);">${escapeHtml(v.term_zh || '')}</span>
                ${tagPill}${srcPill}
            </div>
            ${v.definition ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5;">${escapeHtml(v.definition)}</div>` : ''}
            ${v.source_text ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;font-style:italic;opacity:.7;">"${escapeHtml(v.source_text.substring(0, 80))}${v.source_text.length > 80 ? '...' : ''}"</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
            <button onclick="vocabEdit('${v.id}')" aria-label="编辑术语" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;border-radius:4px;">${iconHtml('pencil',13)}</button>
            <button onclick="vocabDelete('${v.id}','${escapeHtml(v.term_en)}')" aria-label="删除术语" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;border-radius:4px;">${iconHtml('trash-2',13)}</button>
        </div>
    </div>`;
}

function vocabRenderEditCard(v) {
    return `<div class="card" style="padding:14px 16px;margin-bottom:8px;border-color:var(--accent);">
        <div style="display:flex;flex-direction:column;gap:10px;">
            <div>
                <label class="field-label" style="margin-bottom:4px;">英文术语 <span style="color:var(--red);">*</span></label>
                <input id="vocab-edit-en" class="input" style="width:100%;font-family:var(--font-mono);font-size:13px;" value="${escapeHtml(v.term_en)}" aria-describedby="vocab-edit-en-err">
                <div id="vocab-edit-en-err" style="font-size:11px;color:var(--red);min-height:14px;margin-top:2px;"></div>
            </div>
            <div>
                <label class="field-label" style="margin-bottom:4px;">中文翻译</label>
                <input id="vocab-edit-zh" class="input" style="width:100%;font-size:13px;" value="${escapeHtml(v.term_zh || '')}">
            </div>
            <div>
                <label class="field-label" style="margin-bottom:4px;">定义</label>
                <textarea id="vocab-edit-def" class="input" style="width:100%;font-size:12px;rows:2;min-height:44px;resize:vertical;" placeholder="一句话双语定义...">${escapeHtml(v.definition || '')}</textarea>
            </div>
            <div>
                <label class="field-label" style="margin-bottom:4px;">词单</label>
                <input id="vocab-edit-tag" class="input" style="width:100%;font-size:13px;" value="${escapeHtml(v.tag || '')}" placeholder="词单名（可选）" list="vocab-tag-datalist">
                <datalist id="vocab-tag-datalist">
                    ${vocabAllTags.map(t => `<option value="${escapeHtml(t)}">`).join('')}
                </datalist>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn-secondary" style="padding:6px 16px;font-size:12px;" onclick="vocabCancelEdit()">取消</button>
                <button class="btn-primary" style="padding:6px 16px;font-size:12px;" onclick="vocabSaveEdit('${v.id}')">保存</button>
            </div>
        </div>
    </div>`;
}

function vocabEdit(id) {
    vocabEditingId = id;
    vocabRender();
    const inp = document.getElementById('vocab-edit-en');
    if (inp) {
        inp.focus();
        inp.addEventListener('blur', () => {
            const err = document.getElementById('vocab-edit-en-err');
            if (err) err.textContent = inp.value.trim() ? '' : '英文术语不能为空';
        });
    }
}

function vocabCancelEdit() {
    vocabEditingId = null;
    vocabRender();
}

async function vocabSaveEdit(id) {
    const en = (document.getElementById('vocab-edit-en') || {}).value || '';
    const zh = (document.getElementById('vocab-edit-zh') || {}).value || '';
    const def = (document.getElementById('vocab-edit-def') || {}).value || '';
    const tag = (document.getElementById('vocab-edit-tag') || {}).value || '';
    if (!en.trim()) {
        const err = document.getElementById('vocab-edit-en-err');
        if (err) err.textContent = '英文术语不能为空';
        return;
    }
    try {
        const res = await apiFetch('/api/vocab/' + id, {
            method: 'PUT',
            body: JSON.stringify({ term_en: en.trim(), term_zh: zh.trim(), definition: def.trim(), tag: tag.trim() })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        showNotification('术语已更新', 'success');
        if (typeof logActivity === 'function') logActivity('vocab', '编辑术语 · ' + en.trim());
        vocabEditingId = null;
        await vocabLoad();
        vocabRender();
    } catch (e) {
        showNotification('保存失败：' + e.message, 'error');
    }
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
        showNotification('删除失败：' + e.message, 'error');
    }
}

function vocabAdd() {
    // Show an add card at the top of the list
    vocabEditingId = '__new__';
    vocabData.unshift({ id: '__new__', term_en: '', term_zh: '', definition: '', source_doc_id: null });
    vocabRender();
    const inp = document.getElementById('vocab-edit-en');
    if (inp) inp.focus();
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
    if (vocabAllTags.includes(tag)) {
        showNotification('词单 "' + tag + '" 已存在', 'warning');
        return;
    }
    vocabAllTags.push(tag);
    vocabFilterTag = tag;
    vocabRender();
    showNotification('词单 "' + tag + '" 已创建，新收的术语可选择归入此词单', 'success');
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
    // Find doc in bsData and open in Reader at page
    for (const cat of Object.keys(bsData)) {
        const idx = bsData[cat].findIndex(d => d.id === docId);
        if (idx !== -1) {
            showPage('reader');
            setTimeout(() => {
                readerOpenDoc(cat, idx, page);
            }, 100);
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
            <textarea id="vocab-capture-def" class="input" style="width:100%;font-size:12px;min-height:36px;resize:vertical;" placeholder="定义（可选）"></textarea>
            <input id="vocab-capture-tag" class="input" style="width:100%;font-size:12px;margin-top:6px;" placeholder="词单（可选）" list="vocab-capture-tags" value="${escapeHtml(vocabFilterTag)}">
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

    // AI pre-fill via translate endpoint
    try {
        const res = await fetch(AI_BACKEND_URL + '/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.substring(0, 200), target_lang: 'auto' })
        });
        const d = await res.json();
        const translation = d.translation || '';
        // Parse: **翻译**: xxx **释义**: yyy or **Translation**: xxx **Note**: yyy
        const zhMatch = translation.match(/\*\*翻译\*\*:?\s*(.+?)(?:\*\*|$)/s) || translation.match(/\*\*Translation\*\*:?\s*(.+?)(?:\*\*|$)/s);
        const defMatch = translation.match(/\*\*释义\*\*:?\s*(.+)$/s) || translation.match(/\*\*Note\*\*:?\s*(.+)$/s);
        const zhInput = document.getElementById('vocab-capture-zh');
        const defInput = document.getElementById('vocab-capture-def');
        if (zhInput && zhMatch) zhInput.value = zhMatch[1].trim().substring(0, 60);
        if (defInput && defMatch) defInput.value = defMatch[1].trim().substring(0, 200);
    } catch (e) { /* AI prefill failed — user fills manually */ }

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
        vocabLoaded = false; // force reload next visit
    } catch (e) {
        showNotification('保存失败：' + e.message, 'error');
    }
}

// ===== AI concept capture: from concept-tracing purple block =====
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
        showNotification('保存失败：' + e.message, 'error');
    }
}
