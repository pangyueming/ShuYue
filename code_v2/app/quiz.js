// ===== AI QUIZ (generative + harness-verified) =====
const QUIZ_TOPICS=['Mixed','Limits','Differentiation','Integration','Series_Convergence','Differential_Equations','Linear_Algebra','Discrete_Math','Probability','Proof_Techniques','Complex_Numbers','Vector_Calculus'];
let quizState={count:5,diff:'Medium',qtype:'MCQ',active:false,quizId:null,questions:[],serverIdx:[],current:0,score:0,detail:[]};

function quizPageInit(){
    // Populate topic dropdown (once)
    const sel=document.getElementById('quiz-topic');
    if(sel&&sel.options.length===0){
        sel.innerHTML=QUIZ_TOPICS.map(t=>`<option value="${t}">${t.replace(/_/g,' ')}</option>`).join('');
    }
    // Weak-topic recommendation from latest assessment
    const token=localStorage.getItem('cb_cn_token');
    if(token&&sel){
        apiFetch('/api/assessments/latest').then(r=>r.ok?r.json():{}).then(a=>{
            const weak=(a.weak_topics||'').split(',').map(s=>s.trim()).filter(Boolean);
            const first=weak.find(w=>QUIZ_TOPICS.includes(w));
            if(first){
                sel.value=first;
                const hint=document.getElementById('quiz-weak-hint');
                if(hint)hint.style.display='block';
            }
        }).catch(()=>{});
    }
    quizRenderChips();
}

function quizSetCount(v){
    let n=parseInt(v);
    if(isNaN(n))n=5;
    n=Math.max(1,Math.min(15,n));
    quizState.count=n;
    const inp=document.getElementById('quiz-count-input');
    if(inp&&document.activeElement!==inp)inp.value=n;
    // Highlight quick-chips matching the current count
    document.querySelectorAll('#page-quiz button').forEach(b=>{
        const t=b.textContent.trim();
        if(['5','10','15'].includes(t)&&b.onclick){
            const on=(parseInt(t)===n);
            b.style.borderColor=on?'var(--accent)':'var(--border)';
            b.style.background=on?'var(--accent)':'var(--bg-input)';
            b.style.color=on?'#fff':'var(--text-secondary)';
        }
    });
}

function quizRenderChips(){
    const chip=(on,label)=>`padding:6px 14px;border-radius:999px;font-size:12px;cursor:pointer;border:1px solid ${on?'var(--accent)':'var(--border)'};background:${on?'var(--accent)':'var(--bg-input)'};color:${on?'#fff':'var(--text-secondary)'};`;
    const c2=document.getElementById('quiz-diff-chips');
    if(c2)c2.innerHTML=['Easy','Medium','Hard','Mixed'].map(d=>`<button style="${chip(quizState.diff===d,d)}" onclick="quizState.diff='${d}';quizRenderChips()">${d}</button>`).join('');
    const c3=document.getElementById('quiz-qtype-chips');
    if(c3)c3.innerHTML=[['MCQ','MCQ'],['short','Fill-in'],['mixed','Mixed']].map(([v,l])=>`<button style="${chip(quizState.qtype===v,l)}" onclick="quizState.qtype='${v}';quizRenderChips()">${l}</button>`).join('');
}

function quizShow(state){
    ['quiz-config','quiz-generating','quiz-active','quiz-results'].forEach(id=>{
        document.getElementById(id).style.display=(id===state)?'':'none';
    });
}

// Thinking orb replaces the static target icon while the examiner writes; the
// icon is restored (and the canvas loop destroyed) on done/error.
let quizGenOrbStop=null;
function quizGenOrb(on){
    const host=document.querySelector('#quiz-generating .gen-emoji');
    if(!host)return;
    if(on){
        if(quizGenOrbStop||!window.ThinkingOrb||typeof orbThinking!=='function')return;
        quizGenOrbStop=orbThinking(host,'composing',false,64);
    }else if(quizGenOrbStop){
        quizGenOrbStop();quizGenOrbStop=null;
        host.innerHTML='<i data-lucide="target"></i>';
        refreshIcons();
    }
}

async function quizGenerate(){
    const topic=document.getElementById('quiz-topic').value;
    const verify=document.getElementById('quiz-verify').checked;
    quizShow('quiz-generating');
    quizGenOrb(true);
    const bar=document.getElementById('quiz-gen-bar');
    const st=document.getElementById('quiz-gen-status');
    bar.style.width='25%';
    const verifyEl=document.getElementById('quiz-verify');
    // Persistent wait-time hint — written once, never overwritten by the status ticker
    const etaEl=document.getElementById('quiz-gen-eta');
    if(etaEl){
        let est;
        if(!verify)                    est='请稍候 · 1 分钟内';
        else if(quizState.count<=6)    est='请稍候 · 约 1–2 分钟';
        else                           est='请稍候 · 约 2–4 分钟';
        etaEl.textContent=est;
        etaEl.style.display='block';
    }
    st.textContent='正在联络出题官…';
    const tick=setInterval(()=>{bar.style.width=(Math.min(85,parseFloat(bar.style.width)+7))+'%';
        st.textContent=verifyEl&&verifyEl.checked&&parseFloat(bar.style.width)>50?'解题引擎正在交叉验证答案…':'出题官正在命题…';},900);
    try{
        const res=await apiFetch('/api/quiz/generate',{method:'POST',body:JSON.stringify({
            topic,count:quizState.count,difficulty:quizState.diff,qtype:quizState.qtype,verify})});
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.detail||('HTTP '+res.status));}
        const data=await res.json();
        clearInterval(tick);bar.style.width='100%';
        quizState.quizId=data.quiz_id;
        quizState.questions=data.questions;
        quizState.serverIdx=data.questions.map((_,i)=>i);   // map to server cache indices
        quizState.current=0;quizState.score=0;quizState.detail=[];quizState.active=true;
        document.getElementById('quiz-topic-label').textContent=data.topic.replace(/_/g,' ');
        quizShow('quiz-active');
        quizGenOrb(false);
        quizRenderQuestion();
    }catch(e){
        clearInterval(tick);
        quizGenOrb(false);
        showNotification(e.message,'error');
        quizShow('quiz-config');
    }
}

function quizRenderQuestion(){
    const q=quizState.questions[quizState.current];
    const total=quizState.questions.length;
    document.getElementById('quiz-progress-label').textContent=`Q${quizState.current+1}/${total}`;
    document.getElementById('quiz-progress-bar').style.width=((quizState.current)/total*100)+'%';
    const card=document.getElementById('quiz-question-card');
    const fb=document.getElementById('quiz-feedback');
    fb.style.display='none';
    const badge=q.verified?'<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(82,196,26,.12);color:#52c41a;font-weight:600;">'+iconHtml('shield-check',11)+'已验证</span>':'';
    if(q.qtype==='MCQ'){
        card.innerHTML=`
            <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                <span style="font-size:11px;color:var(--text-muted);">单选题</span>${badge}
            </div>
            <div style="font-size:15px;font-weight:500;margin-bottom:16px;">${markdownToHtml(q.q)}</div>
            <div id="quiz-opts">${q.options.map((o,i)=>`
                <label id="quiz-opt-${i}" onclick="quizPick(${i})" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;margin-bottom:8px;color:var(--text-secondary);transition:all .12s;">
                    <span style="width:22px;height:22px;border-radius:50%;border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;">${String.fromCharCode(65+i)}</span>
                    <span style="font-size:13px;">${markdownToHtml(o)}</span>
                </label>`).join('')}</div>
            <button class="btn-primary" style="width:100%;margin-top:8px;" id="quiz-submit-btn" disabled onclick="quizSubmitAnswer()">提交</button>`;
    }else{
        card.innerHTML=`
            <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                <span style="font-size:11px;color:var(--text-muted);">填空题</span>${badge}
            </div>
            <div style="font-size:15px;font-weight:500;margin-bottom:16px;">${markdownToHtml(q.q)}</div>
            <input id="quiz-short-input" class="input" style="width:100%;" placeholder="输入答案，如 n(n+1)/2 或 42" onkeypress="if(event.key==='Enter')quizSubmitAnswer()">
            <button class="btn-primary" style="width:100%;margin-top:8px;" onclick="quizSubmitAnswer()">提交</button>`;
    }
    refreshIcons();
}

let quizPicked=-1;
function quizPick(i){
    quizPicked=i;
    document.querySelectorAll('#quiz-opts label').forEach((el,idx)=>{
        el.style.borderColor=idx===i?'var(--accent)':'var(--border)';
        el.style.background=idx===i?'rgba(76,141,255,.06)':'transparent';
    });
    document.getElementById('quiz-submit-btn').disabled=false;
}

async function quizSubmitAnswer(){
    const q=quizState.questions[quizState.current];
    let student='';
    if(q.qtype==='MCQ'){
        if(quizPicked<0)return;
        student=String.fromCharCode(65+quizPicked);
    }else{
        student=(document.getElementById('quiz-short-input')||{}).value||'';
        student=student.trim();
        if(!student)return;
    }
    document.getElementById('quiz-question-card').style.opacity='.6';
    try{
        const res=await apiFetch('/api/quiz/grade',{method:'POST',body:JSON.stringify({
            quiz_id:quizState.quizId,q_index:quizState.serverIdx[quizState.current],student_answer:student})});
        if(!res.ok)throw new Error('HTTP '+res.status);
        const g=await res.json();
        document.getElementById('quiz-question-card').style.opacity='1';
        if(g.correct)quizState.score++;
        quizState.detail.push({...q,q_index:quizState.serverIdx[quizState.current],student_answer:student,
            correct:g.correct,correct_answer:g.correct_answer,explanation:g.explanation});
        // Reveal correct option visually for MCQ
        if(q.qtype==='MCQ'){
            const ci="ABCD".indexOf(g.correct_answer.trim().toUpperCase());
            if(ci>=0&&ci<4){
                const el=document.getElementById('quiz-opt-'+ci);
                if(el){el.style.borderColor='#52c41a';el.style.background='rgba(82,196,26,.08)';}
            }
        }
        const fb=document.getElementById('quiz-feedback');
        fb.style.display='block';
        fb.innerHTML=`<div class="card" style="border-left:4px solid ${g.correct?'#52c41a':'#ff6b6b'};background:${g.correct?'rgba(82,196,26,.05)':'rgba(255,107,107,.05)'};">
            <div style="font-size:14px;font-weight:700;color:${g.correct?'#52c41a':'#ff6b6b'};margin-bottom:4px;">${g.correct?'Correct!':'Not quite'}</div>
            ${g.correct?'':`<div style="font-size:13px;margin-bottom:4px;">正确答案：<strong>${markdownToHtml(g.correct_answer)}</strong></div>`}
            <div style="font-size:13px;color:var(--text-secondary);">${markdownToHtml(g.explanation||'')}</div>
            <button class="btn-primary" style="margin-top:12px;" onclick="quizNext()">${quizState.current+1<quizState.questions.length?'下一题 →':'查看结果 →'}</button>
        </div>`;
        window.scrollTo(0,0);
    }catch(e){
        document.getElementById('quiz-question-card').style.opacity='1';
        showNotification('判分失败：'+e.message,'error');
    }
}

function quizNext(){
    quizPicked=-1;
    if(quizState.current+1<quizState.questions.length){
        quizState.current++;
        quizRenderQuestion();
    }else{
        quizFinish();
    }
}

async function quizFinish(){
    const total=quizState.questions.length;
    const pct=Math.round(quizState.score/total*100);
    const ring=document.getElementById('quiz-score-ring');
    const col=pct>=80?'#52c41a':pct>=50?'#faad14':'#ff6b6b';
    ring.style.borderColor=col;ring.style.color=col;
    ring.textContent=quizState.score+'/'+total;
    document.getElementById('quiz-score-title').textContent=pct>=80?'出色！':pct>=50?'不错，继续加油！':'多加练习';
    document.getElementById('quiz-score-sub').textContent=quizState.score+'/'+total+' 题正确 · '+(document.getElementById('quiz-topic')?document.getElementById('quiz-topic').value.replace(/_/g,' '):'');
    document.getElementById('quiz-review-list').innerHTML=quizState.detail.map((d,i)=>`
        <div class="card" style="padding:12px;margin-bottom:8px;border-left:3px solid ${d.correct?'#52c41a':'#ff6b6b'};">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap;">
                <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:${d.correct?'#52c41a':'#ff6b6b'};">${iconHtml(d.correct?'check':'x',12)}Q${i+1}</span>
                <span style="font-size:11px;color:var(--text-muted);">你的答案：${markdownToHtml(d.student_answer)}</span>
                ${d.correct?'':`<span style="font-size:11px;color:var(--text-muted);">· 正确答案：<strong>${markdownToHtml(d.correct_answer)}</strong></span>`}
            </div>
            <div style="font-size:13px;color:var(--text-secondary);">${markdownToHtml(d.q)}</div>
        </div>    `).join('');
    refreshIcons();
    const retryBtn=document.getElementById('quiz-retry-btn');
    retryBtn.style.display=quizState.detail.some(d=>!d.correct)?'':'none';
    quizShow('quiz-results');
    // Persist attempt (feeds Problems Solved on Dashboard)
    try{
        await apiFetch('/api/quiz/submit',{method:'POST',body:JSON.stringify({
            quiz_id:quizState.quizId,score:quizState.score,total,
            detail_json:JSON.stringify(quizState.detail.map(d=>({q:d.q,ok:d.correct})))})});
    }catch(e){/* guests: ignore */}
}

function quizRetryWrong(){
    // Re-ask wrong questions; grade against ORIGINAL server cache indices
    const wrongIdx=quizState.detail.filter(d=>!d.correct).map(d=>d.q_index);
    quizState.questions=wrongIdx.map(i=>quizState.questions.find((q,idx)=>idx===i)).filter(Boolean);
    quizState.serverIdx=wrongIdx;
    quizState.current=0;quizState.score=0;quizState.detail=[];quizPicked=-1;
    quizShow('quiz-active');
    quizRenderQuestion();
}

function quizReset(){
    quizState.active=false;
    quizShow('quiz-config');
}

// ===== AI API — Harness Backend =====
// AI_BACKEND_URL already defined at top of script
const USE_BACKEND=true;
// API key is now in backend .env file (not exposed in frontend)

async function kimiCall(messages,onChunk,onDone,onErr){
    try{
        // === Harness Backend route (routing + verifier) ===
        const taskType=messages[0]?.content?.includes('translate')||messages[0]?.content?.includes('翻译')?'translate':messages[0]?.content?.includes('Socratic')||messages[0]?.content?.includes('引导')?'math_guide':'general';
        const r=await fetch(AI_BACKEND_URL+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({task_type:taskType,messages:messages.slice(1),temperature:0.3,max_tokens:2000,stream:true})});
        if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error?.message||e.detail?.[0]?.msg||`HTTP ${r.status}`);}
        const reader=r.body.getReader();const dec=new TextDecoder();let full='';
        while(true){const{done,value}=await reader.read();if(done)break;
            const chunk=dec.decode(value);
            const lines=chunk.split('\n');
            for(const line of lines){
                const trimmed=line.trim();
                if(!trimmed.startsWith('data'))continue;
                const jsonStr=trimmed.replace(/^data:\s*/,'').trim();
                if(jsonStr==='[DONE]')break;
                try{
                    const p=JSON.parse(jsonStr);
                    if(p.content){full+=p.content;if(onChunk)onChunk(full);}
                    if(p.error)throw new Error(p.error);
                }catch(e){if(e.message&&!e.message.includes('JSON')){throw e;}}
            }
        }
        if(!full)throw new Error('Empty response from server (stream ended with no content)');
        if(onDone)onDone(full);
    }catch(err){
        // Fallback: if backend is down, try direct API
        if(onErr){
            try{
                await kimiCallFallback(messages,onChunk,onDone);
            }catch(e2){
                onErr('Backend: '+err.message+' | Fallback: '+e2.message);
            }
        }
    }
}

// Fallback: backend unavailable — no direct API key in frontend
async function kimiCallFallback(messages,onChunk,onDone){
    throw new Error('Backend unavailable. Please ensure the server is running.');
}

