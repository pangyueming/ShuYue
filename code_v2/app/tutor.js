// ===== MATH TUTOR =====
let tutorMode='general';
let tutorChatHistory=[];
// per-workspace state: skill selection + materials never leak across rooms (v1.4.2)
const tutorSkillBySession={};       // key -> skill name
const tutorMaterialsBySession={};   // key -> [{name,size,file}]
function tutorGetSkill(){return tutorSkillBySession[tutorActiveSession||'_temp']||null;}
function tutorGetMaterials(){const k=tutorActiveSession||'_temp';if(!tutorMaterialsBySession[k])tutorMaterialsBySession[k]=[];return tutorMaterialsBySession[k];}
function tutorRemoveMaterial(i){tutorGetMaterials().splice(i,1);tutorRenderMaterials();}
// P2.5: textarea auto-grow (1 row → up to ~6 rows, Claude-style composer)
function tutorAutoGrow(el){
    if(!el)return;
    el.style.height='auto';
    el.style.height=Math.min(160,el.scrollHeight)+'px';
}
// shared: starter suggestions shown only in EMPTY conversations (empty-state guidance)
function tutorSuggestionsHtml(){
    return '<div class="tutor-suggest-row">'
        +'<button class="chip" onclick="tutorSendQuick(\'Evaluate: lim(x→0) sin(x)/x\')">求极限 sin(x)/x</button>'
        +'<button class="chip" onclick="tutorSendQuick(\'Prove that a²+b² ≥ 2ab for all real numbers\')">证明 a²+b²≥2ab</button>'
        +'<button class="chip" onclick="tutorSendQuick(\'Find the eigenvalues of matrix [[2,1],[1,2]]\')">求特征值</button>'
        +'<button class="chip" onclick="tutorSendQuick(\'Does the series Σ(1/n²) converge?\')">Σ1/n² 收敛吗？</button>'
        +'</div>';
}

// ===== P1.5 · Agent Skills UI（+ 菜单统一入口 / / 命令 / pill）=====
// v1.3 决策：常驻 chips 移除；技能 = 全局能力池，+ 与 / 均可调全部技能。
// v1.4.2：选中状态按工作台隔离（A 台开的技能不进 B 台）。
let tutorSkills=[];           // [{name,label,description}] from /api/skills
let tutorSlashIdx=0;          // highlighted row in the / popup
let tutorSlashItems=[];       // filtered skills for the / popup
async function tutorSkillsInit(){
    try{
        const res=await fetch(AI_BACKEND_URL+'/api/skills');
        if(!res.ok)throw new Error('HTTP '+res.status);
        const data=await res.json();
        tutorSkills=(data&&data.skills)||[];
    }catch(e){tutorSkills=[];}
    tutorRenderSkillPill();
    tutorRenderMaterials();
}
// --- active skill pill above the composer (reads the CURRENT workspace's skill) ---
function tutorRenderSkillPill(){
    const row=document.getElementById('tutor-skill-pill-row');
    if(!row)return;
    const cur=tutorGetSkill();
    if(!cur){row.style.display='none';row.innerHTML='';return;}
    const s=tutorSkills.find(x=>x.name===cur);
    row.style.display='';
    row.innerHTML='<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;color:var(--iris-400,var(--accent));background:rgba(122,107,255,.12);border:1px solid rgba(122,107,255,.3);">'
        +iconHtml('sparkles',12)+escapeHtml(s?s.label:cur)
        +'<span onclick="tutorPickSkill(null)" role="button" tabindex="0" aria-label="移除技能" style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;cursor:pointer;background:rgba(122,107,255,.2);font-size:10px;">✕</span></span>';
    refreshIcons();
}
function tutorPickSkill(name){
    const k=tutorActiveSession||'_temp';
    if(name)tutorSkillBySession[k]=name;else delete tutorSkillBySession[k];
    tutorRenderSkillPill();
    tutorClosePlusMenu();tutorCloseSlash();
    if(name){
        const s=tutorSkills.find(x=>x.name===name);
        showNotification('已启用教学技能：'+(s?s.label:name)+'（发送时生效）','success');
    }
    const inp=document.getElementById('tutor-input');
    if(inp)inp.focus();
}
// AI 气泡顶部技能徽标（P1 保留）
function tutorSkillBadge(){
    const cur=tutorGetSkill();
    if(!cur)return '';
    const s=tutorSkills.find(x=>x.name===cur);
    return '<div style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--iris-400,var(--accent));background:rgba(122,107,255,.1);border:1px solid rgba(122,107,255,.25);border-radius:999px;padding:1px 8px;margin-bottom:6px;">'
        +iconHtml('sparkles',10)+' '+escapeHtml(s?s.label:cur)+'</div><br>';
}
// --- + menu（技能 + 上传资料 统一入口）---
function tutorTogglePlusMenu(ev){
    if(ev)ev.stopPropagation();
    const m=document.getElementById('tutor-plus-menu');
    if(m&&m.style.display==='flex'){tutorClosePlusMenu();return;}
    tutorCloseSlash();
    if(!m)return;
    const btn=document.getElementById('tutor-plus-btn');
    const r=btn?btn.getBoundingClientRect():{left:20,bottom:80};
    const curSkill=tutorGetSkill();
    const skItems=tutorSkills.map(s=>{
        const on=s.name===curSkill;
        return `<div class="tutor-menu-item${on?' on':''}" onclick="tutorPickSkill('${on?'':escapeHtml(s.name)}')" role="button" tabindex="0">
            ${iconHtml(on?'check-circle':'sparkles',14)}
            <span style="flex:1;min-width:0;"><b style="font-size:12px;">${escapeHtml(s.label)}</b>
            <span style="display:block;font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.description)}</span></span>
        </div>`;
    }).join('');
    m.innerHTML='<div class="tutor-menu-label">'+iconHtml('wand-sparkles',11)+'教学技能（全部可用）</div>'
        +skItems
        +'<div class="tutor-menu-sep"></div>'
        +'<div class="tutor-menu-label">'+iconHtml('paperclip',11)+'附件</div>'
        +'<div class="tutor-menu-item" onclick="tutorClosePlusMenu();tutorUploadMaterial()" role="button" tabindex="0">'+iconHtml('file-up',14)+'<span style="flex:1;font-size:12px;">上传资料（PDF/PPT）</span></div>';
    m.style.display='flex';
    const mw=Math.min(320,window.innerWidth-24);
    m.style.width=mw+'px';
    m.style.left=Math.max(12,Math.min(r.left,window.innerWidth-mw-12))+'px';
    m.style.top='';m.style.bottom=(window.innerHeight-r.bottom+10)+'px';
    refreshIcons();
}
function tutorClosePlusMenu(){const m=document.getElementById('tutor-plus-menu');if(m){m.style.display='none';m.innerHTML='';}}
// --- / command popup（打字过滤）---
function tutorSlashOpen(){const p=document.getElementById('tutor-slash-popup');return !!(p&&p.style.display==='flex');}
function tutorCloseSlash(){const p=document.getElementById('tutor-slash-popup');if(p){p.style.display='none';p.innerHTML='';}tutorSlashIdx=0;}
function tutorSlashInput(v){
    const p=document.getElementById('tutor-slash-popup');
    if(!p)return;
    if(!v.startsWith('/')){tutorCloseSlash();return;}
    const q=v.slice(1).trim().toLowerCase();
    tutorSlashItems=tutorSkills.filter(s=>!q
        ||s.label.toLowerCase().includes(q)
        ||s.name.toLowerCase().includes(q)
        ||(s.description||'').toLowerCase().includes(q));
    if(!tutorSlashItems.length){tutorCloseSlash();return;}
    tutorSlashIdx=Math.min(tutorSlashIdx,tutorSlashItems.length-1);
    p.innerHTML='<div class="tutor-menu-label">'+iconHtml('slash',11)+'技能 · ↑↓ 选择 · Enter 确认</div>'
        +tutorSlashItems.map((s,i)=>`<div class="tutor-menu-item${i===tutorSlashIdx?' hl':''}" onclick="tutorSlashPick(${i})" role="button" tabindex="0">
            ${iconHtml('sparkles',14)}
            <span style="flex:1;min-width:0;"><b style="font-size:12px;">${escapeHtml(s.label)}</b>
            <span style="display:block;font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.description)}</span></span>
        </div>`).join('');
    const inp=document.getElementById('tutor-input');
    const r=inp?inp.getBoundingClientRect():{left:20,bottom:80};
    const mw=Math.min(340,window.innerWidth-24);
    p.style.display='flex';p.style.width=mw+'px';
    p.style.left=Math.max(12,Math.min(r.left,window.innerWidth-mw-12))+'px';
    p.style.top='';p.style.bottom=(window.innerHeight-r.bottom+10)+'px';
    refreshIcons();
}
function tutorSlashPick(i){
    const s=tutorSlashItems[i];
    const inp=document.getElementById('tutor-input');
    if(inp)inp.value='';           // 选中后清掉 "/..." 命令文本
    if(s)tutorPickSkill(s.name);
}
function tutorSlashKey(e){
    if(!tutorSlashOpen())return false;
    if(e.key==='ArrowDown'){e.preventDefault();tutorSlashIdx=(tutorSlashIdx+1)%tutorSlashItems.length;tutorSlashHl();return true;}
    if(e.key==='ArrowUp'){e.preventDefault();tutorSlashIdx=(tutorSlashIdx-1+tutorSlashItems.length)%tutorSlashItems.length;tutorSlashHl();return true;}
    if(e.key==='Enter'){e.preventDefault();tutorSlashPick(tutorSlashIdx);return true;}
    if(e.key==='Escape'){tutorCloseSlash();return true;}
    return false;
}
function tutorSlashHl(){
    const p=document.getElementById('tutor-slash-popup');
    if(!p)return;
    p.querySelectorAll('.tutor-menu-item').forEach((el,i)=>el.classList.toggle('hl',i===tutorSlashIdx));
}
// click-outside / Esc close the popups
document.addEventListener('mousedown',e=>{
    const pm=document.getElementById('tutor-plus-menu');
    const sp=document.getElementById('tutor-slash-popup');
    if(pm&&pm.style.display==='flex'&&!pm.contains(e.target)&&!e.target.closest('#tutor-plus-btn'))tutorClosePlusMenu();
    if(sp&&sp.style.display==='flex'&&!sp.contains(e.target))tutorCloseSlash();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(tutorEscapeKey(e))return;tutorClosePlusMenu();tutorCloseSlash();}});
// chips init → pill init（P1 遗留调用点兼容）+ 工作台加载（P2）
function tutorInitAll(){tutorSkillsInit();tutorSessionsInit();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tutorInitAll);
else tutorInitAll();

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
        tutorGetMaterials().push({name:file.name,size:(file.size/1024/1024).toFixed(1)+'MB',file:file});
        tutorRenderMaterials();
    };
    document.body.appendChild(inp);inp.click();inp.remove();
}

function tutorRenderMaterials(){
    const c=document.getElementById('tutor-materials');if(!c)return;
    const mats=tutorGetMaterials();
    c.innerHTML=mats.map((m,i)=>
        `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:6px;background:var(--bg-input);margin-bottom:4px;font-size:12px;">
        <span style="color:var(--text-secondary);">${iconHtml('paperclip',13)}</span><span style="color:var(--text-primary);">${m.name}</span><span style="color:var(--text-muted);">${m.size}</span>
        <button onclick="tutorRemoveMaterial(${i})" style="margin-left:auto;color:#ff6b6b;background:none;border:none;cursor:pointer;font-size:14px;">×</button></div>`
    ).join('');refreshIcons();
}

function tutorSendQuick(q){
    document.getElementById('tutor-input').value=q;
    tutorSend();
}

// ===== P2 · Workspaces (G1) — 用户命名的独立聊天场所 =====
let tutorSessions=[];
let tutorActiveSession=null;

async function tutorSessionsInit(){
    if(!localStorage.getItem('cb_cn_token')){tutorSessions=[];tutorActiveSession=null;tutorRenderSessions();return;}
    try{
        const res=await apiFetch('/api/agent/sessions');
        if(!res.ok)throw new Error('HTTP '+res.status);
        tutorSessions=await res.json();
        if(tutorActiveSession&&!tutorSessions.find(s=>s.id===tutorActiveSession))tutorActiveSession=null;
    }catch(e){tutorSessions=[];}
    tutorRenderSessions();
}
function tutorRenderSessions(){
    const list=document.getElementById('tutor-ws-list');
    if(!list)return;
    if(!localStorage.getItem('cb_cn_token')){
        list.innerHTML='<div style="font-size:11px;color:var(--text-muted);padding:8px 4px;line-height:1.6;">登录后即可使用工作台——每个工作台是独立的聊天场所，上下文互不干扰</div>';
        return;
    }
    if(!tutorSessions.length){
        list.innerHTML='<div style="font-size:11px;color:var(--text-muted);padding:8px 4px;">还没有工作台<br>点击上方「+ 新工作台」开始</div>';
        return;
    }
    list.innerHTML=tutorSessions.map(s=>{
        const on=s.id===tutorActiveSession;
        const live=tutorStreamActive(s.id);
        return `<div class="ws-item${on?' on':''}" data-id="${s.id}">
            <span class="ws-dot" onclick="tutorSwitchSession('${s.id}')" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${on?'● ':''}${escapeHtml(s.title)}${live?'<span class="ws-live" title="正在生成"></span>':''}</span>
            <span class="ws-act" title="重命名" onclick="tutorRenameSession('${s.id}')">${iconHtml('pencil',10)}</span>
            <span class="ws-act" title="删除" onclick="tutorDeleteSession('${s.id}')">${iconHtml('trash-2',10)}</span>
        </div>`;
    }).join('');
    const t=document.getElementById('tutor-ws-title');
    if(t){
        const cur=tutorSessions.find(s=>s.id===tutorActiveSession);
        t.textContent=cur?cur.title:'学习助手';
    }
    refreshIcons();
}
async function tutorNewSession(){
    if(!localStorage.getItem('cb_cn_token')){showNotification('登录后使用工作台','warning');return;}
    try{
        const res=await apiFetch('/api/agent/sessions',{method:'POST',body:JSON.stringify({title:''})});
        if(!res.ok)throw new Error('HTTP '+res.status);
        const s=await res.json();
        await tutorSessionsInit();
        await tutorSwitchSession(s.id);
    }catch(e){showNotification('创建失败：'+e.message,'error');}
}
async function tutorSwitchSession(id){
    if(!id)return;
    if(id===tutorActiveSession&&document.getElementById('tutor-chat').children.length>1)return;
    tutorActiveSession=id;
    const chat=document.getElementById('tutor-chat');
    chat.innerHTML='';          // detaches live-stream nodes; registry keeps refs so they keep running
    tutorChatHistory=[];
    let live=tutorStreams.get(id);
    try{
        const res=await apiFetch('/api/agent/sessions/'+id+'/messages');
        if(res.ok){
            const msgs=await res.json();
            if(live&&!live.done&&msgs.length&&msgs[msgs.length-1].role==='user'){
                msgs.pop();     // in-flight user turn re-attaches live below — skip its DB copy
            }
            if(!msgs.length&&!(live&&!live.done)){
                chat.innerHTML='<div class="empty-hero" style="min-height:240px;"><div class="empty-disc"><i data-lucide="message-square"></i></div><div class="empty-title">这个工作台还没有对话</div><div class="empty-sub">在下方输入第一个问题</div>'+tutorSuggestionsHtml()+'</div>';
            }
            msgs.forEach(m=>{
                if(m.role==='user'){
                    const d=document.createElement('div');d.style.cssText='display:flex;flex-direction:row-reverse;gap:8px;';
                    d.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">Y</div><div style="background:var(--accent);color:#fff;padding:8px 14px;border-radius:12px 12px 4px 12px;font-size:13px;max-width:75%;">'+escapeHtmlTutor(m.content)+'</div>';
                    chat.appendChild(d);
                }else if(m.role==='assistant'){
                    const d=document.createElement('div');d.style.cssText='display:flex;gap:8px;';
                    d.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#9b59f7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600;flex-shrink:0;">AI</div><div style="background:var(--bg-hover);color:var(--text-primary);padding:12px 16px;border-radius:14px 14px 14px 4px;font-size:13.5px;line-height:1.7;max-width:100%;">'+mdToHtmlTutor(m.content)+'</div>';
                    chat.appendChild(d);
                }
            });
            tutorChatHistory=msgs.filter(m=>m.role==='user'||m.role==='assistant')
                .map(m=>({role:m.role,content:m.content}));
            if(live&&!live.done){
                // re-attach the background stream: question + status + live AI bubble
                chat.appendChild(live.userDiv);
                chat.appendChild(live.statusWrap);
                chat.appendChild(live.aiDiv);
            }
            refreshIcons();
            chat.scrollTop=chat.scrollHeight;
        }
    }catch(e){/* restore failed → empty session */}
    // per-workspace UI state follows the room (skill pill / materials)
    tutorRenderSkillPill();
    tutorRenderMaterials();
    tutorSetSendBtn(tutorStreamActive());
    tutorRenderSessions();
}
async function tutorRenameSession(id){
    const s=tutorSessions.find(x=>x.id===id);if(!s)return;
    const t=prompt('工作台名称：',s.title);
    if(t===null)return;
    try{
        const res=await apiFetch('/api/agent/sessions/'+id,{method:'PUT',body:JSON.stringify({title:t})});
        if(!res.ok)throw new Error('HTTP '+res.status);
        await tutorSessionsInit();
    }catch(e){showNotification('重命名失败：'+e.message,'error');}
}
async function tutorDeleteSession(id){
    const s=tutorSessions.find(x=>x.id===id);if(!s)return;
    if(!confirm('删除工作台「'+s.title+'」？对话记录将一并删除。'))return;
    const st=tutorStreams.get(id);                        // kill any background stream first
    if(st&&!st.done){try{st.abort.abort();}catch(e){}}
    try{
        const res=await apiFetch('/api/agent/sessions/'+id,{method:'DELETE'});
        if(!res.ok)throw new Error('HTTP '+res.status);
        tutorStreams.delete(id);
        delete tutorSkillBySession[id];          // per-workspace state cleanup
        delete tutorMaterialsBySession[id];
        if(tutorActiveSession===id){tutorActiveSession=null;document.getElementById('tutor-chat').innerHTML='';tutorChatHistory=[];tutorSetSendBtn(false);tutorRenderSkillPill();tutorRenderMaterials();}
        await tutorSessionsInit();
    }catch(e){showNotification('删除失败：'+e.message,'error');}
}

// ===== P2 · 强制中断 + 后台流注册表（每个工作台一条可后台续跑的流）=====
const tutorStreams=new Map();      // sessionKey -> {session,message,statusWrap,aiDiv,abort,done}
function tutorSessionKey(){return tutorActiveSession||'_temp';}
function tutorStreamActive(key){
    key=(key===undefined)?tutorSessionKey():key;
    const s=tutorStreams.get(key);
    return !!(s&&!s.done);
}
function tutorSetSendBtn(streaming){
    const b=document.getElementById('tutor-send-btn');
    if(!b)return;
    b.innerHTML=streaming?iconHtml('square',14):iconHtml('arrow-up',16);
    b.title=streaming?'停止生成（Esc）':'Send';
    b.setAttribute('aria-label',streaming?'停止生成':'发送');
    b.style.background=streaming?'#ff6b6b':'';
    refreshIcons();
}
function tutorSendOrStop(){ if(tutorStreamActive()){tutorStopStreaming();}else{tutorSend();} }
function tutorStopStreaming(){
    const s=tutorStreams.get(tutorSessionKey());
    if(s&&!s.done){try{s.abort.abort();}catch(e){}}
}
function tutorEscapeKey(e){
    if(e.key==='Escape'&&tutorStreamActive()){tutorStopStreaming();return true;}
    return false;
}
async function tutorSend(){
    const inp=document.getElementById('tutor-input');
    const q=inp.value.trim();if(!q)return;
    if(tutorStreamActive()){showNotification('本工作台正在生成中，请等待完成或按 Esc 中断','warning');return;}
    inp.value='';tutorAutoGrow(inp);
    const sendSession=tutorActiveSession;          // scope: this stream belongs to THIS workspace
    const sendKey=sendSession||'_temp';
    const chat=document.getElementById('tutor-chat');
    const empty=chat.querySelector('.empty-hero');if(empty)empty.remove();
    let message=q;
    if(tutorGetMaterials().length>0)message+='\n（学生附带了资料：'+tutorGetMaterials().map(m=>m.name).join(', ')+'）';
    if(!sendSession)tutorChatHistory.push({role:'user',content:q});

    // user bubble
    const userDiv=document.createElement('div');
    userDiv.style.cssText='display:flex;flex-direction:row-reverse;gap:8px;';
    userDiv.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;flex-shrink:0;">Y</div>'+
        '<div style="background:var(--accent);color:#fff;padding:8px 14px;border-radius:12px 12px 4px 12px;font-size:13px;max-width:75%;">'+escapeHtmlTutor(q)+'</div>';
    chat.appendChild(userDiv);

    // AI bubble — status feed lives OUTSIDE the bubble (Codex-style collapsed rows)
    const statusWrap=document.createElement('div');
    statusWrap.style.cssText='padding:0 0 2px 36px;';
    chat.appendChild(statusWrap);
    const aiDiv=document.createElement('div');
    aiDiv.style.cssText='display:flex;gap:8px;';
    const bubbleId='tutor-bubble-'+Date.now();
    aiDiv.innerHTML='<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#9b59f7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:600;flex-shrink:0;">AI</div>'+
        '<div id="'+bubbleId+'" style="background:var(--bg-hover);color:var(--text-primary);padding:12px 16px;border-radius:14px 14px 14px 4px;font-size:13.5px;line-height:1.7;max-width:100%;min-height:20px;"><div class="tutor-content"></div></div>';
    chat.appendChild(aiDiv);
    const bubble=document.getElementById(bubbleId);
    const content=bubble.querySelector('.tutor-content');
    refreshIcons();
    var stopOrb=function(){};
    try{ stopOrb=orbThinking(content,'solving')||function(){}; }catch(e){}
    if(typeof aiBusy==='function')aiBusy(true);
    chat.scrollTop=chat.scrollHeight;

    // status feed: english technical labels, live elapsed timer, collapse on finish
    const stLines=[];let stCalls=0;let stIntent='chat';const stT0=Date.now();
    let stTimer=setInterval(()=>{
        const el=statusWrap.querySelector('.tutor-elapsed');
        if(el)el.textContent=Math.round((Date.now()-stT0)/1000)+'s';
    },1000);
    const stLine=(html)=>{
        const d=document.createElement('div');
        d.className='tutor-st-line';
        d.innerHTML='<span class="tutor-elapsed">'+Math.round((Date.now()-stT0)/1000)+'s</span>'+html;
        statusWrap.appendChild(d);
        chat.scrollTop=chat.scrollHeight;
    };
    const stCollapse=()=>{
        clearInterval(stTimer);
        const secs=Math.round((Date.now()-stT0)/1000);
        if(statusWrap.children.length){
            const rows=Array.from(statusWrap.children).map(c=>c.outerHTML).join('');
            statusWrap.innerHTML='<details class="tutor-st-details"><summary>▸ '+stIntent+' · '+stCalls+' call'+(stCalls===1?'':'s')+' · '+secs+'s</summary>'+rows+'</details>';
        }
    };

    // 旧"引导模式"开关优雅映射到 socratic-tutor 技能（未手动选技能时）
    const curSel=tutorGetSkill();
    const effSkillSel=curSel||(tutorMode==='deep'?'socratic-tutor':undefined);
    const body={session_id:tutorActiveSession||undefined,message:message,skill:effSkillSel,
        history:tutorActiveSession?undefined:tutorChatHistory.slice(0,-1)};
    let full='';let effSkill=effSkillSel||null;let gotText=false;let interrupted=false;let actionsHtml='';
    // register the stream (survives workspace switches — background continuation)
    const stream={key:sendKey,session:sendSession,message:message,
                  userDiv:userDiv,statusWrap:statusWrap,aiDiv:aiDiv,abort:new AbortController(),done:false};
    tutorStreams.set(sendKey,stream);
    tutorSetSendBtn(true);
    const render=()=>{
        const badge=effSkill?tutorSkillBadgeFor(effSkill):'';
        content.innerHTML=badge+mdToHtmlTutor(full)+(gotText?'':'<span style="opacity:.5;">▌</span>')+actionsHtml;
        chat.scrollTop=chat.scrollHeight;
    };
    try{
        const headers={'Content-Type':'application/json'};
        const tok=localStorage.getItem('cb_cn_token');
        if(tok)headers['Authorization']='Bearer '+tok;   // FIX: agent chat must authenticate (workspaces/persist/tools)
        const r=await fetch(AI_BACKEND_URL+'/api/agent/chat',{method:'POST',
            headers:headers,body:JSON.stringify(body),
            signal:stream.abort.signal});
        if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||('HTTP '+r.status));}
        const reader=r.body.getReader();const dec=new TextDecoder();let buf='';
        let firstEvent=true;
        while(true){
            const{done,value}=await reader.read();if(done)break;
            buf+=dec.decode(value);
            let idx;
            while((idx=buf.indexOf('\n\n'))>=0){
                const frame=buf.slice(0,idx);buf=buf.slice(idx+2);
                const line=frame.split('\n').find(l=>l.startsWith('data: '));
                if(!line)continue;
                const data=line.slice(6);
                if(data==='[DONE]')continue;
                let ev;try{ev=JSON.parse(data);}catch(e){continue;}
                if(firstEvent){firstEvent=false;try{stopOrb();}catch(_){}}   // orb stops at the FIRST signal
                if(ev.type==='text'){gotText=true;full+=ev.delta||'';render();}
                else if(ev.type==='decision'){
                    stIntent=ev.intent||'chat';
                    if(ev.skill&&!effSkill)effSkill=ev.skill;
                    let l='route → '+stIntent+(ev.confidence?' ('+Math.round(ev.confidence*100)+'%)':'');
                    if(ev.skill)l+='  ·  skill: '+ev.skill;
                    stLine(l);
                }
                else if(ev.type==='status'){
                    if(!(ev.text||'').startsWith('已启用技能'))stLine(escapeHtmlTutor(ev.text||''));
                }
                else if(ev.type==='tool_call'){stCalls++;stLine('calling <b>'+escapeHtmlTutor(ev.name||'tool')+'</b>…');}
                else if(ev.type==='tool_result'){stLine('✓ '+escapeHtmlTutor(ev.name||'tool')+' done');}
                else if(ev.type==='actions'&&ev.items&&ev.items.length){
                    actionsHtml='<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">'
                        +ev.items.map(a=>'<span style="font-size:9px;padding:1px 7px;border-radius:999px;background:rgba(82,196,26,.1);color:var(--green);border:1px solid rgba(82,196,26,.25);">'+iconHtml('check',9)+' '+escapeHtmlTutor((a.text||'').slice(0,40))+'</span>').join('')+'</div>';
                    render();
                }
                else if(ev.type==='error'){content.innerHTML='<span style="color:#ff6b6b;">'+escapeHtmlTutor(ev.text||'generation failed')+'</span>';}
                chat.scrollTop=chat.scrollHeight;
            }
        }
        if(!full&&!content.textContent.trim())content.innerHTML='<span style="color:var(--yellow);">未收到回复，请重试</span>';
        else render();
        if(!sendSession)tutorChatHistory.push({role:'assistant',content:full});
    }catch(e){
        if(e&&e.name==='AbortError'){
            interrupted=true;
            if(full){render();
                content.insertAdjacentHTML('beforeend','<div style="font-size:10px;color:var(--text-muted);margin-top:4px;display:inline-flex;align-items:center;gap:4px;">'+iconHtml('square',9)+'interrupted</div>');
                if(!sendSession)tutorChatHistory.push({role:'assistant',content:full});
            }else{
                content.innerHTML='<span style="color:var(--text-muted);font-size:11px;">interrupted</span>';
            }
        }else{
            content.innerHTML='<span style="color:#ff6b6b;">'+escapeHtmlTutor(String(e.message||e))+'</span>';
        }
    }finally{
        stCollapse();
        stream.done=true;
        tutorStreams.delete(sendKey);      // live registry holds in-flight streams only
        tutorSetSendBtn(tutorStreamActive());
        try{stopOrb();}catch(_){}
        if(typeof aiBusy==='function')aiBusy(false);
        // sidebar refresh: clears this stream's pulse; background completion also lands here
        if(sendSession)tutorSessionsInit();
        else tutorRenderSessions();
    }
}
function tutorSkillBadgeFor(name){
    const s=tutorSkills.find(x=>x.name===name);
    return '<div style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--iris-400,var(--accent));background:rgba(122,107,255,.1);border:1px solid rgba(122,107,255,.25);border-radius:999px;padding:1px 8px;margin-bottom:6px;">'
        +iconHtml('sparkles',10)+' '+escapeHtmlTutor(s?s.label:name)+'</div><br>';
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

