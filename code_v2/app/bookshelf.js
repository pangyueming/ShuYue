// ===== BOOKSHELF PAGE =====
async function bsPageInit(){
    renderSkeletonGrid('dash-bs-grid',5);
    renderSkeletonGrid('bs-page-grid',5);
    await loadDocumentsFromBackend();
    bsPageRenderTabs();
    bsPageRenderGrid('slides');
    bsRenderDashboard(bsPageCat);
}
function renderSkeletonGrid(id,count){
    const g=document.getElementById(id);if(!g)return;
    g.innerHTML=Array.from({length:count}).map(()=>'<div style="display:flex;flex-direction:column;gap:10px;align-items:center;padding:14px;"><div class="skeleton" style="width:48px;height:56px;border-radius:8px;"></div><div class="skeleton" style="width:72%;height:12px;"></div><div class="skeleton" style="width:48%;height:10px;"></div></div>').join('');
}
// Backend-startup resilience: network-level failures (backend still booting /
// restarted) auto-retry with backoff; after the final attempt an inline
// "backend not ready" banner replaces the silent empty grid, so a timing
// window can never look like "data loss" again.
let _bsLoadAttempt=0;
function _bsShowRetryBanner(){
    ['bs-page-grid','dash-bs-grid'].forEach(id=>{
        const g=document.getElementById(id);if(!g)return;
        const b=document.createElement('div');
        b.style.cssText='grid-column:1/-1;display:flex;flex-direction:column;align-items:center;gap:10px;padding:28px 16px;color:var(--text-muted);font-size:13px;';
        b.innerHTML='<div style="font-size:22px;">&#9888;</div>'
            +'<div>后端未就绪——数据是安全的。</div>'
            +'<button class="btn-primary" style="padding:8px 22px;font-size:13px;" onclick="bsRetryLoad()">立即重试</button>'
            +'<span style="font-size:11px;opacity:.7;">自动重试中…</span>';
        g.innerHTML='';g.appendChild(b);refreshIcons();
    });
}
function bsRetryLoad(){
    _bsLoadAttempt=0;
    bsPageInit();
}
async function loadDocumentsFromBackend(){
    try{
        const res=await apiFetch('/api/documents');
        if(!res.ok)throw new Error('HTTP '+res.status);
        const docs=await res.json();
        // Clear and refill bsData
        BS_CATS.forEach(c=>bsData[c.key]=[]);
        docs.forEach(d=>{
            const cat=d.category;
            if(bsData[cat]!==undefined){
                bsData[cat].push({
                    id:d.id,
                    icon:categoryIcon(cat),
                    title:d.title,
                    desc:d.desc||'',
                    category:cat,
                    source:d.source,
                    fileType:d.fileType,
                    parseStatus:d.parseStatus||'',
                    needsOcr:d.needsOcr||false,
                    aiDeclined:d.aiDeclined||false,
                    isDeleted:false,
                    deletedAt:null
                });
            }
        });
        _bsLoadAttempt=0;
    }catch(e){
        console.error('Failed to load documents:',e);
        // Distinguish network-level failure (backend booting) from HTTP errors:
        // only network failures qualify for the auto-retry ladder.
        const networkLevel=(e instanceof TypeError)||(e.message&&e.message.includes('Failed to fetch'));
        if(networkLevel&&_bsLoadAttempt<3){
            _bsLoadAttempt++;
            showNotification('后端启动中… 自动重试 ('+_bsLoadAttempt+'/3)','error');
            setTimeout(()=>{loadDocumentsFromBackend().then(()=>{bsPageRenderTabs();bsPageRenderGrid('slides');bsRenderDashboard(bsPageCat);});},2000*_bsLoadAttempt);
        }else{
            showNotification('无法从服务器加载书架','error');
            if(localStorage.getItem('cb_cn_token'))_bsShowRetryBanner();
        }
    }
    ensureGuideInShelf();   // built-in guide always pinned (guests included)
}
// Dashboard bookshelf rendering
function bsRenderDashboard(cat){
    const tabs=document.getElementById('dash-bs-tabs');const grid=document.getElementById('dash-bs-grid');
    if(!tabs||!grid)return;
    // Render tabs
    tabs.innerHTML='';
    BS_CATS.forEach((c,i)=>{const t=document.createElement('span');t.style.cssText=`font-size:12px;padding:3px 10px;cursor:pointer;border-bottom:2px solid ${c.key===cat?'var(--accent)':'transparent'};color:${c.key===cat?'var(--accent)':'var(--text-muted)'};font-weight:${c.key===cat?'600':'400'};white-space:nowrap;`;
        t.innerHTML=iconHtml(c.icon,13)+' '+c.label;t.onclick=()=>{bsRenderDashboard(c.key);};tabs.appendChild(t);});refreshIcons();
    // Render grid (Continue tile first when the last-opened doc lives in this category)
    const docs=(bsData[cat]||[]).filter(d=>!d.isDeleted);
    const contTile=(typeof dashContinueTileHtml==='function')?dashContinueTileHtml(cat):'';
    if(docs.length===0){
        if(contTile){grid.innerHTML=contTile;refreshIcons();return;}
        grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted);font-size:12px;">该分类下暂无文档</div>';return;}
    grid.innerHTML=contTile+docs.map((d,i)=>{const origIdx=(bsData[cat]||[]).indexOf(d);
        const showMineru=(d.fileType==='pdf'&&d.needsOcr&&d.parseStatus!=='done');
        const aiBadge=d.parseStatus==='done'?'<span style="position:absolute;top:2px;left:2px;font-size:8px;padding:1px 5px;border-radius:4px;background:rgba(82,196,26,.18);color:#52c41a;font-weight:600;z-index:2;">MinerU</span>':'';
        const sparkBtn=showMineru?`<button class="dash-spark-btn" onclick="event.stopPropagation();bsMineruById('${d.id}')" style="position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:4px;border:none;background:var(--accent);color:#fff;cursor:pointer;opacity:0;transition:opacity .15s;display:flex;align-items:center;justify-content:center;z-index:2;" title="Enable AI re-layout">${iconHtml('sparkles',11)}</button>`:'';
        const isParsing=(d.parseStatus==='queued'||d.parseStatus==='parsing'||d.parseStatus==='indexing');
        const prog=(isParsing&&mineruTracker.progress&&mineruTracker.progress[d.id])||null;
        const pct=prog&&prog.total_pages?Math.min(99,Math.round(prog.pages_done*100/prog.total_pages)):0;
        const progOverlay=isParsing
            ?'<div data-mineru-progress="'+d.id+'" style="position:absolute;left:0;right:0;bottom:0;z-index:2;">'
             +(d.parseStatus==='indexing'
                ?'<div style="height:3px;background:linear-gradient(90deg,#faad14,#f7b955,#faad14);background-size:200% 100%;animation:mineruProgFlow 1.4s linear infinite;"></div>'
                :'<div style="height:3px;background:var(--bg-input);"><div class="mineru-prog-fill" style="height:100%;width:'+pct+'%;background:#faad14;transition:width .6s ease;"></div></div>')
             +'<span class="mineru-prog-pct" style="position:absolute;right:2px;bottom:4px;font-size:8px;color:#faad14;font-weight:600;">'+(d.parseStatus==='queued'?'…':(d.parseStatus==='indexing'?'idx':pct+'%'))+'</span></div>'
            :'';
        return `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center;transition:all .15s;background:var(--bg-card);position:relative;overflow:hidden;" onmouseenter="this.style.borderColor='var(--accent)';this.querySelector('.dash-del-btn').style.opacity='1';var s=this.querySelector('.dash-spark-btn');if(s)s.style.opacity='1'" onmouseleave="this.style.borderColor='var(--border)';this.querySelector('.dash-del-btn').style.opacity='0';var s=this.querySelector('.dash-spark-btn');if(s)s.style.opacity='0'">
        <button class="dash-del-btn" onclick="event.stopPropagation();bsDeleteDocument('${d.id}')" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:4px;border:none;background:rgba(255,107,107,.9);color:#fff;font-size:11px;cursor:pointer;opacity:0;transition:opacity .15s;display:flex;align-items:center;justify-content:center;z-index:2;">×</button>
        ${sparkBtn}${aiBadge}${progOverlay}
        <div onclick="bsOpenFromDash('${cat}',${origIdx})" style="cursor:pointer;">
        <div style="margin-bottom:4px;display:flex;justify-content:center;color:var(--text-secondary);">${iconHtml(d.icon,20)}</div>
        <div style="font-size:11px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary);">${d.title}</div></div></div>`;}).join('');refreshIcons();
}
function bsOpenFromDash(cat,idx){showPage('reader');setTimeout(()=>readerOpenDoc(cat,idx),100);}
function bsPageRenderTabs(){const c=document.getElementById('bs-page-tabs');if(!c)return;c.innerHTML='';
    const allCats=[...BS_CATS,{key:'recycle-bin',icon:'trash-2',label:'Recycle Bin'}];
    allCats.forEach((cat,i)=>{const t=document.createElement('span');t.style.cssText=`font-size:14px;padding:4px 16px;cursor:pointer;border-bottom:2px solid ${cat.key===bsPageCat?'var(--accent)':'transparent'};color:${cat.key===bsPageCat?'var(--accent)':'var(--text-muted)'};font-weight:${cat.key===bsPageCat?'600':'400'};white-space:nowrap;`;
        t.innerHTML=iconHtml(cat.icon,14)+' '+cat.label;
        if(cat.key==='recycle-bin'){
            const deletedCount=Object.values(bsData).flat().filter(d=>d.isDeleted).length;
            if(deletedCount>0)t.innerHTML+=` <span style="font-size:10px;padding:1px 5px;border-radius:999px;background:#ff6b6b;color:#fff;font-weight:600;">${deletedCount}</span>`;
            if(bsPageCat==='recycle-bin'){t.style.borderBottomColor='#ff6b6b';t.style.color='#ff6b6b';}
        }
        t.onclick=()=>{c.querySelectorAll('span').forEach(s=>{s.style.borderBottomColor='transparent';s.style.color='var(--text-muted)';s.style.fontWeight='400';});t.style.borderBottomColor='var(--accent)';t.style.color='var(--accent)';t.style.fontWeight='600';if(cat.key==='recycle-bin'){t.style.borderBottomColor='#ff6b6b';t.style.color='#ff6b6b';}bsPageCat=cat.key;bsPageRenderGrid(cat.key);};c.appendChild(t);});refreshIcons();}
function bsPageRenderGrid(cat){
    const g=document.getElementById('bs-page-grid');const c=document.getElementById('bs-page-count');if(!g)return;
    if(cat==='recycle-bin'){
        const docs=Object.values(bsData).flat().filter(d=>d.isDeleted);
        if(c)c.textContent=`${docs.length} document(s) in Recycle Bin`;
        if(docs.length===0){g.innerHTML=`<div class="placeholder-box" style="grid-column:1/-1;">回收站是空的<br><span style="font-size:12px;">Deleted documents will appear here</span></div>`;return;}
        g.innerHTML=docs.map(d=>`<div style="border:1px solid var(--border);border-radius:10px;padding:12px;transition:all .15s;background:var(--bg-card);position:relative;opacity:.6;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.6'">
            <div style="text-align:center;margin-bottom:8px;"><div style="width:48px;height:56px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-secondary);background:var(--bg-tag);">${iconHtml(d.icon,22)}</div></div>
            <div style="font-size:13px;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.title}</div>
            <div style="font-size:11px;color:var(--text-muted);text-align:center;">Deleted ${d.deletedAt?new Date(d.deletedAt).toLocaleDateString():''}</div>
            <div style="display:flex;gap:6px;margin-top:10px;justify-content:center;">
                <button onclick="bsRestoreDocument('${d.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(82,196,26,.1);border:1px solid rgba(82,196,26,.3);color:#52c41a;cursor:pointer;">恢复</button>
                <button onclick="bsPermanentlyDeleteDocument('${d.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.3);color:#ff6b6b;cursor:pointer;">彻底删除</button>
            </div></div>`).join('');refreshIcons();
        return;
    }
    const docs=(bsData[cat]||[]).filter(d=>!d.isDeleted);
    if(c)c.textContent=`${docs.length} document(s)`;
    if(docs.length===0){g.innerHTML=`<div class="placeholder-box" style="grid-column:1/-1;">No documents yet<br><button class="btn-secondary" style="margin-top:12px;" onclick="bsUpload()">Upload PDF</button></div>`;return;}
    g.innerHTML=docs.map((d,i)=>{const origIdx=(bsData[cat]||[]).indexOf(d);
        const showMineru=(d.fileType==='pdf'&&d.needsOcr&&d.parseStatus!=='done');
        // [Index] native-textbook only: builds the RAG index via MinerU (guides excluded)
        const showIndex=(d.fileType==='pdf'&&!d.needsOcr&&!d.isGuide&&d.category==='textbooks'&&d.parseStatus!=='done');
        const isParsing=(d.parseStatus==='queued'||d.parseStatus==='parsing'||d.parseStatus==='indexing');
        const prog=(isParsing&&mineruTracker.progress&&mineruTracker.progress[d.id])||null;
        let statusLine='';
        if(d.parseStatus==='done'){
            statusLine='<div style="font-size:10px;color:#52c41a;text-align:center;margin-top:6px;">MinerU 已解析</div>';
        }else if(isParsing){
            if(d.parseStatus==='indexing'){
                statusLine='<div data-mineru-progress="'+d.id+'">'+
                    '<div style="height:5px;border-radius:3px;background:var(--bg-input);overflow:hidden;margin-top:8px;"><div class="mineru-prog-fill" style="height:100%;width:100%;background:linear-gradient(90deg,#faad14,#f7b955,#faad14);background-size:200% 100%;animation:mineruProgFlow 1.4s linear infinite;border-radius:3px;"></div></div>'+
                    '<div class="mineru-prog-text" style="font-size:10px;color:#faad14;text-align:center;margin-top:3px;">Building search index…</div></div>';
            }else{
                const pct=prog&&prog.total_pages?Math.min(99,Math.round(prog.pages_done*100/prog.total_pages)):0;
                const label=prog&&prog.total_pages?(prog.pages_done+'/'+prog.total_pages+' pages'):(d.parseStatus==='queued'?'Queued…':'Preparing…');
                statusLine='<div data-mineru-progress="'+d.id+'">'+
                    '<div style="height:5px;border-radius:3px;background:var(--bg-input);overflow:hidden;margin-top:8px;"><div class="mineru-prog-fill" style="height:100%;width:'+pct+'%;background:#faad14;border-radius:3px;transition:width .6s ease;"></div></div>'+
                    '<div class="mineru-prog-text" style="font-size:10px;color:#faad14;text-align:center;margin-top:3px;">'+(d.parseStatus==='queued'?'Queued…':(pct+'% · '+label))+'</div></div>';
            }
        }else if(d.parseStatus==='failed'){
            statusLine='<div style="font-size:10px;color:#ff6b6b;text-align:center;margin-top:6px;">Parsing failed</div>';
        }
        return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;transition:all .18s cubic-bezier(.2,.8,.2,1);background:var(--bg-card);position:relative;box-shadow:var(--shadow-xs);" onmouseenter="this.style.borderColor='var(--accent)';this.style.transform='translateY(-3px)';this.style.boxShadow='var(--shadow-md)';this.querySelector('.bs-del-btn').style.opacity='1'" onmouseleave="this.style.borderColor='var(--border)';this.style.transform='translateY(0)';this.style.boxShadow='var(--shadow-xs)';this.querySelector('.bs-del-btn').style.opacity='0'">
        <button class="bs-del-btn" onclick="event.stopPropagation();bsDeleteDocument('${d.id}')" style="position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:6px;border:none;background:rgba(255,107,107,.9);color:#fff;font-size:11px;cursor:pointer;opacity:0;transition:opacity .15s;display:flex;align-items:center;justify-content:center;z-index:2;">×</button>
        <span style="position:absolute;top:6px;left:6px;font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(82,196,26,.15);color:#52c41a;font-weight:500;">Yours</span>
        <div onclick="bsOpenFromPage('${cat}',${origIdx})" style="cursor:pointer;">
        <div style="text-align:center;margin-bottom:8px;"><div style="width:48px;height:56px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-secondary);background:var(--bg-tag);">${iconHtml(d.icon,22)}</div></div>
        <div style="font-size:13px;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.title}</div><div style="font-size:11px;color:var(--text-muted);text-align:center;">${d.desc}</div></div>
        <div style="text-align:center;margin-top:8px;display:flex;gap:6px;justify-content:center;align-items:center;">
            <span onclick="bsOpenFromPage('${cat}',${origIdx})" style="font-size:11px;padding:2px 10px;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer;">Read</span>
            ${showMineru?`<button onclick="event.stopPropagation();bsMineruById('${d.id}')" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 10px;border-radius:4px;background:var(--accent);color:#fff;border:none;cursor:pointer;">${iconHtml('sparkles',11)}MinerU</button>`:''}
            ${showIndex?`<button onclick="event.stopPropagation();bsMineruById('${d.id}')" title="Build a searchable index so Chat AI can search the whole book" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 10px;border-radius:4px;background:var(--accent);color:#fff;border:none;cursor:pointer;">${iconHtml('sparkles',11)}Index</button>`:''}
            ${!d.isGuide&&!isParsing?`<button onclick="event.stopPropagation();bsGenVocab('${d.id}')" title="从此文档提取数学术语到单词本" aria-label="生成单词本" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:2px 8px;border-radius:4px;background:var(--green);color:#fff;border:none;cursor:pointer;">${iconHtml('book-marked',10)}单词本</button>`:''}
        </div>${statusLine}</div>`;}).join('');refreshIcons();}
function bsOpenFromPage(cat,idx){showPage('reader');setTimeout(()=>readerOpenDoc(cat,idx),100);}
function bsOpenFromDash(cat,idx){showPage('reader');setTimeout(()=>readerOpenDoc(cat,idx),100);}

// ===== UPLOAD =====
function bsUpload(){const old=document.getElementById('bs-file-input');if(old)old.remove();const inp=document.createElement('input');inp.type='file';inp.id='bs-file-input';inp.accept='.pdf,.pptx';inp.style.display='none';inp.onchange=()=>{if(inp.files[0])bsShowUploadModal(inp.files[0]);};
    // [单词本] Cancelling at the FILE-PICKER stage (modal never shown) must
    // not leak the vocab-upload flag into the next unrelated upload.
    // 'cancel' fires on Chromium 113+; elsewhere this is a harmless no-op.
    inp.oncancel=()=>{window.__vocabAfterUpload=false;};
    document.body.appendChild(inp);inp.click();}
function bsShowUploadModal(file){bsPendingFile=file;const m=document.getElementById('bs-upload-modal');const fn=document.getElementById('bs-upload-filename');const cl=document.getElementById('bs-upload-cats');
    fn.textContent=file.name+' ('+(file.size/1024/1024).toFixed(1)+' MB)';bsPendingCat=null;
    cl.innerHTML=BS_CATS.map(c=>`<div onclick="bsSelCat('${c.key}',this)" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:8px;cursor:pointer;border:1px solid var(--border);background:var(--bg-input);">
        <span style="color:var(--text-secondary);display:flex;align-items:center;">${iconHtml(c.icon,18)}</span><span style="font-size:14px;">${c.label}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--text-muted);">${(bsData[c.key]||[]).length} items</span></div>`).join('');
    m.style.display='flex';refreshIcons();}
function bsSelCat(key,el){bsPendingCat=key;el.parentElement.querySelectorAll('div').forEach(d=>{d.style.borderColor='var(--border)';d.style.background='var(--bg-input)';});el.style.borderColor='var(--accent)';el.style.background='rgba(76,141,255,.08)';}
function bsCloseUpload(){document.getElementById('bs-upload-modal').style.display='none';bsPendingFile=null;bsPendingCat=null;window.__vocabAfterUpload=false;}
async function bsConfirmUpload(){if(!bsPendingFile||!bsPendingCat)return;
    // [单词本] Capture the vocab-upload intent HERE (before bsCloseUpload()
    // clears it mid-confirm), and clear it now so a FAILED upload cannot leak
    // the flag into the next unrelated one (uploadCat uses the same pattern).
    const wantVocab=!!window.__vocabAfterUpload;
    window.__vocabAfterUpload=false;
    const cat=BS_CATS.find(c=>c.key===bsPendingCat);
    const uploadCat=bsPendingCat;   // remember before bsCloseUpload clears it
    const formData=new FormData();
    formData.append('file',bsPendingFile);
    formData.append('category',bsPendingCat);
    if(typeof formBusy==='function')formBusy('bs-upload',true,'Uploading…');
    try{
        const res=await apiFetch('/api/documents/upload',{method:'POST',body:formData});
        if(!res.ok)throw new Error('HTTP '+res.status);
        const doc=await res.json();
        bsData[bsPendingCat].push({
            id:doc.id,
            icon:categoryIcon(bsPendingCat),
            title:doc.title,
            desc:doc.sizeText,
            category:bsPendingCat,
            source:'upload',
            fileType:doc.fileType,
            parseStatus:doc.parseStatus||'none',
            needsOcr:doc.needsOcr||false,
            aiDeclined:false,
            isDeleted:false,
            deletedAt:null
        });
        bsCloseUpload();bsPageRenderGrid(bsPageCat);bsRenderDashboard(bsPageCat);
        const rm=document.getElementById('reader-bs-modal');if(rm&&rm.style.display==='flex')readerRenderModalDocs(bsModalCat);
        // Sync: PDF uploaded to "notes" category should appear on Notes page
        if(uploadCat==='notes'){notesInit();}
        if(typeof logActivity==='function')logActivity('upload','上传 · '+doc.title);

        // [单词本] If uploaded from vocab tab, auto-trigger vocab extraction
        // and open the resulting book directly (title passed for direct-open)
        if(wantVocab){
            setTimeout(()=>{ bsGenVocab(doc.id, doc.title); }, 500);
        }
        showNotification(doc.needsOcr
            ?'Scanned PDF detected — enable AI re-layout now?'
            :'Uploaded: '+doc.title
            ,doc.needsOcr?'info':'success');
        // [MinerU] scanned upload -> pop the gate immediately (parse early, not at read time)
        if(doc.needsOcr&&doc.parseStatus!=='done'){
            const upCat=uploadCat; const upIdx=bsData[upCat].length-1;
            setTimeout(()=>{if(bsData[upCat]&&bsData[upCat][upIdx])mineruGateOpen(bsData[upCat][upIdx],upCat,upIdx,false);},350);
        }
    }catch(e){
        console.error('Upload failed:',e);
        showNotification('上传失败：'+e.message,'error');
    }finally{if(typeof formBusy==='function')formBusy('bs-upload',false);}
}



// ===== [单词本] Generate vocabulary from a document =====
// docTitle (optional): when provided (upload-from-vocab flow), the freshly
// created book opens directly after extraction. Without it (bookshelf card
// menu), behaviour stays at "refresh the vocab doc list".
async function bsGenVocab(docId, docTitle){
    showNotification(docTitle
        ?('正在为《'+docTitle+'》提取数学术语，约需 10–30 秒…')
        :'正在提取数学术语…', 'info');
    try{
        const res = await apiFetch('/api/vocab/auto/' + docId, {method:'POST'});
        if(!res.ok){
            const e = await res.json().catch(()=>({}));
            throw new Error(e.detail || ('HTTP ' + res.status));
        }
        const d = await res.json();
        if(d.extracted > 0){
            showNotification('已提取 ' + d.extracted + ' 个术语到单词本', 'success');
            if(typeof logActivity === 'function') logActivity('vocab', '提取术语 · ' + d.extracted + ' 词');
            // Single-load flow: mark stale → await vocabInit() ourselves →
            // THEN switch the tab (vocabTabSwitch sees vocabLoaded=true and
            // does not fire a second concurrent init) → open the new book.
            if(typeof vocabLoaded !== 'undefined') vocabLoaded = false;
            showPage('notes');
            if(typeof vocabInit==='function'){
                try{ await vocabInit(); }catch(e2){/* fall back to doc list */}
            }
            if(typeof vocabTabSwitch==='function')vocabTabSwitch('vocab');
            if(docTitle && typeof vocabOpenDoc==='function'){
                vocabOpenDoc(docId, docTitle);
            }
        }else{
            showNotification('未提取到数学术语（文档可能无可提取内容）', 'warning');
        }
    }catch(e){
        const msg=String(e&&e.message?e.message:e);
        if(/no extractable text/i.test(msg)){
            // Scanned PDF: MinerU parse unlocks extraction (its completion hook
            // auto-extracts textbooks/slides); guide the user there.
            showNotification('扫描版 PDF 无文字层——先在阅读器启用 MinerU 解析（解析完成会自动提取术语），或解析后在书架卡片点"单词本"', 'warning');
        }else{
            showNotification('提取失败：' + msg, 'error');
        }
    }
}
