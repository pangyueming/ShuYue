// ===== SHARED BOOKSHELF DATA =====
const BS_CATS=[
    {key:'slides',icon:'presentation',label:'Slides'},
    {key:'textbooks',icon:'book-open',label:'Textbooks'},
    {key:'exercises',icon:'pen-line',label:'Exercises'},
    {key:'exam-papers',icon:'file-text',label:'Exam Papers'},
    {key:'research-papers',icon:'scroll-text',label:'Research Papers'},
    {key:'notes',icon:'notebook-pen',label:'Notes'}
];
function iconHtml(name,size){size=size||16;return `<i data-lucide="${name}" style="width:${size}px;height:${size}px;flex-shrink:0;"></i>`;}
function refreshIcons(){if(window.lucide)lucide.createIcons();}
function categoryIcon(category){const c=BS_CATS.find(x=>x.key===category);return c?c.icon:'file';}
let bsData={slides:[],textbooks:[],exercises:[],'exam-papers':[],'research-papers':[],notes:[]};
let bsPageCat='slides', bsModalCat='all';
let bsPendingFile=null, bsPendingCat=null;

