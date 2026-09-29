// ===== P8 Vision — 贴图即问（tutor + Reader 共享）=====
// 图片零落盘：压缩后 base64 随请求发送，用完即弃。
// 三入口：Ctrl+V 粘贴 / 拖拽 / 点击"图片"按钮（手机自动唤起相机）。
// 图片状态按上下文隔离（P8 Day-2.5）：tutor:<工作台id|_temp> 与 reader 各自独立——
// 新工作台从干净状态开始，切回旧台图片仍在（与材料/技能的会话隔离行为一致）。

let __visionImgBySession = {};   // key -> {b64, mime, dataURL, w, h, kb}
let __visionPickCtx = 'tutor';   // which chip the "图片" button was clicked from

function __visionKey(ctx){
    if (ctx === 'reader') return 'reader';
    const sid = (typeof tutorActiveSession !== 'undefined' && tutorActiveSession) ? tutorActiveSession : '_temp';
    return 'tutor:' + sid;
}

function visionHasImage(ctx){ return !!__visionImgBySession[__visionKey(ctx || 'tutor')]; }

function visionClear(ctx){ delete __visionImgBySession[__visionKey(ctx || 'tutor')]; visionRenderChip(); }

// ---------- 压缩（≤1600px jpeg 85%） ----------
function __visionCompress(file){
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => {
            try {
                const MAX = 1600;
                let w = im.naturalWidth, h = im.naturalHeight;
                if (Math.max(w, h) > MAX) { const k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(im, 0, 0, w, h);
                const dataURL = cv.toDataURL('image/jpeg', 0.85);
                resolve({ b64: dataURL.split(',')[1], mime: 'image/jpeg', dataURL, w, h, kb: Math.round(dataURL.length * 3 / 4 / 1024) });
            } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
        };
        im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
        im.src = url;
    });
}

async function visionHandleFiles(file, ctx){
    ctx = ctx || 'tutor';
    if (!file) return;
    if (!localStorage.getItem('cb_cn_token')) {
        showNotification('图片功能需登录使用——注册即解锁批改/解题/讲解', 'warning');
        showPage('login'); return;
    }
    if (!/^image\/(jpeg|png|webp|bmp)$/.test(file.type)) {
        showNotification(file.type === 'image/heic'
            ? 'iPhone 请将相机设为「格式兼容」（JPG）后重拍，或直接截图粘贴'
            : '不支持的图片格式（支持 jpg/png/webp/bmp）', 'warning');
        return;
    }
    if (file.size > 8 * 1024 * 1024) { showNotification('图片超过 8MB，请裁剪后重试', 'warning'); return; }
    try {
        __visionImgBySession[__visionKey(ctx)] = await __visionCompress(file);
        visionRenderChip();
        showNotification('图片已就绪——输入问题后发送；不输入直接发送=自动判断', 'success');
    } catch (e) { showNotification('图片处理失败：' + (e.message || e), 'error'); }
}

// ---------- chip 渲染（无图时显示"图片"按钮=点击选图入口；按上下文取图） ----------
function visionRenderChip(){
    [['vision-chip-tutor', 'tutor'], ['vision-chip-reader', 'reader']].forEach(([id, ctx]) => {
        const c = document.getElementById(id); if (!c) return;
        const img = __visionImgBySession[__visionKey(ctx)];
        if (!img) {
            c.innerHTML = '<button onclick="__visionPick(\'' + ctx + '\')" '
                + 'title="粘贴 / 拖拽 / 点击选图（手机可拍照）" '
                + 'style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-muted);'
                + 'background:none;border:1px dashed rgba(128,128,128,.3);border-radius:8px;padding:3px 10px;'
                + 'cursor:pointer;margin-bottom:4px;transition:color .15s;" '
                + 'onmouseover="this.style.color=\'var(--iris-400,var(--accent))\'" '
                + 'onmouseout="this.style.color=\'var(--text-muted)\'">'
                + iconHtml('image', 12) + ' 图片</button>';
            refreshIcons(); return;
        }
        c.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:8px;'
            + 'border:1px solid rgba(122,107,255,.25);background:rgba(122,107,255,.06);margin-bottom:6px;">'
            + '<img src="' + img.dataURL + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px;">'
            + '<span style="font-size:11px;color:var(--iris-400,var(--accent));display:flex;align-items:center;gap:4px;">'
            + iconHtml('image', 12) + ' 图片在上下文中</span>'
            + '<span style="font-size:10px;color:var(--text-muted);">' + img.kb + 'KB</span>'
            + '<button onclick="visionClear(\'' + ctx + '\')" style="margin-left:auto;color:#ff6b6b;background:none;border:none;'
            + 'cursor:pointer;font-size:14px;" title="移除图片">×</button></div>';
        refreshIcons();
    });
}

function __visionPick(ctx){ __visionPickCtx = ctx || 'tutor'; document.getElementById('vision-file-input').click(); }

// ---------- 共享 SSE 消费 ----------
async function visionStream(text, history, h, sessionId){
    const tok = localStorage.getItem('cb_cn_token');
    const body = { image_base64: __visionImgBySession[__visionKey(h.__ctx || 'tutor')].b64,
                   mime: __visionImgBySession[__visionKey(h.__ctx || 'tutor')].mime,
                   text: text || '', history: (history || []).slice(-6),
                   session_id: sessionId || '' };
    const r = await fetch(AI_BACKEND_URL + '/api/vision/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}) },
        body: JSON.stringify(body)
    });
    if (!r.ok) { let d = ''; try { d = (await r.json()).detail || ''; } catch (e) {} throw new Error(d || ('HTTP ' + r.status)); }
    const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value);
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
            for (const line of frame.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const d = line.slice(6);
                if (d === '[DONE]') return;
                let ev; try { ev = JSON.parse(d); } catch (e) { continue; }
                const t = ev.type;
                if (t === 'vision_intent' && h.onIntent) h.onIntent(ev.intent);
                else if (t === 'status' && h.onStatus) h.onStatus(ev.text);
                else if (t === 'text' && h.onText) h.onText(ev.delta || '');
                else if (t === 'grade_result' && h.onGrade) h.onGrade(ev.result, ev.quota_left);
                else if (t === 'quota_exceeded' && h.onQuota) h.onQuota(ev);
                else if (t === 'error' && h.onError) h.onError(ev.text);
            }
        }
    }
}

// ---------- 报告卡 / 配额卡 ----------
function __visionMark(v){
    return v === 'correct' ? '<span style="color:#52c41a;">✓</span>'
         : v === 'wrong'   ? '<span style="color:#ff6b6b;">✗</span>'
         : '<span style="color:#faad14;">◐</span>';
}

function visionReportHtml(result, quotaLeft){
    if (!result || result.parse_error) {
        return '<div style="color:var(--text-muted);font-size:12px;">批改结果解析异常，原始输出：</div>'
            + '<pre style="white-space:pre-wrap;font-size:11px;">' + escapeHtml(String(result && result.raw || '').slice(0, 800)) + '</pre>';
    }
    const probs = result.problems || [];
    let html = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;font-weight:600;color:var(--iris-400,var(--accent));">'
        + iconHtml('clipboard-check', 14) + ' 手写作业批改 · ' + probs.length + ' 题'
        + (result.salvaged ? ' <span style="font-size:10px;color:var(--text-muted);font-weight:400;">（部分识别恢复）</span>' : '') + '</div>';
    probs.forEach(p => {
        const firstWrong = (p.steps || []).find(s => s.verdict === 'wrong');
        html += '<div style="padding:8px 0;border-top:1px solid rgba(128,128,128,.15);">'
            + '<div style="display:flex;gap:6px;align-items:flex-start;font-size:12.5px;">'
            + __visionMark(p.result) + '<b>题' + escapeHtml(String(p.no || '?')) + '</b> '
            + '<span style="color:var(--text-secondary);">' + escapeHtml(String(p.question || '').slice(0, 60)) + '</span></div>';
        (p.steps || []).forEach(s => {
            html += '<div style="font-size:11.5px;color:var(--text-muted);padding-left:20px;margin-top:2px;">'
                + __visionMark(s.verdict) + ' ' + escapeHtml(String(s.text || '').slice(0, 70)) + '</div>'
                + (s.verdict === 'wrong' && s.reason ? '<div style="font-size:11px;color:#ff8a8a;padding-left:34px;">└ ' + escapeHtml(String(s.reason).slice(0, 90)) + '</div>' : '');
        });
        if (p.result !== 'correct') {
            if (p.error_type && p.error_type !== '无')
                html += '<div style="padding-left:20px;margin-top:4px;"><span style="font-size:10px;background:rgba(255,107,107,.12);color:#ff8a8a;border-radius:4px;padding:2px 8px;">' + escapeHtml(p.error_type) + '</span></div>';
            if (p.student_answer || p.reference_answer)
                html += '<div style="font-size:10.5px;color:var(--text-muted);padding-left:20px;margin-top:3px;">你的答案：' + escapeHtml(String(p.student_answer || '').slice(0, 50))
                      + ' ｜ 参考：' + escapeHtml(String(p.reference_answer || '').slice(0, 50)) + '</div>';
        }
        if (p.equivalence_override)
            html += '<div style="font-size:10.5px;color:var(--iris-400,var(--accent));padding-left:20px;margin-top:3px;">✓ 数学等价确认：仅记号/化简形式不同，已判对</div>';
        if (p.suggestion)
            html += '<div style="font-size:11px;color:var(--text-secondary);padding-left:20px;margin-top:3px;">建议：' + escapeHtml(String(p.suggestion).slice(0, 90)) + '</div>';
        if (firstWrong || p.result === 'wrong')
            html += '<button onclick="visionQuizJump(\'' + escapeHtml(String(p.question || '').replace(/['"\\]/g, '').slice(0, 24)) + '\')" '
                  + 'style="margin:6px 0 0 20px;font-size:10.5px;padding:3px 10px;border-radius:6px;border:none;'
                  + 'background:rgba(122,107,255,.12);color:var(--iris-400,var(--accent));cursor:pointer;">🎯 变式练习</button>';
        html += '</div>';
    });
    if (result.praise) html += '<div style="font-size:11.5px;color:#52c41a;margin-top:8px;">👍 ' + escapeHtml(result.praise) + '</div>';
    if (result.overall) html += '<div style="font-size:11.5px;color:var(--text-secondary);margin-top:4px;">' + escapeHtml(result.overall) + '</div>';
    if (typeof quotaLeft === 'number') html += '<div style="font-size:10px;color:var(--text-muted);margin-top:8px;">今日剩余批改次数：' + quotaLeft + '</div>';
    return html;
}

function visionQuotaHtml(ev){
    return '<div style="display:flex;align-items:center;gap:8px;padding:14px;border-radius:12px;'
        + 'background:rgba(250,173,20,.08);border:1px solid rgba(250,173,20,.3);font-size:12.5px;color:var(--text-primary);">'
        + iconHtml('timer-off', 15) + escapeHtml(ev.message || '今日批改次数已用完，明天再来～') + '</div>';
}

// ---------- 批改结论进长期记忆（episodic，P6 同款后置写入） ----------
async function visionRememberGrade(result){
    if (!result || !result.problems) return;
    try {
        const probs = result.problems;
        const wrong = probs.filter(p => p.result === 'wrong');
        const errs = [...new Set(wrong.map(p => p.error_type).filter(t => t && t !== '无'))];
        const content = '手写作业批改：共 ' + probs.length + ' 题，错 ' + wrong.length + ' 题'
            + (errs.length ? '（错因：' + errs.join('、') + '）' : '')
            + (wrong[0] && wrong[0].question ? '——涉及 "' + String(wrong[0].question).slice(0, 30) + '"' : '');
        await apiFetch('/api/agent/memory', { method: 'POST', body: JSON.stringify({ items: [{ kind: 'episodic', content }], session_id: '' }) });
    } catch (e) { /* best-effort */ }
}

// ---------- 变式练习跳转（复用 tutor 动作卡预填机制） ----------
function visionQuizJump(topic){
    try {
        if (typeof tutorActionData !== 'undefined') tutorActionData['quiz'] = { topic: topic, count: 5 };
        if (typeof tutorActionJump === 'function') { tutorActionJump('quiz'); return; }
    } catch (e) {}
    showPage('quiz');
}

// ---------- tutor 端发送流程 ----------
async function tutorVisionSend(text){
    const chat = document.getElementById('tutor-chat');
    if (!chat) return;
    const ctx = 'tutor';
    const img = __visionImgBySession[__visionKey(ctx)];
    if (!img) return;
    const empty = chat.querySelector('.empty-hero'); if (empty) empty.remove();
    const q = text || '📷 图片提问（自动判断）';
    // 用户气泡（含缩略图）
    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'display:flex;flex-direction:row-reverse;gap:8px;margin-bottom:10px;';
    userDiv.innerHTML = '<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">Y</div>'
        + '<div style="background:var(--accent);color:#fff;padding:8px 14px;border-radius:12px 12px 4px 12px;font-size:13px;max-width:75%;">'
        + '<img src="' + img.dataURL + '" style="max-width:180px;max-height:120px;border-radius:8px;display:block;margin-bottom:' + (text ? '6px' : '0') + ';">'
        + (text ? escapeHtmlTutor(text) : '') + '</div>';
    chat.appendChild(userDiv);
    // 状态行 + AI 气泡
    const stWrap = document.createElement('div');
    stWrap.style.cssText = 'padding:2px 0 2px 36px;font-size:11px;color:var(--text-muted);';
    chat.appendChild(stWrap);
    const aiDiv = document.createElement('div');
    aiDiv.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
    const bid = 'vision-bubble-' + Date.now();
    aiDiv.innerHTML = '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#9b59f7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600;flex-shrink:0;">AI</div>'
        + '<div id="' + bid + '" style="background:var(--bg-hover);color:var(--text-primary);padding:12px 16px;border-radius:14px 14px 14px 4px;font-size:13.5px;line-height:1.7;max-width:100%;min-height:20px;"></div>';
    chat.appendChild(aiDiv);
    const bubble = document.getElementById(bid);
    let orb = function(){}; try { orb = orbThinking(bubble, 'vision') || function(){}; } catch (e) {}
    chat.scrollTop = chat.scrollHeight;
    let full = '';
    let lastRender = 0;   // P8 Day-2.5: render throttle (~150ms) — long answers stop thrashing
    const renderFull = () => {
        if (typeof mdToHtmlTutor === 'function') bubble.innerHTML = mdToHtmlTutor(full);
        else bubble.textContent = full;
        chat.scrollTop = chat.scrollHeight;
    };
    const st = s => { stWrap.textContent = s; chat.scrollTop = chat.scrollHeight; };
    const sendSession = (typeof tutorActiveSession !== 'undefined') ? tutorActiveSession : null;
    const hist = (!sendSession && typeof tutorChatHistory !== 'undefined') ? tutorChatHistory : [];
    try {
        await visionStream(text, hist, {
            __ctx: ctx,
            onIntent: i => st('vision · ' + i),
            onStatus: s => st(s),
            onText: d => {
                try { orb(); orb = function(){}; } catch (e) {}
                full += d;
                const now = Date.now();
                if (now - lastRender > 150) { lastRender = now; renderFull(); }
            },
            onGrade: (res, left) => { try { orb(); } catch (e) {} bubble.innerHTML = visionReportHtml(res, left); visionRememberGrade(res); refreshIcons(); },
            onQuota: ev => { try { orb(); } catch (e) {} bubble.innerHTML = visionQuotaHtml(ev); refreshIcons(); },
            onError: t => { try { orb(); } catch (e) {} bubble.innerHTML = '<span style="color:#ff6b6b;">' + escapeHtml(t) + '</span>'; }
        }, sendSession);
    } catch (e) {
        try { orb(); } catch (e2) {}
        bubble.innerHTML = '<span style="color:#ff6b6b;">图片处理失败：' + escapeHtml(String(e.message || e)) + '</span>';
    } finally {
        stWrap.textContent = '';
        if (full) renderFull();          // final state rendered unthrottled
        if (!sendSession && typeof tutorChatHistory !== 'undefined') {
            tutorChatHistory.push({ role: 'user', content: text || '（图片提问）' });
            tutorChatHistory.push({ role: 'assistant', content: full || '（图片批改结果）' });
        }
        refreshIcons();
    }
}

// ---------- Reader 端发送流程 ----------
async function readerVisionSend(text){
    const msgArea = document.getElementById('ai-chat-messages');
    if (!msgArea) return;
    const ctx = 'reader';
    const img = __visionImgBySession[__visionKey(ctx)];
    if (!img) return;
    if (typeof aiChatMessages !== 'undefined' && aiChatMessages.length === 0) msgArea.innerHTML = '';
    const userDiv = document.createElement('div');
    userDiv.style.cssText = 'display:flex;flex-direction:row-reverse;gap:8px;margin-bottom:12px;';
    userDiv.innerHTML = '<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">Y</div>'
        + '<div style="background:var(--accent);color:#fff;padding:8px 14px;border-radius:12px 12px 4px 12px;font-size:13px;max-width:75%;">'
        + '<img src="' + img.dataURL + '" style="max-width:180px;max-height:120px;border-radius:8px;display:block;margin-bottom:' + (text ? '6px' : '0') + ';">'
        + (text ? escapeHtml(text) : '') + '</div>';
    msgArea.appendChild(userDiv);
    // P8 Day-2.5: status line — Reader used to sit silent for 10-40s (felt frozen)
    const stEl = document.createElement('div');
    stEl.style.cssText = 'padding:2px 0 2px 36px;font-size:11px;color:var(--text-muted);';
    msgArea.appendChild(stEl);
    const aiDiv = document.createElement('div');
    aiDiv.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
    aiDiv.innerHTML = '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#9b59f7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:600;flex-shrink:0;">AI</div>'
        + '<div id="reader-vision-' + Date.now() + '" style="background:var(--bg-hover);color:var(--text-primary);padding:12px 16px;border-radius:14px 14px 14px 4px;font-size:13px;line-height:1.7;max-width:100%;min-height:20px;"></div>';
    msgArea.appendChild(aiDiv);
    const bubble = aiDiv.querySelector('div:last-child');
    msgArea.scrollTop = msgArea.scrollHeight;
    let orb = function(){}; try { orb = orbThinking(bubble, 'vision') || function(){}; } catch (e) {}
    let full = '';
    let lastRender = 0;   // render throttle
    const renderFull = () => {
        bubble.innerHTML = (typeof markdownToHtml === 'function' ? markdownToHtml(full) : full);
        msgArea.scrollTop = msgArea.scrollHeight;
    };
    const hist = (typeof aiChatMessages !== 'undefined') ? aiChatMessages : [];
    try {
        await visionStream(text, hist, {
            __ctx: ctx,
            onStatus: s => { stEl.textContent = s; msgArea.scrollTop = msgArea.scrollHeight; },
            onIntent: i => { stEl.textContent = 'vision · ' + i; },
            onText: d => {
                try { orb(); orb = function(){}; } catch (e) {}
                full += d;
                const now = Date.now();
                if (now - lastRender > 150) { lastRender = now; renderFull(); }
            },
            onGrade: (res, left) => { try { orb(); } catch (e) {} bubble.innerHTML = visionReportHtml(res, left); visionRememberGrade(res); refreshIcons(); },
            onQuota: ev => { try { orb(); } catch (e) {} bubble.innerHTML = visionQuotaHtml(ev); refreshIcons(); },
            onError: t => { try { orb(); } catch (e) {} bubble.innerHTML = '<span style="color:#ff6b6b;">' + escapeHtml(t) + '</span>'; }
        });
    } catch (e) {
        try { orb(); } catch (e2) {}
        bubble.innerHTML = '<span style="color:#ff6b6b;">图片处理失败：' + escapeHtml(String(e.message || e)) + '</span>';
    } finally {
        stEl.textContent = '';
        if (full) renderFull();
        if (typeof aiChatMessages !== 'undefined') {
            aiChatMessages.push({ role: 'user', content: text || '（图片提问）' });
            aiChatMessages.push({ role: 'assistant', content: full || '（图片批改结果）' });
        }
        msgArea.scrollTop = msgArea.scrollHeight;
        refreshIcons();
    }
}

// ---------- 初始化：chip 容器注入 + 粘贴绑定 ----------
document.addEventListener('DOMContentLoaded', () => {
    try {
        // tutor：chip 挂在 skill-pill 行与 composer 之间
        const pillRow = document.getElementById('tutor-skill-pill-row');
        if (pillRow && !document.getElementById('vision-chip-tutor')) {
            const d = document.createElement('div'); d.id = 'vision-chip-tutor';
            pillRow.parentNode.insertBefore(d, pillRow.nextSibling);
        }
        // reader：chip 挂在 AI 输入框正上方
        const rInp = document.getElementById('ai-chat-input');
        if (rInp && !document.getElementById('vision-chip-reader')) {
            const d = document.createElement('div'); d.id = 'vision-chip-reader';
            rInp.parentNode.insertBefore(d, rInp);
        }
        // 隐藏 file input（capture：手机唤起相机）——上下文由 __visionPick 预设
        if (!document.getElementById('vision-file-input')) {
            const f = document.createElement('input');
            f.id = 'vision-file-input'; f.type = 'file'; f.accept = 'image/*';
            f.setAttribute('capture', 'environment'); f.style.display = 'none';
            f.onchange = () => { if (f.files && f.files[0]) visionHandleFiles(f.files[0], __visionPickCtx); f.value = ''; };
            document.body.appendChild(f);
        }
        // 粘贴：tutor + reader 输入框（各携上下文）
        [['tutor-input', 'tutor'], ['ai-chat-input', 'reader']].forEach(([id, ctx]) => {
            const el = document.getElementById(id); if (!el) return;
            el.addEventListener('paste', e => {
                const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(x => x.type.startsWith('image/'));
                if (files.length) { e.preventDefault(); visionHandleFiles(files[0], ctx); }
            });
        });
        visionRenderChip();
    } catch (e) { console.error('[vision] init failed:', e); }
});
