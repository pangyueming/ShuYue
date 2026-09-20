// ===== Init =====
// Inline "thinking" indicator for AI bubbles: a small thought-orb beside the
// label (vanilla port of thinking-orbs). Returns a cleanup that stops the
// canvas loop — always call it when the answer arrives or errors out.
function orbThinking(hostEl, state, label, size) {
    if (!hostEl) return function () {};
    try {
        hostEl.innerHTML = '';
        var slot = document.createElement('span');
        slot.style.cssText = 'display:inline-flex;align-items:center;gap:7px;color:var(--text-muted);font-size:13px;';
        hostEl.appendChild(slot);
        var orb = null;
        if (window.ThinkingOrb) {
            var orbBox = document.createElement('span');
            orbBox.style.cssText = 'display:inline-flex;align-items:center;line-height:1;';
            slot.appendChild(orbBox);
            // Effect layer is best-effort: a canvas/theme failure here must never
            // abort the caller (it used to kill tutorSend before kimiCall fired,
            // leaving a permanently empty bubble).
            try {
                orb = ThinkingOrb.create(orbBox, { state: state || 'searching', size: size || 18, theme: 'auto' });
            } catch (e) {
                console.error('[orbThinking] ThinkingOrb.create failed:', e);
                orb = null;
                if (orbBox.parentNode) orbBox.remove();
            }
        }
        if (label !== false) {
            var txt = document.createElement('span');
            txt.textContent = label != null ? label : 'Thinking...';
            slot.appendChild(txt);
        }
    } catch (e) {
        console.error('[orbThinking] setup failed:', e);
    }
    return function () { try { if (typeof orb !== 'undefined' && orb) orb.destroy(); } catch (e) { /* already gone */ } };
}

// ===== AI activity beams (border-beam) — active only while the AI is working =====
// State-driven glow: the travelling light signals "generating", then fades out.
function reducedMotionOn() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function aiBusy(on) {
    if (window.__aiChatBeam) window.__aiChatBeam.setActive(on && !reducedMotionOn());
    if (window.__aiChatSendBeam) window.__aiChatSendBeam.setActive(on && !reducedMotionOn());
    if (window.__tutorComposerBeam) window.__tutorComposerBeam.setActive(on && !reducedMotionOn());
    if (window.__aiChatInputBeam) window.__aiChatInputBeam.setActive(on && !reducedMotionOn());
}
function initAiEffects() {
    if (!window.BorderBeam) return;
    var header = document.getElementById('ai-chat-header');
    if (header) {
        window.__aiChatBeam = BorderBeam.apply(header, {
            size: 'line', colorVariant: 'ocean', theme: 'auto', active: false, strength: .95,
            wrapperStyle: 'flex-shrink:0;display:block;'
        });
    }
    var sendBtn = document.querySelector('#ai-chat-modal .btn-ai-send');
    if (sendBtn) {
        window.__aiChatSendBeam = BorderBeam.apply(sendBtn, {
            size: 'sm', colorVariant: 'ocean', theme: 'auto', active: false, strength: .9,
            wrapperStyle: 'flex-shrink:0;display:inline-flex;'
        });
    }
    var tutorComposer = document.querySelector('#page-tutor .composer');
    if (tutorComposer) {
        window.__tutorComposerBeam = BorderBeam.apply(tutorComposer, {
            size: 'line', colorVariant: 'ocean', theme: 'auto', active: false, strength: .9,
            wrapperStyle: 'flex-shrink:0;display:block;'
        });
    }
    var chatInput = document.getElementById('ai-chat-input');
    if (chatInput) {
        window.__aiChatInputBeam = BorderBeam.apply(chatInput, {
            size: 'line', colorVariant: 'ocean', theme: 'auto', active: false, strength: .9,
            wrapperStyle: 'flex:1;display:inline-flex;flex-shrink:1;min-width:0;'
        });
    }
}

// ===== Tutor mode liquid indicator (liquid-gooey) =====
// An accent pill slides between General / Deep with a liquid trail; the buttons
// themselves stay transparent — the pill carries the active state.
function initTutorGooey() {
    var seg = document.querySelector('#page-tutor .seg');
    var general = document.getElementById('tutor-mode-general');
    var deep = document.getElementById('tutor-mode-deep');
    if (!seg || !general || !deep) return;
    if (!window.LiquidGooey || reducedMotionOn()) return;

    var pill = document.createElement('div');
    pill.style.cssText = 'position:absolute;top:3px;bottom:3px;left:0;width:0;border-radius:8px;background:var(--accent);z-index:0;will-change:left,width;transition:left .45s cubic-bezier(.34,1.56,.64,1),width .45s cubic-bezier(.34,1.56,.64,1);';
    var prevPos = seg.style.position;
    seg.style.position = 'relative';
    seg.insertBefore(pill, seg.firstChild);
    [general, deep].forEach(function (b) {
        b.style.background = 'transparent';
        b.style.position = 'relative';
        b.style.zIndex = '1';
    });

    var goo = LiquidGooey.create(seg, { fill: 'var(--accent)', filterPadding: 14, blur: 5 });
    goo.item(pill, { effect: ['morph', 'move'], move: { springiness: .55, stretch: .45, trail: .5 } });

    var pillMode = 'general';   // mirrors tutor.js tutorMode ('general' is the boot default)
    function place(instant) {
        var btn = pillMode === 'deep' ? deep : general;
        if (instant) pill.style.transition = 'none';
        pill.style.left = (btn.offsetLeft + 3) + 'px';
        pill.style.width = (btn.offsetWidth - 6) + 'px';
        if (instant) {
            void pill.offsetWidth;   // flush the instant placement
            pill.style.transition = '';
        }
    }
    window.__tutorGooeyMove = function (m) {
        if (m) pillMode = m;
        place(false);
    };
    place(true);
    // Keep geometry in step with container resizes
    if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function () { place(true); });
        ro.observe(seg);
    }
}

// ===== Plotter mode liquid indicator (liquid-gooey) =====
// Same sliding-pill pattern as the tutor mode switch, for the 2D/3D seg.
function initPlotGooey() {
    var seg = document.querySelector('#page-plotter .workbench-toolbar .seg');
    var b2 = document.getElementById('plot-mode-2d');
    var b3 = document.getElementById('plot-mode-3d');
    if (!seg || !b2 || !b3) return;
    if (!window.LiquidGooey || reducedMotionOn()) return;

    var pill = document.createElement('div');
    pill.style.cssText = 'position:absolute;top:3px;bottom:3px;left:0;width:0;border-radius:8px;background:var(--accent);z-index:0;will-change:left,width;transition:left .45s cubic-bezier(.34,1.56,.64,1),width .45s cubic-bezier(.34,1.56,.64,1);';
    seg.style.position = 'relative';
    seg.insertBefore(pill, seg.firstChild);
    [b2, b3].forEach(function (b) {
        b.style.background = 'transparent';
        b.style.position = 'relative';
        b.style.zIndex = '1';
    });

    var goo = LiquidGooey.create(seg, { fill: 'var(--accent)', filterPadding: 14, blur: 5 });
    goo.item(pill, { effect: ['morph', 'move'], move: { springiness: .55, stretch: .45, trail: .5 } });

    var pillMode = '2d';   // mirrors plotter.js pm ('2d' is the boot default)
    function place(instant) {
        var btn = pillMode === '3d' ? b3 : b2;
        if (instant) pill.style.transition = 'none';
        pill.style.left = (btn.offsetLeft + 3) + 'px';
        pill.style.width = (btn.offsetWidth - 6) + 'px';
        if (instant) {
            void pill.offsetWidth;   // flush the instant placement
            pill.style.transition = '';
        }
    }
    window.__plotGooeyMove = function (m) {
        if (m) pillMode = m;
        place(false);
    };
    place(true);
    // Keep geometry in step with container resizes (page starts hidden — RO
    // re-places the pill the moment the seg becomes visible)
    if (typeof ResizeObserver !== 'undefined') {
        var ro = new ResizeObserver(function () { place(true); });
        ro.observe(seg);
    }
}

// ===== Form busy beams (login / register / forgot / upload) =====
// Dormant sm beams on submit CTAs; formBusy() wakes them, disables the button
// and swaps its label while the request is in flight (also blocks double submits).
function initFormEffects() {
    if (!window.BorderBeam) return;
    window.__formBeams = {};
    var targets = {
        'login-form': '#login-form .login-cta',
        'register-form': '#register-form .login-cta',
        'forgot-form': '#forgot-form .login-cta',
        'bs-upload': '#bs-upload-modal .step-nav .btn-primary'
    };
    Object.keys(targets).forEach(function (key) {
        var btn = document.querySelector(targets[key]);
        if (!btn) return;
        var wrap = key === 'bs-upload'
            ? 'flex:1;display:flex;flex-shrink:0;'
            : 'display:block;flex-shrink:0;';
        window.__formBeams[key] = BorderBeam.apply(btn, {
            size: 'sm', colorVariant: 'ocean', theme: 'auto', active: false, strength: .9,
            wrapperStyle: wrap
        });
    });
}

// key: 'login-form' | 'register-form' | 'forgot-form' | 'bs-upload'
function formBusy(key, on, label) {
    var btn = key === 'bs-upload'
        ? document.querySelector('#bs-upload-modal .step-nav .btn-primary')
        : document.querySelector('#' + key + ' .login-cta');
    if (btn) {
        btn.disabled = on;
        if (on && label != null) {
            if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
            btn.textContent = label;
        } else if (!on && btn.dataset.origText) {
            btn.textContent = btn.dataset.origText;
            delete btn.dataset.origText;
        }
    }
    var beam = window.__formBeams && window.__formBeams[key];
    if (beam) beam.setActive(on && !reducedMotionOn());
}

// ===== Tutor Send liquid-metal button (liquid-gooey) =====
// The Send button becomes a mercury capsule: the gooey silhouette (fill from
// the theme-aware --tutor-liquid token) paints a chrome bevel — inset top
// highlight + bottom shade — behind the now-transparent button, with a subtle
// 'evolve' keeping the surface alive. Stock btn-primary when the effect layer
// or motion is unavailable.
function initTutorSendLiquid() {
    var composer = document.querySelector('#page-tutor .composer');
    var send = document.querySelector('#page-tutor .composer .btn-primary');
    if (!composer || !send) return;
    if (!window.LiquidGooey || reducedMotionOn()) return;

    send.classList.add('tutor-send-liquid');
    var goo = LiquidGooey.create(composer, {
        fill: 'var(--tutor-liquid)',
        shadow: 'inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 5px rgba(10,14,30,.38), 0 3px 10px rgba(9,12,24,.35)',
        blur: 5, contrast: 18, filterPadding: 18
    });
    goo.item(send, { effect: ['evolve'], radius: 999 });
    window.__tutorSendGoo = goo;
}

document.addEventListener('DOMContentLoaded',async()=>{
    if(window.lucide)lucide.createIcons();
    renderSidebarUser();
    plotInit();
    await loadUserStats();
    animateCountUp();
    document.addEventListener('click',function(e){
        const btn=e.target.closest('.btn-primary,.btn-secondary');
        if(btn)ripple({currentTarget:btn,clientX:e.clientX,clientY:e.clientY});
    });
    // Study plan: checkbox toggle + drag & drop
    document.addEventListener('change',function(e){
        if(e.target.classList&&e.target.classList.contains('plan-check'))togglePlanComplete(e.target.dataset.key);
    });
    document.addEventListener('dragstart',function(e){
        const card=e.target.closest('.plan-card');
        if(card){planDragKey=card.dataset.key;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',card.dataset.key);}catch(_){}}
    });
    document.addEventListener('dragend',function(e){
        const card=e.target.closest('.plan-card');
        if(card)card.classList.remove('dragging');
        planDragKey=null;
    });
    // Check if logged in
    const token=localStorage.getItem('cb_cn_token');
    if(token){
        // Refresh cached user data from server (DB may have changed since login)
        try{
            const meRes=await apiFetch('/api/auth/me');
            if(meRes&&meRes.ok){
                const fresh=await meRes.json();
                if(fresh&&fresh.email){
                    localStorage.setItem('cb_cn_user',JSON.stringify(fresh));
                }
            }
        }catch(e){/* offline: keep cached user */}
        const user=JSON.parse(localStorage.getItem('cb_cn_user')||'{}');
        const welcomeEl=document.querySelector('#page-dashboard h1');
        if(welcomeEl)welcomeEl.textContent='Hello, '+(user.name||'User');
        await bsPageInit();
        await notesInit();
    }else{
        // Guest mode: don't load from backend
        ensureGuideInShelf();
        bsPageRenderTabs();
        bsPageRenderGrid('slides');
        notesRender();
    }
    readerRenderNotes();
    readerRenderHighlights();
    bsRenderDashboard(bsPageCat);
    dashboardInit();
    initAiEffects();
    initTutorGooey();
    initTutorSendLiquid();
    initPlotGooey();
    initFormEffects();
    await pullPlanFromCloud();      // logged-in: plan state from cloud (newest wins)
    await restorePretestData();     // logged-in: pretest from cloud snapshot
    checkWeeklyUpdate();
});
