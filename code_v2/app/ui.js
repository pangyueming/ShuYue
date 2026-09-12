// ===== RECYCLE BIN & CONFIRM DIALOG =====
function showConfirmDialog(opts){
    const existing=document.getElementById('confirm-dialog-overlay');
    if(existing)existing.remove();
    const overlay=document.createElement('div');
    overlay.id='confirm-dialog-overlay';
    overlay.style.cssText='position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.5);';
    overlay.innerHTML=`<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;max-width:360px;width:100%;padding:24px;text-align:center;">
        ${opts.icon?`<div style="margin-bottom:8px;color:${opts.iconColor||'var(--red)'};">${iconHtml(opts.icon,36)}</div>`:''}
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--text-primary);">${escapeHtml(opts.title||'Are you sure?')}</div>
        <div style="font-size:14px;color:var(--text-secondary);margin-bottom:24px;white-space:pre-wrap;">${escapeHtml(opts.message||'')}</div>
        <div style="display:flex;gap:8px;">
            <button id="confirm-cancel" class="btn-secondary" style="flex:1;padding:10px;">${escapeHtml(opts.cancelText||'Cancel')}</button>
            <button id="confirm-ok" class="btn-primary" style="flex:1;padding:10px;background:${opts.confirmColor||'var(--accent)'};">${escapeHtml(opts.confirmText||'Confirm')}</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);
    refreshIcons();
    document.getElementById('confirm-cancel').onclick=()=>{overlay.remove();if(opts.onCancel)opts.onCancel();};
    document.getElementById('confirm-ok').onclick=()=>{overlay.remove();if(opts.onConfirm)opts.onConfirm();};
}

// Bookshelf recycle bin functions
function bsDeleteDocument(docId){
    const doc=Object.values(bsData).flat().find(d=>d.id===docId);
    if(!doc)return;
    showConfirmDialog({
        title:'Delete Document?',
        message:`"${doc.title}" will be moved to Recycle Bin.`,
        confirmText:'Delete',
        confirmColor:'#ff6b6b',
        onConfirm:()=>{
            doc.isDeleted=true;
            doc.deletedAt=new Date().toISOString();
            bsPageRenderGrid(bsPageCat);
            bsRenderDashboard(bsPageCat);
            const rm=document.getElementById('reader-bs-modal');
            if(rm&&rm.style.display==='flex')readerRenderModalDocs(bsModalCat);
            // Sync: hide PDF entry on Notes page when its document goes to Recycle Bin
            const pdfNote=notesData.find(n=>n.isPdf&&n.documentId===docId);
            if(pdfNote){pdfNote.isDeleted=true;pdfNote.deletedAt=doc.deletedAt;notesRender();}
            showNotification('Moved to Recycle Bin','success');
        }
    });
}
function bsRestoreDocument(docId){
    const doc=Object.values(bsData).flat().find(d=>d.id===docId);
    if(!doc)return;
    doc.isDeleted=false;
    doc.deletedAt=null;
    bsPageRenderGrid(bsPageCat);
    bsRenderDashboard(bsPageCat);
    // Sync: restore PDF entry on Notes page
    const pdfNote=notesData.find(n=>n.isPdf&&n.documentId===docId);
    if(pdfNote){pdfNote.isDeleted=false;pdfNote.deletedAt=null;notesRender();}
    showNotification('Document restored');
}
async function bsPermanentlyDeleteDocument(docId){
    const doc=Object.values(bsData).flat().find(d=>d.id===docId);
    if(!doc)return;
    showConfirmDialog({
        icon:'alert-triangle',
        title:'Delete Forever?',
        message:`"${doc.title}" will be permanently removed from the server.\nThis action cannot be undone.`,
        confirmText:'Delete Forever',
        confirmColor:'#ff6b6b',
        onConfirm:async ()=>{
            try{
                const res=await apiFetch('/api/documents/'+docId,{method:'DELETE'});
                if(!res.ok)throw new Error('HTTP '+res.status);
            }catch(e){console.error('Backend delete failed:',e);}
            Object.keys(bsData).forEach(cat=>{
                bsData[cat]=bsData[cat].filter(d=>d.id!==docId);
            });
            bsPageRenderGrid(bsPageCat);
            bsRenderDashboard(bsPageCat);
            // Sync: fully reload Notes page so the deleted PDF disappears everywhere
            notesInit();
            showNotification('Permanently deleted','success');
        }
    });
}

// Notes recycle bin functions
function notesDeleteNote(noteId){
    const n=notesData.find(x=>x.id===noteId);
    if(!n)return;
    showConfirmDialog({
        title:'Delete Note?',
        message:`"${n.title||'Untitled'}" will be moved to Recycle Bin.`,
        confirmText:'Delete',
        confirmColor:'#ff6b6b',
        onConfirm:()=>{
            n.isDeleted=true;
            n.deletedAt=new Date().toISOString();
            notesSave();notesRender();
            showNotification('Note moved to Recycle Bin','success');
        }
    });
}
function notesRestoreNote(noteId){
    const n=notesData.find(x=>x.id===noteId);
    if(!n)return;
    n.isDeleted=false;
    n.deletedAt=null;
    notesSave();notesRender();
    showNotification('Note restored');
}
function notesPermanentlyDeleteNote(noteId){
    const n=notesData.find(x=>x.id===noteId);
    if(!n)return;
    showConfirmDialog({
        icon:'alert-triangle',
        title:'Delete Forever?',
        message:`"${n.title||'Untitled'}" will be permanently removed from the server.\nThis action cannot be undone.`,
        confirmText:'Delete Forever',
        confirmColor:'#ff6b6b',
        onConfirm:async ()=>{
            try{
                const res=await apiFetch('/api/notes/'+noteId,{method:'DELETE'});
                if(!res.ok)throw new Error('HTTP '+res.status);
            }catch(e){console.error('Backend delete failed:',e);}
            notesData=notesData.filter(x=>x.id!==noteId);
            notesSave();notesRender();
            showNotification('Note permanently deleted','success');
        }
    });
}

// ===== UTIL =====
// type: 'success' | 'error' | 'warning' | 'info' (auto-detected as fallback)
function showNotification(text,type){
    const t=String(text||'');
    if(!type){
        if(/failed|error|expired|invalid|denied|unavailable|not found|cannot|could not/i.test(t))type='error';
        else if(/saved|created|uploaded|restored|updated|welcome|deleted|complete|parsed|generated/i.test(t))type='success';
        else type='info';
    }
    const meta={success:['check-circle','var(--green)'],error:['alert-circle','var(--red)'],warning:['alert-triangle','var(--yellow)'],info:['info','var(--iris-400)']}[type]||['info','var(--iris-400)'];
    const clean=t.replace(/^\s*(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\uFE0F?\s*)+/u,'');
    const n=document.createElement('div');
    n.className='toast';
    n.style.cssText='position:fixed;top:72px;right:20px;z-index:1000;display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:14px;background:var(--glass-bg-strong);-webkit-backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));color:var(--text-primary);font-size:13.5px;box-shadow:var(--shadow-lg),var(--shadow-glass);border:1px solid var(--glass-border);max-width:380px;';
    n.innerHTML='<i data-lucide="'+meta[0]+'" style="width:18px;height:18px;color:'+meta[1]+';flex-shrink:0;"></i><span style="flex:1;line-height:1.4;">'+escapeHtml(clean)+'</span>';
    document.body.appendChild(n);
    if(window.lucide)lucide.createIcons();
    setTimeout(()=>{n.style.transition='opacity .25s ease,transform .25s ease';n.style.opacity='0';n.style.transform='translateY(-8px)';setTimeout(()=>n.remove(),260);},2500);
}
function animateCountUp(){
    document.querySelectorAll('.count-up').forEach(el=>{
        const target=parseFloat(el.dataset.count||'0');
        const suffix=el.dataset.suffix||'';
        const dur=1200;
        const start=performance.now();
        function frame(now){
            const t=Math.min((now-start)/dur,1);
            const eased=1-Math.pow(1-t,4);
            el.textContent=Math.round(target*eased)+suffix;
            if(t<1)requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    });
}

// Proficiency ring: stroke-dashoffset eased to the target percentage.
function animateRing(pct){
    const c=document.getElementById('stat-ring-fill');
    if(!c)return;
    const C=2*Math.PI*52;
    const target=Math.max(0,Math.min(100,pct||0));
    const set=v=>{c.style.strokeDashoffset=String(C*(1-v/100));};
    const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduced){set(target);return;}
    const dur=1100,start=performance.now();
    (function frame(now){
        const t=Math.min((now-start)/dur,1);
        const eased=1-Math.pow(1-t,4);
        set(target*eased);
        if(t<1)requestAnimationFrame(frame);
    })(start);
}
// Sync the ring from the DOM demo value (guests — no backend stats).
function ringFromDom(){
    const num=document.getElementById('stat-proj-num');
    if(num)animateRing(parseFloat(num.dataset.count||'0'));
}

async function loadUserStats(){
    const token=localStorage.getItem('cb_token');
    if(!token){ringFromDom();return;}
    try{
        const res=await apiFetch('/api/stats');
        if(!res.ok)return;
        const data=await res.json();
        const setNum=(key,val)=>{const el=document.querySelector('[data-stat-key="'+key+'"]');if(el){el.dataset.count=val;el.textContent=val;}};
        const proj=Math.max(0,Math.min(100,Math.round(data.math_proficiency||0)));
        setNum('documents',data.documents_read||0);
        // Real backend values (streak derives from quiz/notes/highlights/documents activity)
        setNum('problems',data.problems_solved||0);
        setNum('streak',data.day_streak||0);
        const numEl=document.getElementById('stat-proj-num');
        if(numEl){numEl.dataset.count=proj;numEl.textContent=proj+'%';}
        animateRing(proj);
        // Rolling daily snapshot → honest delta ("+3% vs 2d ago")
        const DAY=864e5;
        let hist=null;
        try{hist=JSON.parse(localStorage.getItem('cb_stats_hist')||'null');}catch(e){}
        const age=hist&&hist.t?Date.now()-hist.t:0;
        const deltaEl=document.getElementById('stat-proj-delta');
        if(deltaEl){
            if(hist&&age>=DAY&&hist.proj!==proj){
                const d=proj-hist.proj;
                deltaEl.textContent=(d>0?'+':'')+d+'% vs '+Math.max(1,Math.round(age/DAY))+'d ago';
                deltaEl.className='stat-hero-delta '+(d>=0?'up':'down');
            }else{
                deltaEl.textContent='baseline';
                deltaEl.className='stat-hero-delta';
            }
        }
        if(!hist||age>=DAY){try{localStorage.setItem('cb_stats_hist',JSON.stringify({t:Date.now(),proj:proj}));}catch(e){}}
    }catch(e){console.error('Failed to load stats:',e);ringFromDom();}
}
function ripple(e){
    const btn=e.currentTarget;
    const rect=btn.getBoundingClientRect();
    const size=Math.max(rect.width,rect.height)*2;
    const x=e.clientX-rect.left-size/2;
    const y=e.clientY-rect.top-size/2;
    const r=document.createElement('span');
    r.style.cssText='position:absolute;left:'+x+'px;top:'+y+'px;width:'+size+'px;height:'+size+'px;border-radius:50%;background:'+(btn.classList.contains('btn-primary')?'rgba(255,255,255,.4)':'rgba(55,53,47,.08)')+';transform:scale(0);animation:rippleAnim .6s ease-out;pointer-events:none;';
    btn.appendChild(r);
    setTimeout(()=>r.remove(),620);
}
function toggleNotesPanel(){
    const p=document.getElementById('reader-notes-aside');
    const b=document.getElementById('notes-toggle-btn');
    if(p.classList.contains('collapsed')){
        p.classList.remove('collapsed');
        b.innerHTML=iconHtml('chevron-right',14);b.title='Collapse notes';
    }else{
        p.classList.add('collapsed');
        b.innerHTML=iconHtml('chevron-left',14);b.title='Expand notes';
    }
    refreshIcons();
    // PPTX slides are width:auto and reflow on their own; only PDF needs a
    // scale-aware re-render. Re-render just the viewport pages (plus a small
    // buffer) instead of resetting every page — the old full reset caused
    // scroll jumps and slow redraws.
    if(readerDocType!=='pdf'||!readerPdfDoc)return;
    setTimeout(async()=>{
        const area=document.getElementById('reader-content-area');
        if(!area)return;
        try{
            const firstPage=await readerPdfDoc.getPage(1);
            const nativeWidth=firstPage.getViewport({scale:1}).width;
            const newWidth=area.clientWidth-48;
            readerScale=Math.min(2.0,Math.max(0.5,newWidth/nativeWidth));
            readerRenderedPages.clear();
            const areaRect=area.getBoundingClientRect();
            area.querySelectorAll('[data-page-num]').forEach(pd=>{
                const rect=pd.getBoundingClientRect();
                if(rect.bottom>areaRect.top-200&&rect.top<areaRect.bottom+200){
                    pd.innerHTML='<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);font-size:13px;">Page '+pd.dataset.pageNum+'</div>';
                    pd.style.cssText='margin:0 auto 16px;width:auto;min-height:400px;background:#fff;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.12);overflow:hidden;position:relative;';
                    readerRenderPdfPageFull(parseInt(pd.dataset.pageNum));
                }
            });
        }catch(e){}
    },280);
}

