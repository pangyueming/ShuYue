// ===== KNOWLEDGE GRAPH (layered tech-tree) =====
// Nodes: L1 hsKnowledge (10, rounded squares) → L2 transitionTopics (5, diamonds)
//        → L3 CURRICULUM chapters (16, circles; Analysis + Algebra tracks).
// Edges: CURRICULUM deps (L1→L3) + prev (L2→L3); dashed while the prerequisite
//        is not mastered, solid once it is.
// States are triple-encoded (ui-ux-pro-max: never color alone):
//   color + fill pattern (solid/half/hollow) + mono icon (✓ ◐ ! ○ ● ⟳).
// Evidence: pretest self-rating + AI-Quiz evidence (same thresholds as the
// study plan) + plan-state gap-task closure for chapters.
// Accessible fallback: adjacency table ("List" view) is the source of truth.

const KG_QUIZ_TOPIC={
    // keys = 中文主题/章节新名（与 pretest.js 同步）；values = 后端 quiz 主题 ID（不变）
    '函数与导数（含指数对数）':'Differentiation',
    '数列（含数学归纳法初步）':'Series_Convergence',
    '概率与统计（含排列组合）':'Probability',
    '平面向量与复数':'Linear_Algebra',
    '推理与证明基础':'Proof_Techniques',
    // L2
    '离散数学':'Discrete_Math',
    // L3（章名 → quiz 主题）
    '数列极限（ε-N 语言）':'Limits','函数极限与连续（ε-δ）':'Limits',
    '导数与微分':'Differentiation',
    '中值定理、泰勒与洛必达':'Series_Convergence',
    '不定积分':'Integration','定积分与微积分基本定理':'Integration',
    '行列式（克拉默法则）':'Linear_Algebra','矩阵（逆与初等变换）':'Linear_Algebra',
    '矩阵的秩与分块技巧':'Linear_Algebra','向量空间（基与维数）':'Linear_Algebra',
};
const KG_STYLES={
    // css: token-driven color for HTML contexts (legend/list/panel/tooltip).
    // SVG shapes/badges are themed via [data-state] CSS classes (pages.css) —
    // SVG presentation attributes cannot resolve var(), CSS properties can.
    mastered:{css:'var(--green)',lucide:'check',label:'已掌握'},
    learning:{css:'var(--yellow)',lucide:'contrast',label:'学习中'},
    weak:{css:'var(--red)',lucide:'triangle-alert',label:'弱项'},
    new:{css:'var(--text-muted)',lucide:'circle',label:'未开始'},
    covered:{css:'var(--green)',lucide:'check-check',label:'课程已覆盖'},
    current:{css:'var(--kg-amber)',lucide:'refresh-cw',label:'当前教学周'},
    upcoming:{css:'var(--text-muted)',lucide:'circle-dashed',label:'待学习'},
};

// Lucide (ISC license) inner markup on the 24x24 grid — verbatim from
// lucide-static. Rendered at 14px via translate(-7,-7) scale(0.5833).
const KG_ICONS={
    mastered:'<path d="M20 6 9 17l-5-5"/>',
    learning:'<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>',
    weak:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    new:'<circle cx="12" cy="12" r="10"/>',
    covered:'<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    current:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    upcoming:'<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
};
function kgBadge(state){
    return '<g class="kg-badge" transform="translate(-7,-7) scale(0.5833)">'+(KG_ICONS[state]||KG_ICONS.new)+'</g>';
}
function kgStyle(st){return KG_STYLES[st]||KG_STYLES.new;}

// ---------- model ----------
function kgRating(name){                      // pretest self-rating for an HS topic
    const r=window.pretestResult;if(!r||!r.knowledge)return null;
    const i=hsKnowledge.findIndex(k=>k.n===name);
    return i>=0?(r.knowledge[i]||null):null;
}
function kgL1State(name,ev){
    const rating=kgRating(name);
    let st='new';
    if(rating==='master')st='mastered';
    else if(rating==='ok')st='learning';
    else if(rating==='fuzzy')st='weak';
    else if(rating==='none')st='new';
    // quiz evidence overrides self-rating (same thresholds as the study plan)
    if(ev){
        if(ev.strongCount>=2)st='mastered';
        else if(ev.latest!==null&&ev.latest<QUIZ_WEAK_THRESHOLD)st='weak';
    }
    return st;
}
function kgL2State(name){
    const r=window.pretestResult;if(!r||!r.transition)return 'new';
    const i=transitionTopics.findIndex(t=>t.n===name);
    const v=i>=0?r.transition[i]:null;
    return v==='know'?'mastered':v==='heard'?'learning':v==='unknown'?'weak':'new';
}
function kgL3State(block,planState){
    const week=typeof getCurrentWeek==='function'?getCurrentWeek():1;
    let st=block.w[1]<week?'covered':(block.w[0]<=week?'current':'upcoming');
    // gap-task closure from the plan state: all flagged gaps closed → upgrade upcoming/current evidence
    let total=0,done=0;
    [['an','al']].flat().forEach(tr=>{
        const u=block[tr];if(!u)return;
        const gkey='w'+block.w[0]+'_'+tr;
        (u.deps||[]).concat(u.prev||[]).forEach(d=>{
            total++;
            if(planState.completed[planKey(gkey,d)]||(planState.progress[planKey(gkey,d)]||0)>=100)done++;
        });
    });
    return {st,gaps:{total,done},week};
}
function kgBuildModel(evidence,planState){
    const nodes=[],edges=[],byName={};
    // L1 — foundation (two columns)
    hsKnowledge.forEach((k,i)=>{
        const col=i%2,row=Math.floor(i/2);
        const n={id:'l1_'+i,name:k.n,layer:'foundation',shape:'rect',
            x:col===0?120:328,y:70+row*96,state:kgL1State(k.n,evidence[k.n]),ev:evidence[k.n]||null};
        nodes.push(n);byName[k.n]=n;
    });
    // L2 — bridge
    transitionTopics.forEach((t,i)=>{
        const n={id:'l2_'+i,name:t.n,layer:'bridge',shape:'diamond',desc:t.d,
            x:548,y:110+i*118,state:kgL2State(t.n),ev:null};
        nodes.push(n);byName[t.n]=n;
    });
    // L3 — curriculum dual track
    CURRICULUM.forEach(block=>{
        [['an','analysis'],['al','algebra']].forEach(([tr,layer])=>{
            const u=block[tr];
            const info=kgL3State(block,planState);
            const n={id:'l3_w'+block.w[0]+'_'+tr,name:u.n,layer,shape:'circle',weeks:block.w,
                x:layer==='analysis'?795:1045,y:78+(block.w[0]-1)*54,
                state:info.st,gaps:info.gaps};
            nodes.push(n);byName[u.n]=n;
            (u.deps||[]).forEach(d=>{if(byName[d])edges.push({from:byName[d],to:n});});
            (u.prev||[]).forEach(p=>{if(byName[p])edges.push({from:byName[p],to:n});});
        });
    });
    return {nodes,edges,byName};
}
function kgMasteryPct(node){
    const m={mastered:100,covered:100,learning:55,current:50,weak:25,new:0,upcoming:0};
    return m[node.state]!=null?m[node.state]:0;
}

// ---------- page entry ----------
let kgModel=null,kgFilter='all';
async function graphPageEnter(){
    const app=document.getElementById('kg-app'),empty=document.getElementById('kg-empty');
    const has=!!window.pretestResult;
    app.style.display=has?'':'none';
    empty.style.display=has?'none':'';
    if(!has)return;
    const evidence=await fetchQuizEvidence();
    kgModel=kgBuildModel(evidence,loadPlanState());
    kgRenderFilters();
    kgRenderLegend();
    kgRenderProgress();
    kgRenderGraph();
    kgRenderList();
    kgSetView('graph');
}
function kgRenderProgress(){
    const n=kgModel.nodes;
    const done=n.filter(x=>['mastered','covered'].includes(x.state)).length;
    const weak=n.filter(x=>x.state==='weak').length;
    const week=typeof getCurrentWeek==='function'?getCurrentWeek():1;
    document.getElementById('kg-progress').innerHTML=
        '<b>'+done+'</b>/'+n.length+' 已掌握 &middot; <span style="color:var(--red);">'+weak+' 弱项</span> &middot; 第 '+week+'/16 周';
}
const KG_FILTERS=[['all','全部'],['weak','仅弱项'],['foundation','高中基础'],['bridge','衔接断层'],['analysis','数学分析'],['algebra','高等代数']];
function kgRenderFilters(){
    const c=document.getElementById('kg-filters');
    c.innerHTML=KG_FILTERS.map(([k,l])=>
        '<button class="chip" data-f="'+k+'" aria-pressed="'+(k===kgFilter)+'" onclick="kgApplyFilter(\''+k+'\')" style="'+(k===kgFilter?'border-color:var(--accent);color:var(--accent);':'')+'">'+l+'</button>').join('');
}
function kgApplyFilter(f){
    kgFilter=f;kgRenderFilters();
    const show=n=>{
        if(f==='all')return true;
        if(f==='weak')return n.state==='weak';
        return n.layer===f;
    };
    document.querySelectorAll('#kg-svg .kg-node').forEach(g=>{g.classList.toggle('kg-hidden',!show(kgModel.byName[g.dataset.name]||{}));});
}

// ---------- legend ----------
function kgRenderLegend(){
    const sw=st=>{const s=kgStyle(st);const cls=st==='covered'||st==='current'||st==='upcoming'?'round':st==='weak'||st==='learning'?'diamond':'';
        return '<span class="kg-legend-item"><span class="kg-legend-swatch '+cls+'" style="background:'+s.css+';"></span>'+iconHtml(s.lucide,11)+' '+s.label+'</span>';};
    document.getElementById('kg-legend').innerHTML=
        sw('mastered')+sw('learning')+sw('weak')+sw('new')
        +'<span style="width:1px;height:14px;background:var(--border);"></span>'
        +sw('covered')+sw('current')+sw('upcoming')
        +'<span style="width:1px;height:14px;background:var(--border);"></span>'
        +'<span class="kg-legend-item" style="gap:4px;"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--kg-edge)" stroke-width="1.5"/></svg>prereq met</span>'
        +'<span class="kg-legend-item" style="gap:4px;"><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="var(--kg-edge)" stroke-width="1.5" stroke-dasharray="5 4"/></svg>prereq open</span>';
    if(typeof refreshIcons==='function')refreshIcons();
}

// ---------- graph view (SVG) ----------
function kgShapeSvg(n){
    // All colors are applied via [data-state] classes in pages.css (token-driven,
    // theme-aware). Markup here carries geometry only.
    let inner='';
    if(n.shape==='rect'){
        inner='<rect class="kg-shape" x="-23" y="-19" width="46" height="38" rx="9"/>';
    }else if(n.shape==='diamond'){
        inner='<rect class="kg-shape" x="-19" y="-19" width="38" height="38" rx="4" transform="rotate(45)"/>';
    }else{
        inner='<circle class="kg-shape" r="21"/>';
    }
    const ring=n.state==='weak'?'<circle class="kg-weak-ring" r="26" fill="none" stroke-width="1.5"/>':'';
    const week=n.state==='current'?'<circle class="kg-week-ring" r="27"/>':'';
    return '<circle class="kg-focus-ring" r="30" fill="none" stroke="var(--accent)" stroke-width="2.5"/>'+ring+week+inner+kgBadge(n.state);
}
function kgLabelSvg(n){
    const words=n.name.split(' ');const lines=[];let cur='';
    words.forEach(w=>{if((cur+' '+w).trim().length>17){if(cur)lines.push(cur);cur=w;}else cur=(cur?cur+' ':'')+w;});
    if(cur)lines.push(cur);
    let sub='';
    if(n.layer==='analysis'||n.layer==='algebra')sub='<text class="kg-node-sub" y="'+(14+lines.length*13)+'" text-anchor="middle">w'+n.weeks[0]+'–'+n.weeks[1]+'</text>';
    return lines.map((l,i)=>'<text class="kg-node-label" y="'+(28+i*13)+'" text-anchor="middle">'+escapeHtml(l)+'</text>').join('')+sub;
}
function kgEdgePath(e){
    const dx=e.to.x-e.from.x,dy=e.to.y-e.from.y;
    const mx=e.from.x+dx*0.5;
    return 'M'+e.from.x+' '+e.from.y+' C'+mx+' '+e.from.y+' '+mx+' '+e.to.y+' '+e.to.x+' '+e.to.y;
}
function kgRenderGraph(){
    const svg=document.getElementById('kg-svg');
    const bands=[
        ['高中基础',60,20],['衔接断层',480,20],['数学分析轨',760,20],['高等代数轨',1010,20]
    ].map(b=>'<text class="kg-band-label" x="'+b[1]+'" y="'+b[2]+'">'+b[0]+'</text>').join('');
    const edges=kgModel.edges.map((e,i)=>
        '<path id="kg-e-'+i+'" class="kg-edge'+(['mastered','covered'].includes(e.from.state)?'':' dashed')+'" d="'+kgEdgePath(e)+'"/>').join('');
    const delay={foundation:'',bridge:' d1',analysis:' d2',algebra:' d2'};
    // Double-layer <g>: the OUTER g owns the layout via the transform ATTRIBUTE;
    // the INNER g (.kg-nbody) carries the entrance animation whose CSS transform
    // would otherwise override the attribute and collapse every node to (0,0).
    const nodes=kgModel.nodes.map(n=>
        '<g id="'+n.id+'" data-name="'+escapeHtml(n.name)+'" data-state="'+n.state+'" class="kg-node" transform="translate('+n.x+','+n.y+')" tabindex="0" role="button" aria-label="'+escapeHtml(n.name)+', '+kgStyle(n.state).label+'">'
        +'<g class="kg-nbody kg-in'+delay[n.layer]+'">'+kgShapeSvg(n)+kgLabelSvg(n)+'</g></g>');
    svg.innerHTML=bands+edges+nodes.join('');
    svg.querySelectorAll('.kg-node').forEach(g=>{
        const n=kgModel.byName[g.dataset.name];if(!n)return;
        g.addEventListener('click',()=>kgOpenPanel(n));
        g.addEventListener('keydown',ev2=>{if(ev2.key==='Enter'||ev2.key===' '){ev2.preventDefault();kgOpenPanel(n);}});
        g.addEventListener('mouseenter',()=>{kgHighlight(n.id);kgTooltip(n,g);});
        g.addEventListener('mouseleave',()=>{kgUnhighlight();kgTooltip(null);});
        g.addEventListener('focus',()=>kgHighlight(n.id));
        g.addEventListener('blur',()=>kgUnhighlight());
    });
    // global keyboard: arrows walk nodes in reading order, Esc closes panel
    const wrap=document.getElementById('kg-canvas-wrap');
    wrap.removeEventListener('keydown',kgArrowNav);
    wrap.addEventListener('keydown',kgArrowNav);
    kgApplyFilter(kgFilter);
}
function kgArrowNav(e){
    const order=kgModel.nodes.map(n=>n.id);
    if(e.key==='Escape'){kgClosePanel();return;}
    if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key))return;
    const cur=document.activeElement;
    if(!cur||!cur.id||!order.includes(cur.id))return;
    e.preventDefault();
    const step=(e.key==='ArrowRight'||e.key==='ArrowDown')?1:-1;
    let i=order.indexOf(cur.id);
    do{i=(i+step+order.length)%order.length;}while(document.getElementById(order[i]).classList.contains('kg-hidden')&&i!==order.indexOf(cur.id));
    const next=document.getElementById(order[i]);if(next)next.focus();
}
// upstream/downstream highlight
function kgReach(id,dir){
    const out=new Set([id]);let grew=true;
    while(grew){grew=false;
        kgModel.edges.forEach(e=>{
            const a=(dir==='up'?e.to.id:e.from.id),b=(dir==='up'?e.from.id:e.to.id);
            if(out.has(a)&&!out.has(b)){out.add(b);grew=true;}
        });}
    return out;
}
function kgHighlight(id){
    const up=kgReach(id,'up'),down=kgReach(id,'down');
    kgModel.edges.forEach((e,i)=>{
        const el=document.getElementById('kg-e-'+i);if(!el)return;
        el.classList.remove('hl','dim');
        if(up.has(e.from.id)&&up.has(e.to.id))el.classList.add('hl');
        else el.classList.add('dim');
    });
    kgModel.nodes.forEach(n=>{
        const el=document.getElementById(n.id);if(!el)return;
        el.classList.toggle('dim',down.has(n.id)&&n.id!==id);
    });
}
function kgUnhighlight(){
    document.querySelectorAll('#kg-svg .kg-edge').forEach(el=>el.classList.remove('hl','dim'));
    document.querySelectorAll('#kg-svg .kg-node').forEach(el=>el.classList.remove('dim'));
}
function kgTooltip(n,g){
    const t=document.getElementById('kg-tooltip');
    if(!n){t.style.display='none';return;}
    const s=kgStyle(n.state);
    const ev=n.ev&&n.ev.latest!==null?Math.round(n.ev.latest*100)+'% latest quiz':'';
    t.innerHTML='<b>'+escapeHtml(n.name)+'</b><br><span style="color:'+s.css+'">'+iconHtml(s.lucide,11)+' '+s.label+'</span>'
        +(ev?'<br><span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);">'+ev+'</span>':'');
    t.style.display='block';
    const wrap=document.getElementById('kg-canvas-wrap').getBoundingClientRect();
    const r=g.getBoundingClientRect();
    t.style.left=Math.max(8,Math.min(wrap.width-250,r.left-wrap.left+r.width/2-60))+'px';
    t.style.top=(r.top-wrap.top-58)+'px';
}

// ---------- detail panel ----------
function kgClosePanel(){document.getElementById('kg-panel').style.display='none';}
function kgOpenPanel(n){
    const p=document.getElementById('kg-panel');
    const s=kgStyle(n.state);
    const layerName={foundation:'高中基础',bridge:'衔接断层',analysis:'数学分析轨',algebra:'高等代数轨'}[n.layer];
    const pct=kgMasteryPct(n);
    const prereqs=kgModel.edges.filter(e=>e.to.id===n.id).map(e=>e.from);
    const feeds=kgModel.edges.filter(e=>e.from.id===n.id).map(e=>e.to);
    const evChips=[];
    if(n.layer==='foundation'){
        const r=kgRating(n.name);
        evChips.push('自评：'+(r?{master:'精通',ok:'尚可',fuzzy:'模糊',none:'不会'}[r]||r:'—'));
        if(n.ev){if(n.ev.latest!==null)evChips.push('快测 '+Math.round(n.ev.latest*100)+'%');evChips.push('连续达标 ×'+n.ev.strongCount);}
    }else if(n.layer==='bridge'){
        evChips.push('熟悉度自评');
    }else{
        evChips.push('周次 '+n.weeks[0]+'–'+n.weeks[1]);
        if(n.gaps&&n.gaps.total)evChips.push('缺口闭合 '+n.gaps.done+'/'+n.gaps.total);
        else evChips.push('无标记缺口');
    }
    p.innerHTML=
        '<div class="kg-panel-head"><div><span class="kg-layer-chip">'+layerName+'</span>'
        +'<div class="kg-panel-title">'+escapeHtml(n.name)+'</div></div>'
        +'<button class="kg-panel-close" onclick="kgClosePanel()" aria-label="关闭详情">✕</button></div>'
        +'<div><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:6px;"><span style="color:'+s.css+';display:inline-flex;align-items:center;gap:5px;">'+iconHtml(s.lucide,11)+s.label+'</span><span class="mono" style="font-family:var(--font-mono)">'+pct+'%</span></div>'
        +'<div class="kg-mastery-bar"><div class="kg-mastery-fill" style="width:'+pct+'%;background:'+s.css+';"></div></div></div>'
        +'<div class="kg-evidence">'+evChips.map(c=>'<span class="kg-evidence-chip">'+escapeHtml(c)+'</span>').join('')+'</div>'
        +(n.desc?'<div style="font-size:12px;color:var(--text-muted);line-height:1.6;">'+escapeHtml(n.desc)+'</div>':'')
        +(prereqs.length?'<div><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">前置知识</div>'
            +prereqs.map(pr=>'<div class="kg-prereq-row" onclick="kgOpenPanelById(\''+pr.id+'\')" role="button" tabindex="0"><span class="kg-dot" style="background:'+kgStyle(pr.state).css+';"></span>'+escapeHtml(pr.name)+'<span style="margin-left:auto;font-size:10px;color:var(--text-muted);">'+kgStyle(pr.state).label+'</span></div>').join('')+'</div>':'')
        +(feeds.length?'<div><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">衔接去向</div>'
            +'<div style="font-size:12px;color:var(--text-secondary);line-height:1.8;">'+feeds.map(f=>escapeHtml(f.name)).join(' · ')+'</div></div>':'')
        +'<div class="kg-panel-actions">'
        +'<button class="btn-primary" style="padding:9px;font-size:13px;" onclick="kgQuizTopic(\''+n.id+'\')">本主题出题</button>'
        +'<button class="btn-secondary" style="padding:9px;font-size:13px;" onclick="kgFindInTextbook(\''+n.id+'\')">在教材中定位</button>'
        +'</div>';
    p.style.display='flex';
    p.setAttribute('tabindex','-1');
    p.onkeydown=ev=>{if(ev.key==='Escape')kgClosePanel();};
    try{p.focus({preventScroll:true});}catch(e){}
    if(typeof refreshIcons==='function')refreshIcons();
}
function kgOpenPanelById(id){const n=kgModel.nodes.find(x=>x.id===id);if(n)kgOpenPanel(n);}

// ---------- actions ----------
function kgQuizTopic(id){
    const n=kgModel.nodes.find(x=>x.id===id);if(!n)return;
    showPage('quiz');
    const topic=KG_QUIZ_TOPIC[n.name];
    const sel=document.getElementById('quiz-topic');
    if(topic&&sel){
        const opt=[...sel.options].find(o=>o.value===topic);
        if(opt)sel.value=topic;
    }
    showNotification(topic?('已预选主题：'+((typeof TOPIC_ZH!=='undefined'&&TOPIC_ZH[topic])||topic.replace(/_/g,' '))):'选择主题后生成','success');
}
async function kgFindInTextbook(id){
    const n=kgModel.nodes.find(x=>x.id===id);if(!n)return;
    if(!localStorage.getItem('cb_cn_token')){showNotification('Log in to search your indexed textbooks','warning');return;}
    showNotification('Searching your textbooks…');
    const hits=await textbookAnchorSearch(n.name);
    if(hits&&hits.length){
        window.tbAnchorHits=hits;
        showNotification(hits.length+' textbook match'+(hits.length>1?'es':'')+' found','success');
        openTbPeek(0);
    }else{
        showNotification('No indexed textbook match for “'+n.name+'”','warning');
    }
}

// ---------- list view (a11y source of truth) ----------
function kgListStatus(n){
    const s=kgStyle(n.state);
    return '<span class="kg-status" style="color:'+s.css+'">'+iconHtml(s.lucide,11)+' '+s.label+'</span>';
}
function kgRenderList(){
    const sec=(title,layer)=>{
        const rows=kgModel.nodes.filter(n=>n.layer===layer).map(n=>{
            const prereqs=kgModel.edges.filter(e=>e.to.id===n.id).map(e=>e.from.name);
            const ev=n.layer==='foundation'&&n.ev&&n.ev.latest!==null?('<span class="mono">'+Math.round(n.ev.latest*100)+'%</span>')
                :(n.layer!=='foundation'&&n.gaps&&n.gaps.total?('<span class="mono">'+n.gaps.done+'/'+n.gaps.total+'</span>'):'—');
            return '<tr tabindex="0"><td style="color:var(--text-primary);font-weight:500;">'+escapeHtml(n.name)+'</td>'
                +'<td class="mono">'+(n.weeks?('w'+n.weeks[0]+'–'+n.weeks[1]):'—')+'</td>'
                +'<td>'+(prereqs.length?prereqs.map(escapeHtml).join(', '):'—')+'</td>'
                +'<td>'+kgListStatus(n)+'</td><td>'+ev+'</td></tr>';
        }).join('');
        return '<div class="kg-sec-label">'+title+'</div><table class="kg-table"><thead><tr>'
            +'<th>主题</th><th>周次</th><th>前置</th><th>状态</th><th>证据</th>'
            +'</tr></thead><tbody>'+rows+'</tbody></table>';
    };
    document.getElementById('kg-list-view').innerHTML=
        sec('高中基础（新高考课标）','foundation')+sec('衔接断层预警','bridge')
        +sec('数学分析轨','analysis')+sec('高等代数轨','algebra');
    if(typeof refreshIcons==='function')refreshIcons();
}
function kgSetView(v){
    document.getElementById('kg-canvas-wrap').style.display=v==='graph'?'':'none';
    document.getElementById('kg-list-view').style.display=v==='list'?'':'none';
    document.getElementById('kg-btn-graph').classList.toggle('active',v==='graph');
    document.getElementById('kg-btn-list').classList.toggle('active',v==='list');
    if(v!=='graph')kgClosePanel();
}
