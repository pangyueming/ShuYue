// ===== [MinerU] global parse tracker + confirmation modal =====
const mineruTracker={pending:{},progress:{},queue:[],busy:false};

function mineruTrackerFetch(path){
    const token=localStorage.getItem('cb_token')||'';
    return fetch(AI_BACKEND_URL+path,{headers:{'Authorization':'Bearer '+token}});
}

function mineruUpdateProgressWidgets(){
    // in-place progress updates — no grid re-render (keeps hover states, no flicker)
    Object.keys(mineruTracker.progress).forEach(id=>{
        const p=mineruTracker.progress[id];
        document.querySelectorAll('[data-mineru-progress="'+id+'"]').forEach(box=>{
            const fill=box.querySelector('.mineru-prog-fill');
            const text=box.querySelector('.mineru-prog-text');
            const pctEl=box.querySelector('.mineru-prog-pct');
            const pct=p.total_pages?Math.min(99,Math.round(p.pages_done*100/p.total_pages)):0;
            if(fill&&!fill.style.animation){fill.style.width=pct+'%';}   // animated (indexing) bars keep full width
            if(text)text.textContent=p.status==='queued'?'Queued…':(p.status==='indexing'?'构建检索索引中…':(pct+'% · '+p.pages_done+'/'+p.total_pages+' pages'));
            if(pctEl)pctEl.textContent=p.status==='indexing'?'idx':(p.status==='queued'?'…':pct+'%');
        });
    });
}

function mineruTrackerTick(){
    if(!localStorage.getItem('cb_token'))return;   // no session -> skip (avoid 401 spam)
    mineruTrackerFetch('/api/documents/parsing')
    .then(r=>r.ok?r.json():Promise.reject(new Error('HTTP '+r.status)))
    .then(list=>{
        const now={};
        (list||[]).forEach(d=>{now[d.id]=d;});
        mineruTracker.progress={};
        (list||[]).forEach(d=>{mineruTracker.progress[d.id]=d;});
        mineruUpdateProgressWidgets();
        Object.keys(mineruTracker.pending).forEach(id=>{
            if(now[id])return;   // still pending
            mineruTrackerFetch('/api/documents/'+id+'/parse')
            .then(r=>r.ok?r.json():null)
            .then(s=>{
                if(!s)return;
                if(typeof mineruGateDoc!=='undefined'&&mineruGateDoc&&mineruGateDoc.id===id
                   &&document.getElementById('mineru-gate').style.display==='flex')return;
                if(s.status==='done'||s.status==='failed'){
                    mineruTracker.queue.push({id,title:mineruTracker.pending[id].title,ok:s.status==='done',error:s.error||''});
                    mineruShowNextDone();
                }
            })
            .catch(()=>{});
        });
        mineruTracker.pending=now;
    })
    .catch(()=>{});
}

const MINERU_STATUS_LABELS={done:'MinerU 已解析',failed:'Parsing failed',parsing:'MinerU 解析中…',indexing:'构建索引中…',queued:'Queued',none:'未解析'};

function mineruSyncDoc(id,status){
    let changed=false;
    Object.keys(bsData).forEach(c=>bsData[c].forEach(d=>{
        if(d.id===id&&d.parseStatus!==status){
            d.parseStatus=status;
            if(status==='done')d.aiDeclined=false;
            const base=(d.desc||'').split('·')[0].trim();
            d.desc=base+(MINERU_STATUS_LABELS[status]?' · '+MINERU_STATUS_LABELS[status]:'');
            changed=true;
        }
    }));
    if(changed){
        try{
            if(typeof bsPageRenderGrid==='function'&&typeof bsPageCat!=='undefined')bsPageRenderGrid(bsPageCat);
            if(typeof bsRenderDashboard==='function'&&typeof bsPageCat!=='undefined')bsRenderDashboard(bsPageCat);
        }catch(e){}
        if(typeof readerCurrentDocId!=='undefined'&&readerCurrentDocId===id){
            const aiBtn=document.getElementById('reader-enable-ai');
            if(aiBtn)aiBtn.style.display=status==='done'?'none':aiBtn.style.display;
            const tgl=document.getElementById('reader-view-toggle');
            if(tgl&&status==='done'&&typeof readerDocType!=='undefined'&&readerDocType)tgl.style.display='block';
        }
    }
}

function mineruShowNextDone(){
    if(mineruTracker.busy||!mineruTracker.queue.length)return;
    mineruTracker.busy=true;
    const item=mineruTracker.queue.shift();
    const icon=document.getElementById('mineru-done-icon');
    const title=document.getElementById('mineru-done-title');
    const body=document.getElementById('mineru-done-body');
    const openBtn=document.getElementById('mineru-done-open');
    if(item.ok){
        icon.style.color='#52c41a';
        icon.innerHTML=iconHtml('check-circle',40);
        title.textContent='AI 重排完成';
        body.innerHTML='"'+escapeHtml(item.title)+'" is ready — formatted text, rendered formulas and Q&A are now unlocked.';
        openBtn.style.display='inline-block';
        openBtn.textContent='Open Book';
    }else if(mineruIsAuthError(item)){
        icon.style.color='var(--yellow)';
        icon.innerHTML=iconHtml('key-round',40);
        title.textContent='MinerU API Key 被拒绝';
        body.innerHTML='Your MinerU API key was rejected while parsing "'+escapeHtml(item.title)+'".<br><span style="font-size:11px;color:var(--text-muted);">Update your key to continue — completed parts are cached.</span>';
        openBtn.style.display='inline-block';
        openBtn.textContent='Update Key';
    }else{
        icon.style.color='#ff6b6b';
        icon.innerHTML=iconHtml('alert-circle',40);
        title.textContent='AI 重排失败';
        body.innerHTML='"'+escapeHtml(item.title)+'" could not be parsed.<br><span style="font-size:11px;color:var(--text-muted);">'+escapeHtml(item.error||'Unknown error')+'</span>';
        openBtn.style.display='none';
    }
    refreshIcons();
    // keep progress bars at 100% while the modal awaits user confirmation —
    // cards only flip to the green badge AFTER the user clicks OK / Open Book
    openBtn.onclick=()=>{
        mineruCloseDone();
        if(item.ok){mineruSyncDoc(item.id,'done');mineruOpenBookById(item.id);}
        else{mineruOpenGateAuthFix(item.id);}
    };
    document.getElementById('mineru-done-ok').onclick=()=>{mineruCloseDone();mineruSyncDoc(item.id,item.ok?'done':'failed');};
    document.getElementById('mineru-done-modal').style.display='flex';
}

function mineruOpenGateAuthFix(id){
    let found=null;
    Object.keys(bsData).forEach(c=>bsData[c].forEach((d,i)=>{if(d.id===id)found={doc:d,cat:c,idx:i};}));
    if(!found)return;
    mineruGateDoc=found.doc; mineruGateRef={cat:found.cat,idx:found.idx}; mineruGateOpensReader=true;
    document.getElementById('mineru-gate').style.display='flex';
    mineruGateUpdateKey();
}

function mineruCloseDone(){
    document.getElementById('mineru-done-modal').style.display='none';
    mineruTracker.busy=false;
    mineruShowNextDone();
}

function mineruOpenBookById(id){
    let found=null;
    Object.keys(bsData).forEach(c=>bsData[c].forEach((d,i)=>{if(d.id===id)found={cat:c,idx:i};}));
    if(!found){if(typeof showPage==='function')showPage('bookshelf');return;}
    if(typeof showPage==='function')showPage('reader');
    setTimeout(()=>{readerOpenDoc(found.cat,found.idx);},100);
}

// start the tracker: runs app-wide regardless of current page
setInterval(mineruTrackerTick,10000);
mineruTrackerTick();

// ===== [MinerU] gate: onboarding -> consent -> progress =====
let mineruGateDoc=null, mineruGateRef=null, mineruGateOpensReader=false;

function mineruGateClose(){document.getElementById('mineru-gate').style.display='none';}

function mineruGateReopen(){
    if(!readerCurrentDocRef)return;
    const ref=readerCurrentDocRef;
    const doc=bsData[ref.cat]&&bsData[ref.cat][ref.idx];
    if(!doc)return;
    mineruGateOpen(doc,ref.cat,ref.idx,true);
}

function bsMineruById(id){
    let found=null;
    Object.keys(bsData).forEach(c=>bsData[c].forEach((d,i)=>{if(d.id===id)found={cat:c,idx:i,doc:d};}));
    if(found)mineruGateOpen(found.doc,found.cat,found.idx,false);
}

async function mineruGateOpen(doc,cat,idx,opensReader){
    mineruGateDoc=doc; mineruGateRef={cat,idx};
    mineruGateOpensReader=opensReader===true;
    document.getElementById('mineru-gate').style.display='flex';
    const body=document.getElementById('mineru-gate-body');
    body.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">Checking…</div>';
    // check current parse state FIRST — an active parse goes straight to progress,
    // never re-ask consent for a job that's already running
    let state=null;
    try{
        const r=await apiFetch('/api/documents/'+doc.id+'/parse');
        if(r.ok){const s=await r.json();state=s.status;}
    }catch(e){}
    if(state==='queued'||state==='parsing'||state==='indexing'){
        mineruGateRenderProgress();
        return;
    }
    if(state==='done'){
        // stale card data — sync and open the reformatted view directly
        mineruGateClose();
        if(typeof mineruSyncDoc==='function')mineruSyncDoc(doc.id,'done');
        if(mineruGateOpensReader&&mineruGateRef)readerOpenDoc(mineruGateRef.cat,mineruGateRef.idx);
        return;
    }
    let cfg={configured:false};
    try{
        const r=await apiFetch('/api/user/mineru-token');
        if(r.ok)cfg=await r.json();
    }catch(e){}
    if(cfg.configured){mineruGateRenderConsent();}
    else{mineruGateRenderOnboarding();}
}

function mineruGateRenderOnboarding(){
    const body=document.getElementById('mineru-gate-body');
    const scanned=mineruGateDoc&&mineruGateDoc.needsOcr;
    body.innerHTML=`
    <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:4px 0 14px;">
        ${scanned
            ?'This scanned PDF has no selectable text. AI re-layout unlocks formatted text, rendered formulas and citation-grounded Q&A — using <b>your own free MinerU account</b> (2,000 pages/day free).'
            :'This textbook already reads fine — parsing builds a <b>searchable index</b> so Chat AI can search the whole book (formulas become clean LaTeX) — using <b>your own free MinerU account</b> (2,000 pages/day free).'}</p>
    <div style="background:var(--bg-input);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;font-size:13px;line-height:2;color:var(--text-secondary);">
        <b style="color:var(--text-primary);">Setup (one time only):</b><br>
        1. Create a free account at
        <a href="https://mineru.net" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;">mineru.net ↗</a><br>
        2. Open <span style="font-family:monospace;background:var(--bg-tag);padding:1px 6px;border-radius:4px;">Avatar → API Key</span> and create a key<br>
        3. Paste your API key below — it is stored <b>encrypted</b> and never shown again
    </div>
    <input id="mineru-key-input" type="password" placeholder="Paste your API key (starts with sk-)" class="input" style="width:100%;font-size:13px;">
    <div id="mineru-key-error" style="color:#ff6b6b;font-size:12px;min-height:16px;margin-top:4px;"></div>
    <button id="mineru-key-save" onclick="mineruGateSaveKey()" style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">保存 Key 并继续</button>
    <button onclick="mineruGateOpenGuide()" style="width:100%;margin-top:10px;padding:6px;border:none;background:transparent;color:var(--accent);font-size:12px;cursor:pointer;text-decoration:underline;">What is MinerU? — read the 1-minute guide</button>
    <button onclick="mineruGateChooseOriginal()" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:none;background:transparent;color:var(--text-muted);font-size:12px;cursor:pointer;">${mineruGateOpensReader?'Skip — show original pages only':'Not now'}</button>
    <div id="mineru-quota-line" style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:10px;"></div>`;
    mineruFillQuota('mineru-quota-line');
    setTimeout(()=>{const i=document.getElementById('mineru-key-input');if(i)i.focus();},100);
}

async function mineruFillQuota(elId){
    const el=document.getElementById(elId);
    if(!el)return;
    try{
        const r=await apiFetch('/api/user/mineru-usage');
        if(!r.ok)return;
        const u=await r.json();
        el.textContent='今日 MinerU：'+u.used+' / '+u.limit.toLocaleString()+' pages · resets daily';
    }catch(e){/* offline: leave blank */}
}

function mineruGateRenderQuota(d){
    const body=document.getElementById('mineru-gate-body');
    body.innerHTML=`
    <div style="text-align:center;padding:10px 0;">
        <div style="color:var(--yellow);margin-bottom:10px;display:flex;justify-content:center;">${iconHtml('hourglass',34)}</div>
        <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">今日 MinerU 配额已用完</div>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;">
            This book needs <b>${d.needed}</b> pages, but only <b>${d.remaining}</b> of today's
            ${d.limit.toLocaleString()} free pages remain.<br>
            Parsing stopped — <b>finished parts are kept</b>, so continuing tomorrow costs 0 extra pages.</p>
        <button onclick="mineruGateClose()" style="width:100%;margin-top:12px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">OK — continue tomorrow</button>
    </div>`;
    refreshIcons();
}

function mineruGateOpenGuide(){
    mineruGateClose();
    window.__guideShown=true;   // main guide shouldn't hijack this visit
    showPage('reader');
    setTimeout(()=>{
        ensureGuideInShelf();
        const i=(bsData.textbooks||[]).findIndex(d=>d.id==='__mineru_guide__');
        if(i!==-1)readerOpenDoc('textbooks',i);
    },80);
}

async function mineruGateSaveKey(){
    const input=document.getElementById('mineru-key-input');
    const errEl=document.getElementById('mineru-key-error');
    const btn=document.getElementById('mineru-key-save');
    const key=(input&&input.value||'').trim();
    if(!key.startsWith('sk-')||key.length<20){errEl.textContent='Key 无效——应以 "sk-" 开头。';return;}
    errEl.textContent='';
    if(btn){btn.disabled=true;btn.textContent='正在验证 Key…';}
    try{
        const r=await apiFetch('/api/user/mineru-token',{method:'PUT',body:JSON.stringify({token:key})});
        if(!r.ok){
            const e=await r.json().catch(()=>({}));
            throw new Error(e.detail||('HTTP '+r.status));
        }
        if(mineruKeyRetryPending){mineruGateOfferRetry();}
        else{mineruGateRenderConsent();}
    }catch(e){
        errEl.textContent=e.message;
        if(btn){btn.disabled=false;btn.textContent='Save Key & Continue';}
        return;
    }
}

// ===== [MinerU] auth-error recovery: update key -> one-click retry =====
let mineruKeyRetryPending=false;

function mineruIsAuthError(s){
    return s&&(s.error_type==='auth'||/rejected/i.test(s.error||''));
}

function mineruGateUpdateKey(){
    mineruKeyRetryPending=true;
    mineruGateRenderOnboarding();
    const errEl=document.getElementById('mineru-key-error');
    if(errEl)errEl.textContent='The previous key was rejected — please paste a different one.';
}

function mineruGateOfferRetry(){
    const body=document.getElementById('mineru-gate-body');
    const title=mineruGateDoc?escapeHtml(mineruGateDoc.title):'this document';
    body.innerHTML=`
    <div style="text-align:center;padding:10px 0;">
        <div style="color:var(--green);margin-bottom:8px;display:flex;justify-content:center;">${iconHtml('key-round',34)}</div>
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">Key 已更新</div>
        <p style="font-size:13px;color:var(--text-secondary);margin:0 0 16px;">Your new MinerU key is saved.<br>现在重试解析 "${title}" 吗？</p>
        <div style="display:flex;gap:10px;">
            <button onclick="mineruGateStart()" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">${iconHtml('rotate-ccw',14)}Retry Parse</button>
            <button onclick="mineruGateChooseOriginal()" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-secondary);font-size:13px;cursor:pointer;">暂不启用</button>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">Completed parts are cached — retrying won't re-spend those pages.</p>
    </div>`;
    refreshIcons();
}

function mineruGateRenderConsent(){
    const body=document.getElementById('mineru-gate-body');
    const title=mineruGateDoc?mineruGateDoc.title:'this document';
    const scanned=mineruGateDoc&&mineruGateDoc.needsOcr;
    body.innerHTML=`
    <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:4px 0 14px;">
        <b style="color:var(--text-primary);">"${escapeHtml(title)}"</b> ${scanned
            ?'is a scanned PDF with no selectable text.<br>Enable AI re-layout now? (uses your MinerU key; large books take ~5–20 min)'
            :'reads fine as-is.<br>Build a whole-book AI index now? Reading stays unchanged — only Chat AI gains book-wide search. (uses your MinerU key)'}</p>
    <div style="display:flex;gap:10px;">
        <button onclick="mineruGateStart()" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">${iconHtml('sparkles',14)}${scanned?'Enable AI Re-layout':'Build AI Index'}</button>
        <button onclick="mineruGateChooseOriginal()" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-secondary);font-size:13px;cursor:pointer;">${mineruGateOpensReader?'Original Pages Only':'Not now'}</button>
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">You can change your mind later via the "Enable AI" button in the toolbar.</p>
    <div id="mineru-quota-line" style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:6px;"></div>`;
    refreshIcons();
}

async function mineruGateChooseOriginal(){
    if(mineruGateDoc&&mineruGateDoc.id){
        try{await apiFetch('/api/documents/'+mineruGateDoc.id+'/decline-ai',{method:'POST'});}catch(e){}
        mineruGateDoc.aiDeclined=true;
    }
    mineruGateClose();
    if(mineruGateOpensReader&&mineruGateRef){
        readerOpenDoc(mineruGateRef.cat,mineruGateRef.idx);
    }else{
        try{
            if(typeof bsPageRenderGrid==='function'&&typeof bsPageCat!=='undefined')bsPageRenderGrid(bsPageCat);
            if(typeof bsRenderDashboard==='function'&&typeof bsPageCat!=='undefined')bsRenderDashboard(bsPageCat);
        }catch(e){}
    }
}

async function mineruGateStart(){
    const body=document.getElementById('mineru-gate-body');
    body.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">Starting…</div>';
    try{
        const r=await apiFetch('/api/documents/'+mineruGateDoc.id+'/parse',{method:'POST'});
        if(!r.ok){
            const e=await r.json().catch(()=>({}));
            const d=e.detail;
            if(d&&typeof d==='object'&&d.reason==='quota'){mineruGateRenderQuota(d);return;}
            throw new Error((d&&d.reason)||d||('HTTP '+r.status));
        }
        mineruGateRenderProgress();
    }catch(e){
        body.innerHTML='<div style="color:#ff6b6b;font-size:13px;padding:12px;">'+escapeHtml(e.message)+'</div>'+
            '<button onclick="mineruGateRenderConsent()" style="width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-secondary);font-size:13px;cursor:pointer;">返回</button>';
    }
}

function mineruGateRenderProgress(){
    const body=document.getElementById('mineru-gate-body');
    const title=mineruGateDoc?escapeHtml(mineruGateDoc.title):'';
    body.innerHTML=`
    <div style="text-align:center;padding:14px 0;">
        <div class="spinner" style="margin:0 auto 14px;"></div>
        <div id="mineru-progress-text" style="font-size:13px;color:var(--text-primary);font-weight:600;">Queued…</div>
        <div id="mineru-progress-sub" style="font-size:11px;color:var(--text-muted);margin-top:6px;">"${title}" · you can close this dialog, parsing continues in the background</div>
        <div id="mineru-quota-line" style="font-size:11px;color:var(--text-muted);margin-top:8px;"></div>
    </div>`;
    const quotaEl=document.getElementById('mineru-quota-line');
    const poll=async()=>{
        try{
            const r=await apiFetch('/api/documents/'+mineruGateDoc.id+'/parse');
            if(r.ok){
                const s=await r.json();
                const t=document.getElementById('mineru-progress-text');
                if(t){
                    if(s.status==='done'){
                        t.textContent='Done!';
                        setTimeout(()=>{
                            mineruGateClose();
                            if(mineruGateRef)readerOpenDoc(mineruGateRef.cat,mineruGateRef.idx);
                        },600);
                        return;
                    }
                    if(s.status==='failed'){
                        const auth=mineruIsAuthError(s);
                        const quotaFail=s.error_type==='quota'||/quota/i.test(s.error||'');
                        t.innerHTML='<span style="color:#ff6b6b;">'+escapeHtml(s.error||'Parsing failed')+'</span>';
                        const sub=document.getElementById('mineru-progress-sub');
                        if(sub&&auth){
                            sub.innerHTML='<button onclick="mineruGateUpdateKey()" style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;padding:8px 20px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">'+iconHtml('key-round',13)+'Update MinerU Key & Retry</button>';
                            refreshIcons();
                        }else if(sub&&quotaFail){
                            sub.innerHTML='<span style="color:#faad14;">Finished parts are kept — continue tomorrow at no extra cost.</span>';
                        }
                        return;
                    }
                    const pages=s.total_pages?(' · '+s.pages_done+'/'+s.total_pages+' pages'):'';
                    t.textContent=s.status==='indexing'?'构建检索索引中…':'Parsing on MinerU cloud'+pages;
                    if(quotaEl&&typeof s.mineru_used==='number'){
                        quotaEl.textContent='今日 MinerU：'+s.mineru_used+' / '+(s.mineru_limit||2000).toLocaleString()+' pages · resets daily';
                    }
                }
            }
        }catch(e){}
        setTimeout(poll,3000);
    };
    poll();
}

// ===== [MinerU] reformatted document view (docview) =====
let readerViewMode='doc';
let readerLastDocId=null;
let readerCurrentDocRef=null;
let readerPendingScrollPage=null;   // cross-view page sync on Original ⇄ Reformatted toggle
let readerPendingAnchor='';         // first chars of the visible page's text (off-by-one guard)

function readerDetectCurrentPage(){
    const area=document.getElementById('reader-content-area');
    const container=document.getElementById('pdf-pages-container');
    if(!area||!container)return 1;
    const pages=container.querySelectorAll('[data-page-num]');
    let cur=1;
    for(const p of pages){
        const r=p.getBoundingClientRect();
        if(r.top<area.clientHeight/2){cur=parseInt(p.dataset.pageNum)||1;}  // last page that crossed the mid-line
        else break;
    }
    return cur;
}

// Deterministic restore: direct scrollTop math (no scrollIntoView ancestor chains).
function readerRestoreScroll(target){
    const area=document.getElementById('reader-content-area');
    const el=document.getElementById('pdf-page-'+target);
    if(!area||!el)return;
    area.style.scrollBehavior='auto';   // belt-and-suspenders: never animate programmatic landings
    const a=area.getBoundingClientRect(),r=el.getBoundingClientRect();
    area.scrollTop+=r.top-a.top-8;
    const tb=document.getElementById('reader-toolbar');
    const title=document.getElementById('reader-doc-title').textContent||'';
    if(tb)tb.textContent='Page '+target+' of '+readerPdfTotal+' · '+title;
}

function readerApplyPendingScroll(){
    if(!readerPendingScrollPage)return;
    const target=readerPendingScrollPage;
    // early landing on placeholders; the render hook makes the final exact call
    // (no blanket re-assert — extra scrollTop writes fed the scroll/reflow storm)
    requestAnimationFrame(()=>readerRestoreScroll(target));
    setTimeout(()=>{if(readerPendingScrollPage===target)readerPendingScrollPage=null;},2000);  // safety expiry
}

// Render hook (docview + pdf): called when a page's real content materialises.
// If it's the pending page, optionally correct ±1 via the text anchor, then final restore.
function readerAnchorRestore(pageNum){
    if(readerPendingScrollPage!==pageNum)return;
    const anchor=readerPendingAnchor;
    if(anchor){
        const here=(document.getElementById('pdf-page-'+pageNum).dataset.text||'');
        if(!here.includes(anchor.slice(0,30))){
            for(const n of [pageNum-1,pageNum+1]){
                if(n<1||n>readerPdfTotal)continue;
                const t=(document.getElementById('pdf-page-'+n)||{}).dataset||{};
                if((t.text||'').includes(anchor.slice(0,30))){readerPendingScrollPage=n;break;}
            }
        }
    }
    const finalPage=readerPendingScrollPage;
    readerPendingScrollPage=null;readerPendingAnchor='';
    readerRestoreScroll(finalPage);
}
const MINERU_SKIP_TYPES=new Set(['header','footer','page_number','aside_text','page_footnote']);

function readerToggleView(){
    if(!readerCurrentDocRef)return;
    readerPendingScrollPage=readerDetectCurrentPage();   // keep position across views
    const pd=document.getElementById('pdf-page-'+readerPendingScrollPage);
    readerPendingAnchor=((pd&&pd.dataset.text)||'').trim().slice(0,60);   // off-by-one guard
    readerViewMode=readerViewMode==='doc'?'pdf':'doc';
    const btn=document.getElementById('reader-view-toggle');
    if(btn)btn.textContent=readerViewMode==='doc'?'Original Pages':'Reformatted';
    const ref=readerCurrentDocRef;
    readerOpenDoc(ref.cat,ref.idx);
}

async function readerOpenDocView(doc,area){
    readerDocType='docview';
    area.innerHTML='<div style="text-align:center;padding:60px;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:12px;"><div class="spinner"></div><p>Loading reformatted document…</p></div>';
    area.style.cssText='flex:1;overflow-y:auto;padding:24px 8px;background:var(--bg-tag);';
    let total=0;
    try{
        const r=await apiFetch('/api/documents/'+readerCurrentDocId+'/pages/1');
        if(!r.ok)throw new Error('HTTP '+r.status);
        const meta=await r.json();
        total=meta.total_pages||1;
    }catch(e){
        area.innerHTML='<div style="text-align:center;padding:60px;color:#ff6b6b;">Failed to load reformatted document<br><span style="font-size:12px;">'+escapeHtml(e.message)+'</span></div>';
        return;
    }
    readerPdfTotal=total;
    area.innerHTML='';
    const container=document.createElement('div');
    container.id='pdf-pages-container';
    container.style.cssText='max-width:860px;margin:0 auto;';
    area.appendChild(container);
    // [Virtualization] Batch-build ALL placeholders in ONE innerHTML pass
    // (465 x createElement was the main source of open-lag) — then only a
    // sliding WINDOW of ~40 pages is ever observed at once (react-window /
    // PDF.js-viewer pattern), not all 465.
    let _ph='';
    for(let i=1;i<=total;i++){
        _ph+='<div id="pdf-page-'+i+'" data-page-num="'+i+'" class="docview-page" style="margin:0 auto 18px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:6px 34px 20px;min-height:200px;box-shadow:0 1px 4px rgba(0,0,0,.06);"><div style="display:flex;align-items:center;justify-content:center;padding:34px;color:var(--text-muted);font-size:13px;">Page '+i+'</div></div>';
    }
    container.innerHTML=_ph;
    const _allPages=Array.from(container.querySelectorAll('[data-page-num]'));
    // --- Sliding observation window ---
    let _obsLo=1,_obsHi=0;   // current observed range [lo, hi]
    function _slideWindow(centerPage){
        const lo=Math.max(1,centerPage-18);
        const hi=Math.min(total,centerPage+22);
        if(lo===_obsLo&&hi===_obsHi)return;
        for(const p of _allPages){
            const n=parseInt(p.dataset.pageNum);
            if(n>=lo&&n<=hi){
                if(!readerRenderedPages.has(n))readerScrollObserver.observe(p);
            }else if(n>=_obsLo&&n<=_obsHi){
                readerScrollObserver.unobserve(p);   // left the window
            }
        }
        _obsLo=lo;_obsHi=hi;
    }
    readerApplyPendingScroll();   // cross-view sync: land on the page we left
    readerScrollObserver=new IntersectionObserver((entries)=>{
        entries.forEach(entry=>{
            if(!entry.isIntersecting)return;
            const pageNum=parseInt(entry.target.dataset.pageNum);
            if(readerRenderedPages.has(pageNum))return;
            // During a jump the target page renders FIRST; band neighbours are
            // deferred briefly so KaTeX typesetting is staggered, not a burst.
            if(readerPendingScrollPage&&Math.abs(pageNum-readerPendingScrollPage)>1){
                setTimeout(()=>{if(!readerRenderedPages.has(pageNum))readerRenderDocViewPage(pageNum);},250);
            }else{
                readerRenderDocViewPage(pageNum);
            }
        });
    },{root:area,rootMargin:'300px 0px',threshold:0.01});
    // Toolbar updater + window slider: rAF-throttled + cached page list.
    let _dvTick=false;
    area.onscroll=()=>{
        if(_dvTick)return;
        _dvTick=true;
        requestAnimationFrame(()=>{
            _dvTick=false;
            let _cur=1;
            for(let p of _allPages){
                const rect=p.getBoundingClientRect();
                if(rect.top>=0&&rect.top<area.clientHeight/2){
                    _cur=parseInt(p.dataset.pageNum);
                    document.getElementById('reader-toolbar').textContent='Page '+_cur+' of '+total+' · '+doc.title;
                    break;
                }
            }
            _slideWindow(_cur);
        });
    };
    // Paint first, then observe the initial window around the landing page
    const _startPage=readerPendingScrollPage||1;
    requestAnimationFrame(()=>{
        _slideWindow(_startPage);
        readerApplyPendingScroll();
    });
    showNotification(doc.title+' · reformatted view ('+total+' pages) · Select text to translate, highlight or ask AI','success');
}

async function readerRenderDocViewPage(pageNum){
    if(readerRenderedPages.has(pageNum))return;
    readerRenderedPages.add(pageNum);
    const pageDiv=document.getElementById('pdf-page-'+pageNum);
    if(!pageDiv)return;
    try{
        const r=await apiFetch('/api/documents/'+readerCurrentDocId+'/pages/'+pageNum);
        if(!r.ok)throw new Error('HTTP '+r.status);
        const data=await r.json();
        pageDiv.innerHTML='';
        const divider=document.createElement('div');
        divider.style.cssText='text-align:center;color:var(--text-muted);font-size:11px;letter-spacing:2px;padding:8px 0 14px;border-bottom:1px dashed var(--border);margin-bottom:14px;user-select:none;';
        divider.textContent='— Page '+pageNum+' —';
        pageDiv.appendChild(divider);
        const texts=[];
        for(const b of (data.blocks||[])){
            if(MINERU_SKIP_TYPES.has(b.type))continue;
            const t=(b.text||'').trim();
            if(b.type==='table'&&b.html){
                if(b.caption){
                    const cap=document.createElement('div');
                    cap.style.cssText='font-size:12px;color:var(--text-muted);text-align:center;margin:8px 0 4px;';
                    cap.textContent=b.caption;
                    pageDiv.appendChild(cap);
                }
                const wrap=document.createElement('div');
                wrap.style.cssText='overflow-x:auto;margin:8px 0;';
                const tbl=document.createElement('div');
                tbl.innerHTML=b.html;
                const table=tbl.querySelector('table');
                if(table)table.style.cssText='border-collapse:collapse;font-size:13px;margin:0 auto;';
                if(table)[...table.querySelectorAll('td,th')].forEach(c=>{c.style.border='1px solid var(--border)';c.style.padding='4px 10px';});
                wrap.appendChild(tbl);
                pageDiv.appendChild(wrap);
                texts.push(t||b.caption||'[table]');
                continue;
            }
            if(!t)continue;
            texts.push(t);
            if(b.type==='title'||b.text_level){
                const lvl=Math.min(b.text_level||1,4);
                const h=document.createElement('h'+Math.max(2,lvl+1));
                h.style.cssText='margin:16px 0 8px;font-weight:700;';
                h.textContent=t.replace(/^#+\s*/,'');
                pageDiv.appendChild(h);
            }else if(b.type==='equation'){
                const eq=document.createElement('div');
                eq.style.cssText='text-align:center;margin:10px 0;padding:4px 0;';
                eq.textContent=t.startsWith('$$')?t:'$$'+t+'$$';
                pageDiv.appendChild(eq);
            }else if(b.type==='image'||b.type==='chart'){
                const cap=document.createElement('div');
                cap.style.cssText='font-size:12px;color:var(--text-muted);text-align:center;margin:8px 0;font-style:italic;';
                cap.textContent='[Figure] '+t;
                pageDiv.appendChild(cap);
            }else{
                const p=document.createElement('p');
                p.style.cssText='margin:8px 0;line-height:1.85;font-size:15px;color:var(--text-primary);';
                p.textContent=t;
                pageDiv.appendChild(p);
            }
        }
        pageDiv.dataset.text=texts.join(' ');
        if(pageDiv.children.length<=1){
            const empty=document.createElement('div');
            empty.style.cssText='text-align:center;color:var(--text-muted);font-size:12px;font-style:italic;padding:20px 0;';
            empty.textContent='No extractable content on this page (figure-only or blank page)';
            pageDiv.appendChild(empty);
        }
        // KaTeX typeset when idle: text paints first, formulas pop in ~100ms
        // later — avoids blocking the first paint of a formula-dense page.
        if(window.renderMathInElement){
            (window.requestIdleCallback||(function(f){return setTimeout(f,40);}))(function(){
                if(pageDiv.isConnected)renderMathInElement(pageDiv,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false,strict:false});
            });
        }
        if(typeof readerHighlights!=='undefined'&&readerHighlights.length>0){
            readerHighlights.filter(h=>h.page===pageNum).forEach(h=>{
                try{readerApplyHighlightToPage(pageNum,h.text,h.color);}catch(e){}
            });
        }
        readerAnchorRestore(pageNum);   // cross-view sync: final exact restore once content exists
    }catch(e){
        pageDiv.innerHTML='<div style="padding:30px;text-align:center;color:#ff6b6b;font-size:13px;">Failed to load page '+pageNum+': '+escapeHtml(e.message)+'</div>';
    }
}

// ===== Built-in bilingual user guide (virtual doc, zero backend) =====
// Block types: h (lvl), p (EN main + CN muted sub-line), table, ui (CSS mock), img (future screenshots)
const GUIDE_PAGES=[
{blocks:[
  {t:'h',lvl:1,en:'Welcome to CogniBridge',cn:'欢迎使用智学桥'},
  {t:'p',en:'CogniBridge is your bridge between school maths and university maths. It finds your knowledge gaps, builds a personal study plan that follows your real lectures, and lets you practise with AI that is checked for correctness.',cn:'智学桥连接中学数学与大学数学：定位知识断层、生成跟随真实课表的个人计划、提供经过校验的 AI 练习。'},
  {t:'ui',kind:'sidebar'},
  {t:'p',en:'This guide lives permanently in your bookshelf (Textbooks). Open it any time you need a reminder — the next pages walk through every feature, one by one.',cn:'本指南永久保存在书架（Textbooks 分类）中。接下来几页将逐一介绍全部功能。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Pre-Assessment → Your Math Skill Map',cn:'前测 → 数学能力图'},
  {t:'p',en:'Take the 3-minute Pre-Assessment: rate each school topic (Mastered / Decent / Fuzzy / No idea), check the university topics you have met, and answer 10 quick questions.',cn:'完成 3 分钟前测：为每个中学知识点自评（掌握/尚可/模糊/不会）、标记接触过的大学内容、回答 10 道快问快答。'},
  {t:'ui',kind:'bars'},
  {t:'p',en:'The Math Skill Breakdown then appears on your Dashboard: one bar per topic, coloured by your answers. Red means "fix this before the lectures that need it"; yellow is shaky; green is solid. It is built from YOUR answers — two students see two different maps.',cn:'数学能力图随后出现在 Dashboard 上：每个知识点一条，颜色来自你的作答。红色＝开课前要补；黄色＝不稳；绿色＝扎实。它由你的作答生成——不同学生看到不同的图。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Your Study Plan — A Weekly Bridge',cn:'学习计划 — 每周的桥'},
  {t:'ui',kind:'timeline'},
  {t:'p',en:'Tasks sit on the real teaching calendar: Mathematical Analysis and Higher Algebra, side by side. A gap-fill task is a school skill an upcoming lecture needs — it is due BEFORE that week. A preview task is a brand-new university idea to meet early.',cn:'任务按真实课表排列：数学分析与高等代数双轨并行。补漏任务＝即将开课所需的中学技能，截止于开课周之前；预习任务＝提前接触的大学新概念。'},
  {t:'p',en:'Interactions: tick the checkbox when done, drag cards to re-order, drag to the trash to remove. Set your current teaching week (Pre-Assessment step 1, or your Profile) and the timeline re-aligns instantly.',cn:'交互：完成后勾选；拖拽卡片排序；拖入垃圾桶移除。在前测第 1 步或 Profile 设置当前教学周，时间轴立即重新对齐。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'The Adaptive Loop — Evidence Updates Your Plan',cn:'自适应闭环 — 证据更新计划'},
  {t:'ui',kind:'flow',items:['Diagnose 诊断','Plan 计划','Practise 练习','Evidence 证据','Re-plan 再规划']},
  {t:'p',en:'Self-ratings are only the starting point. Every AI Quiz you take becomes evidence: score below 50% on a topic — even one you rated as strong — and it goes back into your plan with a quiz-score badge that shows the score.',cn:'自评只是起点。每次 AI Quiz 都是证据：某知识点得分低于 50%——即使你自评"掌握"——也会带着分数徽章回到计划中。'},
  {t:'p',en:'Score above 90% twice, and a "weak" topic is exempted automatically. The plan keeps matching the real you, not the you from day one.',cn:'连续两次得分高于 90%，自评"薄弱"的知识点会被自动豁免。计划始终匹配当下的你，而不是第一天的你。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Math Tutor — Two Ways to Learn',cn:'AI 辅导 — 两种学法'},
  {t:'ui',kind:'modes'},
  {t:'p',en:'General gives full step-by-step solutions with properly typeset formulas. Deep asks Socratic questions and waits for YOUR reasoning — stuck? "Need a hint" and "I\'m stuck" buttons appear.',cn:'General 给出公式排版规整的分步解答；Deep 以苏格拉底式提问等你推理——卡住时可点"要提示 / 我卡住了"按钮。'},
  {t:'p',en:'Attach lecture PDFs with the paperclip button and ask about them. One-tap buttons generate similar practice problems or explain the A-Level connection behind any topic.',cn:'用回形针按钮附上讲义 PDF 后可直接提问；一键按钮可生成同类练习或解释知识点的 A-Level 衔接背景。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'AI Quiz — Questions You Can Trust',cn:'AI 出题 — 可信的题目'},
  {t:'p',en:'Configure a quiz in seconds: topic (your weakest are pre-suggested), 1–15 questions, difficulty, and MCQ / fill-in / mixed. Every question renders real maths notation.',cn:'几秒配好一份测验：知识点（弱点已预选）、1–15 题、难度、选择/填空/混合，题目带完整数学公式排版。'},
  {t:'p',en:'With Harness verification ON (recommended), each generated question is solved again by our own engine — if the two answers disagree, the question is thrown away. Expect 1–3 minutes; a wait-time estimate is shown while it works.',cn:'开启 Harness 验证（推荐）后，每道题都由解题引擎二次作答，答案不一致即弃用。耗时约 1–3 分钟，等待界面会显示预估时长。'},
  {t:'p',en:'Answers are graded instantly with full explanations, and wrong ones come back via "Retry wrong ones". Every finished attempt adds to the Problems Solved counter on your Dashboard.',cn:'即时判分并附完整解析；错题可通过"重做错题"再战。每次完成都会计入 Dashboard 的 Problems Solved。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Read — Reader & AI Chat',cn:'阅读 — 文档阅读与 AI 问答'},
  {t:'ui',kind:'floatmenu'},
  {t:'p',en:'Upload PDF/PPTX files to your bookshelf, then select any text to Translate, Highlight, take a Note, or Ask AI.',cn:'上传 PDF/PPTX 到书架后，选中任意文字即可翻译、高亮、记笔记或问 AI。'},
  {t:'p',en:'Scanned textbooks work too — they are re-typeset automatically (MinerU). In Chat AI, switch between Page (ask about the page you are reading) and Whole book (search the entire textbook — answers cite pages like [Page 45]).',cn:'扫描版教材同样可用（MinerU 自动重排版）。Chat AI 可切换当前页与整本书两种问答模式，整书模式的回答会标注页码。'},
  {t:'h',lvl:2,en:'Exercises? Your textbooks answer alongside',cn:'做练习？教材与你同屏作答'},
  {t:'p',en:'Open a document from Exercises or Exam Papers and ask Chat AI how to solve it: a green chip like "高等代数 · p.45" appears above the answer. Click it — a small floating window opens with the textbook page itself (drag it anywhere, stretch its corner to resize).',cn:'打开练习或试卷分类的文档并向 Chat AI 提问：答案上方会浮现绿色标签（如"高等代数 · p.45"）。点击它——弹出教材原文小浮窗，可任意拖动、拖角拉伸大小，与 AI 解答并排对照。'},
  {t:'p',en:'The Reader button in that window opens the full textbook at exactly that page (the AI window stays open). Math Tutor shows the same chips.',cn:'浮窗中的 Reader 按钮会在 Reader 中打开教材并直达该页（AI 窗口保留）。Math Tutor 提问同样会出现这些标签。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Function Plotter — See the Maths',cn:'函数画板 — 让数学可见'},
  {t:'ui',kind:'plot'},
  {t:'p',en:'2D mode overlays up to five functions on one canvas — perfect for comparing sin(x)/x against 1/x, or a function against its derivative. Tap the example chips or type your own.',cn:'2D 模式可在同一画布叠加至多五个函数，便于对比观察（如 sin(x)/x 与 1/x，或函数与其导数）。点示例词条或直接输入皆可。'},
  {t:'p',en:'3D mode renders surfaces like z = x² − y² — rotate and zoom with the mouse. The Conics tab draws circles, ellipses, parabolas and hyperbolas with adjustable parameters, foci marked.',cn:'3D 模式渲染曲面（如 z = x² − y²），可用鼠标旋转缩放；圆锥曲线页支持圆/椭圆/抛物线/双曲线参数调节，并标注焦点。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Organise, Sync & Quick Tips',cn:'整理、同步与快速技巧'},
  {t:'p',en:'The bookshelf has six categories (Slides, Textbooks, Exercises, Exam Papers, Research Papers, Notes). Highlights and notes made while reading sync straight to the Notes page; PDFs uploaded under "Notes" appear there too.',cn:'书架含六个分类；阅读时的高亮与笔记自动同步到 Notes 页，上传到 Notes 分类的 PDF 也会显示在那里。'},
  {t:'table',head:['What you keep','Where it lives'],rows:[
    ['Documents, notes, highlights','Bookshelf · Reader 书架与阅读器'],
    ['Math skill map & study plan','Dashboard 仪表板'],
    ['Quiz history & problem count','Dashboard 仪表板'],
    ['Your account','Cloud — sign in on any device 云端，任意设备登录即同步']]},
  {t:'table',head:['Want to…','Go to'],rows:[
    ['Know my weak points 了解薄弱点','Pre-Assessment → report 前测报告'],
    ['Get lecture-aligned tasks 课表对齐任务','Dashboard → Study Plan 学习计划'],
    ['Practise a topic 练习某知识点','AI Quiz (weak topics pre-suggested 弱点已预选)'],
    ['Ask about my reading 就所读内容提问','Reader → select text → Ask AI'],
    ['Visualise a function 可视化函数','Function Plotter 函数画板'],
    ['See my progress 看进度','Dashboard stat cards 仪表板统计卡']]},
  {t:'p',en:'University maths is a bridge, not a wall — and you just crossed the first step by reading this. Good luck!',cn:'大学数学是一座桥，而不是一堵墙——读完本页，你已迈出第一步。祝学习顺利！'},
  {t:'eq',en:'e^{i\\pi}+1=0',cn:''}
]}];
const GUIDE_DOC={id:'__guide__',icon:'book-open',title:'How to Use CogniBridge · 使用指南',
  desc:'Built-in bilingual guide',category:'textbooks',source:'builtin',fileType:'guide',
  parseStatus:'',needsOcr:false,aiDeclined:false,isGuide:true,isDeleted:false,deletedAt:null};

// ----- MinerU guide (5 pages, bilingual) -----
const GUIDE_MINERU_PAGES=[
{blocks:[
  {t:'h',lvl:1,en:'What is MinerU?',cn:'什么是 MinerU？'},
  {t:'p',en:'MinerU is an open-source document-parsing engine made by OpenDataLab. It turns PDFs that are "just pictures" (scanned books) back into real, selectable text.',cn:'MinerU 是 OpenDataLab 开源的文档解析引擎，能把"整页都是图片"的扫描版 PDF 重新变回可选中、可检索的真文字。'},
  {t:'p',en:'Think of it as a much smarter OCR: it also recovers heading levels, mathematical formulas (as LaTeX), tables and the correct reading order.',cn:'可以把它理解为更强的 OCR：它还能还原标题层级、数学公式（LaTeX）、表格与正确的阅读顺序。'},
  {t:'link',url:'https://mineru.net',en:'Official website — mineru.net',cn:'官方网站'},
  {t:'link',url:'https://github.com/opendatalab/MinerU',en:'Open-source repository — GitHub',cn:'开源仓库'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Why does CogniBridge need it?',cn:'智学桥为什么需要它？'},
  {t:'p',en:'Many university textbooks are scanned PDFs — every page is an image with no text layer. That breaks selecting, translating, highlighting, note-taking and AI chat.',cn:'很多大学教材是扫描版 PDF——每页都是图片、没有文字层，导致划词、翻译、高亮、笔记、AI 问答全部失效。'},
  {t:'ui',kind:'flow',items:['Scanned PDF 扫描书','MinerU parse 解析','Reformatted view 重排版','All features alive 功能复活']},
  {t:'p',en:'After parsing, the book opens in a clean reformatted view (proper headings, typeset formulas, real tables) — and whole-book AI chat becomes available, with answers that cite page numbers.',cn:'解析后书籍以整洁的重排版视图打开（规范标题、排版公式、成型表格），并解锁整本书 AI 问答——回答会标注页码。'},
  {t:'p',en:'Normal text PDFs skip all of this automatically — you never notice MinerU is there.',cn:'原生文字 PDF 会自动跳过以上全部流程——你完全感知不到 MinerU 的存在。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Get your API key (free)',cn:'获取 API Key（免费）'},
  {t:'p',en:'Parsing runs on your own free MinerU quota, so CogniBridge asks for your personal key once. Four steps:',cn:'解析消耗的是你自己的 MinerU 免费额度，因此智学桥需要你一次性提供个人 Key。共四步：'},
  {t:'table',head:['Step 步骤','Action 操作'],rows:[
    ['1','Visit mineru.net and sign up 访问官网并注册（免费）'],
    ['2','Open the console → API Keys 打开控制台的 API Keys 页'],
    ['3','Create and copy your key 创建并复制你的 Key'],
    ['4','Paste it into CogniBridge 粘贴到智学桥即可']]},
  {t:'link',url:'https://mineru.net',en:'Go to mineru.net',cn:'点击访问官网（浏览器新窗口打开无效时请手动复制网址）'},
  {t:'p',en:'The free tier gives 2,000 pages per day — a 465-page textbook costs less than a quarter of one day\'s quota.',cn:'免费额度为每天 2000 页——一本 465 页的教材只消耗一天额度的不到四分之一。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Using it in CogniBridge',cn:'在智学桥中使用'},
  {t:'p',en:'Upload a scanned PDF → the app detects it and asks "Enable AI?" → the first time, paste your key → watch the live progress bar → done: the reformatted book opens automatically.',cn:'上传扫描 PDF → 应用自动识别并询问 Enable AI → 首次粘贴 Key → 观看实时进度条 → 完成后自动打开重排版书籍。'},
  {t:'p',en:'If a key stops working, the progress dialog offers "Update MinerU Key" — fix it and hit "Retry Parse". Parts that already finished are kept and never re-charged.',cn:'Key 失效时，进度弹窗提供 Update MinerU Key——换好后点 Retry Parse 续解析；已完成的分卷会保留，绝不重复扣额度。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Privacy & FAQ',cn:'隐私与常见问题'},
  {t:'p',en:'Your key stays yours: it is encrypted (Fernet) on the server, write-only — we never read it back, share it, or spend it for you.',cn:'Key 只属于你：在服务器上以 Fernet 加密存储、只写不读——我们不会回读、不会共享、也不会代你消耗。'},
  {t:'table',head:['Question 问题','Answer 答案'],rows:[
    ['Which books need MinerU? 哪些书需要','Only scanned PDFs — text PDFs skip it automatically 仅扫描版需要，文字版自动跳过'],
    ['Is it free? 免费吗','Yes — 2,000 pages per day on the free tier 是，免费档每天 2000 页'],
    ['Server restart mid-parse? 解析中重启','Parsing resumes automatically; finished parts are kept 自动恢复，已完成部分保留'],
    ['Who pays for AI chat? AI 问答谁付费','The platform — parsing is the only BYOT part 平台承担，仅解析使用你自己的额度']]}
]}];
const MINERU_DOC={id:'__mineru_guide__',icon:'flask-conical',title:'MinerU & Scanned Textbooks · 扫描书指南',
  desc:'What it is · API key · FAQ',category:'textbooks',source:'builtin',fileType:'guide',
  parseStatus:'',needsOcr:false,aiDeclined:false,isGuide:true,isDeleted:false,deletedAt:null};

function ensureGuideInShelf(){
    const arr=bsData.textbooks||(bsData.textbooks=[]);
    if(!arr.some(d=>d.id==='__guide__'))arr.unshift(GUIDE_DOC);
    if(!arr.some(d=>d.id==='__mineru_guide__'))arr.splice(1,0,MINERU_DOC);
}

function renderGuideBlock(b,pageDiv,texts){
    const cnSub=(cn)=>{
        if(!cn)return;
        const d=document.createElement('div');
        d.style.cssText='font-size:12px;color:var(--text-muted);margin:-2px 0 8px;line-height:1.6;';
        d.textContent=cn;pageDiv.appendChild(d);
    };
    if(b.t==='h'){
        const h=document.createElement('h'+Math.max(2,Math.min(b.lvl||1,3)+1));
        h.style.cssText='margin:18px 0 6px;font-weight:700;';
        h.textContent=b.en;pageDiv.appendChild(h);cnSub(b.cn);texts.push(b.en,b.cn||'');
    }else if(b.t==='p'){
        const p=document.createElement('p');
        p.style.cssText='margin:8px 0;line-height:1.85;font-size:15px;color:var(--text-primary);';
        p.textContent=b.en;pageDiv.appendChild(p);cnSub(b.cn);texts.push(b.en,b.cn||'');
    }else if(b.t==='eq'){
        const eq=document.createElement('div');
        eq.style.cssText='text-align:center;margin:14px 0;';
        eq.textContent='$$'+b.en+'$$';pageDiv.appendChild(eq);texts.push(b.en);
    }else if(b.t==='table'){
        const wrap=document.createElement('div');wrap.style.cssText='overflow-x:auto;margin:10px 0;';
        const tb=document.createElement('table');
        tb.style.cssText='border-collapse:collapse;font-size:13px;width:100%;';
        tb.innerHTML='<thead><tr>'+b.head.map(h=>'<th style="border:1px solid var(--border);padding:5px 10px;background:var(--bg-tag);text-align:left;">'+escapeHtml(h)+'</th>').join('')+'</tr></thead>'
            +'<tbody>'+b.rows.map(r=>'<tr>'+r.map(c=>'<td style="border:1px solid var(--border);padding:5px 10px;">'+escapeHtml(c)+'</td>').join('')+'</tr>').join('')+'</tbody>';
        wrap.appendChild(tb);pageDiv.appendChild(wrap);
        texts.push(b.head.join(' '),b.rows.map(r=>r.join(' ')).join(' '));
    }else if(b.t==='ui'){
        pageDiv.appendChild(renderGuideUiMock(b.kind,b.items));texts.push('ui-guide');
    }else if(b.t==='link'){
        const a=document.createElement('a');
        a.href=b.url;a.target='_blank';a.rel='noopener noreferrer';
        a.style.cssText='display:inline-block;margin:4px 0 8px;color:var(--accent);font-size:14px;text-decoration:underline;';
        a.textContent=b.en;
        pageDiv.appendChild(a);
        if(b.cn){const c=document.createElement('div');c.style.cssText='font-size:12px;color:var(--text-muted);margin:-4px 0 8px;';c.textContent=b.cn;pageDiv.appendChild(c);}
        texts.push(b.en,b.url);
    }else if(b.t==='img'){
        const im=document.createElement('img');
        im.src=b.src;im.style.cssText='max-width:100%;border:1px solid var(--border);border-radius:8px;margin:10px 0;';
        pageDiv.appendChild(im);
        if(b.caption){const c=document.createElement('div');c.style.cssText='font-size:12px;color:var(--text-muted);text-align:center;';c.textContent=b.caption;pageDiv.appendChild(c);}
        texts.push(b.caption||'image');
    }
}

function renderGuideUiMock(kind,items){
    const box=document.createElement('div');
    box.style.cssText='border:1px dashed var(--border);border-radius:10px;padding:12px 14px;margin:12px 0;background:var(--bg-input);';
    const chip=(txt,accent)=>'<span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:12px;border:1px solid '+(accent?'var(--accent)':'var(--border)')+';background:'+(accent?'rgba(76,141,255,.08)':'var(--bg-card)')+';color:'+(accent?'var(--accent)':'var(--text-secondary)')+';margin:2px 4px 2px 0;">'+escapeHtml(txt)+'</span>';
    if(kind==='sidebar'){
        const navs=[['Dashboard 仪表盘','layout-dashboard'],['Pre-Assessment 前测','clipboard-check'],['Math Tutor AI辅导','sigma'],['AI Quiz 智能出题','target'],['Function Plotter 画板','chart-line'],['Reader 阅读','book-open','hot'],['Notes 笔记','notebook-pen','hot'],['All Materials 书架','library']];
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Sidebar 侧边栏导览</div>'
            +navs.map(n=>'<div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 8px;border-radius:6px;'+(n[2]?'background:rgba(76,141,255,.10);color:var(--accent);font-weight:600;':'color:var(--text-secondary);')+'">'+iconHtml(n[1],14)+n[0]+(n[2]?' ◀ start here 从这开始':'')+'</div>').join('');
        refreshIcons();
    }else if(kind==='flow'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">How it works 工作流程</div>'
            +items.map(i=>chip(i)).join('<span style="color:var(--text-muted);margin:0 4px;">→</span>');
    }else if(kind==='modes'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Math Tutor modes 辅导双模式</div>'
            +chip('General · step-by-step 分步解答')+chip('Deep · Socratic 引导思考',true)
            +'<div style="margin-top:8px;">'+chip('Verified — every quiz question is double-checked 每道题双重验证')+'</div>';
    }else if(kind==='floatmenu'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Select text to see 选中文字即出现</div>'
            +chip('Translate')+chip('Highlight')+chip('Note')+chip('Ask AI',true);
    }else if(kind==='bars'){
        const rows=[
            ['Functions & Graphs 函数图像',100,'#52c41a','Mastered 掌握'],
            ['Sequences & Series 数列',75,'#4C8DFF','Decent 尚可'],
            ['Differentiation 求导',40,'#fa8c16','Fuzzy 模糊'],
            ['Trigonometry 三角',10,'#E5484D','No idea 不会']];
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Math Skill Breakdown (example) 数学能力图（示例）</div>'
            +rows.map(r=>'<div style="display:flex;align-items:center;gap:10px;margin:7px 0;">'
                +'<span style="font-size:12px;width:170px;color:var(--text-secondary);flex-shrink:0;">'+escapeHtml(r[0])+'</span>'
                +'<div style="flex:1;height:8px;border-radius:4px;background:var(--bg-tag);overflow:hidden;"><div style="height:100%;border-radius:4px;width:'+r[1]+'%;background:'+r[2]+';"></div></div>'
                +'<span style="font-size:11px;width:86px;color:'+r[2]+';font-weight:600;flex-shrink:0;">'+r[3]+' '+r[1]+'%</span></div>').join('')
            +'<div style="font-size:10px;color:var(--text-muted);margin-top:8px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#E5484D;"></span>fix before the lectures that need it 开课前需补 · <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fa8c16;"></span>shaky 不稳 · <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#52c41a;"></span>solid 扎实</div>';
    }else if(kind==='timeline'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">Study Plan timeline (example) 学习计划时间轴（示例）</div>'
            +'<div style="font-size:12px;font-weight:700;margin:6px 0 4px;">Week 3–4</div>'
            +'<div style="font-size:12px;color:var(--text-secondary);padding-left:10px;border-left:3px solid #E5484D;margin:4px 0;">Sequences & Limits 数列极限（ε-N）</div>'
            +'<div style="font-size:12px;color:var(--text-secondary);padding-left:10px;border-left:3px solid #E5484D;margin:4px 0;">&nbsp;&nbsp;Sequences &amp; Series — due BEFORE this week 本周前补：数列</div>'
            +'<div style="font-size:12px;color:var(--text-secondary);padding-left:10px;border-left:3px solid #faad14;margin:4px 0;">&nbsp;&nbsp;Propositional Logic — preview 预习：命题逻辑</div>'
            +'<div style="font-size:12px;color:var(--text-secondary);padding-left:10px;border-left:3px solid #faad14;margin:4px 0;">Determinants 行列式</div>'
            +'<div style="font-size:12px;font-weight:700;margin:10px 0 4px;">Week 5–6</div>'
            +'<div style="font-size:12px;color:var(--text-muted);">… function limits, linear systems, and the skills they need …</div>'
            +'<div style="font-size:10px;color:var(--text-muted);margin-top:8px;">gap-fill 补漏（红） · preview 预习（黄） · tick 勾选 / drag 拖拽 / trash 移除 交互提示</div>';
    }else if(kind==='plot'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Function Plotter 函数画板</div>'
            +chip('sin(x)/x',true)+chip('e^(-x²)')+chip('x³-3x')+chip('1/x')+chip('tan(x)')
            +'<div style="display:flex;align-items:center;gap:10px;margin-top:10px;">'
            +'<div style="flex:1;height:64px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);position:relative;overflow:hidden;">'
            +'<svg viewBox="0 0 220 64" style="width:100%;height:100%;"><path d="M0,44 C40,10 60,10 110,32 C160,52 180,52 220,36" fill="none" stroke="#4C8DFF" stroke-width="2"/></svg></div>'
            +'<div style="flex:1;height:64px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-muted);">z = x² − y² · rotate in 3D 旋转</div></div>';
    }else{
        box.textContent='';
    }
    return box;
}

function readerOpenGuide(doc){
    const pages=doc.id==='__mineru_guide__'?GUIDE_MINERU_PAGES:GUIDE_PAGES;
    readerCloseBookshelf();
    readerCurrentDocId=doc.id;
    readerCurrentDocRef={cat:'textbooks',idx:(bsData.textbooks||[]).findIndex(d=>d.id===doc.id)};
    readerViewMode='doc';readerLastDocId=doc.id;
    readerPdfDoc=null;readerPdfTotal=pages.length;readerDocType='docview';
    document.getElementById('reader-doc-title').textContent=doc.title;
    document.getElementById('reader-doc-meta').textContent=doc.desc;
    document.getElementById('reader-toolbar').textContent=doc.title;
    const toggleBtn=document.getElementById('reader-view-toggle');
    if(toggleBtn)toggleBtn.style.display='none';
    const aiBtn=document.getElementById('reader-enable-ai');
    if(aiBtn)aiBtn.style.display='none';
    readerNotes=[];readerHighlights=[];readerRenderNotes();readerRenderHighlights();
    readerLoadHighlights(doc.id);
    document.getElementById('reader-action-panel').style.display='none';
    document.getElementById('reader-float-menu').style.display='none';
    const area=document.getElementById('reader-content-area');
    if(readerScrollObserver)readerScrollObserver.disconnect();
    readerRenderedPages.clear();
    area.style.cssText='flex:1;overflow-y:auto;padding:24px 8px;background:var(--bg-tag);';
    area.innerHTML='';
    const container=document.createElement('div');
    container.id='pdf-pages-container';
    container.style.cssText='max-width:860px;margin:0 auto;';
    area.appendChild(container);
    const total=pages.length;
    pages.forEach((pg,i)=>{
        const pageDiv=document.createElement('div');
        pageDiv.id='pdf-page-'+(i+1);
        pageDiv.dataset.pageNum=i+1;
        pageDiv.style.cssText='margin:0 auto 18px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:6px 34px 20px;min-height:200px;box-shadow:0 1px 4px rgba(0,0,0,.06);';
        const divider=document.createElement('div');
        divider.style.cssText='text-align:center;color:var(--text-muted);font-size:11px;letter-spacing:2px;padding:8px 0 14px;border-bottom:1px dashed var(--border);margin-bottom:14px;user-select:none;';
        divider.textContent='— Page '+(i+1)+' —';
        pageDiv.appendChild(divider);
        const texts=[];
        (pg.blocks||[]).forEach(b=>renderGuideBlock(b,pageDiv,texts));
        pageDiv.dataset.text=texts.join(' ');
        container.appendChild(pageDiv);
        if(window.renderMathInElement)renderMathInElement(pageDiv,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false,strict:false});
    });
    area.onscroll=()=>{
        const pages=container.querySelectorAll('[data-page-num]');
        for(let p of pages){
            const rect=p.getBoundingClientRect();
            if(rect.top>=0&&rect.top<area.clientHeight/2){
                document.getElementById('reader-toolbar').textContent='Page '+p.dataset.pageNum+' of '+total+' · '+doc.title;
                break;
            }
        }
    };
}

// ===== [MinerU] bbox overlay injection (original-pages mode) =====
const mineruPageCache={};

async function mineruInjectOverlay(pageNum,pageDiv,textLayerDiv,w,h){
    if(textLayerDiv.dataset.mineru==='1')return;
    textLayerDiv.dataset.mineru='1';
    try{
        let blocks=mineruPageCache[pageNum];
        if(blocks===undefined){
            const res=await apiFetch('/api/documents/'+readerCurrentDocId+'/pages/'+pageNum);
            if(!res.ok)throw new Error('HTTP '+res.status);
            const data=await res.json();
            blocks=data.blocks||[];
            mineruPageCache[pageNum]=blocks;
        }
        const texts=[];
        for(const b of blocks){
            if(MINERU_SKIP_TYPES.has(b.type))continue;
            const t=(b.text||'').trim();
            if(!t||!b.bbox)continue;
            texts.push(t);
            const [x0,y0,x1,y1]=b.bbox;
            const span=document.createElement('span');
            span.style.left=(x0/1000*w)+'px';
            span.style.top=(y0/1000*h)+'px';
            span.style.width=Math.max(10,(x1-x0)/1000*w)+'px';
            span.style.fontSize=Math.max(8,Math.min(18,(y1-y0)/1000*h*0.6))+'px';
            span.style.lineHeight=1.25;
            span.style.whiteSpace='pre-wrap';
            span.style.wordBreak='break-word';
            span.style.overflow='hidden';
            span.textContent=t;
            textLayerDiv.insertBefore(span,textLayerDiv.querySelector('.endOfContent'));
        }
        if(texts.length){
            pageDiv.dataset.text=texts.join(' ');
            if(typeof readerHighlights!=='undefined'&&readerHighlights.length>0){
                readerHighlights.filter(hl=>hl.page===pageNum).forEach(hl=>{
                    try{readerApplyHighlightToPage(pageNum,hl.text,hl.color);}catch(e){}
                });
            }
        }
    }catch(e){console.warn('[mineru] overlay failed p'+pageNum,e);}
}

// ===== [MinerU] citation badges for chat answers =====
function enhanceCitations(el){
    if(!el)return;
    el.innerHTML=el.innerHTML
        .replace(/\[Page (\d+)\]/g,(m,n)=>'<span onclick="readerJumpToPage('+n+')" style="display:inline-block;padding:0 7px;margin:0 2px;border-radius:8px;background:rgba(76,141,255,.12);color:#4C8DFF;border:1px solid rgba(76,141,255,.3);font-size:11px;font-weight:600;cursor:pointer;">Page '+n+'</span>')
        .replace(/【第(\d+)页】/g,(m,n)=>'<span onclick="readerJumpToPage('+n+')" style="display:inline-block;padding:0 7px;margin:0 2px;border-radius:8px;background:rgba(76,141,255,.12);color:#4C8DFF;border:1px solid rgba(76,141,255,.3);font-size:11px;font-weight:600;cursor:pointer;">Page '+n+'</span>');
}
