// ===== Dashboard bento modules (hero head / activity feed / continue tile) =====
// Lightweight local event log (localStorage, capped 30 entries). User-action
// call sites (open doc / note / highlight / upload) append via logActivity();
// renderActivity() merges the log with recent notes for the feed. Guests get
// the same local log — no backend involved.

function logActivity(type, text) {
    try {
        const log = JSON.parse(localStorage.getItem('cb_cn_activity') || '[]');
        log.unshift({ t: Date.now(), type: type, text: String(text || '').substring(0, 80) });
        localStorage.setItem('cb_cn_activity', JSON.stringify(log.slice(0, 30)));
    } catch (e) { /* storage full / private mode — feed is best-effort */ }
    // Real-time refresh: if the dashboard is on screen, re-render immediately
    try {
        const pg = document.getElementById('page-dashboard');
        if (pg && pg.classList.contains('active') && typeof renderActivity === 'function') renderActivity();
    } catch (e) { /* best-effort */ }
}

function relTime(ts) {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return '刚刚';
    const m = Math.floor(s / 60); if (m < 60) return m + (m === 1 ? ' min ago' : ' mins ago');
    const h = Math.floor(m / 60); if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(h / 24); if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    return new Date(ts).toLocaleDateString();
}

const ACTIVITY_META = {
    open: ['book-open', 'var(--iris-300)'],
    note: ['notebook-pen', 'var(--green)'],
    highlight: ['highlighter', 'var(--yellow)'],
    upload: ['upload', 'var(--accent)']
};

function renderActivity() {
    const list = document.getElementById('dash-activity-list');
    if (!list) return;
    let events = [];
    try { events = JSON.parse(localStorage.getItem('cb_cn_activity') || '[]'); } catch (e) {}
    // Recent notes always surface, even on devices where the log is empty
    (typeof notesData !== 'undefined' ? notesData : []).forEach(function (n) {
        if (n.isDeleted) return;
        const ts = new Date(n.updatedAt || n.createdAt || 0).getTime();
        if (ts) events.push({ t: ts, type: 'note', text: '笔记 · ' + (n.title || 'Untitled') });
    });
    events.sort(function (a, b) { return b.t - a.t; });
    // Dedupe same type+text within a minute (log entry + merged note)
    const seen = new Set();
    const rows = [];
    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var k = ev.type + '|' + ev.text + '|' + Math.floor(ev.t / 60000);
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push(ev);
        if (rows.length >= 8) break;
    }
    if (!rows.length) {
        list.innerHTML = '<div class="activity-empty">'
            + '<div class="empty-disc"><i data-lucide="activity"></i></div>'
            + '<div class="empty-title">Your activity will appear here</div>'
            + '<div class="empty-sub">Open a document, save a note or a highlight</div></div>';
        refreshIcons();
        return;
    }
    list.innerHTML = rows.map(function (ev) {
        var meta = ACTIVITY_META[ev.type] || ACTIVITY_META.open;
        return '<div class="activity-row">'
            + '<span class="activity-ico" style="color:' + meta[1] + '"><i data-lucide="' + meta[0] + '"></i></span>'
            + '<span class="activity-text">' + escapeHtml(ev.text) + '</span>'
            + '<span class="activity-time">' + relTime(ev.t) + '</span></div>';
    }).join('');
    refreshIcons();
}

// Hero head: time-of-day greeting + date + teaching-week chip
function renderDashHead() {
    var greet = document.getElementById('dash-greeting');
    if (greet) {
        var user = {};
        try { user = JSON.parse(localStorage.getItem('cb_cn_user') || '{}'); } catch (e) {}
        var h = new Date().getHours();
        var part = h < 5 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
        greet.textContent = part + ', ' + (user.name || 'User');
    }
    var sub = document.getElementById('dash-hero-sub');
    if (sub) {
        var date = new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'short', day: 'numeric' });
        var week = (typeof getCurrentWeek === 'function') ? getCurrentWeek() : 1;
        sub.innerHTML = '<span>' + date + '</span>'
            + '<span class="dash-week-chip">' + iconHtml('calendar-range', 11) + '教学周 ' + week + '/16</span>';
        refreshIcons();
    }
}

// Continue tile prepended to the dashboard bookshelf grid (matches cat)
function dashContinueTileHtml(cat) {
    if (cat == null) return '';
    var last = null;
    try { last = JSON.parse(localStorage.getItem('cb_cn_last_doc') || 'null'); } catch (e) {}
    if (!last || last.cat !== cat || last.idx == null) return '';
    var arr = (typeof bsData !== 'undefined' && bsData[cat]) || [];
    var doc = arr[last.idx];
    if (!doc || doc.isDeleted) return '';
    return '<div class="dash-doc dash-doc-continue" onclick="bsOpenFromDash(\'' + cat + '\',' + last.idx + ')">'
        + '<div class="dash-doc-cover">' + iconHtml(doc.icon || 'book-open', 20) + '</div>'
        + '<div class="dash-doc-name">' + escapeHtml(doc.title) + '</div>'
        + '<div class="dash-doc-tag">' + iconHtml('play', 9) + '继续阅读' + (last.page ? ' · p.' + last.page : '') + '</div>'
        + '</div>';
}

function dashboardInit() {
    renderDashHead();
    renderActivity();
    renderReviewDue();
    initWeeklyCard();
}

// ===== P9 Day-3: weekly report (lazy — fetched on first expand) =====
function initWeeklyCard(){
    var d=document.getElementById('weekly-report-card');
    if(!d)return;
    if(!localStorage.getItem('cb_cn_token')){d.style.display='none';return;}
    d.style.display='block';
    d.addEventListener('toggle',function(){
        if(d.open&&!d.dataset.loaded){
            renderWeeklyReport();
        }
    });
}
async function renderWeeklyReport(){
    var body=document.getElementById('weekly-report-body');
    var d=document.getElementById('weekly-report-card');
    if(!body)return;
    try{
        var res=await apiFetch('/api/review/weekly');
        if(!res.ok)throw new Error('HTTP '+res.status);
        var w=await res.json();
        d.dataset.loaded='1';
        var rows=(w.quizzes||[]).map(function(q){
            var pct=Math.round(q.accuracy*100);
            var color=pct>=80?'var(--green)':(pct>=50?'var(--yellow)':'var(--red)');
            return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">'
                +'<span style="flex:1;">'+escapeHtml(q.topic)+'</span>'
                +'<span style="color:var(--text-muted);font-size:11px;">×'+q.attempts+'</span>'
                +'<b style="color:'+color+';min-width:42px;text-align:right;">'+pct+'%</b></div>';
        }).join('')||'<div style="color:var(--text-muted);">本周还没有练习记录</div>';
        var mem=(w.memory||[]).slice(0,3).map(function(m){
            return escapeHtml(m.topic)+' '+Math.round(m.R*100)+'%';
        }).join(' · ');
        body.innerHTML='<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px;">'
            +(w.attempts_total||0)+' 次练习 · '+(w.answered_total||0)+' 题 · 平均正确率 '
            +'<b>'+Math.round((w.accuracy_avg||0)*100)+'%</b></div>'
            +rows
            +(mem?'<div style="margin-top:8px;font-size:11px;color:var(--text-muted);">记忆状态（最弱）：'+mem+'</div>':'')
            +'<div style="margin-top:10px;padding:8px 12px;border-radius:8px;background:rgba(122,107,255,.06);color:var(--text-primary);">'+escapeHtml(w.paragraph||'')+'</div>';
        refreshIcons();
    }catch(e){
        body.innerHTML='<span style="color:var(--text-muted);">周报加载失败，稍后展开重试</span>';
        d.dataset.loaded='';
    }
}

// ===== P9: review-due card (FSRS R(t) < 0.85 → due) =====
// Skill rules applied: aria-atomic full-sentence status (no bare-number live
// region), labeled CTA button ≥44px (no icon-only), Lucide icons.
async function renderReviewDue(){
    var c = document.getElementById('review-due-card');
    if (!c) return;
    if (!localStorage.getItem('cb_cn_token')) { c.style.display = 'none'; return; }
    try {
        var res = await apiFetch('/api/review/due');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        window.__reviewDue = data.due || [];
        if (!data.count) { c.style.display = 'none'; return; }
        var items = data.due.slice(0, 3);
        var chips = items.map(function (d) {
            return '<span style="display:inline-flex;align-items:center;gap:3px;">'
                + escapeHtml(d.topic) + ' <b style="color:' + (d.R < 0.4 ? '#ff8a8a' : '#faad14') + ';">'
                + Math.round(d.R * 100) + '%</b></span>';
        }).join('<span style="opacity:.4;margin:0 4px;">·</span>');
        c.style.display = 'block';
        c.innerHTML = '<div class="card glass" style="margin-bottom:14px;padding:14px 16px;'
            + 'border:1px solid rgba(122,107,255,.28);background:linear-gradient(135deg,'
            + 'rgba(122,107,255,.08),rgba(122,107,255,.02));">'
            + '<div style="display:flex;align-items:center;gap:12px;">'
            + '<span style="color:var(--iris-400,var(--accent));display:flex;">' + iconHtml('timer', 20) + '</span>'
            + '<div style="flex:1;min-width:0;">'
            + '<div role="status" aria-atomic="true" style="font-size:13.5px;font-weight:600;'
            + 'color:var(--text-primary);">' + data.count + ' 个知识点到期复习</div>'
            + '<div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;overflow:hidden;'
            + 'text-overflow:ellipsis;white-space:nowrap;">' + chips + '</div></div>'
            + '<button onclick="startReviewQuiz()" style="min-height:44px;min-width:96px;display:inline-flex;'
            + 'align-items:center;justify-content:center;gap:5px;font-size:12.5px;font-weight:600;padding:8px 16px;'
            + 'border-radius:10px;border:none;background:rgba(122,107,255,.16);color:var(--iris-400,var(--accent));'
            + 'cursor:pointer;transition:background .15s;" onmouseover="this.style.background=\'rgba(122,107,255,.28)\'" '
            + 'onmouseout="this.style.background=\'rgba(122,107,255,.16)\'">'
            + iconHtml('play', 12) + '开始复习</button>'
            + '</div></div>';
        refreshIcons();
    } catch (e) {
        c.style.display = 'none';
    }
}

// One-click review: prefill the quiz page with the WEAKEST due topic and
// auto-start (reuses the agent action-card jump mechanism).
function startReviewQuiz(){
    var first = window.__reviewDue && window.__reviewDue[0];
    if (first && first.topic) {
        if (typeof tutorActionData !== 'undefined') {
            tutorActionData['quiz'] = { topic: first.topic, count: 5 };
        }
        if (typeof tutorActionJump === 'function') { tutorActionJump('quiz'); return; }
    }
    showPage('quiz');
}
