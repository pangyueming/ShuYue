// ===== Navigation =====
const pageLabels={dashboard:'Dashboard',pretest:'Pre-Assessment',tutor:'Math Tutor',quiz:'AI Quiz',plotter:'Function Plotter',reader:'Reader',notes:'Notes',graph:'Knowledge Graph',forum:'Student Forum',bookshelf:'Bookshelf',login:'Log In',profile:'Profile'};

// Pages that require login for data persistence
const LOGIN_REQUIRED_PAGES=['bookshelf'];
const LOGIN_RECOMMENDED_PAGES=['dashboard'];

function showPage(id){
    const token=localStorage.getItem('cb_token');
    // Route guard: redirect to login for protected pages
    if(!token&&LOGIN_REQUIRED_PAGES.includes(id)){
        showNotification('Please log in to access this feature','warning');
        id='login';
    }
    document.querySelectorAll('.page-view').forEach(p=>p.classList.remove('active'));
    document.getElementById('page-'+id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    const bc=document.getElementById('breadcrumb');
    if(bc)bc.textContent=pageLabels[id]||id;
    if(id==='dashboard'){
        // Refresh bento head (greeting/date/week) + activity feed on every visit
        if(typeof renderDashHead==='function')renderDashHead();
        if(typeof renderActivity==='function')renderActivity();
        bsRenderDashboard(bsPageCat);
    }
    if(id==='profile'){
        renderProfile();
    }
    if(id==='bookshelf'){
        // Reload documents if not loaded yet
        const hasData=BS_CATS.some(c=>bsData[c.key]&&bsData[c.key].length>0);
        if(!hasData)bsPageInit();
    }
    if(id==='notes'){
        // Always refresh notes (text notes + PDF notes) when entering the page
        notesInit();
    }
    if(id==='quiz'){
        quizPageInit();
    }
    if(id==='graph'&&typeof graphPageEnter==='function'){
        graphPageEnter();
    }
    if(id==='reader'&&!readerCurrentDocId&&!window.__guideShown){
        // First visit to Reader this session: open the built-in guide
        window.__guideShown=true;
        setTimeout(()=>{
            const i=(bsData.textbooks||[]).findIndex(d=>d.isGuide);
            if(i!==-1)readerOpenDoc('textbooks',i);
        },60);
    }
}
function toggleSidebar(){
    const sb=document.getElementById('app-sidebar');
    if(sb.style.width==='0px'){
        sb.style.width='240px';sb.style.minWidth='240px';sb.style.borderRight='1px solid var(--border)';
    }else{
        sb.style.width='0';sb.style.minWidth='0';sb.style.borderRight='none';
    }
}
function toggleTheme(){document.body.classList.toggle('dark');try{localStorage.setItem('cb_theme',document.body.classList.contains('dark')?'dark':'light');}catch(e){}}

