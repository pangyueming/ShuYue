// ===== [MinerU] global parse tracker + confirmation modal =====
const mineruTracker={pending:{},progress:{},queue:[],busy:false};

function mineruTrackerFetch(path){
    const token=localStorage.getItem('cb_cn_token')||'';
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
    if(!localStorage.getItem('cb_cn_token'))return;   // no session -> skip (avoid 401 spam)
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

const MINERU_STATUS_LABELS={done:'MinerU 已解析',failed:'解析失败',parsing:'MinerU 解析中…',indexing:'构建索引中…',queued:'排队中',none:'未解析'};

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
        body.innerHTML='"'+escapeHtml(item.title)+'" 已就绪——排版文本、公式渲染与引用问答现已全部解锁。';
        openBtn.style.display='inline-block';
        openBtn.textContent='打开本书';
    }else if(mineruIsAuthError(item)){
        icon.style.color='var(--yellow)';
        icon.innerHTML=iconHtml('key-round',40);
        title.textContent='MinerU API Key 被拒绝';
        body.innerHTML='解析 "'+escapeHtml(item.title)+'" 时你的 MinerU API Key 被拒绝。<br><span style="font-size:11px;color:var(--text-muted);">更新 Key 即可继续——已完成的部分已缓存。</span>';
        openBtn.style.display='inline-block';
        openBtn.textContent='更新 Key';
    }else{
        icon.style.color='#ff6b6b';
        icon.innerHTML=iconHtml('alert-circle',40);
        title.textContent='AI 重排失败';
        body.innerHTML='"'+escapeHtml(item.title)+'" 解析失败。<br><span style="font-size:11px;color:var(--text-muted);">'+escapeHtml(item.error||'未知错误')+'</span>';
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
    body.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">检查中…</div>';
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
            ?'这份扫描版 PDF 没有可选中的文字。AI 重排将解锁排版文本、公式渲染与带引用的问答——使用<b>你自己的免费 MinerU 账号</b>（每天免费 2,000 页）。'
            :'这本教材本身可正常阅读——解析后会构建<b>可检索索引</b>，让 AI 问答能搜索整本书（公式转为整洁的 LaTeX）——使用<b>你自己的免费 MinerU 账号</b>（每天免费 2,000 页）。'}</p>
    <div style="background:var(--bg-input);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;font-size:13px;line-height:2;color:var(--text-secondary);">
        <b style="color:var(--text-primary);">配置（仅需一次）：</b><br>
        1. 在
        <a href="https://mineru.net" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;">mineru.net ↗</a>
        注册免费账号<br>
        2. 打开 <span style="font-family:monospace;background:var(--bg-tag);padding:1px 6px;border-radius:4px;">头像 → API Key</span> 并创建一个 Key<br>
        3. 把 API Key 粘贴到下面——它会被<b>加密存储</b>，之后不再显示
    </div>
    <input id="mineru-key-input" type="password" placeholder="粘贴你的 API Key（以 sk- 开头）" class="input" style="width:100%;font-size:13px;">
    <div id="mineru-key-error" style="color:#ff6b6b;font-size:12px;min-height:16px;margin-top:4px;"></div>
    <button id="mineru-key-save" onclick="mineruGateSaveKey()" style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">保存 Key 并继续</button>
    <button onclick="mineruGateOpenGuide()" style="width:100%;margin-top:10px;padding:6px;border:none;background:transparent;color:var(--accent);font-size:12px;cursor:pointer;text-decoration:underline;">MinerU 是什么？——阅读 1 分钟指南</button>
    <button onclick="mineruGateChooseOriginal()" style="width:100%;margin-top:4px;padding:8px;border-radius:8px;border:none;background:transparent;color:var(--text-muted);font-size:12px;cursor:pointer;">${mineruGateOpensReader?'跳过——仅查看原书页':'暂不启用'}</button>
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
        el.textContent='今日 MinerU：'+u.used+' / '+u.limit.toLocaleString()+' 页 · 每日重置';
    }catch(e){/* offline: leave blank */}
}

function mineruGateRenderQuota(d){
    const body=document.getElementById('mineru-gate-body');
    body.innerHTML=`
    <div style="text-align:center;padding:10px 0;">
        <div style="color:var(--yellow);margin-bottom:10px;display:flex;justify-content:center;">${iconHtml('hourglass',34)}</div>
        <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">今日 MinerU 配额已用完</div>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;">
            这本书需要 <b>${d.needed}</b> 页，但今日免费的 ${d.limit.toLocaleString()} 页只剩 <b>${d.remaining}</b> 页。<br>
            解析已暂停——<b>已完成的部分会保留</b>，明天继续不再额外消耗页数。</p>
        <button onclick="mineruGateClose()" style="width:100%;margin-top:12px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">好的——明天继续</button>
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
        if(btn){btn.disabled=false;btn.textContent='保存 Key 并继续';}
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
    if(errEl)errEl.textContent='刚才的 Key 被拒绝了——请粘贴另一个 Key。';
}

function mineruGateOfferRetry(){
    const body=document.getElementById('mineru-gate-body');
    const title=mineruGateDoc?escapeHtml(mineruGateDoc.title):'该文档';
    body.innerHTML=`
    <div style="text-align:center;padding:10px 0;">
        <div style="color:var(--green);margin-bottom:8px;display:flex;justify-content:center;">${iconHtml('key-round',34)}</div>
        <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">Key 已更新</div>
        <p style="font-size:13px;color:var(--text-secondary);margin:0 0 16px;">你的新 MinerU Key 已保存。<br>现在重试解析 "${title}" 吗？</p>
        <div style="display:flex;gap:10px;">
            <button onclick="mineruGateStart()" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">${iconHtml('rotate-ccw',14)}重试解析</button>
            <button onclick="mineruGateChooseOriginal()" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-secondary);font-size:13px;cursor:pointer;">暂不启用</button>
        </div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">已完成的部分已缓存——重试不会重复消耗那些页数。</p>
    </div>`;
    refreshIcons();
}

function mineruGateRenderConsent(){
    const body=document.getElementById('mineru-gate-body');
    const title=mineruGateDoc?mineruGateDoc.title:'该文档';
    const scanned=mineruGateDoc&&mineruGateDoc.needsOcr;
    body.innerHTML=`
    <p style="font-size:13px;color:var(--text-secondary);line-height:1.6;margin:4px 0 14px;">
        <b style="color:var(--text-primary);">"${escapeHtml(title)}"</b> ${scanned
            ?'是扫描版 PDF，没有可选中的文字。<br>现在启用 AI 重排吗？（使用你的 MinerU Key；大部头约需 5–20 分钟）'
            :'本身可正常阅读。<br>现在构建全书 AI 索引吗？阅读体验不变——只是让 AI 问答获得整本书的检索能力。（使用你的 MinerU Key）'}</p>
    <div style="display:flex;gap:10px;">
        <button onclick="mineruGateStart()" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">${iconHtml('sparkles',14)}${scanned?'启用 AI 重排':'构建 AI 索引'}</button>
        <button onclick="mineruGateChooseOriginal()" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-secondary);font-size:13px;cursor:pointer;">${mineruGateOpensReader?'仅看原书页':'暂不启用'}</button>
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">之后随时可以通过工具栏的「启用 AI」按钮改变主意。</p>
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
    body.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">启动中…</div>';
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
        <div id="mineru-progress-text" style="font-size:13px;color:var(--text-primary);font-weight:600;">排队中…</div>
        <div id="mineru-progress-sub" style="font-size:11px;color:var(--text-muted);margin-top:6px;">"${title}" · 可以关闭此弹窗，解析会在后台继续</div>
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
                        t.textContent='完成！';
                        setTimeout(()=>{
                            mineruGateClose();
                            if(mineruGateRef)readerOpenDoc(mineruGateRef.cat,mineruGateRef.idx);
                        },600);
                        return;
                    }
                    if(s.status==='failed'){
                        const auth=mineruIsAuthError(s);
                        const quotaFail=s.error_type==='quota'||/quota/i.test(s.error||'');
                        t.innerHTML='<span style="color:#ff6b6b;">'+escapeHtml(s.error||'解析失败')+'</span>';
                        const sub=document.getElementById('mineru-progress-sub');
                        if(sub&&auth){
                            sub.innerHTML='<button onclick="mineruGateUpdateKey()" style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;padding:8px 20px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;">'+iconHtml('key-round',13)+'更新 MinerU Key 并重试</button>';
                            refreshIcons();
                        }else if(sub&&quotaFail){
                            sub.innerHTML='<span style="color:#faad14;">已完成的部分已保留——明天继续不额外消耗页数。</span>';
                        }
                        return;
                    }
                    const pages=s.total_pages?(' · '+s.pages_done+'/'+s.total_pages+' 页'):'';
                    t.textContent=s.status==='indexing'?'构建检索索引中…':'MinerU 云端解析中'+pages;
                    if(quotaEl&&typeof s.mineru_used==='number'){
                        quotaEl.textContent='今日 MinerU：'+s.mineru_used+' / '+(s.mineru_limit||2000).toLocaleString()+' 页 · 每日重置';
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
    if(tb)tb.textContent='第 '+target+' 页 / 共 '+readerPdfTotal+' 页 · '+title;
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
    if(btn)btn.textContent=readerViewMode==='doc'?'原书页':'重排版';
    const ref=readerCurrentDocRef;
    readerOpenDoc(ref.cat,ref.idx);
}

async function readerOpenDocView(doc,area){
    readerDocType='docview';
    area.innerHTML='<div style="text-align:center;padding:60px;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:12px;"><div class="spinner"></div><p>正在加载重排版文档…</p></div>';
    area.style.cssText='flex:1;overflow-y:auto;padding:24px 8px;background:var(--bg-tag);';
    let total=0;
    try{
        const r=await apiFetch('/api/documents/'+readerCurrentDocId+'/pages/1');
        if(!r.ok)throw new Error('HTTP '+r.status);
        const meta=await r.json();
        total=meta.total_pages||1;
    }catch(e){
        area.innerHTML='<div style="text-align:center;padding:60px;color:#ff6b6b;">重排版文档加载失败<br><span style="font-size:12px;">'+escapeHtml(e.message)+'</span></div>';
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
                    document.getElementById('reader-toolbar').textContent='第 '+_cur+' 页 / 共 '+total+' 页 · '+doc.title;
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
        divider.textContent='— 第 '+pageNum+' 页 —';
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
            empty.textContent='本页无可提取内容（整页插图或空白页）';
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
        pageDiv.innerHTML='<div style="padding:30px;text-align:center;color:#ff6b6b;font-size:13px;">页面加载失败 '+pageNum+': '+escapeHtml(e.message)+'</div>';
    }
}

// ===== Built-in bilingual user guide (virtual doc, zero backend) =====
// Block types: h (lvl), p (EN main + CN muted sub-line), table, ui (CSS mock), img (future screenshots)
const GUIDE_PAGES=[
{blocks:[
  {t:'h',lvl:1,en:'Welcome to 数跃',cn:'欢迎使用数跃'},
  {t:'p',en:'数跃 is your bridge between school maths and university maths. It finds your knowledge gaps, builds a personal study plan that follows your real lectures, and lets you practise with AI that is checked for correctness.',cn:'数跃连接中学数学与大学数学：定位知识断层、生成跟随真实课表的个人计划、提供经过校验的 AI 练习。'},
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
  {t:'p',en:'Score above 90% twice, and a "weak" topic is exempted automatically. The plan keeps matching the real you, not the you from day one.',cn:'连续两次得分高于 90%，自评"薄弱"的知识点会被自动豁免。计划始终匹配当下的你，而不是第一天的你。'},
  {t:'p',en:'V4 adds a second engine to this loop: the FSRS memory model. Every graded quiz and homework feeds it, and every Friday the plan itself evolves — reinforcement tasks for what you struggled with, review tasks for what is decaying. Evidence now updates not just mastery, but memory itself.',cn:'V4 为这个闭环加装了第二台引擎：FSRS 记忆模型。每次判分都在喂养它；每周五计划还会自动进化——本周薄弱的加补强任务、记忆衰减的加复习任务。证据如今不仅更新掌握度，也在更新记忆本身。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Agent Assistant — Your Study Intelligence',cn:'Agent 助手 — 你的学习智能体'},
  {t:'p',en:'V4 turns 数跃 into a real agent: it decides for itself which tools to call (15 of them — solve, quiz, notes, vocab, graph, plotter, diagnostics…), which teaching skill to adopt (10 SKILL.md methodologies), and verifies its own calculations in a sandbox before answering.',cn:'V4 起，数跃是一个真正的智能体：它自主决定调用哪些工具（15 个：解题/出题/笔记/单词本/图谱/画板/诊断…）、采用哪项教学技能（10 套方法论），并在回答前于沙盒中验证自己的计算。'},
  {t:'h',lvl:2,en:'Workspaces',cn:'工作台'},
  {t:'p',en:'Each workspace is an isolated conversation. Ask freely — the agent picks the right tool automatically. Streams keep running when you switch tabs (a breathing dot marks live ones); Esc stops generation.',cn:'每个工作台是一段独立对话。直接提问即可——agent 会自动选择合适的工具。切换工作台时回答继续在后台生成（呼吸点标记进行中）；Esc 可随时中断。'},
  {t:'h',lvl:2,en:'Three entrances, one agent',cn:'三个入口，同一个智能体'},
  {t:'table',head:['Entrance 入口','What it does 作用'],rows:[
    ['+ menu ＋菜单','Skills, attach files, finish-session memory capture 技能选择/附资料/结束学习并提取记忆'],
    ['/ command ／命令','Type / to filter skills and actions by keyboard 打字过滤技能，键盘直达'],
    ['@ reference ＠引用','@ a bookshelf doc to feed it as context @引用书架文档作为上下文']]},
  {t:'h',lvl:2,en:'Memory — it remembers you',cn:'记忆 — 它记得你'},
  {t:'p',en:'Five memory layers. The practical part: say "finish this session" and the agent proposes what to remember long-term (weak spots, preferences) — you approve, it persists across devices. Ask "what do you remember about me?" anytime.',cn:'五层记忆体系。实用的是：说"结束本次学习"，agent 会提炼值得长期记住的要点（薄弱点、偏好）让你确认入库；随时可问"你记得我什么"。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Paste & Ask — Photos Welcome',cn:'贴图即问 — 拍照也能问'},
  {t:'p',en:'Paste (Ctrl+V), drag, or click the 图片 button in any AI chat — then just ask. One image, three intents, auto-detected:',cn:'在任意 AI 对话里 Ctrl+V 粘贴、拖拽或点"图片"按钮选图/拍照，然后直接问。一张图，三种意图自动识别：'},
  {t:'table',head:['You send 你发的','What happens 会发生'],rows:[
    ['手写作业照片 Handwritten homework','Graded problem by problem: ✓/✗ per step, wrong-step located, error type classified (计算错误/概念误解/逻辑跳步/符号规范/方法选择), a "similar practice" button per wrong problem 逐题批改：逐步对错、错步定位、五类归因，错题可一键变式练习'],
    ['题目照片 A problem photo','Extracted by VL, then solved through the verified Harness pipeline — two-stage reliability 题目识别后经 Harness 验证管道解答——两段式可靠'],
    ['教材页照片 A textbook page','Explained in four layers: Gaokao → University → Deeper why → Frontiers 四层讲解：高考→大学→深层理解→前沿应用']]},
  {t:'p',en:'Grading is quota-capped (20/day; solving and explaining are unlimited). Mathematically equivalent answers are never marked wrong — 16cos4x and 4·4cos4x are the same. Images live only in the conversation; follow-ups re-use them automatically.',cn:'批改有每日 20 次配额（解题与讲解不限）。数学等价的答案绝不误判——16cos4x 与 4·4cos4x 是同一个答案。图片只存在于对话中；追问会自动携带图片上下文。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Memory Engine & Review — Never Forget to Review',cn:'记忆引擎与复习 — 不忘复习'},
  {t:'p',en:'Every quiz, graded homework and pre-assessment feeds an FSRS-5 memory model: each topic has a Difficulty, a Stability, and a live recall probability R(t) that decays with time — revisit before it drops and half the work is done for you.',cn:'每次答题、批改、前测都在更新 FSRS-5 记忆模型：每个知识点有难度、稳定性与一个随时间衰减的实时记忆保持率 R(t)——在它跌破临界前复习，事半功倍。'},
  {t:'table',head:['Where 哪里','What you see 看到什么'],rows:[
    ['Dashboard 待办卡','"N topics due for review" with a one-click review quiz "N 个知识点到期复习"，一键开始复习'],
    ['知识图谱 Knowledge Graph','Dashed rings turn red (<40%) / yellow / green (>70%) per topic; hover shows the retention % 节点虚线环红黄绿三档，显示记忆保持百分比'],
    ['Email 邮件','Daily 08:00 reminder when memory decays past threshold (toggle in Profile, one-click unsubscribe) 每日 08:00 到期提醒（资料页可开关，邮件内一键退订）'],
    ['Agent 助手','Ask "我该复习什么" — it answers with per-topic retention and due list 问"我该复习什么"——按主题报记忆保持率与到期清单']]},
  {t:'p',en:'The Dashboard proficiency number is alive too: it blends your pretest baseline with memory health at first, then tracks pure memory once you cover 3+ topics. Study and it rises; slack and it decays.',cn:'Dashboard 的掌握度数字也活了：初期混合前测基线与记忆健康度，覆盖 3 个以上主题后完全跟随记忆动态——学则涨、弃则跌。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Weekly Report & Evolving Plan',cn:'周报与计划进化'},
  {t:'p',en:'Every Friday 18:00 the agent writes your week: attempts, accuracy per topic, weakest memories, and a short AI comment — delivered by email (if on) and on the Dashboard\'s collapsible weekly card.',cn:'每周五 18:00，agent 自动写周报：练习次数、各主题正确率、最薄弱记忆与一段 AI 点评——邮件（开启时）与 Dashboard 折叠卡均可查看。'},
  {t:'p',en:'Minutes later your study plan evolves: topics you struggled with this week get reinforcement tasks, decaying memories get review tasks — inserted as a distinct "AI 自适应" group, original plan untouched. A change card on the plan page summarises what was added.',cn:'几分钟后学习计划自动进化：本周薄弱主题加入补强任务、记忆衰减主题加入复习任务——以"AI 自适应"分组插入，原计划结构不动；计划页顶部的变更卡说明新增了什么。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Answers You Can Trust — Verified, Not Guessed',cn:'带验证的回答 — 算过，不是猜的'},
  {t:'p',en:'When exact numbers or symbols are involved, the agent runs Python (sympy/numpy) in an isolated sandbox — 5s cap, no network, no files, nothing from the server — and shows the verified result. "让我算一下" is now literal.',cn:'涉及精确数值或符号计算时，agent 会在隔离沙盒中运行 Python（sympy/numpy）——5 秒上限、无网络、无文件访问——然后带着验证过的结果回答。"让我算一下"如今是字面意思。'},
  {t:'p',en:'You will see it happen: a run_python step in the status line, then an answer that cites its own computation (often double-checked symbolically AND numerically).',cn:'你能看到全过程：状态行出现 run_python 步骤，随后回答引用自己的计算结果（常常符号法与数值法双重验证）。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'AI Quiz — Questions You Can Trust',cn:'AI 出题 — 可信的题目'},
  {t:'p',en:'Configure a quiz in seconds: topic (your weakest are pre-suggested), 1–15 questions, difficulty, and MCQ / fill-in / mixed. Every question renders real maths notation.',cn:'几秒配好一份测验：知识点（弱点已预选）、1–15 题、难度、选择/填空/混合，题目带完整数学公式排版。'},
  {t:'p',en:'Choose the question language: English (the exam language — with Chinese explanations that gloss key terms bilingually) or fully Chinese. A must-have for practising in the language you will be examined in.',cn:'出题语言可切换：英文（考试语言，解析为中文并附术语中英对照）或全中文——按考试语言练习，双语无缝衔接。'},
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
  {t:'h',lvl:1,en:'Vocabulary Book — Your Terminology Bank',cn:'单词本 — 你的数学术语库'},
  {t:'ui',kind:'vocab'},
  {t:'p',en:'Bilingual maths terminology is half the battle in an English-medium programme. Your Vocabulary Book (Notes & Vocab tab) collects terms through FOUR paths — most of them automatic:',cn:'全英文授课里，双语术语就是半壁江山。单词本（笔记单词库页的"单词本"标签）通过四条路径收词——大多自动完成：'},
  {t:'table',head:['Path 路径','How it works 工作方式'],rows:[
    ['Upload auto-extract 上传自动提取','Upload a PDF/PPTX and 数跃 extracts university-level maths terms automatically (skips common words) 上传文档后自动提取大学级数学术语'],
    ['Reader selection 阅读划词','Select any term while reading → "收入单词本" 阅读时选中术语 → 一键收词'],
    ['AI concept tracing AI 概念溯源','Ask AI anything — key concepts in the answer become one-tap chips AI 回答中的关键概念一键收录'],
    ['Manual 手动添加','Add terms yourself; group them in custom books (green ones) 手动添加 + 自定义单词本（绿色）分组']]},
  {t:'p',en:'Every entry pairs the English term with its Chinese translation and a one-line bilingual definition; a page badge (p.45) jumps straight back to the textbook passage it came from — context is how memory sticks.',cn:'每个词条都是英文术语 + 中文对照 + 一句双语定义；出处徽章（p.45）可一键跳回教材原文——语境记忆才是术语的正解。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Knowledge Graph — See the Whole Bridge',cn:'知识图谱 — 看见整座桥'},
  {t:'ui',kind:'graph'},
  {t:'p',en:'The Knowledge Graph lays out the entire journey in three layers: school foundations → transition gaps → the two university tracks (Mathematical Analysis · Higher Algebra). Each node carries a mastery state — mastered (solid), learning, weak (pulsing) — updated live by your pre-assessment AND every quiz you take.',cn:'知识图谱以三层呈现完整路径：高中基础 → 衔接断层 → 大学双轨（数学分析 · 高等代数）。每个节点带掌握状态——已掌握（实心）/学习中/弱项（脉冲提示）——由前测与每次答题实时更新。'},
  {t:'p',en:'Click any node for evidence (self-rating, quiz scores, gap closure), then act on it: "Quiz this topic" starts an AI quiz pre-aimed at that node; "Find in textbook" locates it in your indexed books. Dashed edges mean a prerequisite is not yet met — follow them back to the school skill to fix first.',cn:'点击节点查看证据（自评、快测得分、缺口闭合度），并可直达行动：「本主题出题」一键定向练习；「在教材中定位」在你已索引的书中找到它。虚线＝前置未达标——沿虚线回溯，先补最源头的高中技能。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Organise, Sync & Quick Tips',cn:'整理、同步与快速技巧'},
  {t:'p',en:'The bookshelf has six categories (Slides, Textbooks, Exercises, Exam Papers, Research Papers, Notes). Highlights and notes made while reading sync straight to the Notes page; PDFs uploaded under "Notes" appear there too.',cn:'书架含六个分类；阅读时的高亮与笔记自动同步到 Notes 页，上传到 Notes 分类的 PDF 也会显示在那里。'},
  {t:'table',head:['What you keep','Where it lives'],rows:[
    ['Documents, notes, highlights','Bookshelf · Reader 书架与阅读器'],
    ['Math terminology 单词本','Notes & Vocab → 单词本'],
    ['Math skill map & study plan','Dashboard 仪表板'],
    ['Quiz history & problem count','Dashboard 仪表板'],
    ['Your account','Cloud — sign in on any device 云端，任意设备登录即同步']]},
  {t:'table',head:['Want to…','Go to'],rows:[
    ['Know my weak points 了解薄弱点','Pre-Assessment → report 前测报告'],
    ['Get lecture-aligned tasks 课表对齐任务','Dashboard → Study Plan 学习计划'],
    ['Practise a topic 练习某知识点','AI Quiz (weak topics pre-suggested 弱点已预选)'],
    ['Ask about my reading 就所读内容提问','Reader → select text → Ask AI'],
    ['Collect math terms 收数学术语','Vocabulary Book 单词本（四条收词路径）'],
    ['See the whole picture 看知识全貌','Knowledge Graph 知识图谱'],
    ['Visualise a function 可视化函数','Function Plotter 函数画板'],
    ['See my progress 看进度','Dashboard stat cards 仪表板统计卡']]},
  {t:'p',en:'University maths is a bridge, not a wall — and you just crossed the first step by reading this. Good luck!',cn:'大学数学是一座桥，而不是一堵墙——读完本页，你已迈出第一步。祝学习顺利！'},
  {t:'eq',en:'e^{i\\pi}+1=0',cn:''}
]}];
const GUIDE_DOC={id:'__guide__',icon:'book-open',title:'How to Use 数跃 · 使用指南',
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
  {t:'h',lvl:1,en:'Why does 数跃 need it?',cn:'数跃为什么需要它？'},
  {t:'p',en:'Many university textbooks are scanned PDFs — every page is an image with no text layer. That breaks selecting, translating, highlighting, note-taking and AI chat.',cn:'很多大学教材是扫描版 PDF——每页都是图片、没有文字层，导致划词、翻译、高亮、笔记、AI 问答全部失效。'},
  {t:'ui',kind:'flow',items:['Scanned PDF 扫描书','MinerU parse 解析','Reformatted view 重排版','All features alive 功能复活']},
  {t:'p',en:'After parsing, the book opens in a clean reformatted view (proper headings, typeset formulas, real tables) — and whole-book AI chat becomes available, with answers that cite page numbers.',cn:'解析后书籍以整洁的重排版视图打开（规范标题、排版公式、成型表格），并解锁整本书 AI 问答——回答会标注页码。'},
  {t:'p',en:'Normal text PDFs skip all of this automatically — you never notice MinerU is there.',cn:'原生文字 PDF 会自动跳过以上全部流程——你完全感知不到 MinerU 的存在。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Get your API key (free)',cn:'获取 API Key（免费）'},
  {t:'p',en:'Parsing runs on your own free MinerU quota, so 数跃 asks for your personal key once. Four steps:',cn:'解析消耗的是你自己的 MinerU 免费额度，因此数跃需要你一次性提供个人 Key。共四步：'},
  {t:'table',head:['Step 步骤','Action 操作'],rows:[
    ['1','Visit mineru.net and sign up 访问官网并注册（免费）'],
    ['2','Open the console → API Keys 打开控制台的 API Keys 页'],
    ['3','Create and copy your key 创建并复制你的 Key'],
    ['4','Paste it into 数跃 粘贴到数跃即可']]},
  {t:'link',url:'https://mineru.net',en:'Go to mineru.net',cn:'点击访问官网（浏览器新窗口打开无效时请手动复制网址）'},
  {t:'p',en:'The free tier gives 2,000 pages per day — a 465-page textbook costs less than a quarter of one day\'s quota.',cn:'免费额度为每天 2000 页——一本 465 页的教材只消耗一天额度的不到四分之一。'}
]},
{blocks:[
  {t:'h',lvl:1,en:'Using it in 数跃',cn:'在数跃中使用'},
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
        const navs=[['Dashboard 仪表盘','layout-dashboard'],['Pre-Assessment 前测','clipboard-check'],['Math Tutor AI辅导','sigma'],['AI Quiz 智能出题','target'],['Function Plotter 画板','chart-line'],['Reader 阅读','book-open','hot'],['Notes & Vocab 笔记单词库','notebook-pen','hot'],['Knowledge Graph 知识图谱','network'],['Forum 学习论坛','message-square'],['All Materials 书架','library']];
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Sidebar 侧边栏导览</div>'
            +navs.map(n=>'<div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 8px;border-radius:6px;'+(n[2]?'background:rgba(76,141,255,.10);color:var(--accent);font-weight:600;':'color:var(--text-secondary);')+'">'+iconHtml(n[1],14)+n[0]+(n[2]?' ◀ start here 从这开始':'')+'</div>').join('');
        refreshIcons();
    }else if(kind==='flow'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">How it works 工作流程</div>'
            +items.map(i=>chip(i)).join('<span style="color:var(--text-muted);margin:0 4px;">→</span>');
    }else if(kind==='modes'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">辅导双模式 Math Tutor modes</div>'
            +chip('通用 · 分步解答 step-by-step')+chip('引导 · 苏格拉底式 Socratic',true)
            +'<div style="margin-top:8px;">'+chip('已验证 —— 每道题双重校验 verified')+'</div>';
    }else if(kind==='floatmenu'){
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">划词三件套 Select text to see</div>'
            +chip('翻译')+chip('高亮')+chip('笔记')+chip('问 AI',true)
            +'<div style="margin-top:6px;">'+chip('收入单词本 ⇐ 阅读时划词即可收词',true)+'</div>';
    }else if(kind==='vocab'){
        // term chips styled like the real vocab flow view
        const term=(en,zh,src)=>'<span style="display:inline-flex;align-items:baseline;gap:4px;padding:5px 12px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border);margin:3px 4px 3px 0;font-size:12px;">'
            +'<span style="font-family:var(--font-mono);font-weight:600;color:var(--text-primary);">'+en+'</span>'
            +'<span style="color:var(--text-secondary);">'+zh+'</span>'
            +(src?'<span style="font-family:var(--font-mono);font-size:9px;color:var(--accent);">p.'+src+'</span>':'')+'</span>';
        const book=(name,n)=>'<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:8px;border:1px dashed rgba(82,196,26,.45);margin:3px 4px 3px 0;font-size:12px;color:var(--green);">'+iconHtml('notebook-pen',12)+name+' <span style="font-size:9px;color:var(--text-muted);">'+n+' 词</span></span>';
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Vocabulary Book 单词本</div>'
            +term('supremum','上确界','12')+term('eigenvalue','特征值','45')+term('uniform convergence','一致收敛','78')+term('ε-δ language','ε-δ 语言','')
            +'<div style="font-size:11px;color:var(--text-muted);margin:10px 0 6px;">Custom books 自定义单词本</div>'
            +book('第一章 极限术语','18')+book('易忘词','7');
        refreshIcons();
    }else if(kind==='graph'){
        const node=(txt,color,solid)=>'<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:999px;font-size:11px;margin:2px 4px 2px 0;border:1.5px solid '+color+';'+(solid?'background:'+color+';color:#fff;':'color:'+color+';')+'">'+txt+'</span>';
        const arrow='<span style="color:var(--text-muted);margin:0 2px;">↓</span>';
        box.innerHTML='<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Knowledge Graph 知识图谱（三层层级）</div>'
            +'<div><span style="font-size:10px;color:var(--text-muted);margin-right:6px;">L1 高中</span>'+node('函数与导数','#52c41a',true)+node('数列','#4C8DFF',true)+node('概率统计','#faad14',false)+'</div>'
            +'<div style="margin:2px 0;">'+arrow+'</div>'
            +'<div><span style="font-size:10px;color:var(--text-muted);margin-right:6px;">L2 衔接</span>'+node('ε-δ 语言','#7a6bff',false)+node('推理与证明','#E5484D',false)+'</div>'
            +'<div style="margin:2px 0;">'+arrow+'</div>'
            +'<div><span style="font-size:10px;color:var(--text-muted);margin-right:6px;">L3 大学</span>'+node('数列极限','#52c41a',true)+node('矩阵与行列式','#52c41a',true)+node('向量空间','#faad14',false)+'</div>'
            +'<div style="font-size:10px;color:var(--text-muted);margin-top:8px;">实线＝前置已达标 · 虚线＝前置未达标 · 颜色＝掌握状态（绿=已掌握 / 黄=学习中 / 红=弱项）</div>';
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
        divider.textContent='— 第 '+(i+1)+' 页 —';
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
                document.getElementById('reader-toolbar').textContent='第 '+p.dataset.pageNum+' 页 / 共 '+total+' 页 · '+doc.title;
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
