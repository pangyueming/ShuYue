// ===== READER NOTES (synced with Notes page) =====
async function readerSaveNoteFromSel(){
    const inp=document.getElementById('reader-note-input');if(!inp||!inp.value.trim())return;
    const noteText=inp.value.trim();const quote=readerSelText.substring(0,100);
    readerNotes.push({text:noteText,quote,time:new Date().toLocaleTimeString(),color:'#52c41a'});
    readerRenderNotes();
    // Sync to backend
    try{
        const res=await apiFetch('/api/notes',{
            method:'POST',
            body:JSON.stringify({
                title:'Reading · '+(quote.substring(0,30)||'Reader Note'),
                tag:'Reading Note',
                content:noteText+'\n\nQuoted: "'+quote+(readerSelText.length>100?'...':'')+'"',
                source:'reader'
            })
        });
        if(!res.ok)throw new Error('HTTP '+res.status);
        const created=await res.json();
        notesData.push({
            id:created.id,
            title:(quote.substring(0,30)||'Reader Note'),
            tag:'Reading Note',
            content:noteText+'\n\nQuoted: "'+quote+(readerSelText.length>100?'...':'')+'"',
            source:'reader',
            createdAt:new Date().toISOString(),
            updatedAt:new Date().toISOString(),
            isDeleted:false,
            deletedAt:null
        });
        notesSave();
        if(typeof logActivity==='function')logActivity('note','笔记 · '+(quote.substring(0,30)||'阅读器笔记'));
    }catch(e){console.error('Save reader note failed:',e);}
    document.getElementById('reader-action-panel').style.display='none';window.getSelection().removeAllRanges();
    showNotification('Note saved','success');
}
async function readerSaveQuickNote(){
    const inp=document.getElementById('reader-quick-note');if(!inp||!inp.value.trim())return;
    const noteText=inp.value.trim();
    readerNotes.push({text:noteText,quote:'',time:new Date().toLocaleTimeString(),color:'#4C8DFF'});
    inp.value='';readerRenderNotes();
    // Sync to backend
    try{
        const res=await apiFetch('/api/notes',{
            method:'POST',
            body:JSON.stringify({title:'Quick Note',tag:'Reading Note',content:noteText,source:'reader'})
        });
        if(!res.ok)throw new Error('HTTP '+res.status);
        const created=await res.json();
        notesData.push({
            id:created.id,
            title:'Quick Note',
            tag:'Reading Note',
            content:noteText,
            source:'reader',
            createdAt:new Date().toISOString(),
            updatedAt:new Date().toISOString(),
            isDeleted:false,
            deletedAt:null
        });
        notesSave();
        if(typeof logActivity==='function')logActivity('note','笔记 · 快速笔记');
    }catch(e){console.error('Save quick note failed:',e);}
    showNotification('Quick note saved','success');
}
function readerDeleteNote(i){readerNotes.splice(i,1);readerRenderNotes();}
function readerRenderNotes(){const list=document.getElementById('reader-notes-list');const cnt=document.getElementById('reader-note-count');if(!list)return;if(cnt)cnt.textContent=readerNotes.length+(readerNotes.length===1?' note':' notes');
    if(readerNotes.length===0){list.innerHTML='<p style="font-size:12px;text-align:center;padding:16px;color:var(--text-muted);">No notes yet. Select text and click Note.</p>';return;}
    list.innerHTML=readerNotes.map((n,i)=>`<div class="card" style="padding:12px;border-left:3px solid ${n.color};">
        ${n.quote?`<div style="font-size:11px;margin-bottom:4px;font-style:italic;color:var(--text-muted);">"${n.quote}${n.quote.length>=100?'...':''}"</div>`:''}
        <p style="font-size:13px;">${n.text}</p><div style="display:flex;justify-content:space-between;margin-top:4px;"><span style="font-size:11px;color:var(--text-muted);">${n.time}</span><button onclick="readerDeleteNote(${i})" style="font-size:12px;color:#ff6b6b;background:none;border:none;cursor:pointer;display:inline-flex;align-items:center;">${iconHtml('x',12)}</button></div></div>`).join('');refreshIcons();}
function readerSetHlColor(c){
    document.getElementById('hl-selected-color').value=c;
    ['#faad14','#52c41a','#4C8DFF','#ff6b6b'].forEach(col=>{
        const btn=document.getElementById('hl-color-btn-'+col);
        if(btn)btn.style.borderColor=(col===c?'#333':'transparent');
    });
}

function readerSaveHighlightFromPanel(){
    const color=document.getElementById('hl-selected-color').value;
    const note=document.getElementById('hl-note-input').value.trim();
    const panel=document.getElementById('reader-action-panel');
    const text=readerSelText;
    // Apply visual highlight immediately
    try{const span=document.createElement('span');span.className='reader-hl';span.style.cssText='background:'+color+'33;border-radius:2px;';readerSelRange.surroundContents(span);}catch(e){}
    window.getSelection().removeAllRanges();
    panel.style.display='none';
    // Detect page from current view
    let page=1;const container=document.getElementById('pdf-pages-container');if(container){const pages=container.querySelectorAll('[data-page-num]');for(let p of pages){const rect=p.getBoundingClientRect();const area=document.getElementById('reader-content-area');if(rect.top>=0&&rect.top<area.clientHeight){page=parseInt(p.dataset.pageNum);break;}}}
    // Save to backend
    readerSaveHighlight(readerCurrentDocId,page,text,color,note);
}

async function readerSaveHighlight(docId,page,text,color,note){
    const hl={id:'local_'+Date.now(),document_id:docId,page:page,text:text,color:color,note:note||'',created_at:new Date().toISOString()};
    readerHighlights.push(hl);readerRenderHighlights();
    if(typeof logActivity==='function')logActivity('highlight','高亮 · "'+(text||'').substring(0,40)+'"');
    // Save to localStorage for guests
    try{localStorage.setItem('cb_cn_highlights_'+docId,JSON.stringify(readerHighlights));}catch(e){}
    const token=localStorage.getItem('cb_cn_token');
    if(!token)return; // Guest: localStorage only
    try{
        const res=await apiFetch('/api/highlights',{method:'POST',body:JSON.stringify({document_id:docId,page:page,text:text,color:color,note:note||''})});
        if(!res.ok)throw new Error('HTTP '+res.status);
        const data=await res.json();
        if(data.id)hl.id=data.id;
    }catch(e){console.error('Failed to save highlight:',e);}
}

async function readerLoadHighlights(docId){
    if(!docId)return;
    readerHighlights=[];
    // Try backend first
    const token=localStorage.getItem('cb_cn_token');
    if(token){
        try{
            const res=await apiFetch('/api/highlights?document_id='+encodeURIComponent(docId));
            if(res.ok){const data=await res.json();if(Array.isArray(data))readerHighlights=data;}
        }catch(e){console.error('Failed to load highlights:',e);}
    }
    // Fallback: localStorage for guests
    if(readerHighlights.length===0){
        try{const local=JSON.parse(localStorage.getItem('cb_cn_highlights_'+docId)||'[]');if(Array.isArray(local))readerHighlights=local;}catch(e){}
    }
    readerRenderHighlights();
    // Apply to already-rendered pages
    readerHighlights.forEach(h=>{if(readerRenderedPages.has(h.page))readerApplyHighlightToPage(h.page,h.text,h.color);});
}

// Shared highlight core: wraps the first text-node match inside any root
// (Reader pages #pdf-page-N and peek pages #tbpp-page-N both use this).
function applyHighlightToRoot(rootEl,searchText,color){
    const walker=document.createTreeWalker(rootEl,NodeFilter.SHOW_TEXT,null,false);
    const nodes=[];let n;while((n=walker.nextNode())!==null)nodes.push(n);
    for(let node of nodes){
        const idx=node.textContent.indexOf(searchText);if(idx===-1)continue;
        const range=document.createRange();
        range.setStart(node,idx);range.setEnd(node,idx+searchText.length);
        const span=document.createElement('span');
        span.className='reader-hl';
        span.style.cssText='background:'+color+'33;border-radius:2px;';
        try{range.surroundContents(span);}catch(e){}
        break; // Highlight first match only
    }
}

function readerApplyHighlightToPage(pageNum,searchText,color){
    const pageDiv=document.getElementById('pdf-page-'+pageNum);if(!pageDiv)return;
    const textLayer=pageDiv.querySelector('.textLayer');
    applyHighlightToRoot(textLayer||pageDiv,searchText,color);
}

function readerDeleteHighlight(hlId){
    const idx=readerHighlights.findIndex(h=>h.id===hlId);if(idx===-1)return;
    readerHighlights.splice(idx,1);readerRenderHighlights();
    // Sync localStorage
    try{if(readerCurrentDocId)localStorage.setItem('cb_cn_highlights_'+readerCurrentDocId,JSON.stringify(readerHighlights));}catch(e){}
    // Remove from backend
    const token=localStorage.getItem('cb_cn_token');
    if(token&&hlId&&!hlId.startsWith('local_')){
        apiFetch('/api/highlights/'+hlId,{method:'DELETE'}).catch(e=>console.error('Failed to delete highlight:',e));
    }
    // Remove visual highlights from DOM
    document.querySelectorAll('.reader-hl').forEach(el=>{
        const parent=el.parentNode;if(!parent)return;
        while(el.firstChild)parent.insertBefore(el.firstChild,el);
        parent.removeChild(el);
    });
    // Re-apply remaining highlights
    readerHighlights.forEach(h=>{if(readerRenderedPages.has(h.page))readerApplyHighlightToPage(h.page,h.text,h.color);});
}

function readerRenderHighlights(){
    const list=document.getElementById('reader-highlights-list');if(!list)return;
    if(readerHighlights.length===0){list.innerHTML='<p style="font-size:12px;color:var(--text-muted);">No highlights yet</p>';return;}
    list.innerHTML=readerHighlights.map(h=>{
        const noteBadge=h.note?'':'';
        return `<div style="font-size:12px;padding:6px 8px;border-radius:4px;background:${h.color}11;border-left:3px solid ${h.color};color:var(--text-secondary);cursor:pointer;margin-bottom:4px;" onclick="readerJumpToPage(${h.page})" title="Page ${h.page}">
        <div style="display:flex;align-items:center;justify-content:space-between;">
            <span>${escapeHtml(h.text.substring(0,40))}${h.text.length>40?'...':''}${noteBadge}</span>
            <button onclick="event.stopPropagation();readerDeleteHighlight('${h.id}')" style="font-size:11px;color:#ff6b6b;background:none;border:none;cursor:pointer;padding:0 4px;display:inline-flex;align-items:center;">${iconHtml('x',11)}</button>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Page ${h.page}${h.note?' · '+escapeHtml(h.note.substring(0,30))+(h.note.length>30?'...':''):''}</div>
        </div>`;
    }).join('');
    refreshIcons();
}

function readerJumpToPage(pageNum){
    const pageDiv=document.getElementById('pdf-page-'+pageNum);if(!pageDiv)return;
    pageDiv.scrollIntoView({behavior:'auto',block:'start'});   // instant: smooth scrolled through every page
}

