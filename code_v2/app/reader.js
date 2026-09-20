// ===== READER BOOKSHELF MODAL =====
function readerOpenBookshelf(){readerRenderModalTabs();readerRenderModalDocs('all');document.getElementById('reader-bs-modal').style.display='flex';}
function readerCloseBookshelf(){document.getElementById('reader-bs-modal').style.display='none';}
function readerRenderModalTabs(){const c=document.getElementById('reader-bs-tabs');if(!c)return;c.innerHTML='';
    const cats=[{key:'all',icon:'layout-grid',label:'All'},...BS_CATS];
    cats.forEach((cat,i)=>{const t=document.createElement('button');t.style.cssText=`padding:6px 12px;border-radius:6px;border:none;font-size:13px;font-weight:${i===0?'600':'400'};background:${i===0?'var(--accent)':'transparent'};color:${i===0?'#fff':'var(--text-secondary)'};cursor:pointer;`;
        t.innerHTML=iconHtml(cat.icon,14)+' '+cat.label;t.onclick=()=>{c.querySelectorAll('button').forEach(b=>{b.style.background='transparent';b.style.color='var(--text-secondary)';b.style.fontWeight='400';});t.style.background='var(--accent)';t.style.color='#fff';t.style.fontWeight='600';bsModalCat=cat.key;readerRenderModalDocs(cat.key);};c.appendChild(t);});refreshIcons();}
function readerRenderModalDocs(cat){const g=document.getElementById('reader-bs-grid');if(!g)return;
    const all=[];Object.keys(bsData).forEach(c=>bsData[c].forEach((d,i)=>{if(!d.isDeleted)all.push({...d,cat:c,idx:i});}));
    const docs=cat==='all'?all:all.filter(d=>d.cat===cat);
    if(docs.length===0){g.innerHTML=`<div class="placeholder-box" style="grid-column:1/-1;">暂无文档<br><button class="btn-secondary" style="margin-top:12px;" onclick="bsUpload()">${iconHtml('paperclip',14)}Upload PDF</button></div>`;return;}
    g.innerHTML=docs.map(d=>{const cl=BS_CATS.find(c=>c.key===d.cat);
        return `<div onclick="readerOpenDoc('${d.cat}',${d.idx})" style="border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;transition:all .18s cubic-bezier(.2,.8,.2,1);background:var(--bg-sidebar);box-shadow:var(--shadow-xs);" onmouseenter="this.style.borderColor='var(--accent)';this.style.transform='translateY(-3px)';this.style.boxShadow='var(--shadow-md)'" onmouseleave="this.style.borderColor='var(--border)';this.style.transform='translateY(0)';this.style.boxShadow='var(--shadow-xs)'">
        <div style="text-align:center;margin-bottom:8px;"><div style="width:48px;height:56px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-secondary);background:var(--bg-tag);">${iconHtml(d.icon,22)}</div></div>
        <div style="font-size:13px;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.title}</div><div style="font-size:11px;color:var(--text-muted);text-align:center;">${cl?cl.label:''}</div></div>`;}).join('');refreshIcons();}

// ===== READER: OPEN DOC WITH PDF.JS (ScholarRead — text layer + smooth scroll) =====
let readerNotes=[],readerHighlights=[],readerSelText='',readerSelRange=null,readerPdfDoc=null,readerPdfTotal=0;
let readerDocType=null;
let readerRenderedPages=new Set();
let readerScale=1.3;
let readerScrollObserver=null;
let readerCurrentDocId=null;

function readerOpenDoc(cat,idx){
    const doc=bsData[cat][idx];if(!doc)return;
    if(doc.isDeleted){showNotification('请先恢复该文档再打开','warning');return;}
    // ===== Built-in guide (virtual doc, no network) =====
    if(doc.isGuide){readerOpenGuide(doc);return;}
    readerCloseBookshelf();
    readerCurrentDocId=doc.id;
    readerCurrentDocRef={cat,idx};
    // Dashboard: remember the last-opened doc (Continue tile) + activity feed
    try{localStorage.setItem('cb_cn_last_doc',JSON.stringify({cat:cat,idx:idx,page:1,t:Date.now()}));}catch(e){}
    if(typeof logActivity==='function')logActivity('open','打开 · '+doc.title);
    if(readerLastDocId!==doc.id)readerViewMode=doc.needsOcr?'doc':'pdf';   // scanned -> reformatted default; native parsed -> keep original PDF view
    readerLastDocId=doc.id;
    readerPdfDoc=null;readerPdfTotal=0;readerDocType=null;
    document.getElementById('reader-doc-title').textContent=doc.title;
    document.getElementById('reader-doc-meta').textContent=doc.desc;
    document.getElementById('reader-toolbar').textContent=doc.title;
    const toggleBtn=document.getElementById('reader-view-toggle');
    if(toggleBtn)toggleBtn.style.display=(doc.fileType==='pdf'&&doc.parseStatus==='done')?'block':'none';
    if(toggleBtn)toggleBtn.textContent=readerViewMode==='doc'?'原书页':'重排版';
    const aiBtn=document.getElementById('reader-enable-ai');
    if(aiBtn)aiBtn.style.display=(doc.fileType==='pdf'&&doc.needsOcr&&doc.parseStatus!=='done')?'block':'none';
    readerNotes=[];readerHighlights=[];readerRenderNotes();readerRenderHighlights();
    // Load persisted highlights for this document
    readerLoadHighlights(doc.id);
    document.getElementById('reader-action-panel').style.display='none';
    document.getElementById('reader-float-menu').style.display='none';
    const area=document.getElementById('reader-content-area');
    if(readerScrollObserver)readerScrollObserver.disconnect();
    readerRenderedPages.clear();

    // ===== [MinerU] parsed PDF -> reformatted document view =====
    if(doc.fileType==='pdf'&&doc.parseStatus==='done'&&readerViewMode==='doc'){
        readerOpenDocView(doc,area);
        return;
    }

    // ===== [MinerU] un-parsed scanned PDF -> gate (ask, don't force) =====
    if(doc.fileType==='pdf'&&doc.needsOcr&&doc.parseStatus!=='done'&&!doc.aiDeclined){
        mineruGateOpen(doc,cat,idx,true);
        return;
    }

    // Fetch file from backend
    area.innerHTML='<div style="padding:24px 8px;display:flex;flex-direction:column;gap:16px;align-items:center;"><div class="skeleton" style="width:min(600px,92%);height:760px;border-radius:8px;"></div><div class="skeleton" style="width:min(600px,92%);height:760px;border-radius:8px;"></div></div>';
    apiFetch('/api/documents/'+doc.id+'/file')
        .then(res=>{if(!res.ok)throw new Error('HTTP '+res.status);return res.arrayBuffer();})
        .then(arrayBuffer=>{
            if(doc.fileType==='pptx'){
                readerOpenPPTX(arrayBuffer,doc,area);
            }else{
                readerOpenPDF(arrayBuffer,doc,area);
            }
        })
        .catch(err=>{
            area.innerHTML='<div class="placeholder-box" style="max-width:600px;margin:0 auto;min-height:400px;background:var(--bg-card);">Failed to load document<br><span style="font-size:12px;">'+escapeHtml(err.message)+'</span></div>';
            showNotification('加载失败：'+err.message,'error');
        });
}

// ===== PPTX Rendering (JSZip + XML text extraction) =====
async function readerOpenPPTX(arrayBuffer,doc,area){
    readerDocType='pptx';
    area.innerHTML='<div style="text-align:center;padding:60px;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:12px;"><div class="spinner"></div><p>Loading PPTX...</p></div>';
    try{
        const zip=await JSZip.loadAsync(arrayBuffer);
        const slideNames=Object.keys(zip.files).filter(n=>n.match(/^ppt\/slides\/slide\d+\.xml$/)).sort((a,b)=>{
            return parseInt(a.match(/\d+/)[0])-parseInt(b.match(/\d+/)[0]);
        });
        if(slideNames.length===0){area.innerHTML='<div style="text-align:center;padding:60px;color:#ff6b6b;"><p>No slides found in PPTX</p></div>';return;}

        // Pre-load all relationship files (slide → image mappings)
        const relsCache={};
        for(let s=0;s<slideNames.length;s++){
            const slideNum=s+1;
            const relsPath='ppt/slides/_rels/slide'+slideNum+'.xml.rels';
            if(zip.files[relsPath]){
                const relsXml=await zip.files[relsPath].async('text');
                const relsDoc=new DOMParser().parseFromString(relsXml,'text/xml');
                const rels={};
                [...relsDoc.getElementsByTagName('Relationship')].forEach(r=>{
                    rels[r.getAttribute('Id')]=r.getAttribute('Target');
                });
                relsCache[slideNum]=rels;
            }
        }

        // Get list of all media files
        const mediaFiles=Object.keys(zip.files).filter(n=>n.match(/^ppt\/media\//));

        area.innerHTML='';
        area.style.cssText='flex:1;overflow-y:auto;padding:16px;background:var(--bg-tag);';
        const container=document.createElement('div');
        container.style.cssText='max-width:100%;margin:0 auto;';
        area.appendChild(container);

        for(let s=0;s<slideNames.length;s++){
            const slideNum=s+1;
            const xml=await zip.files[slideNames[s]].async('text');
            const xmlDoc=new DOMParser().parseFromString(xml,'text/xml');

            // Extract text
            const textNodes=[...xmlDoc.getElementsByTagName('a:t')];
            const texts=textNodes.map(n=>n.textContent).filter(t=>t.trim());

            // Extract images: find <a:blip> tags with r:embed
            const blipNodes=[...xmlDoc.getElementsByTagName('a:blip')];
            const imageRIds=blipNodes.map(b=>b.getAttribute('r:embed')||b.getAttributeNS('*','embed')).filter(r=>r);

            const slideDiv=document.createElement('div');
            slideDiv.style.cssText='background:#fff;border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.1);margin:0 auto 16px;padding:40px 48px;position:relative;overflow:visible;width:auto;min-height:calc(100vh - 200px);';

            const slideNumLabel=document.createElement('div');
            slideNumLabel.style.cssText='position:absolute;top:8px;right:12px;font-size:10px;color:#ccc;';
            slideNumLabel.textContent='Slide '+slideNum;
            slideDiv.appendChild(slideNumLabel);

            // Render text content
            if(texts.length>0){
                texts.forEach((text,i)=>{
                    const p=document.createElement('div');
                    if(i===0){
                        p.style.cssText='font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:16px;line-height:1.4;';
                    }else{
                        p.style.cssText='font-size:15px;color:#333;margin-bottom:10px;line-height:1.8;';
                    }
                    p.textContent=text;
                    slideDiv.appendChild(p);
                });
            }

            // Render images
            if(imageRIds.length>0){
                for(const rId of imageRIds){
                    const rels=relsCache[slideNum]||{};
                    let imgPath=rels[rId];
                    if(!imgPath)continue;
                    // Normalize path
                    imgPath=imgPath.replace(/^\.\.\//,'');
                    const fullPath='ppt/'+imgPath.replace(/^\/+/,'');
                    const actualPath=zip.files[fullPath]?fullPath:'ppt/slides/'+imgPath;

                    if(zip.files[actualPath]){
                        try{
                            const imgBlob=await zip.files[actualPath].async('blob');
                            const imgUrl=URL.createObjectURL(imgBlob);
                            const img=document.createElement('img');
                            img.src=imgUrl;
                            img.style.cssText='max-width:100%;height:auto;border-radius:4px;margin:12px 0;box-shadow:0 1px 4px rgba(0,0,0,.1);';
                            img.alt='Slide '+slideNum+' image';
                            slideDiv.appendChild(img);
                        }catch(e){}
                    }
                }
            }

            // If no text and no images
            if(texts.length===0&&imageRIds.length===0){
                const empty=document.createElement('div');
                empty.style.cssText='text-align:center;color:#ccc;padding:60px;font-size:13px;';
                empty.textContent='No text or images found on this slide';
                slideDiv.appendChild(empty);
            }

            container.appendChild(slideDiv);

            if(s<slideNames.length-1){
                const gap=document.createElement('div');
                gap.className='pdf-page-gap';
                container.appendChild(gap);
            }
        }

        const slides=container.children;
        area.onscroll=()=>{
            let currentSlide=1;
            for(let i=0;i<slides.length;i++){
                if(slides[i].classList&&slides[i].classList.contains('pdf-page-gap'))continue;
                const rect=slides[i].getBoundingClientRect();
                if(rect.top<area.clientHeight/2)currentSlide=Math.round((i+1)/2);
            }
            document.getElementById('reader-toolbar').textContent='Slide '+currentSlide+' of '+slideNames.length+' · '+doc.title;
        };

        showNotification(doc.title+' ('+slideNames.length+' slides) · Scroll to read','success');
    }catch(err){
        area.innerHTML='<div style="text-align:center;padding:60px;color:#ff6b6b;display:flex;flex-direction:column;align-items:center;gap:12px;"><span style="color:#ff6b6b;">'+iconHtml('alert-circle',44)+'</span><p>Failed to load PPTX: '+escapeHtml(err.message)+'</p></div>';refreshIcons();
    }
}

// ===== PDF Rendering (existing logic, extracted) =====
function readerOpenPDF(arrayBuffer,doc,area){
    area.innerHTML='<div style="text-align:center;padding:60px;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:12px;"><div class="spinner"></div><p>Loading PDF...</p></div>';
    pdfjsLib.getDocument({data:arrayBuffer}).promise.then(async pdf=>{
        readerPdfDoc=pdf;readerPdfTotal=pdf.numPages;readerDocType='pdf';

        // Dynamic scale: fit PDF page width to reading area
        const firstPage=await pdf.getPage(1);
        const nativeWidth=firstPage.getViewport({scale:1}).width;
        const areaWidth=area.clientWidth-48;
        readerScale=Math.min(2.0,Math.max(0.5,areaWidth/nativeWidth));

        area.innerHTML='';
        area.style.cssText='flex:1;overflow-y:auto;padding:24px 8px;background:var(--bg-tag);';
        const container=document.createElement('div');
        container.id='pdf-pages-container';
        container.style.cssText='max-width:100%;margin:0 auto;';
        area.appendChild(container);
        for(let i=1;i<=readerPdfTotal;i++){
            const pageDiv=document.createElement('div');
            pageDiv.id='pdf-page-'+i;
            pageDiv.dataset.pageNum=i;
            pageDiv.style.cssText='margin:0 auto 16px;width:auto;min-height:400px;background:#fff;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.12);overflow:hidden;position:relative;';
            pageDiv.innerHTML='<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);font-size:13px;">Page '+i+'</div>';
            container.appendChild(pageDiv);
            if(i<readerPdfTotal){const gap=document.createElement('div');gap.className='pdf-page-gap';container.appendChild(gap);}
        }
        readerApplyPendingScroll();   // cross-view sync: land on the page we left
        readerScrollObserver=new IntersectionObserver((entries)=>{
            entries.forEach(entry=>{
                if(entry.isIntersecting){
                    const pageNum=parseInt(entry.target.dataset.pageNum);
                    if(!readerRenderedPages.has(pageNum)){readerRenderPdfPageFull(pageNum);}
                }
            });
        },{root:area,rootMargin:'200px 0px',threshold:0.01});
        container.querySelectorAll('[data-page-num]').forEach(d=>readerScrollObserver.observe(d));
        // rAF-throttled toolbar updater (same anti-thrash treatment as docview)
        let _pdfPages=null,_pdfTick=false;
        area.onscroll=()=>{
            if(_pdfTick)return;
            _pdfTick=true;
            requestAnimationFrame(()=>{
                _pdfTick=false;
                if(!_pdfPages)_pdfPages=Array.from(container.querySelectorAll('[data-page-num]'));
                for(let p of _pdfPages){
                    const rect=p.getBoundingClientRect();
                    if(rect.top>=0&&rect.top<area.clientHeight/2){
                        document.getElementById('reader-toolbar').textContent='第 '+p.dataset.pageNum+' 页 / 共 '+readerPdfTotal+' 页 · '+doc.title;
                        break;
                    }
                }
            });
        };
        showNotification(doc.title+' ('+pdf.numPages+' pages) · Scroll to read','success');
    }).catch(err=>{
        area.innerHTML='<div style="text-align:center;padding:60px;color:#ff6b6b;display:flex;flex-direction:column;align-items:center;gap:12px;"><span style="color:#ff6b6b;">'+iconHtml('alert-circle',44)+'</span><p>Failed: '+escapeHtml(err.message)+'</p></div>';refreshIcons();
    });
}

async function readerRenderPdfPageFull(pageNum){
    if(!readerPdfDoc||readerRenderedPages.has(pageNum))return;
    readerRenderedPages.add(pageNum);

    const pageDiv=document.getElementById('pdf-page-'+pageNum);
    if(!pageDiv)return;

    try{
        const page=await readerPdfDoc.getPage(pageNum);
        const viewport=page.getViewport({scale:readerScale});
        const w=Math.floor(viewport.width);
        const h=Math.floor(viewport.height);

        // Set EXACT pixel dimensions on page container — all three layers must match
        pageDiv.innerHTML='';
        pageDiv.style.cssText='position:relative;margin:0 auto 16px;'+
            'width:'+w+'px;height:'+h+'px;'+
            'background:#fff;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.12);overflow:hidden;';

        // 1. Canvas — EXACT pixel size, no 100% (prevents scaling mismatch with textLayer)
        const canvas=document.createElement('canvas');
        const ctx=canvas.getContext('2d');
        canvas.width=w;
        canvas.height=h;
        canvas.style.cssText='position:absolute;top:0;left:0;width:'+w+'px;height:'+h+'px;display:block;';
        pageDiv.appendChild(canvas);
        await page.render({canvasContext:ctx,viewport:viewport}).promise;

        // 2. Text layer — EXACT same pixel size as canvas + --scale-factor
        const textLayerDiv=document.createElement('div');
        textLayerDiv.className='textLayer';
        textLayerDiv.style.cssText='position:absolute;top:0;left:0;width:'+w+'px;height:'+h+'px;';
        textLayerDiv.style.setProperty('--scale-factor',readerScale);
        pageDiv.appendChild(textLayerDiv);

        const textContent=await page.getTextContent();
        const textDivs=[];

        await pdfjsLib.renderTextLayer({
            textContentSource:textContent,
            container:textLayerDiv,
            viewport:viewport,
            textDivs:textDivs,
        }).promise;

        // 3. endOfContent for clean selection edge (same as PDF.js viewer)
        const endDiv=document.createElement('div');
        endDiv.className='endOfContent';
        textLayerDiv.appendChild(endDiv);
        endDiv.addEventListener('mousedown',()=>{endDiv.classList.add('active');});
        endDiv.addEventListener('mouseup',()=>{endDiv.classList.remove('active');});

        // Store extracted text for AI context
        pageDiv.dataset.text=textContent.items.map(i=>i.str).join(' ');

        // ===== [MinerU] scanned-page bbox overlay (original-pages mode) =====
        if(pageDiv.dataset.text.trim().length<20 && readerCurrentDocId){
            mineruInjectOverlay(pageNum,pageDiv,textLayerDiv,w,h);
        }

        // Apply persisted highlights for this page
        if(readerHighlights.length>0){
            readerHighlights.filter(h=>h.page===pageNum).forEach(h=>{
                readerApplyHighlightToPage(pageNum,h.text,h.color);
            });
        }
        readerAnchorRestore(pageNum);   // cross-view sync: final exact restore once content exists

    }catch(err){
        pageDiv.innerHTML='<div style="padding:40px;text-align:center;color:#ff6b6b;">页面渲染失败 '+pageNum+': '+escapeHtml(err.message)+'</div>';
    }
}

// ===== READER: TEXT SELECTION (Reader area only — peek has its own menu) =====
document.addEventListener('mouseup',e=>{const area=document.getElementById('reader-content-area');const menu=document.getElementById('reader-float-menu');
    if(!area||!area.contains(e.target)){if(menu)menu.style.display='none';return;}
    const sel=window.getSelection();const text=sel.toString().trim();
    if(text.length>1&&text.length<500){readerSelText=text;try{readerSelRange=sel.getRangeAt(0).cloneRange();}catch(e){return;}
        const rect=sel.getRangeAt(0).getBoundingClientRect();menu.style.display='flex';menu.style.top=(window.scrollY+rect.bottom+8)+'px';menu.style.left=(window.scrollX+rect.left+rect.width/2-140)+'px';}
    else{menu.style.display='none';}});

// ===== PEEK: dedicated text-selection menu (self-contained in the modal) =====
document.addEventListener('mouseup',e=>{
    const body=document.getElementById('tb-peek-body');
    const menu=document.getElementById('tb-peek-menu');
    if(!body||!menu)return;
    // Only show for selections inside the peek body
    if(!body.contains(e.target)){menu.style.display='none';return;}
    const sel=window.getSelection();const text=sel.toString().trim();
    if(text.length>1&&text.length<500){
        tbPeekSelText=text;tbPeekLastSel=true;
        const pgEl=e.target.closest?e.target.closest('[data-page-num]'):null;
        tbPeekSelPage=pgEl?parseInt(pgEl.dataset.pageNum):tbPeekCurrentPage;
        // Position in modal coordinates (guaranteed visible — modal is fixed & on top)
        const modal=document.getElementById('tb-peek-modal');
        if(!modal){menu.style.display='none';return;}
        const mRect=modal.getBoundingClientRect();
        const sRect=sel.getRangeAt(0).getBoundingClientRect();
        let top=sRect.bottom-mRect.top+6;
        let left=sRect.left-mRect.left+sRect.width/2-140;
        // Clamp within modal bounds
        top=Math.max(40,Math.min(top,mRect.height-50));
        left=Math.max(4,Math.min(left,mRect.width-290));
        menu.style.top=top+'px';menu.style.left=left+'px';
        menu.style.display='flex';
    }else{
        menu.style.display='none';
    }
});

// ===== READER ACTIONS =====
function readerAction(action){const menu=document.getElementById('reader-float-menu');menu.style.display='none';const panel=document.getElementById('reader-action-panel');const text=readerSelText;
    if(action==='translate'){panel.innerHTML=`<div class="card" style="border-left:4px solid #4C8DFF;background:rgba(76,141,255,.06);">
        <div style="display:flex;gap:12px;"><div style="width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;background:var(--accent);flex-shrink:0;">译</div>
        <div style="flex:1;"><div style="font-size:12px;font-weight:600;color:#4C8DFF;margin-bottom:4px;">翻译中…</div><p style="font-size:14px;margin-bottom:8px;">${escapeHtml(text)}</p><div id="reader-translate-result" style="color:var(--text-muted);font-size:13px;">正在调用 AI…</div>
        <div style="display:flex;gap:8px;margin-top:8px;"><button onclick="readerAction('note')" style="font-size:12px;padding:6px 12px;border-radius:6px;background:var(--bg-input);color:var(--text-secondary);border:1px solid var(--border);cursor:pointer;">存为笔记</button><button onclick="readerAction('highlight')" style="font-size:12px;padding:6px 12px;border-radius:6px;background:var(--bg-input);color:var(--text-secondary);border:1px solid var(--border);cursor:pointer;">高亮</button><button onclick="document.getElementById('reader-action-panel').style.display='none'" style="font-size:12px;padding:6px 12px;border-radius:6px;background:transparent;color:var(--text-muted);border:none;cursor:pointer;">关闭</button></div></div></div></div>`;
        panel.style.display='block';
        fetch(AI_BACKEND_URL+'/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,target_lang:'auto'})})
        .then(r=>r.json()).then(data=>{
            const el=document.getElementById('reader-translate-result');
            if(!el)return;
            if(data.error){el.innerHTML='<span style="color:#ff6b6b">'+escapeHtml(data.error)+'</span>';}
            else{el.innerHTML=(data.translation||'').replace(/\n/g,'<br>');}
        }).catch(err=>{
            const el=document.getElementById('reader-translate-result');
            if(el)el.innerHTML='<span style="color:#ff6b6b">'+escapeHtml(err.message)+'</span>';
        });
    }else if(action==='highlight'){
        // Show color picker + note panel
        const colors=[{c:'#faad14',n:'Yellow'},{c:'#52c41a',n:'Green'},{c:'#4C8DFF',n:'Blue'},{c:'#ff6b6b',n:'Red'}];
        panel.innerHTML=`<div class="card" style="border-left:4px solid #faad14;background:rgba(250,173,20,.06);">
        <div style="font-size:12px;font-weight:600;color:#faad14;margin-bottom:8px;">Highlight</div>
        <div style="font-size:12px;padding:8px;border-radius:6px;background:var(--bg-input);color:var(--text-secondary);font-style:italic;margin-bottom:8px;">"${escapeHtml(text.substring(0,120))}${text.length>120?'...':''}"</div>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
            ${colors.map(cl=>`<button onclick="readerSetHlColor('${cl.c}')" id="hl-color-btn-${cl.c}" style="width:32px;height:32px;border-radius:50%;border:3px solid ${cl.c===colors[0].c?'#333':'transparent'};background:${cl.c};cursor:pointer;" title="${cl.n}"></button>`).join('')}
        </div>
        <input type="hidden" id="hl-selected-color" value="${colors[0].c}">
        <textarea id="hl-note-input" placeholder="Add a note (optional)..." style="width:100%;padding:8px;border-radius:6px;font-size:13px;resize:none;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);outline:none;" rows="2"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn-primary" style="font-size:13px;padding:6px 16px;" onclick="readerSaveHighlightFromPanel()">Save</button>
            <button onclick="document.getElementById('reader-action-panel').style.display='none'" style="font-size:13px;padding:6px 12px;color:var(--text-muted);background:none;border:none;cursor:pointer;">Cancel</button>
        </div></div>`;
        panel.style.display='block';
    }else if(action==='note'){panel.innerHTML=`<div class="card" style="border-left:4px solid #52c41a;background:rgba(82,196,26,.06);">
        <div style="font-size:12px;font-weight:600;color:#52c41a;margin-bottom:4px;">新笔记</div><div style="font-size:12px;padding:8px;border-radius:6px;background:var(--bg-input);color:var(--text-secondary);font-style:italic;margin-bottom:8px;">"${escapeHtml(text.substring(0,100))}${text.length>100?'...':''}"</div>
        <textarea id="reader-note-input" placeholder="Write your note..." style="width:100%;padding:8px;border-radius:6px;font-size:14px;resize:none;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);outline:none;" rows="3"></textarea>
        <div style="display:flex;gap:8px;margin-top:8px;"><button class="btn-primary" style="font-size:13px;padding:6px 16px;" onclick="readerSaveNoteFromSel()">Save</button><button onclick="document.getElementById('reader-action-panel').style.display='none'" style="font-size:13px;padding:6px 12px;color:var(--text-muted);background:none;border:none;cursor:pointer;">Cancel</button></div></div>`;
        panel.style.display='block';document.getElementById('reader-note-input').focus();
    }else if(action==='ai'){
        openAIChat(readerSelText);
    }
}

// ===== AI CHAT DIALOG =====
let aiChatMessages=[];

// ===== AI Chat (Free mode): chat about the current page without selecting text =====
// ===== Whole-book RAG mode (MinerU-parsed docs only) =====
window.aiChatBookMode=false;
window.aiChatBookDocId=null;
window.aiChatBookCtx=null;       // per-message retrieved excerpts
window.aiChatPageLabel='';       // remember page-mode strip label

function aiChatSetMode(m){
    window.aiChatBookMode=(m==='book');
    window.aiChatBookCtx=null;
    const bp=document.getElementById('ai-mode-page'),bb=document.getElementById('ai-mode-book');
    const on='display:inline-flex;align-items:center;gap:5px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;';
    const off='display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-secondary);cursor:pointer;';
    if(bp)bp.style.cssText='font-size:11px;padding:4px 12px;border-radius:999px;'+(m==='page'?on:off);
    if(bb)bb.style.cssText='font-size:11px;padding:4px 12px;border-radius:999px;'+(m==='book'?on:off);
    // Update the context strip for the chosen mode
    const quoteEl=document.getElementById('ai-chat-quote');
    if(quoteEl){
        if(m==='book'){
            quoteEl.style.display='block';
            quoteEl.textContent='整本书模式——可询问本书任何内容';
            quoteEl.style.background='rgba(122,107,255,.06)';
            quoteEl.style.borderLeft='3px solid var(--accent)';
        }else if(window.aiChatPageLabel){
            quoteEl.style.display='block';
            quoteEl.textContent=window.aiChatPageLabel;
            quoteEl.style.background='rgba(76,141,255,.06)';
            quoteEl.style.borderLeft='3px solid #4C8DFF';
        }
    }
}

async function aiChatMaybeRetrieveBookCtx(question){
    window.aiChatBookCtx=null;
    if(!window.aiChatBookMode||!window.aiChatBookDocId)return;
    try{
        const res=await apiFetch('/api/documents/'+window.aiChatBookDocId+'/search',
            {method:'POST',body:JSON.stringify({query:question})});
        if(!res.ok)return;
        const d=await res.json();
        if(d.reason==='ok'&&d.chunks&&d.chunks.length){
            window.aiChatBookCtx=d.chunks.map(c=>'[Page '+c.page+'] '+c.text).join('\n\n');
            const quoteEl=document.getElementById('ai-chat-quote');
            if(quoteEl){
                quoteEl.textContent='整本书 · 命中 '+d.chunks.length+' 段 · 第 '
                    +d.chunks.map(c=>c.page).join(', p.');
            }
        }else if(d.reason==='not_parsed'||d.reason==='no_index'||d.reason==='not_textbook'||(d.reason&&d.reason.startsWith('retrieve_failed'))){
            // Degrade gracefully: back to page mode for this message
            showNotification('整本书检索暂不可用，已切换为本页上下文','warning');
            aiChatSetMode('page');
        }
    }catch(e){/* network hiccup: fall back silently */}
}

// ===== Automatic textbook anchoring (async, non-blocking) =====
// The AI answer streams immediately; when retrieval hits, a green citation
// strip appears ABOVE the answer. No hit -> nothing is shown.
async function textbookAnchorSearch(question){
    const token=localStorage.getItem('cb_cn_token');
    if(!token)return null;
    try{
        const r=await apiFetch('/api/textbooks/search',{method:'POST',body:JSON.stringify({query:question})});
        if(!r.ok)return null;
        const d=await r.json();
        return (d.reason==='ok'&&d.chunks&&d.chunks.length)?d.chunks:null;
    }catch(e){return null}
}

function tbAnchorStrip(hits,aiDiv,searchingEl){
    if(searchingEl&&searchingEl.parentNode)searchingEl.remove();   // dismiss "Searching…" placeholder
    if(!hits||!aiDiv||!aiDiv.parentNode)return;
    window.tbAnchorHits=hits;   // powers the peek window (tabs + open-in-reader)
    const strip=document.createElement('div');
    strip.style.cssText='display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;';
    strip.innerHTML='<span style="color:var(--accent);display:flex;align-items:center;">'+iconHtml('book-open',11)+'</span>'
        +hits.map((c,i)=>'<span onclick="openTbPeek('+i+')" title="View textbook excerpt" style="font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(82,196,26,.08);border:1px solid rgba(82,196,26,.25);color:#52c41a;cursor:pointer;">'
            +escapeHtml(c.book)+' · p.'+c.page+'</span>').join('');
    aiDiv.parentNode.insertBefore(strip,aiDiv);
    refreshIcons();
}

function tbAnchorSearching(aiDiv){
    if(!aiDiv||!aiDiv.parentNode)return null;
    const el=document.createElement('div');
    el.style.cssText='font-size:11px;color:var(--text-muted);font-style:italic;margin-bottom:6px;transition:opacity .3s ease;';
    el.textContent='正在检索你的教材…';
    aiDiv.parentNode.insertBefore(el,aiDiv);
    return el;
}

function tbAnchorDismissSearching(el){
    if(!el||!el.parentNode)return;
    el.style.opacity='0';
    setTimeout(()=>{if(el.parentNode)el.remove();},350);
}

async function aiChatAnchorAsync(question,aiDiv){
    try{
        if(!localStorage.getItem('cb_cn_token'))return;
        if(window.aiChatBookMode&&window.aiChatBookDocId)return;              // explicit whole-book mode wins
        // Scope: auto-anchoring ONLY for exercises / exam-papers docs
        const doc=Object.values(bsData).flat().find(d=>d.id===readerCurrentDocId);
        if(!doc||!['exercises','exam-papers'].includes(doc.category))return;
        const _s=tbAnchorSearching(aiDiv);
        const hits=await textbookAnchorSearch(question);
        tbAnchorStrip(hits,aiDiv,_s);
        if(!hits)tbAnchorDismissSearching(_s);
    }catch(e){/* retrieval hiccup: answer is unaffected */}
}

async function tutorAnchorAsync(question,aiDiv){
    try{
        if(!localStorage.getItem('cb_cn_token'))return;
        const _s=tbAnchorSearching(aiDiv);
        const hits=await textbookAnchorSearch(question);
        tbAnchorStrip(hits,aiDiv,_s);
        if(!hits)tbAnchorDismissSearching(_s);
    }catch(e){/* answer unaffected */}
}

// ===== Post-answer concept tracing (async, after AI answer completes) =====
async function traceConcepts(answerText,aiDiv){
    if(!localStorage.getItem('cb_cn_token'))return;
    if(!aiDiv||!aiDiv.parentNode)return;
    const status=document.createElement('div');
    status.style.cssText='margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(122,107,255,.03);border-left:3px solid rgba(122,107,255,.45);font-size:11px;color:var(--text-muted);font-style:italic;';
    status.textContent='正在教材中检索关键概念…';
    aiDiv.parentNode.insertBefore(status,aiDiv.nextSibling);
    try{
        const res=await apiFetch('/api/textbooks/concepts',{
            method:'POST',body:JSON.stringify({answer_text:answerText})
        });
        if(!res.ok){status.textContent='关键概念检索暂不可用';return;}
        const d=await res.json();
        if(d.reason!=='ok'||!d.concepts||!d.concepts.length){
            status.style.opacity='0';status.style.transition='opacity .3s';
            setTimeout(()=>{if(status.parentNode)status.remove();},350);
            return;
        }
        renderConceptCitations(d.concepts,aiDiv,status);
    }catch(e){
        status.textContent='关键概念检索暂不可用';
    }
}

function renderConceptCitations(concepts,aiDiv,statusEl){
    if(statusEl&&statusEl.parentNode)statusEl.remove();
    if(!aiDiv||!aiDiv.parentNode)return;
    const block=document.createElement('div');
    block.style.cssText='margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(122,107,255,.04);border-left:3px solid var(--accent);';
    let html='<div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:6px;">📚 你教材中的关键概念</div>';
    concepts.forEach((c,ci)=>{
        html+='<div style="margin-bottom:4px;">'
            +'<span style="font-size:12px;font-weight:500;color:var(--text-primary);">'+escapeHtml(c.name)+'</span>';
        c.hits.forEach((h,hi)=>{
            html+=' <span onclick="conceptPeek('+ci+','+hi+')" title="查看教材原文" '
                +'style="font-size:11px;padding:1px 8px;border-radius:999px;background:rgba(82,196,26,.08);border:1px solid rgba(82,196,26,.25);color:#52c41a;cursor:pointer;margin-left:4px;">'
                +escapeHtml(h.book)+' · p.'+h.page+'</span>';
        });
        html+='</div>';
    });
    block.innerHTML=html;
    aiDiv.parentNode.insertBefore(block,aiDiv.nextSibling);
    window._conceptHits=concepts;
}

function conceptPeek(ci,hi){
    const c=(window._conceptHits||[])[ci];
    if(!c)return;
    const h=c.hits[hi];if(!h)return;
    window.tbAnchorHits=[{doc_id:h.doc_id,book:h.book,page:h.page,text:''}];
    openTbPeek(0);
}

// ===== Textbook Peek window (mini-reader: full book + selection trio) =====
let tbPeekCurrent=0;
let tbPeekDocId=null,tbPeekTotal=0,tbPeekCurrentPage=1;
let tbPeekRenderedPages=new Set();
let tbPeekObserver=null;
let tbPeekHighlights=[];
let tbPeekSelText='',tbPeekSelPage=0,tbPeekLastSel=false;
const TB_SKIP_TYPES=new Set(['header','footer','page_number','aside_text','page_footnote']);

function closeTbPeek(){
    document.getElementById('tb-peek-modal').style.display='none';
    const slot=document.getElementById('tb-peek-slot');
    if(slot){slot.style.display='none';slot.innerHTML='';}
    const menu=document.getElementById('tb-peek-menu');
    if(menu)menu.style.display='none';
    tbPeekLastSel=false;
}

function tbPeekJumpTo(page){
    const body=document.getElementById('tb-peek-body');
    const el=document.getElementById('tbpp-page-'+page);
    if(!body||!el)return;
    requestAnimationFrame(()=>{
        const b=body.getBoundingClientRect(),r=el.getBoundingClientRect();
        body.scrollTop+=r.top-b.top-6;
    });
    setTimeout(()=>{   // re-assert once content height settles
        const el2=document.getElementById('tbpp-page-'+page);
        if(el2){const b=body.getBoundingClientRect(),r=el2.getBoundingClientRect();body.scrollTop+=r.top-b.top-6;}
    },300);
}

async function openTbPeek(i){
    const hits=window.tbAnchorHits||[];const h=hits[i];if(!h)return;
    tbPeekCurrent=i;tbPeekCurrentPage=h.page;
    const modal=document.getElementById('tb-peek-modal');
    const titleEl=document.getElementById('tb-peek-title');
    const tabs=document.getElementById('tb-peek-tabs');
    const body=document.getElementById('tb-peek-body');
    const slot=document.getElementById('tb-peek-slot');
    if(slot){slot.style.display='none';slot.innerHTML='';}
    if(tabs){
        tabs.innerHTML=hits.map((c,j)=>'<span onclick="openTbPeek('+j+')" style="font-size:11px;padding:3px 10px;border-radius:999px;cursor:pointer;white-space:nowrap;border:1px solid '+(j===i?'rgba(82,196,26,.4)':'var(--border)')+';background:'+(j===i?'rgba(82,196,26,.1)':'var(--bg-input)')+';color:'+(j===i?'#52c41a':'var(--text-secondary)')+';">'+escapeHtml(c.book)+' p.'+c.page+'</span>').join('');
        tabs.style.display=hits.length>1?'flex':'none';
    }
    modal.style.display='flex';
    // Same book already mounted? just jump — no rebuild
    if(tbPeekDocId===h.doc_id&&body.querySelector('[data-page-num]')){
        if(titleEl)titleEl.textContent=h.book+' · 第 '+h.page+'/'+tbPeekTotal+' 页';
        tbPeekJumpTo(h.page);
        return;
    }
    body.innerHTML='<div style="text-align:center;color:var(--text-muted);padding:24px;font-size:12px;">Loading textbook…</div>';
    try{
        const r=await apiFetch('/api/documents/'+h.doc_id+'/pages/1');
        if(!r.ok)throw new Error('HTTP '+r.status);
        const meta=await r.json();
        tbPeekTotal=meta.total_pages||1;
    }catch(e){
        body.innerHTML='<div style="color:#ff6b6b;font-size:12px;padding:12px;">'+escapeHtml(e.message)+'</div>';
        return;
    }
    tbPeekDocId=h.doc_id;
    tbPeekRenderedPages.clear();
    tbPeekHighlights=[];
    loadTbPeekHighlights();
    body.innerHTML='';
    const wrap=document.createElement('div');
    body.appendChild(wrap);
    // [Viewport semantics] Column width fits the popup AT OPEN TIME, then is
    // frozen: resizing afterwards never reflows text, it only changes the
    // viewport (browser-window behaviour). Re-fits on every open.
    const _fitW=Math.max(360,body.clientWidth-20);
    wrap.style.width=_fitW+'px';
    // Batch-build all placeholders in ONE innerHTML pass (465 x createElement
    // was the main source of the "popup opens with a stutter" lag)
    let ph='';
    for(let n2=1;n2<=tbPeekTotal;n2++){
        ph+='<div id="tbpp-page-'+n2+'" data-page-num="'+n2+'" style="margin:0 auto 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:4px 24px 16px;min-height:160px;"><div style="display:flex;align-items:center;justify-content:center;padding:24px;color:var(--text-muted);font-size:12px;">Page '+n2+'</div></div>';
    }
    wrap.innerHTML=ph;
    if(tbPeekObserver)tbPeekObserver.disconnect();
    tbPeekObserver=new IntersectionObserver((entries)=>{
        entries.forEach(entry=>{
            if(!entry.isIntersecting)return;
            const p=parseInt(entry.target.dataset.pageNum);
            if(!tbPeekRenderedPages.has(p))tbPeekRenderPage(p);
        });
    },{root:body,rootMargin:'300px 0px',threshold:0.01});
    // rAF-throttled page tracker over a CACHED page list (no per-frame re-query)
    const pgsArr=Array.from(wrap.querySelectorAll('[data-page-num]'));
    let _pTick=false;
    body.onscroll=()=>{
        if(_pTick)return;_pTick=true;
        requestAnimationFrame(()=>{
            _pTick=false;
            let cur=tbPeekCurrentPage;
            for(const p of pgsArr){
                const rect=p.getBoundingClientRect();
                if(rect.top>=0&&rect.top<body.clientHeight/2){cur=parseInt(p.dataset.pageNum);break;}
            }
            if(cur!==tbPeekCurrentPage){
                tbPeekCurrentPage=cur;
                const book=(window.tbAnchorHits||[])[tbPeekCurrent];
                if(titleEl&&book)titleEl.textContent=book.book+' · 第 '+cur+'/'+tbPeekTotal+' 页';
            }
        });
    };
    if(titleEl)titleEl.textContent=h.book+' · 第 '+h.page+'/'+tbPeekTotal+' 页';
    // Let the modal paint BEFORE the observer's initial pass + jump
    // (another chunk of the open-lag: work happened before first paint)
    requestAnimationFrame(()=>{
        pgsArr.forEach(d=>tbPeekObserver.observe(d));
        tbPeekJumpTo(h.page);
    });
}

async function tbPeekRenderPage(n){
    if(tbPeekRenderedPages.has(n))return;
    tbPeekRenderedPages.add(n);
    const pageDiv=document.getElementById('tbpp-page-'+n);if(!pageDiv)return;
    try{
        const r=await apiFetch('/api/documents/'+tbPeekDocId+'/pages/'+n);
        if(!r.ok)throw new Error('HTTP '+r.status);
        const data=await r.json();
        pageDiv.innerHTML='';
        const divider=document.createElement('div');
        divider.style.cssText='text-align:center;color:var(--text-muted);font-size:10px;letter-spacing:2px;padding:6px 0 10px;border-bottom:1px dashed var(--border);margin-bottom:10px;user-select:none;';
        divider.textContent='— 第 '+n+' 页 —';
        pageDiv.appendChild(divider);
        const texts=renderTbBlocks(pageDiv,data.blocks||[]);
        pageDiv.dataset.text=texts.join(' ');
        if(tbPeekHighlights.length){
            tbPeekHighlights.filter(hl=>hl.page===n).forEach(hl=>{
                try{applyHighlightToRoot(pageDiv,hl.text,hl.color);}catch(e){}
            });
        }
    }catch(e){
        pageDiv.innerHTML='<div style="padding:20px;text-align:center;color:#ff6b6b;font-size:12px;">Failed: '+escapeHtml(e.message)+'</div>';
    }
}

async function loadTbPeekHighlights(){
    if(!tbPeekDocId)return;
    try{
        const res=await apiFetch('/api/highlights?document_id='+encodeURIComponent(tbPeekDocId));
        if(res.ok){const data=await res.json();if(Array.isArray(data))tbPeekHighlights=data;}
    }catch(e){/* offline: highlights simply won't show */}
    // apply to pages that rendered before the list arrived
    tbPeekHighlights.forEach(hl=>{
        if(tbPeekRenderedPages.has(hl.page)){
            const pd=document.getElementById('tbpp-page-'+hl.page);
            if(pd){try{applyHighlightToRoot(pd,hl.text,hl.color);}catch(e){}}
        }
    });
}

// ===== Peek selection actions (translate / highlight / note / ask AI) =====
function tbPeekShowSlot(html){
    const slot=document.getElementById('tb-peek-slot');
    if(!slot)return null;
    slot.innerHTML=html;slot.style.display='block';
    return slot;
}

function tbPeekAction(action){
    const menu=document.getElementById('tb-peek-menu');
    if(menu)menu.style.display='none';
    const text=tbPeekSelText;
    if(action==='translate'){
        tbPeekShowSlot('<div style="padding:10px 12px;background:rgba(76,141,255,.06);border-left:3px solid #4C8DFF;">'
            +'<div style="font-size:11px;font-weight:600;color:#4C8DFF;margin-bottom:4px;">Translating…</div>'
            +'<p style="font-size:12px;margin-bottom:6px;color:var(--text-secondary);">'+escapeHtml(text.substring(0,140))+(text.length>140?'...':'')+'</p>'
            +'<div id="tb-peek-translate-result" style="font-size:12px;color:var(--text-muted);">正在调用 AI…</div>'
            +'<button onclick="document.getElementById(\'tb-peek-slot\').style.display=\'none\'" style="margin-top:6px;font-size:10px;padding:3px 8px;border-radius:6px;background:transparent;color:var(--text-muted);border:none;cursor:pointer;">关闭</button></div>');
        fetch(AI_BACKEND_URL+'/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,target_lang:'auto'})})
        .then(r=>r.json()).then(data=>{
            const el=document.getElementById('tb-peek-translate-result');if(!el)return;
            if(data.error){el.innerHTML='<span style="color:#ff6b6b">'+escapeHtml(data.error)+'</span>';}
            else{el.innerHTML=(data.translation||'').replace(/\n/g,'<br>');}
        }).catch(err=>{
            const el=document.getElementById('tb-peek-translate-result');
            if(el)el.innerHTML='<span style="color:#ff6b6b">'+escapeHtml(err.message)+'</span>';
        });
    }else if(action==='highlight'){
        const colors=[{c:'#faad14',n:'Yellow'},{c:'#52c41a',n:'Green'},{c:'#4C8DFF',n:'Blue'},{c:'#ff6b6b',n:'Red'}];
        tbPeekShowSlot('<div style="padding:10px 12px;background:rgba(250,173,20,.06);border-left:3px solid #faad14;">'
            +'<div style="font-size:11px;font-weight:600;color:#faad14;margin-bottom:6px;">Highlight · p.'+tbPeekSelPage+'</div>'
            +'<div style="font-size:11px;padding:6px;border-radius:6px;background:var(--bg-input);color:var(--text-secondary);font-style:italic;margin-bottom:8px;">"'+escapeHtml(text.substring(0,100))+(text.length>100?'...':'')+'"</div>'
            +'<div style="display:flex;gap:6px;margin-bottom:8px;">'
            +colors.map(cl=>'<button onclick="tbPeekSetHlColor(\''+cl.c+'\')" id="tbhl-'+cl.c.slice(1)+'" style="width:26px;height:26px;border-radius:50%;border:2px solid '+cl.c+';background:'+cl.c+';cursor:pointer;" title="'+cl.n+'"></button>').join('')
            +'</div><input type="hidden" id="tbhl-color" value="#faad14">'
            +'<textarea id="tbhl-note" placeholder="Add a note (optional)…" style="width:100%;padding:6px;border-radius:6px;font-size:12px;resize:none;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);outline:none;" rows="2"></textarea>'
            +'<div style="display:flex;gap:6px;margin-top:6px;">'
            +'<button onclick="tbPeekSaveHighlightFromSlot()" style="font-size:11px;padding:4px 12px;border-radius:6px;border:none;background:#faad14;color:#fff;font-weight:600;cursor:pointer;">Save</button>'
            +'<button onclick="document.getElementById(\'tb-peek-slot\').style.display=\'none\'" style="font-size:11px;padding:4px 10px;background:none;border:none;color:var(--text-muted);cursor:pointer;">Cancel</button></div></div>');
        tbPeekSetHlColor('#faad14');
    }else if(action==='note'){
        tbPeekShowSlot('<div style="padding:10px 12px;background:rgba(82,196,26,.06);border-left:3px solid #52c41a;">'
            +'<div style="font-size:11px;font-weight:600;color:#52c41a;margin-bottom:6px;">Note · p.'+tbPeekSelPage+'</div>'
            +'<div style="font-size:11px;padding:6px;border-radius:6px;background:var(--bg-input);color:var(--text-secondary);font-style:italic;margin-bottom:8px;">"'+escapeHtml(text.substring(0,100))+(text.length>100?'...':'')+'"</div>'
            +'<textarea id="tbpeek-note-input" placeholder="Write your note…" style="width:100%;padding:6px;border-radius:6px;font-size:12px;resize:none;border:1px solid var(--border);background:var(--bg-input);color:var(--text-primary);outline:none;" rows="3"></textarea>'
            +'<div style="display:flex;gap:6px;margin-top:6px;">'
            +'<button onclick="tbPeekSaveNoteFromSel()" style="font-size:11px;padding:4px 12px;border-radius:6px;border:none;background:#52c41a;color:#fff;font-weight:600;cursor:pointer;">Save</button>'
            +'<button onclick="document.getElementById(\'tb-peek-slot\').style.display=\'none\'" style="font-size:11px;padding:4px 10px;background:none;border:none;color:var(--text-muted);cursor:pointer;">Cancel</button></div></div>');
        setTimeout(()=>{const t=document.getElementById('tbpeek-note-input');if(t)t.focus();},80);
    }else if(action==='ai'){
        // Strategy B: reuse the Chat AI window — follow-up if open (no reset),
        // fresh quote-session otherwise. Never a third floating window.
        const chatModal=document.getElementById('ai-chat-modal');
        const quote=text.substring(0,800);
        if(chatModal&&chatModal.style.display==='flex'){
            tbPeekLastSel=false;
            aiChatSend('请讲解我教材中的这段内容：\n\n"'+quote+'"');
        }else{
            openAIChat(text);
        }
    }
}

function tbPeekSetHlColor(c){
    const hidden=document.getElementById('tbhl-color');
    if(hidden)hidden.value=c;
    ['#faad14','#52c41a','#4C8DFF','#ff6b6b'].forEach(col=>{
        const b=document.getElementById('tbhl-'+col.slice(1));
        if(b)b.style.boxShadow=(col===c?'0 0 0 2px var(--bg-card),0 0 0 4px '+col:'none');
    });
}

function tbPeekSaveHighlightFromSlot(){
    const hidden=document.getElementById('tbhl-color');
    const noteEl=document.getElementById('tbhl-note');
    const color=hidden?hidden.value:'#faad14';
    const note=noteEl?noteEl.value.trim():'';
    const slot=document.getElementById('tb-peek-slot');
    const pageDiv=document.getElementById('tbpp-page-'+tbPeekSelPage);
    if(pageDiv){try{applyHighlightToRoot(pageDiv,tbPeekSelText,color);}catch(e){}}
    tbPeekHighlights.push({page:tbPeekSelPage,text:tbPeekSelText,color:color,note:note});
    if(slot){slot.style.display='none';slot.innerHTML='';}
    tbPeekLastSel=false;
    apiFetch('/api/highlights',{method:'POST',body:JSON.stringify({document_id:tbPeekDocId,page:tbPeekSelPage,text:tbPeekSelText,color:color,note:note})})
        .then(r=>{if(r.ok){showNotification('高亮已保存——同步到阅读器与云端','success');if(typeof logActivity==='function')logActivity('highlight','Highlighted · "'+tbPeekSelText.substring(0,40)+'"');}})
        .catch(e=>console.error('Peek highlight save failed:',e));
}

async function tbPeekSaveNoteFromSel(){
    const inp=document.getElementById('tbpeek-note-input');
    if(!inp||!inp.value.trim())return;
    const noteText=inp.value.trim();
    const quote=tbPeekSelText.substring(0,100);
    const slot=document.getElementById('tb-peek-slot');
    if(slot){slot.style.display='none';slot.innerHTML='';}
    tbPeekLastSel=false;
    const content=noteText+'\n\nQuoted (p.'+tbPeekSelPage+'): "'+quote+(tbPeekSelText.length>100?'...':'')+'"';
    const title=(quote.substring(0,30)||'Textbook Note');
    try{
        const res=await apiFetch('/api/notes',{method:'POST',body:JSON.stringify({
            title:title,tag:'Reading Note',content:content,source:'reader'
        })});
        if(!res.ok)throw new Error('HTTP '+res.status);
        const created=await res.json();
        notesData.push({id:created.id,title:title,tag:'Reading Note',content:content,source:'reader',
            createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),isDeleted:false,deletedAt:null});
        notesSave();
        if(typeof logActivity==='function')logActivity('note','笔记 · '+title);
        showNotification('Note saved — visible on Notes page','success');
    }catch(e){showNotification('Note save failed: '+e.message,'error');}
}

// Shared block renderer for peek pages (returns extracted texts)
function renderTbBlocks(container,blocks){
    container.innerHTML='';
    const texts=[];
    let any=false;
    for(const b of blocks){
        if(TB_SKIP_TYPES.has(b.type))continue;
        const t=(b.text||'').trim();
        if(b.type==='table'&&b.html){
            const wrap=document.createElement('div');wrap.style.cssText='overflow-x:auto;margin:8px 0;';
            const tmp=document.createElement('div');tmp.innerHTML=b.html;
            const table=tmp.querySelector('table');
            if(table){
                table.style.cssText='border-collapse:collapse;font-size:12px;margin:0 auto;';
                [...table.querySelectorAll('td,th')].forEach(c=>{c.style.border='1px solid var(--border)';c.style.padding='4px 8px';});
            }
            wrap.appendChild(tmp);container.appendChild(wrap);any=true;
            texts.push(t||'[table]');
            continue;
        }
        if(!t)continue;
        any=true;
        texts.push(t);
        if(b.type==='title'||b.text_level){
            const lvl=Math.min(b.text_level||1,4);
            const hEl=document.createElement('h'+Math.max(2,lvl+1));
            hEl.style.cssText='margin:12px 0 6px;font-weight:700;font-size:'+(17-lvl*2)+'px;';
            hEl.textContent=t.replace(/^#+\s*/,'');container.appendChild(hEl);
        }else if(b.type==='equation'){
            const eq=document.createElement('div');
            eq.style.cssText='text-align:center;margin:8px 0;';
            eq.textContent=t.startsWith('$$')?t:'$$'+t+'$$';container.appendChild(eq);
        }else{
            const p=document.createElement('p');
            p.style.cssText='margin:6px 0;line-height:1.7;font-size:13.5px;color:var(--text-primary);';
            p.textContent=t;container.appendChild(p);
        }
    }
    if(!any)container.innerHTML='<div style="text-align:center;color:var(--text-muted);font-size:12px;font-style:italic;padding:16px 0;">No extractable content on this page</div>';
    // KaTeX typeset when idle — text paints first, formulas pop in
    if(window.renderMathInElement){
        (window.requestIdleCallback||(function(f){return setTimeout(f,40);}))(function(){
            if(container.isConnected)renderMathInElement(container,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false,strict:false});
        });
    }
    return texts;
}

function tbPeekOpenInReader(){
    const hits=window.tbAnchorHits||[];
    const h=hits[tbPeekCurrent]||hits[0];if(!h)return;
    const page=tbPeekCurrentPage||h.page;   // live page from the popup tracker
    const doc=Object.values(bsData).flat().find(d=>d.id===h.doc_id);
    if(!doc){showNotification('Book not found in bookshelf','warning');return;}
    closeTbPeek();                          // AI chat window stays open (side-by-side reading)
    window.__guideShown=true;
    readerLastDocId=doc.id;                 // skip the default-view reset so 'doc' survives
    readerViewMode='doc';                   // docview lands instantly (no full-PDF download)
    readerPendingScrollPage=page;           // reuse cross-view restore for precise landing
    const cat=Object.keys(bsData).find(c=>bsData[c].some(d=>d.id===h.doc_id));
    showPage('reader');
    setTimeout(()=>{
        if(cat)readerOpenDoc(cat,bsData[cat].findIndex(d=>d.id===h.doc_id));
    },60);
}

// Peek window drag (same pattern as the Chat AI modal)
(function initTbPeekDrag(){
    const modal=document.getElementById('tb-peek-modal');
    const header=document.getElementById('tb-peek-header');
    if(!modal||!header)return;
    let dragging=false,ox=0,oy=0;
    header.addEventListener('mousedown',e=>{
        if(e.target.closest('button'))return;
        dragging=true;
        const rect=modal.getBoundingClientRect();
        ox=e.clientX-rect.left;oy=e.clientY-rect.top;
        header.style.cursor='grabbing';
    });
    document.addEventListener('mousemove',e=>{
        if(!dragging)return;
        let x=e.clientX-ox,y=e.clientY-oy;
        const maxX=window.innerWidth-modal.offsetWidth;
        const maxY=window.innerHeight-modal.offsetHeight;
        x=Math.max(0,Math.min(x,maxX));
        y=Math.max(0,Math.min(y,maxY));
        modal.style.left=x+'px';modal.style.top=y+'px';modal.style.right='auto';
    });
    document.addEventListener('mouseup',()=>{if(dragging){dragging=false;header.style.cursor='grab';}});
})();

function openAIChatFree(){
    aiChatMessages=[];
    window.aiChatPageContext=null;   // reset before capturing
    window.aiChatBookMode=false;window.aiChatBookCtx=null;window.aiChatBookDocId=null;
    const modal=document.getElementById('ai-chat-modal');
    const quoteEl=document.getElementById('ai-chat-quote');
    const msgArea=document.getElementById('ai-chat-messages');

    // Capture the page the student is currently reading (from toolbar "Page N of M")
    // [MinerU] reformatted pages & overlay-injected pages both provide dataset.text,
    // so page-context chat works for scanned books too
    let ctxLabel='';
    try{
        const tb=document.getElementById('reader-toolbar');
        const _m=tb&&tb.textContent.match(/第 (\d+) 页|Page (\d+) of/);const m=_m?[,_m[1]||_m[2]]:null;
        if(m){
            const pageDiv=document.getElementById('pdf-page-'+m[1]);
            const pageText=(pageDiv&&pageDiv.dataset.text||'').trim();
            if(pageText){
                window.aiChatPageContext=pageText.substring(0,2000);
                ctxLabel='第 '+m[1]+' 页——可询问本页任何内容';
            }
        }
    }catch(e){}
    window.aiChatPageLabel=ctxLabel;   // for mode switching later

    // Show context strip (blue) or nothing in plain chat mode
    if(ctxLabel){
        quoteEl.style.display='block';
        quoteEl.textContent=ctxLabel;
        quoteEl.style.background='rgba(76,141,255,.06)';
        quoteEl.style.borderLeft='3px solid #4C8DFF';
    }else{
        quoteEl.style.display='none';
        quoteEl.style.background='rgba(122,107,255,.04)';
        quoteEl.style.borderLeft='3px solid var(--accent)';
    }

    msgArea.innerHTML='';
    aiChatMessages=[];

    // Reset position to bottom-right (default)
    modal.style.left='auto';modal.style.top='auto';modal.style.right='24px';modal.style.bottom='0px';
    modal.style.display='flex';

    // [Whole-book] show the mode toggle only for MinerU-parsed TEXTBOOKS
    // (RAG index is textbook-only; guides are fileType 'guide' and never qualify)
    const modeRow=document.getElementById('ai-chat-mode-row');
    if(modeRow)modeRow.style.display='none';
    const _token=localStorage.getItem('cb_cn_token');
    const _doc=Object.values(bsData).flat().find(d=>d.id===readerCurrentDocId);
    if(_token&&readerCurrentDocId&&_doc&&_doc.category==='textbooks'){
        apiFetch('/api/documents/'+readerCurrentDocId+'/parse')
            .then(r=>r.ok?r.json():{}).then(s=>{
                if(s&&s.status==='done'&&modeRow&&document.getElementById('ai-chat-modal').style.display==='flex'){
                    window.aiChatBookDocId=readerCurrentDocId;
                    modeRow.style.display='flex';
                    aiChatSetMode('page');   // page stays the default
                }
            }).catch(()=>{});
    }

    // Focus input — no auto-send, let the student ask freely
    setTimeout(()=>{const inp=document.getElementById('ai-chat-input');if(inp)inp.focus();},150);
}

function openAIChat(quotedText){
    aiChatMessages=[];
    window.aiChatPageContext=null;   // quote mode takes priority over page context
    window.aiChatBookMode=false;window.aiChatBookCtx=null;window.aiChatBookDocId=null;
    const modeRow0=document.getElementById('ai-chat-mode-row');
    if(modeRow0)modeRow0.style.display='none';
    const modal=document.getElementById('ai-chat-modal');
    const quoteEl=document.getElementById('ai-chat-quote');
    const msgArea=document.getElementById('ai-chat-messages');

    // Show quoted text (restore purple quote styling)
    quoteEl.style.background='rgba(122,107,255,.04)';
    quoteEl.style.borderLeft='3px solid var(--accent)';
    if(quotedText){
        quoteEl.style.display='block';
        quoteEl.textContent='"'+quotedText.substring(0,200)+(quotedText.length>200?'...':'')+'"';
    }else{
        quoteEl.style.display='none';
    }

    // Reset messages
    msgArea.innerHTML='';
    aiChatMessages=[];

    // Reset position to bottom-right (default)
    modal.style.left = 'auto';
    modal.style.top = 'auto';
    modal.style.right = '24px';
    modal.style.bottom = '0px';

    // Show modal
    modal.style.display='flex';

    // Clear float menu
    document.getElementById('reader-float-menu').style.display='none';
    document.getElementById('reader-action-panel').style.display='none';

    // AUTO-SEND: immediately send the quoted text to AI for analysis (no user input needed)
    // NOTE: quoted text must be in the USER message, because the backend filters out
    // any system messages from the frontend to avoid prompt conflicts.
    setTimeout(()=>{
        const quoteForAI = quotedText ? '\n\n"' + quotedText.substring(0,800) + '"' : '';
        aiChatSend('请分析以下文本——用通俗的话解释它的核心含义：' + quoteForAI);
    },300);
}

function closeAIChat(){
    window.aiChatPageContext=null;
    window.aiChatBookMode=false;window.aiChatBookCtx=null;window.aiChatBookDocId=null;
    const modeRow=document.getElementById('ai-chat-mode-row');
    if(modeRow)modeRow.style.display='none';
    document.getElementById('ai-chat-modal').style.display='none';
}

// ===== AI Chat Modal Drag =====
(function initAIChatDrag(){
    const modal = document.getElementById('ai-chat-modal');
    const header = document.getElementById('ai-chat-header');
    if(!modal || !header) return;

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('mousedown', (e) => {
        // Ignore if clicking close button
        if(e.target.closest('button')) return;
        isDragging = true;
        const rect = modal.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        header.style.cursor = 'grabbing';
        modal.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if(!isDragging) return;
        let x = e.clientX - offsetX;
        let y = e.clientY - offsetY;
        // Boundary checks
        const maxX = window.innerWidth - modal.offsetWidth;
        const maxY = window.innerHeight - modal.offsetHeight;
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));
        modal.style.left = x + 'px';
        modal.style.top = y + 'px';
        modal.style.right = 'auto';
        modal.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if(isDragging) {
            isDragging = false;
            header.style.cursor = 'grab';
            modal.style.transition = '';
        }
    });
})();

async function aiChatSend(text){
    text=text||document.getElementById('ai-chat-input').value.trim();
    if(!text)return;
    document.getElementById('ai-chat-input').value='';

    const msgArea=document.getElementById('ai-chat-messages');

    // If first message, clear placeholder
    if(aiChatMessages.length===0)msgArea.innerHTML='';

    // Add user message to UI
    const userDiv=document.createElement('div');
    userDiv.style.cssText='display:flex;flex-direction:row-reverse;gap:8px;margin-bottom:12px;';
    userDiv.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">Y</div>'+
        '<div style="background:var(--accent);color:#fff;padding:8px 14px;border-radius:12px 12px 4px 12px;font-size:13px;max-width:75%;">'+escapeHtml(text)+'</div>';
    msgArea.appendChild(userDiv);

    // Add to message history
    aiChatMessages.push({role:'user',content:text});

    // Create AI response placeholder
    const aiDiv=document.createElement('div');
    aiDiv.style.cssText='display:flex;gap:8px;margin-bottom:12px;';
    aiDiv.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:600;flex-shrink:0;">AI</div>'+
        '<div id="ai-streaming-'+Date.now()+'" style="background:var(--bg-hover);color:var(--text-primary);padding:8px 14px;border-radius:12px 12px 12px 4px;font-size:13px;max-width:75%;min-height:20px;"></div>';
    msgArea.appendChild(aiDiv);
    const streamId=aiDiv.querySelector('div:last-child').id;
    var stopOrb=function(){};
    try{ stopOrb=orbThinking(document.getElementById(streamId),'searching')||function(){}; }catch(e){ console.error('[aiChatSend] orb init failed:',e); }
    if(typeof aiBusy==='function')aiBusy(true);
    msgArea.scrollTop=msgArea.scrollHeight;

    // Whole-book mode: retrieve fresh excerpts for THIS question (per-message RAG)
    await aiChatMaybeRetrieveBookCtx(text);
    // Auto textbook anchoring: NON-BLOCKING — the answer streams immediately;
    // a citation strip appears above the bubble when retrieval hits
    aiChatAnchorAsync(text,aiDiv);

    // Build system context with quoted text
    const quoteEl=document.getElementById('ai-chat-quote');
    const quote=quoteEl.style.display!=='none'?quoteEl.textContent:'';

    const sysContent='你是智学桥 CogniBridge，中外合办大学（北邮-QMUL式）一年级 AI 辅导助手，学生来自高考体系、阅读中英混合教材。回答清晰简洁，使用 markdown（加粗、列表），数学用 LaTeX。关键术语首次出现附中英对照（如 supremum 上确界）。中文提问用中文回答，英文提问用英文回答。'+(quote?'\n\n学生从文档中划选了这段文本：\n'+quote:'');

    // Context injection (backend filters system messages, so context rides in user
    // messages): book excerpts → LAST user message; page context → FIRST user message
    // (auto textbook anchoring no longer injects — it renders an async strip instead)
    let bodyMsgs=aiChatMessages;
    if(window.aiChatBookCtx){
        const lastIdx=bodyMsgs.map(m=>m.role).lastIndexOf('user');
        if(lastIdx!==-1){
            bodyMsgs=bodyMsgs.map((m,i)=>i===lastIdx
                ?{...m,content:m.content+'\n\n[以下是为你的问题检索到的教材摘录——请依据它们作答，引用页码格式 [Page N]]\n'+window.aiChatBookCtx}
                :m);
        }
        bodyMsgs=bodyMsgs.map((m,i)=>{
            const firstUser=i===bodyMsgs.findIndex(x=>x.role==='user');
            return (firstUser&&m.role==='user'&&window.aiChatPageContext)
                ?{...m,content:m.content+'\n\n[上下文：学生当前正在阅读的页面]\n'+window.aiChatPageContext}
                :m;
        });
    }else if(window.aiChatPageContext){
        bodyMsgs=bodyMsgs.map((m,i)=>{
            const firstUser=i===bodyMsgs.findIndex(x=>x.role==='user');
            return (firstUser&&m.role==='user')
                ?{...m,content:m.content+'\n\n[上下文：学生当前正在阅读的页面]\n'+window.aiChatPageContext}
                :m;
        });
    }
    const apiMessages=[{role:'system',content:sysContent},...bodyMsgs];

    // Call Kimi
    kimiCall(apiMessages,
        full=>{
            const el=document.getElementById(streamId);
            try{if(stopOrb){stopOrb();stopOrb=null;}}catch(e){}
            if(typeof aiBusy==='function')aiBusy(true);
            if(el)el.innerHTML=markdownToHtml(full)+'<span style="opacity:.5;">▌</span>';
            msgArea.scrollTop=msgArea.scrollHeight;
        },
        full=>{
            const el=document.getElementById(streamId);
            try{if(stopOrb){stopOrb();stopOrb=null;}}catch(e){}
            if(typeof aiBusy==='function')aiBusy(false);
            if(el){el.innerHTML=full?markdownToHtml(full):'<span style="color:var(--yellow);">Empty response — please retry.</span>';enhanceCitations(el);}   // [MinerU] clickable [Page N]
            aiChatMessages.push({role:'assistant',content:full});
            msgArea.scrollTop=msgArea.scrollHeight;
            // Post-answer concept tracing (exercises/exam-papers scope only)
            const _doc=Object.values(bsData).flat().find(d=>d.id===readerCurrentDocId);
            if(_doc&&['exercises','exam-papers'].includes(_doc.category)){
                traceConcepts(full,aiDiv);
            }
        },
        err=>{
            const el=document.getElementById(streamId);
            try{if(stopOrb){stopOrb();stopOrb=null;}}catch(e){}
            if(typeof aiBusy==='function')aiBusy(false);
            if(el)el.innerHTML='<span style="color:#ff6b6b;">'+escapeHtml(String(err&&err.message?err.message:err))+'</span>';
        }
    );
}

function aiChatQuick(btn){
    const q=btn.dataset.q;
    aiChatSend(q);
}

function escapeHtml(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function markdownToHtml(md){
    // Protect LaTeX
    const mathBlocks=[];
    let text=md.replace(/\$\$([\s\S]+?)\$\$/g,(m,p1)=>{mathBlocks.push({d:true,l:p1.trim()});return '\x00B'+(mathBlocks.length-1)+'\x00';});
    text=text.replace(/\$([^\$\n]+?)\$/g,(m,p1)=>{mathBlocks.push({d:false,l:p1.trim()});return '\x00I'+(mathBlocks.length-1)+'\x00';});
    text=text.replace(/\\\((.+?)\\\)/g,(m,p1)=>{mathBlocks.push({d:false,l:p1.trim()});return '\x00I'+(mathBlocks.length-1)+'\x00';});
    text=text.replace(/\\\[([\s\S]+?)\\\]/g,(m,p1)=>{mathBlocks.push({d:true,l:p1.trim()});return '\x00B'+(mathBlocks.length-1)+'\x00';});
    // Markdown
    let h=escapeHtml(text);
    h=h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    h=h.replace(/\*(.+?)\*/g,'<em>$1</em>');
    h=h.replace(/`(.+?)`/g,'<code style="background:rgba(0,0,0,.1);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>');
    // Headings (H4→H1 order so ### is not eaten by #)
    h=h.replace(/^#### (.+)$/gm,'<div style="font-size:13px;font-weight:700;margin:10px 0 3px;">$1</div>');
    h=h.replace(/^### (.+)$/gm,'<div style="font-size:14px;font-weight:700;margin:10px 0 4px;">$1</div>');
    h=h.replace(/^## (.+)$/gm,'<div style="font-size:15px;font-weight:700;margin:12px 0 4px;">$1</div>');
    h=h.replace(/^# (.+)$/gm,'<div style="font-size:16px;font-weight:700;margin:12px 0 4px;">$1</div>');
    h=h.replace(/^\- (.+)$/gm,'<li style="margin-left:16px;">$1</li>');
    h=h.replace(/^\d+\. (.+)$/gm,'<li style="margin-left:16px;">$1</li>');
    // Markdown tables (must run before \n→<br>: blocks span multiple lines)
    h=h.replace(MD_TABLE_RE,mdTableBlock);
    h=h.replace(/\n/g,'<br>');
    // Render math
    if(typeof katex!=='undefined'){
        mathBlocks.forEach((b,i)=>{
            const ph='\x00'+(b.d?'B':'I')+i+'\x00';
            try{
                const html=katex.renderToString(b.l,{displayMode:b.d,throwOnError:false});
                h=h.split(ph).join(b.d?'<div style="text-align:center;margin:8px 0;overflow-x:auto;">'+html+'</div>':html);
            }catch(e){h=h.split(ph).join('<code>'+b.l+'</code>');}
        });
    }else{
        mathBlocks.forEach((b,i)=>{
            const ph='\x00'+(b.d?'B':'I')+i+'\x00';
            h=h.split(ph).join('<code>'+(b.d?'$$':'$')+b.l+(b.d?'$$':'$')+'</code>');
        });
    }
    return h;
}

