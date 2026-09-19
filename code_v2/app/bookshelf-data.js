// ===== SHARED BOOKSHELF DATA =====
const BS_CATS=[
    {key:'slides',icon:'presentation',label:'课件'},
    {key:'textbooks',icon:'book-open',label:'教材'},
    {key:'exercises',icon:'pen-line',label:'习题'},
    {key:'exam-papers',icon:'file-text',label:'真题卷'},
    {key:'research-papers',icon:'scroll-text',label:'文献'},
    {key:'notes',icon:'notebook-pen',label:'笔记'}
];
function iconHtml(name,size){size=size||16;return `<i data-lucide="${name}" style="width:${size}px;height:${size}px;flex-shrink:0;"></i>`;}
function refreshIcons(){if(window.lucide)lucide.createIcons();}
function categoryIcon(category){const c=BS_CATS.find(x=>x.key===category);return c?c.icon:'file';}
let bsData={slides:[],textbooks:[],exercises:[],'exam-papers':[],'research-papers':[],notes:[]};
let bsPageCat='slides', bsModalCat='all';
let bsPendingFile=null, bsPendingCat=null;

