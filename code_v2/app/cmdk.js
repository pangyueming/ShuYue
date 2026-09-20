// ===== ⌘K Command Palette (Aurora Glass) =====
// Self-contained: injects its own DOM/CSS hooks; pages list sourced from nav.js pageLabels.
(function(){
    const ACTIONS = [
        { id:'theme',   label:'切换深色 / 浅色主题', icon:'moon',      section:'操作', run:()=>toggleTheme() },
        { id:'sidebar', label:'折叠 / 展开侧栏',            icon:'panel-left', section:'操作', run:()=>toggleSidebar() }
    ];
    let built=false, sel=0, results=[];

    function build(){
        if(built) return;
        built=true;
        const wrap=document.createElement('div');
        wrap.id='cmdk';
        wrap.innerHTML=
            '<div class="cmdk-backdrop"></div>'+
            '<div class="cmdk-panel" role="dialog" aria-label="Command palette">'+
                '<div class="cmdk-head"><i data-lucide="search"></i>'+
                    '<input id="cmdk-input" type="text" placeholder="搜索页面与操作…" autocomplete="off" spellcheck="false">'+
                    '<kbd class="kbd">ESC</kbd></div>'+
                '<div id="cmdk-list" class="cmdk-list"></div>'+
                '<div class="cmdk-foot"><span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> navigate</span>'+
                    '<span><kbd class="kbd">↵</kbd> open</span><span class="cmdk-hint">CogniBridge · Aurora Glass</span></div>'+
            '</div>';
        document.body.appendChild(wrap);
        wrap.querySelector('.cmdk-backdrop').addEventListener('click',closeCmdK);
        const input=wrap.querySelector('#cmdk-input');
        input.addEventListener('input',()=>{ render(input.value); });
        input.addEventListener('keydown',e=>{
            if(e.key==='ArrowDown'){ e.preventDefault(); move(1); }
            else if(e.key==='ArrowUp'){ e.preventDefault(); move(-1); }
            else if(e.key==='Enter'){ e.preventDefault(); exec(sel); }
            else if(e.key==='Escape'){ e.preventDefault(); closeCmdK(); }
        });
    }

    function pool(){
        const pages=Object.keys(pageLabels)
            .filter(id=>id!=='login'||!localStorage.getItem('cb_cn_token'))
            .map(id=>({ id, label:pageLabels[id], icon:iconFor(id), section:'前往', run:()=>showPage(id) }));
        return pages.concat(ACTIONS);
    }
    function iconFor(id){
        return ({dashboard:'layout-dashboard',pretest:'clipboard-check',tutor:'sigma',quiz:'target',
                 plotter:'chart-line',reader:'book-open',notes:'notebook-pen',graph:'network',
                 forum:'messages-square',bookshelf:'library',login:'log-in',profile:'user'})[id]||'file';
    }
    function score(q,item){
        q=q.trim().toLowerCase(); if(!q) return 1;
        const l=item.label.toLowerCase(); let qi=0,s=0,streak=0;
        for(let i=0;i<l.length&&qi<q.length;i++){
            if(l[i]===q[qi]){ qi++; streak++; s+=1+streak*2; } else streak=0;
        }
        if(qi<q.length) return -1;
        if(l.startsWith(q)) s+=10;
        const idx=l.indexOf(q); if(idx>-1) s+=6-Math.min(idx,5);
        return s;
    }
    function render(q){
        results=pool().map(it=>({it,s:score(q,it)})).filter(r=>r.s>=0)
            .sort((a,b)=>b.s-a.s).slice(0,9).map(r=>r.it);
        sel=0;
        const list=document.getElementById('cmdk-list');
        list.innerHTML=results.length?results.map((it,i)=>
            '<div class="cmdk-item'+(i===0?' sel':'')+'" data-i="'+i+'">'+
                '<i data-lucide="'+it.icon+'"></i><span>'+it.label+'</span>'+
                '<em>'+it.section+'</em></div>').join('')
            :'<div class="cmdk-empty">没有匹配结果</div>';
        list.querySelectorAll('.cmdk-item').forEach(el=>{
            el.addEventListener('click',()=>exec(parseInt(el.dataset.i)));
            el.addEventListener('mousemove',()=>{ const i=parseInt(el.dataset.i); if(i!==sel){sel=i;paint();} });
        });
        if(window.lucide&&lucide.createIcons)lucide.createIcons();
    }
    function paint(){
        document.querySelectorAll('#cmdk-list .cmdk-item').forEach((el,i)=>el.classList.toggle('sel',i===sel));
        const el=document.querySelectorAll('#cmdk-list .cmdk-item')[sel];
        if(el)el.scrollIntoView({block:'nearest'});
    }
    function move(d){ if(!results.length)return; sel=(sel+d+results.length)%results.length; paint(); }
    function exec(i){ const it=results[i]; if(!it)return; closeCmdK(); try{ it.run(); }catch(e){} }

    window.openCmdK=function(){
        build();
        const w=document.getElementById('cmdk');
        w.style.display='flex';
        requestAnimationFrame(()=>w.classList.add('open'));
        const input=document.getElementById('cmdk-input');
        input.value=''; render(''); input.focus();
    };
    window.closeCmdK=function(){
        const w=document.getElementById('cmdk'); if(!w||w.style.display==='none')return;
        w.classList.remove('open');
        setTimeout(()=>{ w.style.display='none'; },160);
    };
    document.addEventListener('keydown',e=>{
        if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){ e.preventDefault(); openCmdK(); }
    });
})();
