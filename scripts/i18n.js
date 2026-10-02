const VIVID_LANG_KEY="vivid-language";
const LANGUAGES=[
  ["en","English"],["fr","Français"],["es","Español"],["de","Deutsch"],
  ["pt","Português"],["it","Italiano"],["ja","日本語"],["ko","한국어"]
];
const COPY={
  en:{home:"Home",discover:"Discover",trending:"Trending",movies:"Movies",tv:"TV",library:"My Library",signIn:"Sign in",search:"Search",terms:"Terms",privacy:"Privacy",contact:"Contact",about:"About",help:"Help & FAQ",accessibility:"Accessibility",cookies:"Cookie Policy",explore:"Explore",language:"Language"},
  fr:{home:"Accueil",discover:"Découvrir",trending:"Tendances",movies:"Films",tv:"Séries",library:"Ma bibliothèque",signIn:"Se connecter",search:"Rechercher",terms:"Conditions",privacy:"Confidentialité",contact:"Contact",about:"À propos",help:"Aide et FAQ",accessibility:"Accessibilité",cookies:"Politique des cookies",explore:"Explorer",language:"Langue"},
  es:{home:"Inicio",discover:"Descubrir",trending:"Tendencias",movies:"Películas",tv:"Series",library:"Mi biblioteca",signIn:"Iniciar sesión",search:"Buscar",terms:"Términos",privacy:"Privacidad",contact:"Contacto",about:"Acerca de",help:"Ayuda y FAQ",accessibility:"Accesibilidad",cookies:"Política de cookies",explore:"Explorar",language:"Idioma"},
  de:{home:"Startseite",discover:"Entdecken",trending:"Trends",movies:"Filme",tv:"Serien",library:"Meine Bibliothek",signIn:"Anmelden",search:"Suchen",terms:"Nutzungsbedingungen",privacy:"Datenschutz",contact:"Kontakt",about:"Über uns",help:"Hilfe & FAQ",accessibility:"Barrierefreiheit",cookies:"Cookie-Richtlinie",explore:"Entdecken",language:"Sprache"},
  pt:{home:"Início",discover:"Descobrir",trending:"Em alta",movies:"Filmes",tv:"Séries",library:"Minha biblioteca",signIn:"Entrar",search:"Pesquisar",terms:"Termos",privacy:"Privacidade",contact:"Contacto",about:"Sobre",help:"Ajuda e FAQ",accessibility:"Acessibilidade",cookies:"Política de cookies",explore:"Explorar",language:"Idioma"},
  it:{home:"Home",discover:"Scopri",trending:"Tendenze",movies:"Film",tv:"Serie TV",library:"La mia libreria",signIn:"Accedi",search:"Cerca",terms:"Termini",privacy:"Privacy",contact:"Contatti",about:"Chi siamo",help:"Aiuto e FAQ",accessibility:"Accessibilità",cookies:"Cookie",explore:"Esplora",language:"Lingua"},
  ja:{home:"ホーム",discover:"見つける",trending:"トレンド",movies:"映画",tv:"TV",library:"マイライブラリ",signIn:"サインイン",search:"検索",terms:"利用規約",privacy:"プライバシー",contact:"お問い合わせ",about:"概要",help:"ヘルプ・FAQ",accessibility:"アクセシビリティ",cookies:"Cookieポリシー",explore:"見る",language:"言語"},
  ko:{home:"홈",discover:"둘러보기",trending:"트렌딩",movies:"영화",tv:"TV",library:"내 라이브러리",signIn:"로그인",search:"검색",terms:"이용약관",privacy:"개인정보 보호",contact:"문의",about:"소개",help:"도움말 & FAQ",accessibility:"접근성",cookies:"쿠키 정책",explore:"탐색",language:"언어"}
};
const FOOTER=[
  ["terms.html","terms"],["privacy.html","privacy"],["contact.html","contact"],
  ["about.html","about"],["help.html","help"],["accessibility.html","accessibility"],["cookies.html","cookies"]
];
function getLanguage(){const saved=localStorage.getItem(VIVID_LANG_KEY);return COPY[saved]?saved:"en"}
function makeStyles(){
 if(document.getElementById("vivid-i18n-style"))return;
 const style=document.createElement("style");style.id="vivid-i18n-style";
 style.textContent=`
.vivid-language{position:relative;display:inline-flex;align-items:center;flex:0 0 auto}
.vivid-language select{appearance:none;-webkit-appearance:none;height:36px;min-width:58px;padding:0 27px 0 10px;border:1px solid rgba(255,255,255,.11);border-radius:11px;background:rgba(255,255,255,.055);color:#f5f7fa;font:600 .72rem/1 inherit;letter-spacing:.04em;outline:0;cursor:pointer}
.vivid-language select:focus{border-color:rgba(255,255,255,.3);box-shadow:0 0 0 3px rgba(255,255,255,.05)}
.vivid-language select option{background:#11151c;color:#f5f7fa;font-weight:500}
.vivid-language select option:checked{background:#202631;color:#fff}
@media(hover:hover) and (pointer:fine){.vivid-language select:hover{background:rgba(255,255,255,.085);border-color:rgba(255,255,255,.18)}}
.vivid-language:after{content:"⌄";position:absolute;right:9px;top:50%;transform:translateY(-52%);pointer-events:none;color:#9fa6b0;font-size:.72rem}
.vivid-nav .vivid-language{margin-left:2px}
.vivid-footer{display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;text-align:center}
.vivid-footer-links{display:flex;justify-content:center;gap:10px 14px;flex-wrap:wrap}
.vivid-footer-links a{color:inherit}
.landing-footer-links{display:flex;gap:12px 18px;flex-wrap:wrap}
@media(max-width:700px){.vivid-language select{height:34px;min-width:54px}.vivid-nav .vivid-language{margin-left:0}}
`;
 document.head.appendChild(style)
}
function labelForAnchor(a,lang){
 const c=COPY[lang],href=(a.getAttribute("href")||"").split("?")[0].replace(/^\.\//,"");
 if(href==="home.html"||href==="#home")return c.home;
 if(href==="discover.html")return c.discover;
 if(href.startsWith("collection.html?collection=movies")||href==="collection.html")return a.textContent.trim().toLowerCase().includes("browse")?c.discover:c.movies;
 if(href.startsWith("collection.html?collection=tv"))return c.tv;
 if(href==="library.html")return c.library;
 if(href==="#trending")return c.trending;
 if(href==="auth.html")return c.signIn;
 if(href==="terms.html")return c.terms;
 if(href==="privacy.html")return c.privacy;
 if(href==="contact.html")return c.contact;
 if(href==="about.html")return c.about;
 if(href==="help.html")return c.help;
 if(href==="accessibility.html")return c.accessibility;
 if(href==="cookies.html")return c.cookies;
 if(href==="index.html")return c.explore;
 return null
}
function translateChrome(lang){
 const c=COPY[lang];
 document.documentElement.lang=lang;
 document.querySelectorAll("nav a,a.vivid-nav-action").forEach(a=>{const next=labelForAnchor(a,lang);if(next)a.textContent=next});
 document.querySelectorAll(".vivid-nav-search input").forEach(i=>{i.placeholder=c.search;i.setAttribute("aria-label",c.search)});
 document.querySelectorAll(".vivid-footer").forEach(footer=>{
   const year=footer.querySelector(".vivid-footer-year")?.textContent||"© 2026 Vivid Cinema";
   footer.innerHTML="";
   const yearEl=document.createElement("span");yearEl.className="vivid-footer-year";yearEl.textContent=year;
   const links=document.createElement("span");links.className="vivid-footer-links";
   FOOTER.forEach(([href,key],idx)=>{const a=document.createElement("a");a.href=href;a.textContent=c[key];links.appendChild(a)});
   footer.append(yearEl,document.createTextNode(" · "),links)
 });
 document.querySelectorAll(".landing-footer-links").forEach(box=>{
   box.querySelectorAll("a").forEach(a=>{const next=labelForAnchor(a,lang);if(next)a.textContent=next})
 });
}
function addLanguagePicker(){
 if(document.querySelector(".vivid-language"))return;
 const lang=getLanguage(),c=COPY[lang];
 const wrap=document.createElement("div");wrap.className="vivid-language";
 const select=document.createElement("select");select.id="vivid-language-select";select.setAttribute("aria-label",c.language);
 LANGUAGES.forEach(([code,name])=>{const o=document.createElement("option");o.value=code;o.textContent=code.toUpperCase();o.title=name;o.selected=code===lang;select.appendChild(o)});
 select.addEventListener("change",()=>{localStorage.setItem(VIVID_LANG_KEY,select.value);translateChrome(select.value);select.setAttribute("aria-label",COPY[select.value].language)});
 wrap.appendChild(select);
 const nav=document.querySelector(".vivid-nav,.vivid-discovery-nav,.vivid-library-nav,.vivid-title-nav,.vivid-watch-nav");
 if(nav)nav.appendChild(wrap);
 else document.body.appendChild(Object.assign(wrap,{style:"position:fixed;top:12px;right:14px;z-index:3000"}));
}
function enhanceFooter(){
 document.querySelectorAll(".vivid-footer").forEach(footer=>{
   if(!footer.querySelector(".vivid-footer-links"))footer.dataset.i18nFooter="pending";
 });
}
function initI18n(){makeStyles();addLanguagePicker();enhanceFooter();translateChrome(getLanguage())}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initI18n,{once:true});else initI18n();
