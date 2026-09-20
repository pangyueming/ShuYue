// ===== MATH TUTOR =====
let tutorMode='general';
let tutorChatHistory=[];
let tutorMaterials=[];

function tutorSwitchMode(m){
    tutorMode=m;
    const bg=document.getElementById('tutor-mode-general');
    const bd=document.getElementById('tutor-mode-deep');
    const desc=document.getElementById('tutor-mode-desc');
    if(m==='general'){
        bd.style.background='transparent';bd.style.color='var(--text-secondary)';
        bg.style.color='#fff';
        desc.textContent='直接解答：知识来源、方法拆解、通俗讲解（术语中英对照）';
    }else{
        bg.style.background='transparent';bg.style.color='var(--text-secondary)';
        bd.style.color='#fff';
        desc.textContent='引导式发现——苏格拉底式逐步提问。耗时更长，但帮你真正理解';
    }
    // Liquid indicator carries the active background (init.js); fall back to
    // solid button backgrounds when the effect layer is unavailable.
    if(window.__tutorGooeyMove){
        bg.style.background='transparent';bd.style.background='transparent';
        window.__tutorGooeyMove(m);
    }else if(m==='general'){
        bg.style.background='var(--accent)';
    }else{
        bd.style.background='var(--accent)';
    }
}

function tutorUploadMaterial(){
    const inp=document.createElement('input');
    inp.type='file';inp.accept='.pdf,.pptx';inp.style.display='none';
    inp.onchange=()=>{
        if(!inp.files[0])return;
        const file=inp.files[0];
        tutorMaterials.push({name:file.name,size:(file.size/1024/1024).toFixed(1)+'MB',file:file});
        tutorRenderMaterials();
    };
    document.body.appendChild(inp);inp.click();inp.remove();
}

function tutorRenderMaterials(){
    const c=document.getElementById('tutor-materials');if(!c)return;
    c.innerHTML=tutorMaterials.map((m,i)=>
        `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:6px;background:var(--bg-input);margin-bottom:4px;font-size:12px;">
        <span style="color:var(--text-secondary);">${iconHtml('paperclip',13)}</span><span style="color:var(--text-primary);">${m.name}</span><span style="color:var(--text-muted);">${m.size}</span>
        <button onclick="tutorMaterials.splice(${i},1);tutorRenderMaterials()" style="margin-left:auto;color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:14px;">×</button></div>`
    ).join('');refreshIcons();
}

function tutorSendQuick(q){
    document.getElementById('tutor-input').value=q;
    tutorSend();
}

async function tutorSend(){
    const inp=document.getElementById('tutor-input');
    const q=inp.value.trim();if(!q)return;
    inp.value='';
    const chat=document.getElementById('tutor-chat');
    // Clear placeholder
    if(tutorChatHistory.length===0)chat.innerHTML='';
    // User message
    const sysMsg=tutorMode==='general'?
        '你是智学桥 CogniBridge，中外合办大学（北邮-QMUL式）一年级 AI 辅导老师，学生来自高考体系、学习英文授课的大学数学。逐步解题、过程清晰，关键术语首次出现附英文对照（如 极限 limit），记号遵循英文教材并在需要时对照高考习惯。最终答案用**加粗**标出。中文提问用中文回答，英文提问用英文回答。':
        '你是智学桥 CogniBridge，一位苏格拉底式引导老师（Socratic tutor）。不直接给答案，通过引导式提问帮助学生自己发现答案。跟随学生提问语言（默认中文）。';
    // Build messages with history
    let msgs=[{role:'system',content:sysMsg}];
    if(tutorMaterials.length>0){
        msgs.push({role:'system',content:'The student has uploaded these reference materials: '+tutorMaterials.map(m=>m.name).join(', ')});
    }
    msgs=msgs.concat(tutorChatHistory);
    msgs.push({role:'user',content:q});
    tutorChatHistory.push({role:'user',content:q});

    // Render user bubble
    const userDiv=document.createElement('div');
    userDiv.style.cssText='display:flex;flex-direction:row-reverse;gap:8px;';
    userDiv.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">Y</div>'+
        '<div style="background:var(--accent);color:#fff;padding:8px 14px;border-radius:12px 12px 4px 12px;font-size:13px;max-width:75%;">'+escapeHtmlTutor(q)+'</div>';
    chat.appendChild(userDiv);

    // AI bubble (streaming)
    const aiDiv=document.createElement('div');
    aiDiv.style.cssText='display:flex;gap:8px;';
    const bubbleId='tutor-bubble-'+Date.now();
    aiDiv.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,'+(tutorMode==='general'?'#4C8DFF,#4090e8':'var(--accent),#9b59f7')+');display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">'+(tutorMode==='general'?'AI':iconHtml('brain',14))+'</div>'+
        '<div id="'+bubbleId+'" style="background:var(--bg-hover);color:var(--text-primary);padding:8px 14px;border-radius:12px 12px 12px 4px;font-size:13px;max-width:75%;min-height:20px;"></div>';
    chat.appendChild(aiDiv);
    refreshIcons();
    // Effects are best-effort: any orb/beam failure must degrade to a plain
    // bubble, never abort tutorSend before kimiCall fires (that left the
    // bubble permanently empty).
    var stopOrb=function(){};
    try{ stopOrb=orbThinking(document.getElementById(bubbleId),tutorMode==='general'?'solving':'weaving')||function(){}; }catch(e){ console.error('[tutorSend] orb init failed:',e); }
    // Streaming glow: the bubble being written carries a soft md beam; it is
    // destroyed the moment the answer completes or errors out.
    var bubbleEl=document.getElementById(bubbleId);
    var bubbleBeam=null;
    try{
        if(bubbleEl&&window.BorderBeam&&typeof reducedMotionOn==='function'&&!reducedMotionOn()){
            bubbleBeam=BorderBeam.apply(bubbleEl,{
                size:'md',colorVariant:'ocean',theme:'auto',active:true,strength:.55,
                wrapperStyle:'display:block;flex-shrink:1;min-width:0;'
            });
        }
    }catch(e){ console.error('[tutorSend] beam init failed:',e); bubbleBeam=null; }
    if(typeof aiBusy==='function')aiBusy(true);
    chat.scrollTop=chat.scrollHeight;

    // Auto textbook anchoring: NON-BLOCKING — the answer streams immediately;
    // a citation strip appears above the bubble when retrieval hits
    tutorAnchorAsync(q,aiDiv);

    kimiCall(msgs,
        full=>{try{if(stopOrb){stopOrb();stopOrb=null;}}catch(e){}if(typeof aiBusy==='function')aiBusy(true);const el=document.getElementById(bubbleId);if(el)el.innerHTML=mdToHtmlTutor(full)+'<span style="opacity:.5;">▌</span>';chat.scrollTop=chat.scrollHeight;},
        full=>{try{if(stopOrb){stopOrb();stopOrb=null;}}catch(e){}try{if(bubbleBeam){bubbleBeam.destroy();bubbleBeam=null;}}catch(e){bubbleBeam=null;}if(typeof aiBusy==='function')aiBusy(false);const el=document.getElementById(bubbleId);if(el)el.innerHTML=full?mdToHtmlTutor(full):'<span style="color:var(--yellow);">Empty response — please retry.</span>';tutorChatHistory.push({role:'assistant',content:full});chat.scrollTop=chat.scrollHeight;
            // Post-answer concept tracing: locate theorems in user's textbooks
            traceConcepts(full,aiDiv);
            // Suggest practice + Gaokao bridging in General mode
            if(tutorMode==='general'){
                const sug=document.createElement('div');sug.style.cssText='display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;';
                sug.innerHTML='<div style="width:28px;flex-shrink:0;"></div>'+
                    '<button onclick="tutorSendQuick(\'生成3道类似的练习题并附解答（题目用英文，解析用中文）\')" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(82,196,26,.1);border:1px solid rgba(82,196,26,.3);color:#52c41a;cursor:pointer;white-space:nowrap;">'+iconHtml('target',12)+'同类练习</button>'+
                    '<button onclick="tutorSendQuick(\'请说明这个概念与高考数学的衔接：它对应高考哪些具体知识点作前置？大学（英文授课）的处理方式与高考有何不同？请给出从高考理解过渡到大学理解的具体例子，关键术语中英对照。\')" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(76,141,255,.1);border:1px solid rgba(76,141,255,.3);color:#4C8DFF;cursor:pointer;white-space:nowrap;">'+iconHtml('link',12)+'高考衔接</button>';
                chat.appendChild(sug);refreshIcons();chat.scrollTop=chat.scrollHeight;
            }else if(tutorMode==='deep'){
                const sug=document.createElement('div');sug.style.cssText='display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;';
                sug.innerHTML='<div style="width:28px;flex-shrink:0;"></div>'+
                    '<button onclick="tutorSendQuick(\'我需要一点提示\')" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(250,172,22,.1);border:1px solid rgba(250,172,22,.3);color:#faad14;cursor:pointer;white-space:nowrap;">给我提示</button>'+
                    '<button onclick="tutorSendQuick(\'我卡住了，能带我一步步走一遍吗？\')" style="font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.3);color:#ff6b6b;cursor:pointer;white-space:nowrap;">我卡住了</button>';
                chat.appendChild(sug);chat.scrollTop=chat.scrollHeight;
            }
        },
        err=>{try{if(stopOrb){stopOrb();stopOrb=null;}}catch(e){}try{if(bubbleBeam){bubbleBeam.destroy();bubbleBeam=null;}}catch(e){bubbleBeam=null;}if(typeof aiBusy==='function')aiBusy(false);const el=document.getElementById(bubbleId);if(el)el.innerHTML='<span style="color:#ff6b6b;">'+escapeHtml(String(err&&err.message?err.message:err))+'</span>';}
    );
}

function escapeHtmlTutor(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// ===== Markdown table renderer (shared by Math Tutor + Reader AI Chat) =====
const MD_TABLE_RE=/(^\|.+\|$)\n(^\|[ :\-|]+\|$)(?:\n((?:^\|.*\|\n?)*))?/gm;
function mdTableBlock(block){
    const lines=block.split('\n').filter(l=>l.trim());
    const cells=row=>row.replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
    // Column count & alignment come from the separator row (:--- / :---: / ---:)
    const seps=cells(lines[1]);
    const aligns=seps.map(s=>{
        const l=s.startsWith(':'),r=s.endsWith(':');
        if(l&&r)return 'center';
        if(r)return 'right';
        return 'left';
    });
    const th=cells(lines[0]).map((c,i)=>`<th style="border:1px solid var(--border);padding:4px 10px;background:var(--bg-tag);font-weight:600;text-align:${aligns[i]||'left'};">${c}</th>`).join('');
    const rows=lines.slice(2).map(line=>{
        const cs=cells(line);
        while(cs.length<seps.length)cs.push('');   // ragged rows: pad, never undefined
        return '<tr>'+cs.map((c,i)=>`<td style="border:1px solid var(--border);padding:4px 10px;text-align:${aligns[i]||'left'};">${c}</td>`).join('')+'</tr>';
    }).join('');
    return `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;font-size:12px;white-space:nowrap;"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function mdToHtmlTutor(md){
    // 1. Protect LaTeX math before escaping
    const mathBlocks=[];
    // Block math: $$...$$
    let text=md.replace(/\$\$([\s\S]+?)\$\$/g,(m,p1)=>{mathBlocks.push({d:true,l:p1.trim()});return '\x00B'+(mathBlocks.length-1)+'\x00';});
    // Inline math: $...$
    text=text.replace(/\$([^\$\n]+?)\$/g,(m,p1)=>{mathBlocks.push({d:false,l:p1.trim()});return '\x00I'+(mathBlocks.length-1)+'\x00';});
    // Also protect \(...\) and \[...\]
    text=text.replace(/\\\((.+?)\\\)/g,(m,p1)=>{mathBlocks.push({d:false,l:p1.trim()});return '\x00I'+(mathBlocks.length-1)+'\x00';});
    text=text.replace(/\\\[([\s\S]+?)\\\]/g,(m,p1)=>{mathBlocks.push({d:true,l:p1.trim()});return '\x00B'+(mathBlocks.length-1)+'\x00';});

    // 2. Markdown processing
    text=escapeHtmlTutor(text);
    text=text.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    text=text.replace(/\*(.+?)\*/g,'<em>$1</em>');
    text=text.replace(/`(.+?)`/g,'<code style="background:rgba(0,0,0,.1);padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>');
    // Headings (H4→H1 order so ### is not eaten by #)
    text=text.replace(/^#### (.+)$/gm,'<div style="font-size:13px;font-weight:700;margin:10px 0 3px;">$1</div>');
    text=text.replace(/^### (.+)$/gm,'<div style="font-size:14px;font-weight:700;margin:10px 0 4px;">$1</div>');
    text=text.replace(/^## (.+)$/gm,'<div style="font-size:15px;font-weight:700;margin:12px 0 4px;">$1</div>');
    text=text.replace(/^# (.+)$/gm,'<div style="font-size:16px;font-weight:700;margin:12px 0 4px;">$1</div>');
    text=text.replace(/^\- (.+)$/gm,'<li style="margin-left:16px;">$1</li>');
    text=text.replace(/^\d+\. (.+)$/gm,'<li style="margin-left:16px;">$1</li>');
    // Markdown tables (must run before \n→<br>: blocks span multiple lines)
    text=text.replace(MD_TABLE_RE,mdTableBlock);
    text=text.replace(/\n/g,'<br>');

    // 3. Render math with KaTeX
    if(typeof katex!=='undefined'){
        mathBlocks.forEach((b,i)=>{
            const ph='\x00'+(b.d?'B':'I')+i+'\x00';
            try{
                const html=katex.renderToString(b.l,{displayMode:b.d,throwOnError:false});
                text=text.split(ph).join(b.d?'<div style="text-align:center;margin:8px 0;overflow-x:auto;">'+html+'</div>':html);
            }catch(e){
                text=text.split(ph).join('<code>'+b.l+'</code>');
            }
        });
    }else{
        // KaTeX not loaded yet, show raw
        mathBlocks.forEach((b,i)=>{
            const ph='\x00'+(b.d?'B':'I')+i+'\x00';
            text=text.split(ph).join((b.d?'<div>':'')+'<code>'+(b.d?'$$':'$')+b.l+(b.d?'$$':'$')+'</code>'+(b.d?'</div>':''));
        });
    }
    return text;
}

