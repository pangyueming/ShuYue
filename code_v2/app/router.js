// ===== Hash router (Aurora Glass) =====
// Wraps the existing global showPage(): every navigation syncs #/page-id into the URL,
// back/forward and deep links work, and the route-guard redirect (login) is reflected truthfully.
(function(){
    const VALID=new Set(['dashboard','pretest','tutor','quiz','plotter','reader','notes','graph','forum','bookshelf','login','profile']);
    let suppress=false;

    function idFromHash(){
        const h=(location.hash||'').replace(/^#\/?/,'').split('?')[0];
        return VALID.has(h)?h:null;
    }
    function currentActiveId(fallback){
        const el=document.querySelector('.page-view.active');
        return el?el.id.replace(/^page-/,''):fallback;
    }
    function syncHash(){
        const target='#/'+currentActiveId('dashboard');
        if(location.hash!==target){
            suppress=true;
            location.hash=target;
            suppress=false;
        }
    }

    const _showPage=window.showPage;
    if(typeof _showPage==='function'){
        window.showPage=function(id){
            _showPage(id);
            if(!suppress)syncHash();
        };
    }

    function onHashChange(){
        if(suppress)return;
        const id=idFromHash();
        if(id){ suppress=true; showPage(id); suppress=false; }
        else{ suppress=true; showPage('dashboard'); suppress=false; }
    }
    window.addEventListener('hashchange',onHashChange);

    // Deep link support: only override init.js's default landing when the user
    // explicitly opened a non-dashboard route. Empty hash gets a silent default.
    const initial=idFromHash();
    if(initial && initial!=='dashboard'){
        setTimeout(()=>{ showPage(initial); },0);
    }else if(!location.hash){
        try{ history.replaceState(null,'','#/dashboard'); }catch(e){}
    }
})();
