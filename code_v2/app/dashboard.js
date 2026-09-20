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
}
