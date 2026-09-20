// ===== AUTH & API =====
// Default points at the duel-review backend (localhost:8000).
// Override for local testing: localStorage.setItem('cb_cn_api_base','http://localhost:8010')
const AI_BACKEND_URL=(function(){try{return localStorage.getItem('cb_cn_api_base')||'http://localhost:8001';}catch(e){return 'http://localhost:8001';}})();

// Global API fetch with JWT token
async function apiFetch(url,options={}){
    const token=localStorage.getItem('cb_cn_token');
    const headers={...(options.headers||{})};
    if(!(options.body instanceof FormData))headers['Content-Type']='application/json';
    if(token)headers['Authorization']='Bearer '+token;
    const res=await fetch(AI_BACKEND_URL+url,{...options,headers});
    if(res.status===401){
        localStorage.removeItem('cb_cn_token');
        localStorage.removeItem('cb_cn_user');
        showNotification('会话已过期，请重新登录。','warning');
        showPage('login');
        throw new Error('Unauthorized');
    }
    return res;
}

// Auth functions
function authToggleMode(){
    const loginForm=document.getElementById('login-form');
    const regForm=document.getElementById('register-form');
    const forgotForm=document.getElementById('forgot-form');
    if(loginForm.style.display==='none'){
        loginForm.style.display='block';regForm.style.display='none';forgotForm.style.display='none';
    }else{
        loginForm.style.display='none';regForm.style.display='block';forgotForm.style.display='none';
    }
}
function authShowForgot(){
    document.getElementById('login-form').style.display='none';
    document.getElementById('register-form').style.display='none';
    document.getElementById('forgot-form').style.display='block';
}
function authShowLogin(){
    document.getElementById('login-form').style.display='block';
    document.getElementById('register-form').style.display='none';
    document.getElementById('forgot-form').style.display='none';
}

async function authLogin(){
    const email=document.getElementById('login-email').value.trim();
    const password=document.getElementById('login-password').value;
    if(!email||!password){showNotification('请输入邮箱和密码','warning');return;}
    if(typeof formBusy==='function')formBusy('login-form',true,'登录中…');
    try{
        const res=await fetch(AI_BACKEND_URL+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
        if(!res.ok){const err=await res.json();throw new Error(err.detail||'Login failed');}
        const data=await res.json();
        localStorage.setItem('cb_cn_token',data.access_token);
        localStorage.setItem('cb_cn_user',JSON.stringify(data.user));
        await migrateGuestData();
        renderSidebarUser();
        // Cloud restore pipeline: bookshelf → notes → plan → pretest → stats
        await bsPageInit();
        await notesInit();
        await pullPlanFromCloud();
        await restorePretestData();
        await loadUserStats();
        animateCountUp();
        showNotification('欢迎回来，'+data.user.name,'success');
        showPage('dashboard');
    }catch(e){showNotification(e.message,'error');}
    finally{if(typeof formBusy==='function')formBusy('login-form',false);}
}

async function authRegister(){
    const name=document.getElementById('reg-name').value.trim();
    const email=document.getElementById('reg-email').value.trim();
    const password=document.getElementById('reg-password').value;
    if(!email||!password){showNotification('请填写完整','warning');return;}
    if(password.length<6){showNotification('密码至少 6 位','warning');return;}
    if(!/[a-zA-Z]/.test(password)||!/\d/.test(password)){showNotification('密码需包含至少一个字母和一个数字','warning');return;}
    if(typeof formBusy==='function')formBusy('register-form',true,'Creating account…');
    try{
        const res=await fetch(AI_BACKEND_URL+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,name})});
        if(!res.ok){const err=await res.json();throw new Error(err.detail||'Registration failed');}
        const data=await res.json();
        localStorage.setItem('cb_cn_token',data.access_token);
        localStorage.setItem('cb_cn_user',JSON.stringify(data.user));
        await migrateGuestData();
        renderSidebarUser();
        showNotification('账号创建成功！欢迎，'+data.user.name,'success');
        showPage('dashboard');
    }catch(e){showNotification(e.message,'error');}
    finally{if(typeof formBusy==='function')formBusy('register-form',false);}
}

async function authForgotPassword(){
    const email=document.getElementById('forgot-email').value.trim();
    if(!email){showNotification('Please enter your email','warning');return;}
    if(typeof formBusy==='function')formBusy('forgot-form',true,'Sending…');
    try{
        const res=await fetch(AI_BACKEND_URL+'/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
        if(!res.ok)throw new Error('Failed');
        showNotification('重置链接已生成，请查看服务器控制台。');
        authShowLogin();
    }catch(e){showNotification('生成重置链接失败','error');}
    finally{if(typeof formBusy==='function')formBusy('forgot-form',false);}
}

function authLogout(){
    localStorage.removeItem('cb_cn_token');
    localStorage.removeItem('cb_cn_user');
    // Full in-memory wipe: another account on this browser must start clean
    BS_CATS.forEach(c=>bsData[c.key]=[]);
    notesData=[];
    readerNotes=[];readerHighlights=[];
    tutorChatHistory=[];tutorMaterials=[];
    aiChatMessages=[];window.aiChatPageContext=null;
    window.pretestResult=null;
    quizState={count:5,diff:'中',qtype:'MCQ',active:false,quizId:null,questions:[],serverIdx:[],current:0,score:0,detail:[]};
    try{localStorage.removeItem('cb_cn_pretest');localStorage.removeItem('cb_cn_plan');localStorage.removeItem('cb_cn_highlights_'+(readerCurrentDocId||''));}catch(e){}
    // Reset visible surfaces
    const ph=document.getElementById('math-skill-placeholder');const phc=document.getElementById('math-skill-content');
    if(ph)ph.style.display='';if(phc)phc.style.display='none';
    const sph=document.getElementById('study-plan-placeholder');const sphc=document.getElementById('study-plan-content');
    if(sph)sph.style.display='';if(sphc)sphc.style.display='none';
    const chat=document.getElementById('tutor-chat');
    if(chat)chat.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px;">Ask a question or upload materials to get started<br><span style="font-size:11px;">Powered by CogniBridge AI</span></div>';
    if(window.lucide)lucide.createIcons();
    renderSidebarUser();
    showNotification('Logged out','info');
    showPage('login');
}

function authContinueAsGuest(){
    showNotification('Continuing as guest. Your progress is saved locally.');
    showPage('dashboard');
}

async function migrateGuestData(){
    const guestNotes=JSON.parse(localStorage.getItem('cb_cn_notes_guest')||'[]');
    const pretest=localStorage.getItem('cb_cn_pretest');
    if(guestNotes.length===0&&!pretest)return;
    showNotification('Migrating your local data...');
    for(const note of guestNotes){
        try{await apiFetch('/api/notes',{method:'POST',body:JSON.stringify({title:note.title,tag:note.tag,content:note.content,source:note.source||'manual'})});}catch(e){}
    }
    if(pretest){
        try{await apiFetch('/api/assessments',{method:'POST',body:pretest});}catch(e){}
    }
    localStorage.removeItem('cb_cn_notes_guest');
    showNotification('Your progress has been saved to your account!','success');
}

// ===== PROFILE =====
function renderProfile(){
    const userStr=localStorage.getItem('cb_cn_user');
    const user=userStr?JSON.parse(userStr):null;
    if(!user){showNotification('Please log in first','warning');showPage('login');return;}
    
    // Avatar & header
    const initial=(user.name||'U')[0].toUpperCase();
    const avatarEl=document.getElementById('profile-avatar');
    const nameEl=document.getElementById('profile-name');
    const emailEl=document.getElementById('profile-email');
    if(avatarEl){avatarEl.textContent=initial;}
    if(nameEl){nameEl.textContent=user.name||'User';}
    if(emailEl){emailEl.textContent=user.email||'';}
    
    // Form fields
    document.getElementById('profile-input-name').value=user.name||'';
    document.getElementById('profile-input-uni').value=user.university||'北京邮电大学（中外合办）';
    document.getElementById('profile-input-major').value=user.major||'Computer Science';
    document.getElementById('profile-input-year').value=user.year||'freshman';
    document.getElementById('profile-input-alevel').value=user.a_level_grade||'';
    document.getElementById('profile-input-fm').checked=user.further_math===1||user.further_math===true;
    const pw=document.getElementById('profile-input-week');
    fillWeekSelect(pw);
    if(pw)pw.value=getCurrentWeek();
}

async function saveProfile(){
    const name=document.getElementById('profile-input-name').value.trim();
    const university=document.getElementById('profile-input-uni').value.trim();
    const major=document.getElementById('profile-input-major').value.trim();
    const year=document.getElementById('profile-input-year').value;
    const a_level_grade=document.getElementById('profile-input-alevel').value;
    const further_math=document.getElementById('profile-input-fm').checked?1:0;
    
    try{
        const res=await apiFetch('/api/auth/me',{
            method:'PUT',
            body:JSON.stringify({name,university,major,year,a_level_grade,further_math})
        });
        if(!res.ok)throw new Error('Failed to update');
        
        // Update localStorage user
        const userStr=localStorage.getItem('cb_cn_user');
        const user=userStr?JSON.parse(userStr):{};
        user.name=name;user.university=university;user.major=major;
        user.year=year;user.a_level_grade=a_level_grade;user.further_math=further_math;
        localStorage.setItem('cb_cn_user',JSON.stringify(user));
        
        renderProfile();
        renderSidebarUser();
        showNotification('资料已更新','success');
    }catch(e){showNotification('资料更新失败','error');}
}

// Password strength meter
document.addEventListener('DOMContentLoaded',()=>{
    const regPwd=document.getElementById('reg-password');
    if(regPwd){
        regPwd.addEventListener('input',function(){
            const pwd=this.value;
            const hasLetter=/[a-zA-Z]/.test(pwd);
            const hasNumber=/\d/.test(pwd);
            const isLongEnough=pwd.length>=6;
            let strength='弱';let color='#E5484D';
            if(pwd.length===0){strength='输入密码';color='var(--text-muted)';}
            else if(isLongEnough&&hasLetter&&hasNumber&&pwd.length>=10){strength='强';color='#52c41a';}
            else if(isLongEnough&&hasLetter&&hasNumber){strength='中';color='#faad14';}
            const el=document.getElementById('pwd-strength');
            if(el){el.textContent=strength;el.style.color=color;}
        });
    }
});

// Sidebar user area rendering
function renderSidebarUser(){
    const container=document.getElementById('sidebar-user-area');
    if(!container)return;
    const token=localStorage.getItem('cb_cn_token');
    const user=token?JSON.parse(localStorage.getItem('cb_cn_user')||'{}'):null;
    if(!token){
        container.innerHTML=`<div class="side-user-guest"><button class="btn-primary" style="width:100%;font-size:13px;" onclick="showPage('login')">登 录</button><p class="side-user-hint">游客模式 · 数据存本地</p></div>`;refreshIcons();
    }else{
        const initial=(user.name||'U')[0].toUpperCase();
        container.innerHTML=`<div class="side-user"><div class="side-user-row" onclick="document.getElementById('user-dropdown').style.display=document.getElementById('user-dropdown').style.display==='none'?'block':'none';"><div class="side-user-avatar">${initial}</div><div class="side-user-meta"><div class="side-user-name">${escapeHtml(user.name||'User')}</div><div class="side-user-sub">${escapeHtml(user.university||'Student')}</div></div><i data-lucide="chevron-down" class="side-user-caret"></i></div><div id="user-dropdown" class="side-user-dropdown"><div class="nav-item" onclick="showPage('profile')"><i data-lucide="user"></i>个人资料</div><div class="nav-item" onclick="authLogout()"><i data-lucide="log-out"></i>退出登录</div></div></div>`;refreshIcons();
    }
}

