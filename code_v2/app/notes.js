// ===== NOTES =====
let notesData=[];
let notesFilterTag='all';
let notesEditingId=null;

async function notesInit(){await notesLoad();notesRender();}
async function notesLoad(){
    // Load active notes from backend
    try{
        const res=await apiFetch('/api/notes');
        if(!res.ok)throw new Error('HTTP '+res.status);
        const backendNotes=await res.json();
        notesData=backendNotes.map(n=>({
            id:n.id,
            title:n.title||'',
            tag:n.tag||'',
            content:n.content||'',
            source:n.source||'manual',
            createdAt:n.created_at||n.createdAt,
            updatedAt:n.updated_at||n.updatedAt,
            isDeleted:false,
            deletedAt:null
        }));
    }catch(e){
        console.error('Failed to load notes from server:',e);
        showNotification('无法从服务器加载笔记','error');
        notesData=[];
    }
    // Merge PDF notes uploaded to the "notes" category in Bookshelf
    try{
        const res2=await apiFetch('/api/documents?category=notes');
        if(res2.ok){
            const pdfDocs=await res2.json();
            pdfDocs.forEach(d=>{
                // Skip if already merged (avoid duplicates on re-load)
                if(notesData.some(n=>n.id==='pdf_'+d.id))return;
                notesData.push({
                    id:'pdf_'+d.id,
                    documentId:d.id,
                    title:d.title||'Untitled PDF',
                    tag:'PDF',
                    isPdf:true,
                    source:'pdf',
                    content:'',           // required: notesRender calls content.substring()
                    desc:d.desc||'',
                    fileType:d.fileType||'pdf',
                    createdAt:d.createdAt,
                    updatedAt:d.createdAt,
                    isDeleted:false,
                    deletedAt:null
                });
            });
        }
    }catch(e){console.error('Failed to load PDF notes:',e);}
    // Merge recycle-bin state from localStorage (soft-delete not yet in backend)
    try{
        const s=localStorage.getItem('cb_notes_recycle');
        if(s){
            const recycled=JSON.parse(s);
            recycled.forEach(r=>{
                const existing=notesData.find(n=>n.id===r.id);
                if(existing){
                    existing.isDeleted=true;
                    existing.deletedAt=r.deletedAt;
                }else{
                    notesData.push(r);
                }
            });
        }
    }catch(e){}
}
function notesSaveRecycleBin(){
    const recycled=notesData.filter(n=>n.isDeleted);
    try{localStorage.setItem('cb_notes_recycle',JSON.stringify(recycled));}catch(e){}
}

function notesSave(){
    // Active notes are persisted on backend; only recycle-bin state is local
    notesSaveRecycleBin();
}

function notesRender(){
    const list=document.getElementById('notes-list');
    const cnt=document.getElementById('notes-count');
    const tagsEl=document.getElementById('notes-tags');
    if(!list)return;
    const activeNotes=notesData.filter(n=>!n.isDeleted);
    const deletedCount=notesData.filter(n=>n.isDeleted).length;
    // Update count
    if(cnt)cnt.textContent=activeNotes.length+(activeNotes.length===1?' note':' notes');
    // Build tag filter
    const allTags=[...new Set(activeNotes.map(n=>n.tag).filter(t=>t))];
    let tagButtons=['<button onclick="notesFilterTag=\'all\';notesRender()" style="font-size:11px;padding:4px 10px;border-radius:999px;cursor:pointer;border:1px solid '+(notesFilterTag==='all'?'var(--accent)':'var(--border)')+';background:'+(notesFilterTag==='all'?'var(--accent)':'var(--bg-input)')+';color:'+(notesFilterTag==='all'?'#fff':'var(--text-secondary)')+';">All</button>'];
    tagButtons=tagButtons.concat(allTags.map(t=>'<button onclick="notesFilterTag=\''+escapeHtml(t)+'\';notesRender()" style="font-size:11px;padding:4px 10px;border-radius:999px;cursor:pointer;border:1px solid '+(notesFilterTag===t?'var(--accent)':'var(--border)')+';background:'+(notesFilterTag===t?'var(--accent)':'var(--bg-input)')+';color:'+(notesFilterTag===t?'#fff':'var(--text-secondary)')+';">'+escapeHtml(t)+'</button>'));
    // Add Recycle Bin tag
    const rbStyle=notesFilterTag==='__recycle__'?'border:1px solid #ff6b6b;background:#ff6b6b;color:#fff;':'border:1px solid var(--border);background:var(--bg-input);color:var(--text-secondary);';
    tagButtons.push('<button onclick="notesFilterTag=\'__recycle__\';notesRender()" style="font-size:11px;padding:4px 10px;border-radius:999px;cursor:pointer;'+rbStyle+'">Recycle Bin'+(deletedCount>0?' <span style="font-size:10px;padding:1px 5px;border-radius:999px;background:#fff;color:#ff6b6b;font-weight:600;">'+deletedCount+'</span>':'')+'</button>');
    if(tagsEl)tagsEl.innerHTML=tagButtons.join('');
    // Filter
    let filtered;
    if(notesFilterTag==='__recycle__'){filtered=notesData.filter(n=>n.isDeleted);}
    else if(notesFilterTag==='all'){filtered=activeNotes;}
    else{filtered=activeNotes.filter(n=>n.tag===notesFilterTag);}
    if(filtered.length===0){
        const emptyMsg=notesFilterTag==='__recycle__'?'回收站是空的':'还没有笔记<br><span style="font-size:12px;">Click "+ New Note" to create your first note</span>';
        list.innerHTML='<div class="placeholder-box" style="min-height:200px;">'+emptyMsg+'</div>';return;
    }
    // Sort by updated desc
    filtered.sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt));
    // Render cards
    list.innerHTML=filtered.map(n=>{
        const date=n.updatedAt||n.createdAt;
        const dateStr=date?new Date(date).toLocaleDateString():'';
        const preview=(n.content||'').substring(0,200)+((n.content||'').length>200?'...':'');
        if(n.isDeleted){
            return `<div class="card" style="opacity:.6;transition:opacity .15s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.6'">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="font-size:14px;font-weight:600;color:var(--text-primary);text-decoration:line-through;">${escapeHtml(n.title||'Untitled')}</span>
                    ${n.tag?'<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--bg-input);color:var(--text-muted);">'+escapeHtml(n.tag)+'</span>':''}
                    <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">Deleted ${n.deletedAt?new Date(n.deletedAt).toLocaleDateString():''}</span>
                </div>
                <p style="font-size:13px;color:var(--text-secondary);white-space:pre-wrap;">${escapeHtml(preview)}</p>
                <div style="display:flex;gap:8px;margin-top:10px;">
                    <button onclick="notesRestoreNote('${n.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(82,196,26,.1);border:1px solid rgba(82,196,26,.3);color:#52c41a;cursor:pointer;">Restore</button>
                    <button onclick="notesPermanentlyDeleteNote('${n.id}')" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.3);color:#ff6b6b;cursor:pointer;">Delete Forever</button>
                </div>
            </div>`;
        }
        if(n.isPdf){
            return `<div class="card" style="cursor:pointer;position:relative;" onmouseenter="this.querySelector('.note-del-btn').style.opacity='1'" onmouseleave="this.querySelector('.note-del-btn').style.opacity='0'">
                <button class="note-del-btn" onclick="event.stopPropagation();notesDeletePdfNote('${n.id}')" style="position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:6px;border:none;background:rgba(255,107,107,.9);color:#fff;font-size:11px;cursor:pointer;opacity:0;transition:opacity .15s;display:flex;align-items:center;justify-content:center;z-index:2;">×</button>
                <div onclick="notesOpenPdf('${n.id}')" style="width:100%;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="color:var(--accent);display:flex;align-items:center;">${iconHtml('file-text',18)}</span>
                    <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(n.title||'Untitled PDF')}</span>
                    <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(122,107,255,.1);color:var(--accent);font-weight:600;">PDF</span>
                    <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${dateStr}</span>
                </div>
                <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                    <span>${escapeHtml(n.desc||'')}</span>
                    <span style="margin-left:auto;font-size:11px;color:var(--accent);display:flex;align-items:center;gap:4px;">${iconHtml('book-open',12)} Open in Reader</span>
                </div></div>
            </div>`;
        }
        return `<div class="card" style="cursor:pointer;position:relative;" onmouseenter="this.querySelector('.note-del-btn').style.opacity='1'" onmouseleave="this.querySelector('.note-del-btn').style.opacity='0'">
            <button class="note-del-btn" onclick="event.stopPropagation();notesDeleteNote('${n.id}')" style="position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:6px;border:none;background:rgba(255,107,107,.9);color:#fff;font-size:11px;cursor:pointer;opacity:0;transition:opacity .15s;display:flex;align-items:center;justify-content:center;z-index:2;">×</button>
            <div onclick="notesEdit('${n.id}')" style="width:100%;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(n.title||'Untitled')}</span>
                ${n.tag?'<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--bg-input);color:var(--text-muted);">'+escapeHtml(n.tag)+'</span>':''}
                <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${dateStr}</span>
            </div>
            <p style="font-size:13px;color:var(--text-secondary);white-space:pre-wrap;">${escapeHtml(preview)}</p></div>
        </div>`;
    }).join('');
}

function notesOpenPdf(id){
    const n=notesData.find(x=>x.id===id);
    if(!n||!n.isPdf)return;
    // Locate the doc index inside bookshelf "notes" category, then open in Reader
    const arr=bsData['notes']||[];
    const idx=arr.findIndex(d=>d.id===n.documentId);
    if(idx===-1){showNotification('书架中未找到该 PDF，正在重新加载…','warning');bsPageInit();return;}
    showPage('reader');
    setTimeout(()=>readerOpenDoc('notes',idx),100);
}

function notesDeletePdfNote(id){
    const n=notesData.find(x=>x.id===id);
    if(!n||!n.isPdf)return;
    showConfirmDialog({
        title:'删除 PDF 笔记？',
        message:`"${n.title}" will be permanently removed from both Notes and Bookshelf.`,
        confirmText:'删除',
        confirmColor:'#ff6b6b',
        onConfirm:async()=>{
            try{
                const res=await apiFetch('/api/documents/'+n.documentId,{method:'删除'});
                if(!res.ok)throw new Error('HTTP '+res.status);
                await notesInit();      // refresh Notes page
                await bsPageInit();     // refresh Bookshelf (Dashboard/page/Reader modal)
                showNotification('已从笔记本和书架删除','success');
            }catch(e){
                console.error('Failed to delete PDF note:',e);
                showNotification('删除失败：'+e.message,'error');
            }
        }
    });
}

function notesNewNote(){
    notesEditingId=null;
    document.getElementById('notes-editor-title').value='';
    document.getElementById('notes-editor-tag').value='';
    document.getElementById('notes-editor-content').value='';
    document.getElementById('notes-editor-meta').textContent='新笔记';
    document.getElementById('notes-list-view').style.display='none';
    document.getElementById('notes-editor-view').style.display='';
    document.getElementById('notes-editor-title').focus();
}

function notesEdit(id){
    const n=notesData.find(x=>x.id===id);if(!n)return;
    if(n.isPdf){notesOpenPdf(id);return;}
    notesEditingId=id;
    document.getElementById('notes-editor-title').value=n.title||'';
    document.getElementById('notes-editor-tag').value=n.tag||'';
    document.getElementById('notes-editor-content').value=n.content||'';
    document.getElementById('notes-editor-meta').textContent='Editing · Created '+new Date(n.createdAt).toLocaleDateString();
    document.getElementById('notes-list-view').style.display='none';
    document.getElementById('notes-editor-view').style.display='';
    document.getElementById('notes-editor-content').focus();
}

function notesCloseEditor(){
    document.getElementById('notes-editor-view').style.display='none';
    document.getElementById('notes-list-view').style.display='';
}

async function notesSaveFromEditor(){
    const title=document.getElementById('notes-editor-title').value.trim();
    const tag=document.getElementById('notes-editor-tag').value.trim();
    const content=document.getElementById('notes-editor-content').value.trim();
    if(!content){showNotification('笔记内容为空','warning');return;}
    try{
        if(notesEditingId){
            const res=await apiFetch('/api/notes/'+notesEditingId,{
                method:'PUT',
                body:JSON.stringify({title,tag,content})
            });
            if(!res.ok)throw new Error('HTTP '+res.status);
            const n=notesData.find(x=>x.id===notesEditingId);
            if(n){n.title=title;n.tag=tag;n.content=content;n.updatedAt=new Date().toISOString();}
        }else{
            const res=await apiFetch('/api/notes',{
                method:'POST',
                body:JSON.stringify({title,tag,content,source:'manual'})
            });
            if(!res.ok)throw new Error('HTTP '+res.status);
            const created=await res.json();
            notesData.push({
                id:created.id,
                title:title,
                tag:tag,
                content:content,
                source:'manual',
                createdAt:new Date().toISOString(),
                updatedAt:new Date().toISOString(),
                isDeleted:false,
                deletedAt:null
            });
        }
        notesSave();notesRender();notesCloseEditor();
        if(typeof logActivity==='function')logActivity('note','Note · '+(title||'Untitled'));
        showNotification('笔记已保存','success');
    }catch(e){
        console.error('Save note failed:',e);
        showNotification('保存失败：'+e.message,'error');
    }
}

