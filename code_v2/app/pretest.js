// ===== PRE-ASSESSMENT（中国赛道：高考 → 中外合办大学数学衔接）=====
// 高中知识清单（新高考课标 10 项；命名兼顾 CURRICULUM deps 与 QUIZ_TOPIC_TO_HS 联动）
const hsKnowledge=[
    {n:'函数与导数（含指数对数）'},{n:'三角函数与解三角形'},{n:'数列（含数学归纳法初步）'},
    {n:'立体几何'},{n:'解析几何（圆锥曲线）'},{n:'概率与统计（含排列组合）'},
    {n:'平面向量与复数'},{n:'集合与常用逻辑'},{n:'不等式（含二次不等式）'},{n:'推理与证明基础'}
];
// 衔接断层预警（中外合办 6 项：数学断层 + 语言断层）
const transitionTopics=[
    {n:'ε-δ 极限语言',d:'大学数学分析第一课，高考不考证明，冲击最大'},
    {n:'线性代数抽象化',d:'从「解方程组」到「向量空间与线性映射」的范式跃迁'},
    {n:'证明范式（归纳/反证/构造）',d:'大学级系统化证明训练，高中仅浅尝'},
    {n:'离散数学',d:'计算机方向必修，高中完全空白'},
    {n:'集合论与数理逻辑',d:'大学的严谨化视角，高考只触及皮毛'},
    {n:'全英文授课适应',d:'英文教材·英文试卷·英文课堂——中外合办独有断层'}
];

// ===== 课程对齐型学习计划（16 周双轨）=====
// 教材：《工科数学分析基础（上册）》+ 北大版《高等代数》。中文赛道：章名中文化，
// deps/prev 指向上方新主题名（改主题名必须同步这里，否则依赖悬空）。
const CURRICULUM=[
    {w:[1,2],  an:{n:'实数与函数（确界原理）',deps:['函数与导数（含指数对数）','不等式（含二次不等式）'],prev:['集合论与数理逻辑']},
               al:{n:'多项式（带余除法与因式定理）',deps:['不等式（含二次不等式）','函数与导数（含指数对数）'],prev:[]}},
    {w:[3,4],  an:{n:'数列极限（ε-N 语言）',deps:['数列（含数学归纳法初步）'],prev:['集合论与数理逻辑','证明范式（归纳/反证/构造）']},
               al:{n:'行列式（克拉默法则）',deps:['不等式（含二次不等式）'],prev:[]}},
    {w:[5,6],  an:{n:'函数极限与连续（ε-δ）',deps:['三角函数与解三角形','函数与导数（含指数对数）'],prev:['证明范式（归纳/反证/构造）']},
               al:{n:'线性方程组（消元法与秩）',deps:['平面向量与复数'],prev:[]}},
    {w:[7,8],  an:{n:'导数与微分',deps:['函数与导数（含指数对数）','三角函数与解三角形'],prev:[]},
               al:{n:'矩阵（逆与初等变换）',deps:['平面向量与复数'],prev:[]}},
    {w:[9,10], an:{n:'中值定理、泰勒与洛必达',deps:['函数与导数（含指数对数）','数列（含数学归纳法初步）'],prev:[]},
               al:{n:'矩阵的秩与分块技巧',deps:['平面向量与复数'],prev:[]}},
    {w:[11,12],an:{n:'不定积分',deps:['函数与导数（含指数对数）','三角函数与解三角形'],prev:[]},
               al:{n:'二次型（标准形与正定性）',deps:['平面向量与复数','函数与导数（含指数对数）'],prev:[]}},
    {w:[13,14],an:{n:'定积分与微积分基本定理',deps:['函数与导数（含指数对数）','数列（含数学归纳法初步）'],prev:[]},
               al:{n:'向量空间（基与维数）',deps:['平面向量与复数','函数与导数（含指数对数）'],prev:[]}},
    {w:[15,16],an:{n:'积分应用与总复习',deps:[],prev:[]},
               al:{n:'期末总复习',deps:[],prev:[]}},
];
// AI Quiz 主题（后端英文词表）→ 高中知识新名映射（证据闭环联动）
const QUIZ_TOPIC_TO_HS={
    'Differentiation':'函数与导数（含指数对数）',
    'Integration':'函数与导数（含指数对数）',
    'Probability':'概率与统计（含排列组合）',
    'Series_Convergence':'数列（含数学归纳法初步）',
    'Linear_Algebra':'平面向量与复数',
    'Vector_Calculus':'平面向量与复数',
    'Proof_Techniques':'推理与证明基础'
};
const QUIZ_WEAK_THRESHOLD=0.5, QUIZ_STRONG_THRESHOLD=0.9;

let _quizEvCache=null,_quizEvTs=0;
async function fetchQuizEvidence(){
    const token=localStorage.getItem('cb_token');
    if(!token)return {};
    const now=Date.now();
    if(_quizEvCache&&now-_quizEvTs<60000)return _quizEvCache;   // 60s cache
    const ev={};
    try{
        const res=await apiFetch('/api/quiz/history');
        if(!res.ok)throw new Error('HTTP '+res.status);
        (await res.json()).forEach(r=>{
            const hs=QUIZ_TOPIC_TO_HS[r.topic];
            if(!hs)return;
            if(!ev[hs])ev[hs]={latest:null,strongCount:0};
            const ratio=r.total>0?r.score/r.total:0;
            if(ev[hs].latest===null)ev[hs].latest=ratio;      // first row = most recent
            if(ratio>=QUIZ_STRONG_THRESHOLD)ev[hs].strongCount++;
        });
        _quizEvCache=ev;_quizEvTs=now;
    }catch(e){/* offline: no evidence */}
    return ev;
}
const quizQs=[
    // 双语策略：题干用英文（中外合办考试语言），k 字段为中文知识点归属
    {q:'Evaluate: lim(x→0) sin(x)/x = ?',opts:['0','1','Does not exist','∞'],ans:1,k:'极限（重要极限）',diff:'Basic'},
    {q:'Evaluate: ∫ 2x dx = ?',opts:['x² + C','2x² + C','x²/2 + C','2 + C'],ans:0,k:'积分基础',diff:'Basic'},
    {q:'Which is a valid proof method?',opts:['Verification by examples','Proof by contradiction','Intuition','Computer verification'],ans:1,k:'证明方法',diff:'Basic'},
    {q:'Arithmetic sequence a₁=3, d=2, find a₁₀',opts:['21','23','20','25'],ans:0,k:'数列',diff:'Basic'},
    {q:'3 red 2 blue balls, P(both red) without replacement',opts:['3/10','6/25','9/25','1/2'],ans:0,k:'概率',diff:'Basic'},
    {q:'Geometric series a₁=2, r=1/2, S(∞) = ?',opts:['2','4','∞','1'],ans:1,k:'级数收敛',diff:'Intermediate'},
    {q:'X~N(μ,σ²), P(|X-μ|<σ) ≈ ?',opts:['≈68%','≈95%','≈50%','≈99.7%'],ans:0,k:'正态分布',diff:'Intermediate'},
    {q:'Does Σ1/n² converge? Sum = ?',opts:['Diverges','Converges, π²/6≈1.645','Converges ≈1','Cannot determine'],ans:1,k:'收敛判别法',diff:'Hard'},
    {q:'Evaluate: lim(x→∞)(1+1/x)^x = ?',opts:['1','0','e≈2.718','∞'],ans:2,k:'重要极限 (e)',diff:'Hard'},
    {q:'Evaluate: ∫₀¹ x·e^x dx = ?',opts:['1','e-1','e','0'],ans:0,k:'分部积分',diff:'Hard'},
];
let ptState={knowledge:{},transition:{},quiz:[]};
function ptGo(s){['pt-welcome','pt-step1','pt-step2','pt-step3','pt-step4','pt-report'].forEach(id=>document.getElementById(id).style.display='none');
    if(s===0)document.getElementById('pt-welcome').style.display='';
    else if(s===1){document.getElementById('pt-step1').style.display='';const ws=document.getElementById('pt-week');fillWeekSelect(ws);if(ws)ws.value=getCurrentWeek();}
    else if(s===2){document.getElementById('pt-step2').style.display='';ptRenderKnowledge();}
    else if(s===3){document.getElementById('pt-step3').style.display='';ptRenderTransition();}
    else if(s===4){document.getElementById('pt-step4').style.display='';ptRenderQuiz();}
}
function ptRenderKnowledge(){const c=document.getElementById('pt-knowledge-list');if(c.children.length>0)return;const lv=[{v:'master',l:'精通',c:'#52c41a'},{v:'ok',l:'尚可',c:'#4C8DFF'},{v:'fuzzy',l:'模糊',c:'#faad14'},{v:'none',l:'不会',c:'#E5484D'}];
    hsKnowledge.forEach((kp,i)=>{const d=document.createElement('div');d.className='card';d.style.padding='12px';d.innerHTML=`<div style="margin-bottom:8px;font-size:14px;font-weight:500;">${kp.n}</div><div style="display:flex;gap:6px;">${lv.map(l=>`<button onclick="ptSetK(${i},'${l.v}',this)" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--border);font-size:12px;color:var(--text-secondary);background:transparent;cursor:pointer;">${l.l}</button>`).join('')}</div>`;c.appendChild(d);});}
function ptSetK(i,v,btn){ptState.knowledge[i]=v;btn.parentElement.querySelectorAll('button').forEach(b=>{b.style.background='transparent';b.style.borderColor='var(--border)';b.style.color='var(--text-secondary)';});const cs={master:'#52c41a',ok:'#4C8DFF',fuzzy:'#faad14',none:'#E5484D'};btn.style.background=cs[v]+'20';btn.style.borderColor=cs[v];btn.style.color=cs[v];}
function ptRenderTransition(){const c=document.getElementById('pt-transition-list');if(c.children.length>0)return;const lv=[{v:'know',l:'熟悉',c:'#52c41a'},{v:'heard',l:'听说过',c:'#faad14'},{v:'unknown',l:'没学过',c:'#E5484D'}];
    transitionTopics.forEach((t,i)=>{const d=document.createElement('div');d.className='card';d.style.padding='12px';d.innerHTML=`<div style="margin-bottom:4px;font-size:14px;font-weight:500;">${t.n}</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${t.d}</div><div style="display:flex;gap:6px;">${lv.map(l=>`<button onclick="ptSetT(${i},'${l.v}',this)" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--border);font-size:12px;color:var(--text-secondary);background:transparent;cursor:pointer;">${l.l}</button>`).join('')}</div>`;c.appendChild(d);});}
function ptSetT(i,v,btn){ptState.transition[i]=v;btn.parentElement.querySelectorAll('button').forEach(b=>{b.style.background='transparent';b.style.borderColor='var(--border)';b.style.color='var(--text-secondary)';});const cs={know:'#52c41a',heard:'#faad14',unknown:'#E5484D'};btn.style.background=cs[v]+'20';btn.style.borderColor=cs[v];btn.style.color=cs[v];}
function ptRenderQuiz(){const c=document.getElementById('pt-quiz-list');if(c.children.length>0)return;
    quizQs.forEach((q,qi)=>{const d=document.createElement('div');d.className='card';const dl={Basic:'基础',Intermediate:'进阶',Hard:'挑战'};const dc=q.diff==='Hard'?'#E5484D':q.diff==='Intermediate'?'#faad14':'#52c41a';const db=q.diff==='Hard'?'rgba(245,34,45,.08)':q.diff==='Intermediate'?'rgba(250,173,20,.08)':'rgba(82,196,26,.08)';
        d.innerHTML=`<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="font-size:12px;color:var(--accent);">Q${qi+1} · ${q.k}</span><span style="font-size:11px;padding:2px 8px;border-radius:999px;background:${db};color:${dc};">${dl[q.diff]||q.diff}</span></div><p style="font-size:14px;font-weight:500;margin-bottom:12px;">${q.q}</p><div id="pt-q-${qi}">${q.opts.map((o,oi)=>`<label onclick="ptSelectAns(${qi},${oi})" style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;cursor:pointer;color:var(--text-secondary);"><input type="radio" name="ptq${qi}" value="${oi}" style="accent-color:var(--accent);"><span style="font-size:13px;">${o}</span></label>`).join('')}</div><div id="pt-exp-${qi}" style="display:none;margin-top:12px;padding:12px;border-radius:6px;font-size:12px;background:var(--bg-tag);"></div>`;c.appendChild(d);});}
function ptSelectAns(qi,oi){ptState.quiz[qi]=oi;const q=quizQs[qi];document.querySelectorAll('#pt-q-'+qi+' label').forEach((el,i)=>{el.style.background='transparent';if(i===q.ans)el.style.background='rgba(82,196,26,.1)';if(i===oi&&oi!==q.ans)el.style.background='rgba(245,34,45,.1)';});const e=document.getElementById('pt-exp-'+qi);e.style.display='';        e.innerHTML=`${oi===q.ans?'Correct!':'Not quite.'} Correct answer: ${q.opts[q.ans]}`;e.style.color=oi===q.ans?'#52c41a':'#E5484D';}
function ptGenerateReport(){
    const al=document.getElementById('pt-alevel').value||'120-139';
    const majorSelect=document.getElementById('pt-major');
    const majorLabel=majorSelect?majorSelect.options[majorSelect.selectedIndex].text:'计算机类';
    const weekSel=document.getElementById('pt-week');
    const pickedWeek=weekSel?parseInt(weekSel.value)||1:getCurrentWeek();
    const ks={master:100,ok:75,fuzzy:40,none:0};let ts=0,cnt=0,weak=[],ok2=[],strong=[];
    hsKnowledge.forEach((kp,i)=>{const v=ptState.knowledge[i];if(v){ts+=ks[v];cnt++;}if(v==='none'||v==='fuzzy')weak.push(kp.n);else if(v==='ok')ok2.push(kp.n);else if(v==='master')strong.push(kp.n);});
    const avg=cnt>0?Math.round(ts/cnt):0;let danger=[],warn=[];
    transitionTopics.forEach((t,i)=>{const v=ptState.transition[i];if(v==='unknown')danger.push(t);else if(v==='heard')warn.push(t);});
    let qc=0;ptState.quiz.forEach((a,i)=>{if(a===quizQs[i].ans)qc++;});
    document.getElementById('pt-report-content').innerHTML=`
        <div class="card" style="display:flex;align-items:center;gap:16px;"><div style="width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--accent);">${iconHtml('graduation-cap',24)}</div><div><div style="font-size:14px;font-weight:500;">北京邮电大学（中外合办） · ${majorLabel}</div><div style="font-size:12px;color:var(--text-muted);">高考数学：${al} · 大一 · 教学周 ${pickedWeek}</div></div></div>
        <div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="font-size:14px;font-weight:500;">高中知识掌握度</span><span style="font-size:24px;font-weight:700;color:${avg>=70?'#52c41a':avg>=40?'#faad14':'#E5484D'};">${avg}%</span></div><div class="progress-bar"><div style="background:${avg>=70?'#52c41a':avg>=40?'#faad14':'#E5484D'};height:4px;border-radius:2px;width:${avg}%;"></div></div>${strong.length?`<div style="font-size:12px;margin-top:8px;"><span style="color:#52c41a">已精通：</span> ${strong.join('、')}</div>`:''}${weak.length?`<div style="font-size:12px;"><span style="color:#E5484D">待加强：</span> ${weak.join('、')}</div>`:''}</div>
        <div class="card"><div style="font-size:14px;font-weight:500;margin-bottom:12px;">衔接断层预警（${majorLabel}）</div>${danger.map(t=>`<div style="display:flex;gap:8px;margin-bottom:8px;padding:8px;border-radius:6px;background:rgba(245,34,45,.06);"><span style="color:#E5484D">•</span><div><div style="font-size:13px;font-weight:500;">${t.n}</div><div style="font-size:11px;color:var(--text-muted)">${t.d}</div></div></div>`).join('')}${warn.map(t=>`<div style="display:flex;gap:8px;margin-bottom:8px;padding:8px;border-radius:6px;background:rgba(250,173,20,.06);"><span style="color:#faad14">•</span><div><div style="font-size:13px;font-weight:500;">${t.n}</div><div style="font-size:11px;color:var(--text-muted)">${t.d}</div></div></div>`).join('')}</div>
        <div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="font-size:14px;font-weight:500;">快测结果</span><span style="font-size:14px;font-weight:700;color:${qc>=7?'#52c41a':qc>=4?'#faad14':'#E5484D'};">答对 ${qc}/10</span></div></div>
        <div class="card" style="background:rgba(76,141,255,.06);border-color:rgba(76,141,255,.2);"><div style="font-size:14px;font-weight:500;color:var(--accent);margin-bottom:12px;">推荐补强路径</div>${danger.length?`<div style="font-size:13px;margin-bottom:8px;"><span style="color:#E5484D;font-weight:700;">1.</span> 优先预习：<strong>${danger[0].n}</strong></div>`:''}${weak.length?`<div style="font-size:13px;margin-bottom:8px;"><span style="color:#faad14;font-weight:700;">2.</span> 补齐高中：<strong>${weak[0]}</strong></div>`:''}</div>`;
    ptGo(5);document.getElementById('pt-report').style.display='';
    refreshIcons();

    // Store pre-assessment results globally (majorLabel/pickedWeek hoisted above)
    window.pretestResult={
        alevel:al,major:majorLabel,knowledge:ptState.knowledge,transition:ptState.transition,
        quizCorrect:qc,quizTotal:10,avgScore:avg,
        weakTopics:weak,strongTopics:strong,
        dangerTopics:danger,warningTopics:warn,
        currentWeek:pickedWeek,
        completedAt:new Date().toISOString(),
    };
    // Persist the teaching week into plan state too (cloud-synced)
    const ps=loadPlanState();ps.currentWeek=pickedWeek;savePlanState(ps);
    // Persist to localStorage
    try{localStorage.setItem('cb_pretest',JSON.stringify(window.pretestResult));}catch(e){}
    // Save to backend (if logged in)
    const token=localStorage.getItem('cb_token');
    if(token){
        apiFetch('/api/assessments',{
            method:'POST',
            body:JSON.stringify({
                alevel:al,
                major:majorLabel,
                knowledge_json:JSON.stringify(ptState.knowledge),
                transition_json:JSON.stringify(ptState.transition),
                quiz_correct:qc,
                quiz_total:10,
                avg_score:avg,
                weak_topics:weak.join(','),
                strong_topics:strong.join(','),
                danger_topics:danger.map(t=>t.n).join(','),
                result_json:JSON.stringify(window.pretestResult),   // full snapshot for zero-loss restore
            })
        }).then(r=>{if(r.ok)showNotification('Assessment saved to cloud','success');})
        .catch(e=>console.error('Failed to save assessment:',e));
    }
    // Auto-navigate to dashboard after 3 seconds and render
    setTimeout(async ()=>{
        showPage('dashboard');
        renderMathSkill(window.pretestResult);
        renderStudyPlan(window.pretestResult);
        await loadUserStats();
        animateCountUp();
    },3000);
}

// ===== MATH SKILL BREAKDOWN =====
// Sorted bars: needs-attention (<75) first, direct mono value labels,
// transition warnings as colour-dotted chips. Pure CSS — no chart lib.
function renderMathSkill(result){
    const ph=document.getElementById('math-skill-placeholder');
    const ct=document.getElementById('math-skill-content');
    if(!ph||!ct)return;
    ph.style.display='none';ct.style.display='block';
    const ks={master:100,ok:75,fuzzy:40,none:0};
    const cl={master:'var(--green)',ok:'var(--iris-400)',fuzzy:'var(--orange)',none:'var(--red)'};
    const rows=hsKnowledge.map((kp,i)=>{
        const lv=result.knowledge[i]||'none';
        return{n:kp.n,score:ks[lv],c:cl[lv]};
    }).sort((a,b)=>a.score-b.score);
    const weak=rows.filter(r=>r.score<75),solid=rows.filter(r=>r.score>=75);
    const bar=r=>'<div class="skill-row"><span class="skill-name">'+escapeHtml(r.n)+'</span><div class="skill-bar"><i style="width:'+r.score+'%;background:'+r.c+';"></i></div><span class="skill-val" style="color:'+r.c+';">'+r.score+'%</span></div>';
    let html='';
    if(weak.length)html+='<div class="skill-group-label">Needs attention · '+weak.length+'</div>'+weak.map(bar).join('');
    if(solid.length)html+='<div class="skill-group-label">Solid · '+solid.length+'</div>'+solid.map(bar).join('');
    const chips=[];
    (result.dangerTopics||[]).forEach(t=>chips.push({n:t.n,c:'var(--red)'}));
    (result.warningTopics||[]).forEach(t=>chips.push({n:t.n,c:'var(--yellow)'}));
    if(chips.length){
        html+='<div class="skill-chip-row">'+chips.map(c=>'<span class="skill-chip"><span class="skill-dot" style="background:'+c.c+';"></span>'+escapeHtml(c.n)+'</span>').join('')+'</div>';
    }
    html+='<div class="skill-footer"><span>Overall: '+result.avgScore+'%</span><span>Quiz: '+result.quizCorrect+'/10</span></div>';
    ct.innerHTML=html;
}

// ===== STUDY PLAN =====
function renderStudyPlan(result){
    const ph=document.getElementById('study-plan-placeholder');
    const ct=document.getElementById('study-plan-content');
    if(!ph||!ct)return;
    ph.style.display='none';ct.style.display='block';
    renderStudyPlanAsync(result).then(()=>{if(window.lucide)lucide.createIcons();});
    // Dashboard "This Week" summary stays in step with every plan mutation
    if(typeof renderPlanFocus==='function')renderPlanFocus();
}

// Shared collector: walks CURRICULUM from the current teaching week and stamps
// every task with progress/completed/order state. Consumed by BOTH the full
// 16-week renderer and the dashboard focus card — one source of truth.
async function collectPlanTasks(result){
    const ks={master:100,ok:75,fuzzy:40,none:0};
    const kIdx={};hsKnowledge.forEach((kp,i)=>kIdx[kp.n]=i);
    const rating=n=>{const i=kIdx[n];return i===undefined?'master':(result.knowledge[i]||'none');};
    let planState=loadPlanState();
    planState.completed=planState.completed||{};
    planState.deleted=planState.deleted||{};
    planState.order=planState.order||{};
    const week=Math.min(16,Math.max(1,parseInt(planState.currentWeek||result.currentWeek||1)||1));
    const evidence=await fetchQuizEvidence();
    const groups=[];let totalTasks=0,doneTasks=0;
    CURRICULUM.forEach(block=>{
        if(block.w[1]<week)return;   // finished block — skip
        const ongoing=block.w[0]<=week&&block.w[1]>=week;
        const until=block.w[0]-week;
        const tracks=[];
        [['an','sigma','245,34,45'],['al','hash','250,173,20']].forEach(([tr,icon,rgb])=>{
            const u=block[tr];
            const gkey='w'+block.w[0]+'_'+tr;
            const tasks=[];
            // Gap-fill tasks from HS dependencies
            (u.deps||[]).forEach(d=>{
                const r=rating(d);
                const ev=evidence[d];
                if(ev&&ev.strongCount>=2)return;   // quiz-verified mastery — exempt even weak self-ratings
                if(r==='none'||r==='fuzzy'){
                    tasks.push({name:d,score:ks[r],target:75,
                        desc:(ev&&ev.latest!==null&&ev.latest<QUIZ_WEAK_THRESHOLD)?('快测 '+Math.round(ev.latest*100)+'%'):'开课前补齐'});
                }else if(ev&&ev.latest!==null&&ev.latest<QUIZ_WEAK_THRESHOLD){
                    tasks.push({name:d,score:ks[r],target:90,desc:'快测 '+Math.round(ev.latest*100)+'% · 与自评对照'});
                }
            });
            // Preview tasks from transition warnings mapped to this block
            (u.prev||[]).forEach(p=>{
                const ti=transitionTopics.findIndex(t=>t.n===p);
                const tr2=result.transition&&result.transition[ti];
                if(tr2==='unknown'||tr2==='heard'||tr2===undefined){
                    tasks.push({name:p,score:0,target:60,desc:'开课前预习'});
                }
            });
            const items=tasks.map(item=>({item,key:planKey(gkey,item.name)})).filter(x=>!planState.deleted[x.key]);
            if(!items.length)return;
            const order=planState.order[gkey]||[];
            if(order.length)items.sort((a,b)=>{
                const ia=order.indexOf(a.key),ib=order.indexOf(b.key);
                return (ia===-1?999:ia)-(ib===-1?999:ib);
            });
            items.forEach(x=>{
                const prog=planState.progress[x.key]||0;
                x.prog=prog;
                x.completed=!!planState.completed[x.key]||prog>=100;
                totalTasks++;if(x.completed)doneTasks++;
            });
            tracks.push({tr,icon,rgb,u,items,gkey});
        });
        if(tracks.length)groups.push({block,ongoing,until,tracks});
    });
    return{week,groups,totalTasks,doneTasks};
}

async function renderStudyPlanAsync(result){
    const ct=document.getElementById('study-plan-content');
    if(!ct)return;
    const data=await collectPlanTasks(result);
    const week=data.week;
    let html=`<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">课程对齐衔接计划 · 教学周 <strong style="color:var(--text-primary);">${week}</strong>/16 <span style="font-size:10px;">（在个人资料或前测中修改）</span></div>`;

    data.groups.forEach(g=>{
        const status=g.ongoing?'<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(82,196,26,.12);color:#52c41a;font-weight:600;">Now</span>'
            :(g.until<=2?`<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(250,173,20,.12);color:#faad14;font-weight:600;">in ${g.until}w</span>`:'');
        html+=`<div style="display:flex;align-items:center;gap:8px;margin:18px 0 8px;"><span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--text-primary);">${iconHtml('calendar',13)}Week ${g.block.w[0]}–${g.block.w[1]}</span>${status}</div>`;
        g.tracks.forEach(t=>{
            html+=`<div style="margin-bottom:8px;"><div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${iconHtml(t.icon,13)}${t.u.n}</div><div class="plan-group" data-group="${t.gkey}">`;
            t.items.forEach(x=>{
                html+=renderPlanCard(x.key,x.item,x.prog,t.tr==='an'?'#E5484D':'#faad14',t.tr==='al',x.completed);
            });
            html+='</div></div>';
        });
    });

    if(data.totalTasks===0){
        html+='<div class="placeholder-box" style="min-height:120px;">前方无缺口——你的前置知识已覆盖！<br><span style="font-size:12px;">完成 AI 快测可持续为计划提供证据</span></div>';
    }else{
        html+=`<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;"><span style="color:var(--text-muted);">学期任务：${data.totalTasks}</span><span style="color:var(--text-secondary);">已完成： ${data.doneTasks}/${data.totalTasks}</span></div><div class="progress-bar"><div style="background:linear-gradient(90deg,#E5484D,#faad14,#52c41a);height:5px;border-radius:3px;width:${Math.round(data.doneTasks/data.totalTasks*100)}%;transition:width .3s;"></div></div></div>`;
    }
    ct.innerHTML=html;
}

// ===== Dashboard "This Week" focus card =====
// Current (or next) curriculum block only: Now/in-Xw chip, done/total progress
// and the first 3 open tasks. Checkboxes reuse .plan-check so the existing
// cloud-synced toggle pipeline drives them unchanged.
function renderPlanFocus(){
    const body=document.getElementById('dash-plan-body');
    const chip=document.getElementById('dash-plan-chip');
    if(!body)return;
    const result=window.pretestResult;
    if(!result||result.avgScore===undefined){
        if(chip)chip.style.display='none';
        body.innerHTML='<div class="activity-empty"><div class="empty-disc"><i data-lucide="route"></i></div><div class="empty-title">No assessment yet</div><div class="empty-sub">Take the 3-min diagnostic to unlock your weekly focus</div><button class="btn-primary" style="margin-top:12px;font-size:12px;padding:6px 16px;" onclick="showPage(\'pretest\')">Start Assessment</button></div>';
        refreshIcons();
        return;
    }
    renderPlanFocusAsync(result).then(()=>{if(window.lucide)lucide.createIcons();});
}
async function renderPlanFocusAsync(result){
    const body=document.getElementById('dash-plan-body');
    const chip=document.getElementById('dash-plan-chip');
    if(!body)return;
    const data=await collectPlanTasks(result);
    const g=data.groups.find(x=>x.ongoing)||data.groups[0];
    if(!g){
        if(chip)chip.style.display='none';
        body.innerHTML='<div class="activity-empty"><div class="empty-disc"><i data-lucide="circle-check"></i></div><div class="empty-title">No gaps ahead</div><div class="empty-sub">Your prerequisites are covered — keep feeding quiz evidence</div></div>';
        refreshIcons();
        return;
    }
    if(chip){
        chip.style.display='';
        if(g.ongoing){chip.textContent='Now';chip.style.cssText='background:rgba(82,196,26,.12);color:#52c41a;';}
        else{chip.textContent='in '+g.until+'w';chip.style.cssText='background:rgba(250,173,20,.12);color:#faad14;';}
    }
    const rows=[];
    g.tracks.forEach(t=>t.items.forEach(x=>rows.push({x:x,color:t.tr==='an'?'#E5484D':'#faad14'})));
    const open=rows.filter(r=>!r.x.completed).slice(0,3);
    const done=rows.filter(r=>r.x.completed).length;
    const total=rows.length;
    let html=`<div class="focus-summary"><span style="flex-shrink:0;">Week ${g.block.w[0]}–${g.block.w[1]}</span><div class="focus-progress"><i style="width:${total?Math.round(done/total*100):0}%"></i></div><span class="focus-count">${done}/${total}</span></div>`;
    if(!open.length){
        html+=`<div class="focus-row" style="justify-content:center;border-left:3px solid var(--green);"><span class="focus-name" style="display:inline-flex;align-items:center;gap:6px;">${iconHtml('circle-check',13)}All caught up — nothing due in this block</span></div>`;
    }else{
        open.forEach(r=>{
            html+=`<div class="focus-row" style="border-left:3px solid ${r.color};"><input type="checkbox" class="plan-check" data-key="${r.x.key}"><span class="focus-name">${escapeHtml(r.x.item.name)}</span><span class="focus-meta">${r.x.item.score}% → ${r.x.item.target}%</span></div>`;
        });
    }
    const smooth=!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    html+=`<button class="focus-more" onclick="document.getElementById('study-plan-card').scrollIntoView({behavior:'${smooth?'smooth':'auto'}',block:'center'})">View full plan ${iconHtml('arrow-down',12)}</button>`;
    body.innerHTML=html;
    refreshIcons();
}

function planKey(group,name){return group+'_'+String(name).replace(/[^a-zA-Z0-9]/g,'_');}

function renderPlanCard(key,item,prog,color,compact,completed){
    const checked=completed?'checked':'';
    if(completed){
        return `<div class="plan-card" draggable="true" data-key="${key}" style="padding:10px;margin-bottom:8px;border-radius:6px;background:rgba(82,196,26,.06);border-left:3px solid #52c41a;opacity:.55;cursor:grab;">
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" class="plan-check" data-key="${key}" ${checked} style="accent-color:#52c41a;cursor:pointer;width:15px;height:15px;flex-shrink:0;">
                <span style="font-size:13px;color:var(--text-primary);text-decoration:line-through;">${escapeHtml(item.name)}</span>
                <span style="font-size:11px;color:var(--text-muted);margin-left:auto;">Done</span>
            </div>
        </div>`;
    }
    let html=`<div class="plan-card" draggable="true" data-key="${key}" style="padding:10px;margin-bottom:8px;border-radius:6px;background:rgba(${color==='#E5484D'?'245,34,45':'250,173,20'},.04);border-left:3px solid ${color};cursor:grab;transition:opacity .15s;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <input type="checkbox" class="plan-check" data-key="${key}" style="accent-color:${color};cursor:pointer;width:15px;height:15px;flex-shrink:0;">
            <span style="font-size:13px;font-weight:500;color:var(--text-primary);flex:1;">${escapeHtml(item.name)}</span>
            <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(item.desc||'')}</span>
        </div>`;
    if(!compact){
        html+=`<div style="display:flex;gap:12px;font-size:11px;color:var(--text-muted);margin-bottom:6px;margin-left:23px;"><span>${item.score}% → ${item.target}%</span><span>${Math.ceil((100-prog)/20)} problems</span></div>`;
        html+=`<div class="progress-bar" style="margin-bottom:6px;margin-left:23px;width:calc(100% - 23px);"><div style="background:${color};height:4px;border-radius:2px;width:${prog}%;transition:width .3s;"></div></div>`;
    }
    html+='</div>';
    return html;
}

function updatePlanProgress(key){
    let planState=loadPlanState();
    const cur=planState.progress[key]||0;
    planState.progress[key]=Math.min(100,cur+20);
    savePlanState(planState);
    if(window.pretestResult)renderStudyPlan(window.pretestResult);
    showNotification('Progress updated: '+planState.progress[key]+'%','info');
    // Check if plan item completed → schedule weekly refresh
    if(planState.progress[key]>=100)showNotification('Topic completed! New plan will be generated.','success');
}

function togglePlanEdit(){
    const ct=document.getElementById('study-plan-content');
    if(!ct||ct.style.display==='none'){showNotification('Complete pre-assessment first');return;}
    showNotification('Edit mode — add custom goals in future update');
}

function loadPlanState(){
    try{const s=localStorage.getItem('cb_plan');return s?JSON.parse(s):{progress:{},completed:{},deleted:{},order:{},lastUpdate:new Date().toISOString()};}catch(e){return{progress:{},completed:{},deleted:{},order:{},lastUpdate:new Date().toISOString()};}
}
// Cloud sync: debounced PUT after every local save; explicit pull after login.
let planSyncTimer=null;
function savePlanState(s){
    try{localStorage.setItem('cb_plan',JSON.stringify(s));}catch(e){}
    const token=localStorage.getItem('cb_token');
    if(!token)return;   // guests: local only
    clearTimeout(planSyncTimer);
    planSyncTimer=setTimeout(()=>{
        apiFetch('/api/plan',{method:'PUT',body:JSON.stringify({state_json:JSON.stringify(s)})})
            .catch(e=>console.error('Plan cloud sync failed:',e));
    },1000);
}
async function pullPlanFromCloud(){
    const token=localStorage.getItem('cb_token');
    if(!token)return;
    try{
        const res=await apiFetch('/api/plan');
        if(!res.ok)return;
        const data=await res.json();
        if(data&&data.state_json){
            const cloud=JSON.parse(data.state_json);
            if(cloud&&cloud.lastUpdate){
                const local=loadPlanState();
                // Newest wins: cloud is authoritative unless local is newer (rare offline edits)
                if(new Date(cloud.lastUpdate)>=new Date(local.lastUpdate)){
                    try{localStorage.setItem('cb_plan',JSON.stringify(cloud));}catch(e){}
                }
            }
        }
    }catch(e){/* offline: keep local */}
}

// ===== Current teaching week (drives the curriculum-aligned plan) =====
function fillWeekSelect(sel){
    if(!sel||sel.options.length)return;
    let html='';
    for(let w=1;w<=16;w++)html+=`<option value="${w}">Week ${w}${w===16?' (exams)':''}</option>`;
    sel.innerHTML=html;
}
function getCurrentWeek(){
    const ps=loadPlanState();
    return Math.min(16,Math.max(1,parseInt(ps.currentWeek||(window.pretestResult&&window.pretestResult.currentWeek)||1)||1));
}
function setCurrentWeek(v){
    let w=Math.min(16,Math.max(1,parseInt(v)||1));
    const ps=loadPlanState();
    ps.currentWeek=w;
    savePlanState(ps);          // local + debounced cloud sync
    showNotification('教学周已设为 '+w+' —— 计划已重新对齐','success');
    if(window.pretestResult)renderStudyPlan(window.pretestResult);
}

let planDragKey=null;
function togglePlanComplete(key){
    const planState=loadPlanState();
    planState.completed=planState.completed||{};
    if(planState.completed[key]){delete planState.completed[key];}
    else{planState.completed[key]=true;}
    savePlanState(planState);
    if(window.pretestResult)renderStudyPlan(window.pretestResult);
}
function allowDrop(e){e.preventDefault();e.dataTransfer.dropEffect='move';}
function dropToSort(e){
    e.preventDefault();
    const target=e.target.closest('.plan-card');
    if(!target||!planDragKey)return;
    const dragEl=document.querySelector('.plan-card[data-key="'+planDragKey+'"]');
    if(!dragEl||target===dragEl)return;
    const group=target.closest('.plan-group');
    if(!group||dragEl.closest('.plan-group')!==group)return;
    const rect=target.getBoundingClientRect();
    const before=e.clientY<rect.top+rect.height/2;
    group.insertBefore(dragEl,before?target:target.nextSibling);
    const planState=loadPlanState();
    planState.order=planState.order||{};
    planState.order[group.dataset.group]=Array.from(group.querySelectorAll('.plan-card')).map(c=>c.dataset.key);
    savePlanState(planState);
}
function dropToTrash(e){
    e.preventDefault();
    if(!planDragKey)return;
    const planState=loadPlanState();
    planState.deleted=planState.deleted||{};
    planState.deleted[planDragKey]=true;
    savePlanState(planState);
    if(window.pretestResult)renderStudyPlan(window.pretestResult);
    showNotification('Removed from plan');
}

function checkWeeklyUpdate(){
    let planState=loadPlanState();
    const last=new Date(planState.lastUpdate);
    const now=new Date();
    const days=Math.floor((now-last)/(1000*60*60*24));
    if(days>=7){
        // Remove completed items, update plan
        let changed=false;
        Object.keys(planState.progress).forEach(k=>{
            if(planState.progress[k]>=100){delete planState.progress[k];changed=true;}
        });
        planState.lastUpdate=now.toISOString();
        savePlanState(planState);
        if(changed){
            // Re-render if pretest data exists
            if(window.pretestResult){
                setTimeout(()=>{renderStudyPlan(window.pretestResult);showNotification('Weekly plan updated — new topics added','info');},500);
            }
        }
    }
}

// Restore pretest data on page load — cloud first (full snapshot), localStorage fallback
async function restorePretestData(){
    const token=localStorage.getItem('cb_token');
    if(token){
        try{
            const res=await apiFetch('/api/assessments/latest');
            if(res.ok){
                const a=await res.json();
                if(a&&a.result_json){
                    const cloud=JSON.parse(a.result_json);
                    if(cloud&&cloud.avgScore!==undefined){
                        window.pretestResult=cloud;
                        // keep local copy in sync for offline fallback
                        try{localStorage.setItem('cb_pretest',JSON.stringify(cloud));}catch(e){}
                        renderMathSkill(cloud);
                        renderStudyPlan(cloud);
                        return;
                    }
                }
            }
        }catch(e){/* offline → fall through to localStorage */}
    }
    try{
        const saved=localStorage.getItem('cb_pretest');
        if(saved){
            window.pretestResult=JSON.parse(saved);
            renderMathSkill(window.pretestResult);
            renderStudyPlan(window.pretestResult);
        }
    }catch(e){}
}

