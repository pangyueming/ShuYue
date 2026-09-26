// ===== MATH TUTOR =====
// P2.6: General/Deep mode seg RETIRED — 引导模式 became a thin shortcut over
// the per-workspace skill system (tutorToggleGuideMode). No global mode state.
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
    // P3 D7: @ trigger for bookshelf docs
    const v=el.value;
    const atIdx=v.lastIndexOf('@');
    if(atIdx>=0&&atIdx===v.length-1||(atIdx>=0&&!/\s/.test(v.substring(atIdx+1))&&atIdx>0&&/\s/.test(v[atIdx-1]))){
        tutorAtShowPopup(atIdx);
    }else{
        tutorAtClosePopup();
    }
}
// P3 D7: @ reference bookshelf docs
let tutorAtTriggerPos=-1;
let tutorAtItems=[];
function tutorAtClosePopup(){
    const p=document.getElementById('tutor-at-popup');
    if(p){p.style.display='none';p.innerHTML='';}
    tutorAtTriggerPos=-1;
}
async function tutorAtShowPopup(atIdx){
    const p=document.getElementById('tutor-at-popup');
    if(!p)return;
    if(!tutorAtItems.length){
        try{
            const res=await apiFetch('/api/documents?category=all');
            if(res.ok){
                const docs=await res.json();
                tutorAtItems=(docs||[]).slice(0,15).map(d=>d.title||d.name||'?');
            }
        }catch(e){tutorAtItems=[];}
    }
    if(!tutorAtItems.length){tutorAtClosePopup();return;}
    tutorAtTriggerPos=atIdx;
    const inp=document.getElementById('tutor-input');
    const r=inp?inp.getBoundingClientRect():{left:20,bottom:80};
    const mw=Math.min(320,window.innerWidth-24);
    p.innerHTML='<div class="tutor-menu-label">'+iconHtml('at-sign',11)+'引用文档</div>'
        +tutorAtItems.map((title,i)=>
            `<div class="tutor-menu-item" onclick="tutorAtPick(${i})" role="button" tabindex="0">
                ${iconHtml('file-text',14)}
                <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(title)}</span>
            </div>`).join('');
    p.style.display='flex';p.style.width=mw+'px';
    p.style.left=Math.max(12,Math.min(r.left,window.innerWidth-mw-12))+'px';
    p.style.top='';p.style.bottom=(window.innerHeight-r.bottom+10)+'px';
    refreshIcons();
}
function tutorAtPick(i){
    const title=tutorAtItems[i];
    if(!title)return;
    const inp=document.getElementById('tutor-input');
    if(inp&&tutorAtTriggerPos>=0){
        inp.value=inp.value.substring(0,tutorAtTriggerPos)+'@'+title+' ';
        tutorAutoGrow(inp);
        inp.focus();
    }
    tutorAtClosePopup();
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
    tutorRenderModeChip();     // P2.6: chip reflects the room's skill state
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
        +'<div class="tutor-menu-item" onclick="tutorClosePlusMenu();tutorUploadMaterial()" role="button" tabindex="0">'+iconHtml('file-up',14)+'<span style="flex:1;font-size:12px;">上传资料（PDF/PPT）</span></div>'
        +'<div class="tutor-menu-sep"></div>'
        +'<div class="tutor-menu-label">'+iconHtml('settings',11)+'会话</div>'
        +'<div class="tutor-menu-item" onclick="tutorClosePlusMenu();tutorFinishSession()" role="button" tabindex="0">'+iconHtml('check-circle',14)+'<span style="flex:1;font-size:12px;">完成本次学习（总结+记忆）</span></div>'
        +'<div class="tutor-menu-item" onclick="tutorClosePlusMenu();tutorCompactSession()" role="button" tabindex="0">'+iconHtml('fold-horizontal',14)+'<span style="flex:1;font-size:12px;">整理对话（压缩上下文）</span></div>';
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
    // P3: action commands alongside skills
    const ACTIONS=[
        {name:'__finish__',label:'完成学习',description:'总结本次学习+提取记忆候选'},
        {name:'__compact__',label:'整理对话',description:'压缩长对话上下文'},
    ];
    let items=[
        ...tutorSkills.map(s=>({...s,isAction:false})),
        ...ACTIONS.map(a=>({...a,isAction:true})),
    ].filter(s=>!q
        ||s.label.toLowerCase().includes(q)
        ||s.name.toLowerCase().includes(q)
        ||(s.description||'').toLowerCase().includes(q));
    if(!items.length){tutorCloseSlash();return;}
    tutorSlashItems=items;
    tutorSlashIdx=Math.min(tutorSlashIdx,items.length-1);
    p.innerHTML='<div class="tutor-menu-label">'+iconHtml('slash',11)+'技能与操作 · ↑↓ 选择 · Enter 确认</div>'
        +items.map((s,i)=>`<div class="tutor-menu-item${i===tutorSlashIdx?' hl':''}" onclick="tutorSlashPick(${i})" role="button" tabindex="0">
            ${iconHtml(s.isAction?'settings':'sparkles',14)}
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
    if(!s)return;
    if(s.isAction){
        if(s.name==='__finish__')tutorFinishSession();
        else if(s.name==='__compact__')tutorCompactSession();
        return;
    }
    tutorPickSkill(s.name);
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
    const ap=document.getElementById('tutor-at-popup');
    if(pm&&pm.style.display==='flex'&&!pm.contains(e.target)&&!e.target.closest('#tutor-plus-btn'))tutorClosePlusMenu();
    if(sp&&sp.style.display==='flex'&&!sp.contains(e.target))tutorCloseSlash();
    if(ap&&ap.style.display==='flex'&&!ap.contains(e.target))tutorAtClosePopup();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(tutorEscapeKey(e))return;tutorClosePlusMenu();tutorCloseSlash();}});
// chips init → pill init（P1 遗留调用点兼容）+ 工作台加载（P2）+ 侧栏折叠态（P2.6）
function tutorInitAll(){tutorSkillsInit();tutorSessionsInit();tutorWsInit();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tutorInitAll);
else tutorInitAll();

// P2.6 · 引导模式 = socratic-tutor 技能的快捷开关（按工作台隔离，走技能系统）
function tutorToggleGuideMode(){
    const cur=tutorGetSkill();
    tutorPickSkill(cur==='socratic-tutor'?null:'socratic-tutor');
}
function tutorRenderModeChip(){
    const b=document.getElementById('tutor-mode-chip');if(!b)return;
    const on=tutorGetSkill()==='socratic-tutor';
    b.setAttribute('aria-pressed',on);
    b.classList.toggle('on',on);
    const t=document.querySelector('.tutor-topbar-hint');
    if(t)t.textContent=on?'苏格拉底技能已挂载 · 仅本工作台生效':'关闭=通用直答 · 点 + 或输入 / 唤起全部技能';
}

// P2.6 · 工作台侧栏折叠（Ctrl+B / 把手 / 状态记忆 / 后台流呼吸点）
let tutorWsCollapsed=false;
function tutorApplyWsState(){
    const sb=document.getElementById('tutor-ws-sidebar');
    const hd=document.getElementById('tutor-ws-handle');
    if(!sb||!hd)return;
    sb.classList.toggle('collapsed',tutorWsCollapsed);
    hd.style.display=tutorWsCollapsed?'flex':'none';
    try{localStorage.setItem('cb_cn_ws_collapsed',tutorWsCollapsed?'1':'0');}catch(e){}
    tutorUpdateHandleLive();
}
function tutorToggleWs(){
    tutorWsCollapsed=!tutorWsCollapsed;
    tutorApplyWsState();
}
function tutorUpdateHandleLive(){
    const dot=document.getElementById('tutor-ws-handle-live');
    if(!dot)return;
    let live=false;
    tutorStreams.forEach(s=>{if(!s.done)live=true;});
    dot.style.display=live?'':'none';
}
function tutorWsInit(){
    const saved=localStorage.getItem('cb_cn_ws_collapsed');
    tutorWsCollapsed=saved!==null?saved==='1':(window.innerWidth<900);   // 窄屏默认折叠
    tutorApplyWsState();
}
document.addEventListener('keydown',e=>{
    if(e.ctrlKey&&!e.altKey&&(e.key==='b'||e.key==='B')){e.preventDefault();tutorToggleWs();}
});

function tutorUploadMaterial(){
    const inp=document.createElement('input');
    inp.type='file';inp.accept='.pdf,.pptx';inp.style.display='none';
    inp.onchange=()=>{
        if(!inp.files[0])return;
        tutorHandleFile(inp.files[0]);
    };
    document.body.appendChild(inp);inp.click();inp.remove();
}

// P4.1: upload file to server + auto-trigger agent analysis
async function tutorHandleFile(file){
    if(!file)return;
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['pdf','pptx'].includes(ext)){
        showNotification('仅支持 PDF/PPTX 文件','warning');return;
    }
    showNotification('正在上传「'+file.name+'」…','info');
    try{
        const fd=new FormData();
        fd.append('file',file);
        fd.append('category','slides');   // default; agent can re-categorize later
        const headers={};
        const tok=localStorage.getItem('cb_cn_token');
        if(tok)headers['Authorization']='Bearer '+tok;
        const r=await fetch(AI_BACKEND_URL+'/api/documents/upload',{method:'POST',headers:headers,body:fd});
        if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.detail||'HTTP '+r.status);}
        const doc=await r.json();
        showNotification('已上传「'+doc.title+'」——正在分析…','success');
        // auto-send analysis message
        window.__tutorDirectSend='我上传了《'+doc.title+'》，请帮我分析：读取内容摘要、提取数学术语、并将摘要保存为笔记。';
        tutorSend();
    }catch(e){
        showNotification('上传失败：'+e.message,'error');
    }
}

// P4.1: drag-and-drop on chat area
(function(){
    const chat=document.getElementById('tutor-chat');
    if(!chat)return;
    let dragCount=0;
    chat.addEventListener('dragenter',e=>{
        e.preventDefault();
        dragCount++;
        chat.style.outline='2px dashed var(--accent)';
        chat.style.outlineOffset='-4px';
        chat.style.borderRadius='14px';
    });
    chat.addEventListener('dragleave',e=>{
        e.preventDefault();
        dragCount--;
        if(dragCount<=0){dragCount=0;chat.style.outline='';}
    });
    chat.addEventListener('dragover',e=>e.preventDefault());
    chat.addEventListener('drop',e=>{
        e.preventDefault();
        dragCount=0;
        chat.style.outline='';
        const files=e.dataTransfer&&e.dataTransfer.files;
        if(files&&files[0])tutorHandleFile(files[0]);
    });
})();

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
    tutorRenderModeChip();
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

// P3 E1: session-scoped write-tool approvals (client-held, sent with each request)
let tutorApprovedTools=[];
const TUTOR_LINK_LABELS={notes:'查看笔记',vocab:'去单词本',quiz:'去出题',plan:'查看计划',graph:'查看图谱',plotter:'去画板',pretest:'去前测'};

// P3 G5: /finish flow state
let tutorFinishPending=null;   // {session_id, summary, candidates}

async function tutorFinishSession(){
    if(!tutorActiveSession){showNotification('需要工作台才能完成（登录+选工作台）','warning');return;}
    if(tutorFinishPending){tutorFinishShowCard();return;}
    showNotification('正在总结本次学习…','info');
    try{
        const res=await apiFetch('/api/agent/sessions/'+tutorActiveSession+'/finish',{method:'POST'});
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.detail||'HTTP '+res.status);}
        tutorFinishPending=await res.json();
        tutorFinishShowCard();
    }catch(e){showNotification('完成失败：'+e.message,'error');}
}
function tutorFinishShowCard(){
    const f=tutorFinishPending;
    if(!f)return;
    const chat=document.getElementById('tutor-chat');
    const empty=chat.querySelector('.empty-hero');if(empty)empty.remove();
    const wrap=document.createElement('div');
    wrap.className='finish-card';
    wrap.style.cssText='border:1px solid rgba(122,107,255,.3);background:rgba(122,107,255,.05);border-radius:14px;padding:14px 18px;font-size:13px;margin:4px 0;';
    let candHtml='';
    if(f.candidates&&f.candidates.length){
        candHtml='<div style="font-size:11px;color:var(--text-muted);margin:10px 0 6px;font-weight:600;">✨ 值得记住的：</div>'
            +f.candidates.map((c,i)=>
                '<label style="display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:8px;cursor:pointer;font-size:12px;color:var(--text-secondary);">'
                +'<input type="checkbox" class="finish-cand" data-kind="'+escapeHtmlTutor(c.kind||'episodic')+'" data-content="'+escapeHtmlTutor(c.content)+'" checked style="margin-top:2px;accent-color:var(--accent);flex-shrink:0;">'
                +'<span><span style="font-family:var(--font-mono);font-size:9px;color:var(--iris-400,var(--accent));">['+(c.kind||'?')+']</span> '+escapeHtmlTutor(c.content)+'</span></label>'
            ).join('');
    }
    wrap.innerHTML=
        '<div style="display:flex;align-items:center;gap:8px;font-weight:650;color:var(--iris-400,var(--accent));margin-bottom:8px;">'+iconHtml('sparkles',16)+' 本次学习总结</div>'
        +'<div style="color:var(--text-secondary);line-height:1.7;">'+escapeHtmlTutor(f.summary||'（无摘要）')+'</div>'
        +candHtml
        +'<div style="display:flex;gap:8px;margin-top:12px;">'
        +(f.candidates&&f.candidates.length?'<button class="btn-primary" style="font-size:12px;padding:6px 18px;" onclick="tutorFinishSave()">保存选中记忆</button>':'')
        +'<button class="btn-secondary" style="font-size:12px;padding:6px 14px;" onclick="tutorFinishClose()">跳过</button>'
        +'<button class="btn-secondary" style="font-size:12px;padding:6px 14px;display:inline-flex;align-items:center;gap:5px;" onclick="tutorShowMemory()">'+iconHtml('brain',12)+'数跃记得我什么</button>'
        +'</div>';
    chat.appendChild(wrap);
    chat.scrollTop=chat.scrollHeight;
    refreshIcons();
}
function tutorFinishClose(){
    document.querySelectorAll('.finish-card').forEach(c=>c.remove());
    tutorFinishPending=null;
}
async function tutorFinishSave(){
    const checked=document.querySelectorAll('.finish-cand:checked');
    const items=Array.from(checked).map(c=>({kind:c.dataset.kind,content:c.dataset.content}));
    if(!items.length){showNotification('请至少勾选一条','warning');return;}
    try{
        const res=await apiFetch('/api/agent/memory',{method:'POST',
            body:JSON.stringify({items,session_id:tutorActiveSession||''})});
        if(!res.ok)throw new Error('HTTP '+res.status);
        showNotification('已保存 '+items.length+' 条记忆','success');
        tutorFinishClose();
    }catch(e){showNotification('保存失败：'+e.message,'error');}
}
async function tutorShowMemory(){
    const overlay=document.createElement('div');
    overlay.id='tutor-memory-overlay';
    overlay.style.cssText='position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML='<div style="position:absolute;inset:0;background:rgba(8,10,18,.6);backdrop-filter:blur(6px);" onclick="this.parentElement.remove()"></div>'
        +'<div style="position:relative;width:min(480px,92vw);max-height:70vh;overflow-y:auto;padding:20px 24px;border-radius:16px;background:var(--glass-bg);backdrop-filter:blur(var(--glass-blur)) saturate(var(--glass-sat));border:1px solid var(--glass-border);box-shadow:var(--shadow-glass);font-size:13px;">'
        +'<div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650;color:var(--text-primary);margin-bottom:14px;">'+iconHtml('brain',18)+' 数跃记得我什么</div>'
        +'<div id="tutor-memory-list" style="display:flex;flex-direction:column;gap:6px;"><span style="color:var(--text-muted);padding:16px 0;text-align:center;">加载中…</span></div>'
        +'<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">'
        +'<button class="btn-secondary" style="font-size:11px;padding:5px 12px;color:#ff6b6b;border-color:rgba(255,107,107,.3);" onclick="tutorClearMemory()">清空全部</button>'
        +'<button class="btn-secondary" style="font-size:11px;padding:5px 12px;" onclick="document.getElementById(\'tutor-memory-overlay\').remove()">关闭</button>'
        +'</div></div>';
    document.body.appendChild(overlay);
    refreshIcons();
    try{
        const res=await apiFetch('/api/agent/memory');
        if(!res.ok)throw new Error('HTTP '+res.status);
        const entries=await res.json();
        const list=document.getElementById('tutor-memory-list');
        if(!list)return;
        if(!entries.length){list.innerHTML='<span style="color:var(--text-muted);padding:16px 0;text-align:center;">还没有记忆——完成一次学习对话试试</span>';return;}
        list.innerHTML=entries.map(m=>
            '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;background:var(--bg-input);font-size:12px;color:var(--text-secondary);">'
            +'<span style="font-family:var(--font-mono);font-size:9px;color:var(--iris-400,var(--accent));flex-shrink:0;margin-top:2px;">['+escapeHtmlTutor(m.kind)+']</span>'
            +'<span style="flex:1;min-width:0;">'+escapeHtmlTutor(m.content)+'</span>'
            +'<button onclick="tutorDelMemory('+m.id+')" style="color:var(--text-muted);background:none;border:none;cursor:pointer;padding:2px;" aria-label="删除">'+iconHtml('trash-2',11)+'</button>'
            +'</div>').join('');
        refreshIcons();
    }catch(e){
        const list=document.getElementById('tutor-memory-list');
        if(list)list.innerHTML='<span style="color:#ff6b6b;text-align:center;padding:12px;">加载失败：'+escapeHtmlTutor(e.message)+'</span>';
    }
}
async function tutorDelMemory(mid){
    try{
        await apiFetch('/api/agent/memory/'+mid,{method:'DELETE'});
        const overlay=document.getElementById('tutor-memory-overlay');
        if(overlay)overlay.remove();
        tutorShowMemory();
    }catch(e){showNotification('删除失败','error');}
}
async function tutorClearMemory(){
    if(!confirm('确定清空全部记忆？'))return;
    try{
        await apiFetch('/api/agent/memory',{method:'DELETE'});
        showNotification('已清空','success');
        const overlay=document.getElementById('tutor-memory-overlay');
        if(overlay)overlay.remove();
    }catch(e){showNotification('清空失败','error');}
}
// P3 G2: manual compact
async function tutorCompactSession(){
    if(!tutorActiveSession){showNotification('需要工作台','warning');return;}
    showNotification('正在整理对话…','info');
    try{
        const res=await apiFetch('/api/agent/sessions/'+tutorActiveSession+'/compact',{method:'POST'});
        if(!res.ok)throw new Error('HTTP '+res.status);
        const d=await res.json();
        if(d.compacted){
            showNotification('已压缩：移除 '+d.removed+' 条旧消息，保留最近 5 轮','success');
            await tutorSwitchSession(tutorActiveSession);
        }else{
            showNotification('对话还太短，不需要整理','info');
        }
    }catch(e){showNotification('整理失败：'+e.message,'error');}
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
    // direct-send bypass (permission retry): uses the stored question, never touches the input box
    const q=(window.__tutorDirectSend||'').trim()||inp.value.trim();
    window.__tutorDirectSend=null;
    if(!q)return;
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
    let planSteps=null;   // P4 H2: plan card steps
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

    // 技能选择（引导模式 chip 已并入技能系统——无独立全局状态）
    const curSel=tutorGetSkill();
    const effSkillSel=curSel||undefined;
    const body={session_id:tutorActiveSession||undefined,message:message,skill:effSkillSel,
        history:tutorActiveSession?undefined:tutorChatHistory.slice(0,-1),
        approved_tools:tutorApprovedTools};   // P3 E1: session write approvals
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
                else if(ev.type==='plan_step'){
                    // P4 H2: plan progress — accumulate and re-render checklist
                    if(!planSteps)planSteps=[];
                    planSteps.push({name:ev.name,summary:ev.summary,link:ev.link});
                    const planEl=statusWrap.querySelector('.plan-card');
                    if(planEl)planEl.remove();
                    const pc=document.createElement('div');
                    pc.className='plan-card';
                    pc.style.cssText='border:1px solid rgba(122,107,255,.25);background:rgba(122,107,255,.05);border-radius:10px;padding:8px 12px;margin:4px 0;';
                    pc.innerHTML='<div style="font-size:10px;font-weight:600;color:var(--iris-400,var(--accent));margin-bottom:4px;">'+iconHtml('list-checks',11)+' 执行计划</div>'
                        +planSteps.map((s,i)=>'<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);padding:2px 0;">'
                            +'<span style="color:var(--green);display:flex;">'+iconHtml('check-circle',11)+'</span>'
                            +'<span>'+escapeHtmlTutor(s.name)+'</span>'
                            +'<span style="color:var(--text-muted);font-size:10px;margin-left:auto;">'+escapeHtmlTutor((s.summary||'').slice(0,30))+'</span>'
                            +'</div>').join('');
                    statusWrap.appendChild(pc);
                    refreshIcons();
                    chat.scrollTop=chat.scrollHeight;
                }
                else if(ev.type==='permission_request'){
                    // P3 E1: modal dialog confirm (opencode style) — not an inline card
                    stLine('🔒 <b>'+escapeHtmlTutor(ev.name)+'</b> awaiting approval');
                    const pn=ev.name||'',ph=ev.hint||'',pa=ev.args||{};
                    const _savedQ=q;   // capture for re-send on approve
                    showConfirmDialog({
                        icon:'shield',
                        iconColor:'#faad14',
                        title:'AI 请求执行写操作',
                        message:pn+' — '+ph+'\n\n参数：'+JSON.stringify(pa).substring(0,150),
                        confirmText:'允许（本会话）',
                        cancelText:'拒绝',
                        confirmColor:'#faad14',
                        onConfirm:()=>tutorApproveTool(pn,_savedQ),
                    });
                }
                else if(ev.type==='actions'&&ev.items&&ev.items.length){
                    // store prefill data for jump targets
                    ev.items.forEach(a=>{
                        if(a.link&&a.data)tutorActionData[a.link]=a.data;
                    });
                    actionsHtml='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">'
                        +ev.items.map(a=>{
                            const link=a.link||'';
                            const lk=TUTOR_LINK_LABELS[link]||'';
                            const skip=link==='permission';
                            if(skip)return '';
                            return '<span onclick="tutorActionJump(\''+escapeHtmlTutor(link)+'\')" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:3px 10px;border-radius:999px;background:rgba(82,196,26,.1);color:var(--green);border:1px solid rgba(82,196,26,.25);cursor:pointer;">'+iconHtml('check',9)+' '+escapeHtmlTutor((a.text||'').slice(0,36))+(lk?' '+iconHtml('arrow-right',9)+' '+lk:'')+'</span>';
                        }).join('')+'</div>';
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
        tutorUpdateHandleLive();     // collapsed handle dot follows background streams
    }
}
function tutorSkillBadgeFor(name){
    const s=tutorSkills.find(x=>x.name===name);
    return '<div style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--iris-400,var(--accent));background:rgba(122,107,255,.1);border:1px solid rgba(122,107,255,.25);border-radius:999px;padding:1px 8px;margin-bottom:6px;">'
        +iconHtml('sparkles',10)+' '+escapeHtmlTutor(s?s.label:name)+'</div><br>';
}
// P3 E1: approve a write tool → add to session set → auto re-send the same question
// Uses a bypass variable — the input box is NEVER touched (user sees a clean box)
function tutorApproveTool(name,resendQ){
    if(!tutorApprovedTools.includes(name))tutorApprovedTools.push(name);
    showNotification('已授权 '+name+'（本会话生效），正在重试…','success');
    window.__tutorDirectSend=resendQ||'';
    tutorSend();
}
// P3 D2: action card jump with prefill data
let tutorActionData={};   // link → data payload from the tool result

function tutorActionJump(link){
    if(link==='notes'){vocabTabSwitch('notes');showPage('notes');}
    else if(link==='vocab'){vocabTabSwitch('vocab');showPage('notes');}
    else if(link==='quiz'){
        showPage('quiz');
        const d=tutorActionData['quiz'];
        if(d){
            setTimeout(()=>{
                // prefill topic (fuzzy match Chinese/English)
                const sel=document.getElementById('quiz-topic');
                if(sel&&d.topic){
                    const t=d.topic.toLowerCase();
                    const opt=[...sel.options].find(o=>
                        o.value.toLowerCase()===t||o.text.toLowerCase().includes(t)||
                        t.includes(o.value.toLowerCase()));
                    if(opt)sel.value=opt.value;
                }
                const cnt=document.getElementById('quiz-count-input');
                if(cnt&&d.count)cnt.value=d.count;
                // difficulty chips
                if(d.difficulty&&typeof quizState!=='undefined'){
                    quizState.diff=d.difficulty;
                    if(typeof quizRenderChips==='function')quizRenderChips();
                }
                // auto-start generation — user lands on the "generating" page directly
                if(typeof quizGenerate==='function'){
                    setTimeout(()=>quizGenerate(),300);
                }
            },150);
        }
    }
    else if(link==='plan'){showPage('pretest');}
    else if(link==='graph'){showPage('graph');if(typeof graphPageEnter==='function')graphPageEnter();}
    else if(link==='plotter'){
        showPage('plotter');
        const d=tutorActionData['plotter'];
        if(d&&d.expression&&typeof pf!=='undefined'&&pf.length){
            setTimeout(()=>{
                pf[0].e=d.expression;
                if(typeof plotRenderFuncList==='function')plotRenderFuncList();
                if(typeof plotRender==='function')plotRender();
            },150);
        }
    }
    else if(link==='pretest'){showPage('pretest');if(typeof ptGo==='function')ptGo(0);}
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

