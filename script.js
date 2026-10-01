import { tmdbApi } from "./scripts/tmdb.js";
import { getHomeSections, getHomeSectionPage, searchContent } from "./scripts/content.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./scripts/media.js";
import { getLocalLibrary } from "./scripts/library.js";
import { getContinueWatching, getPlaybackProgress, getPersonalRecommendations, formatProgress } from "./scripts/recommendations.js";
import { escapeHtml, debounce, getErrorMessage } from "./scripts/utils.js";

const $=id=>document.getElementById(id);
let featured=[],activeIndex=0,heroMuted=true,heroPlaying=true,heroTimer=null;
const rails={};
const sectionState={};

function skeleton(container,count=8){if(!container)return;container.innerHTML='<div class="vivid-loading">'+Array.from({length:count},()=>'<div class="vivid-skeleton-card"></div>').join("")+'</div>'}

function card(media,options={}){
 const title=media.title||"Untitled", rating=Number(media.vote_average||0).toFixed(1);
 const progress=options.progress;
 const contentId=media.content_id||((media.media_type||"movie")+":"+media.id);
 const progressBar=progress&&Number(progress.percentage)>0?'<div class="vivid-card-progress"><span style="width:'+Math.min(100,Number(progress.percentage)||0)+'%"></span></div>':"";
 return '<article class="vivid-card" data-id="'+escapeHtml(media.id)+'" data-type="'+escapeHtml(media.media_type||"movie")+'" tabindex="0" role="link" aria-label="'+escapeHtml(title)+'">'+
 '<div class="vivid-card-media"><img src="'+getImageUrl(media.poster_path,"w342")+'" alt="'+escapeHtml(title)+'" loading="lazy" decoding="async">'+
 (rating!=="0.0"?'<span class="vivid-rating">★ '+rating+"</span>":"")+progressBar+'</div>'+
 '<div class="vivid-card-info"><div class="vivid-card-title">'+escapeHtml(title)+'</div><div class="vivid-card-sub">'+escapeHtml(media.year||"—")+(media.media_type==="tv"?" · Series":" · Movie")+(progress?" · "+formatProgress(progress):"")+"</div></div></article>";
}

function wireCards(container){
 container?.querySelectorAll(".vivid-card").forEach(c=>{
   const open=()=>{
     const progress=getPlaybackProgress(c.dataset.type+":"+c.dataset.id);
     location.href=getMediaUrl({id:c.dataset.id,media_type:c.dataset.type})+(progress?"&resume=1":"");
   };
   c.addEventListener("click",open);
   c.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
 });
}

function renderRail(id,items=[],options={}){
 const el=$(id);if(!el)return;
 const normalized=items.map(x=>x.media_type?x:normalizeResults([x])[0]).filter(Boolean);
 const html=normalized.length?normalized.map(item=>card(item,{progress:options.progressMap?.[item.media_type+":"+item.id]})).join(""):'<div class="vivid-empty">Nothing available right now.</div>';
 el.innerHTML=options.append&&el.querySelector(".vivid-card")?el.innerHTML+html:html;
 wireCards(el);
 rails[id]=el;
}

function setHeroText(item){
 $("hero-title").textContent=item.title;
 $("hero-copy").textContent=item.overview||"Explore this title on Vivid Cinema.";
 $("hero-meta").innerHTML='<span>'+escapeHtml(item.year||"—")+'</span><span class="vivid-dot"></span><span>'+escapeHtml(item.media_type==="tv"?"TV Series":"Movie")+'</span><span class="vivid-dot"></span><span>★ '+Number(item.vote_average||0).toFixed(1)+'</span>';
 $("hero-watch").href=getMediaUrl(item);
 $("hero-more").onclick=()=>location.href=getMediaUrl(item);
 $("hero-fallback").style.backgroundImage=item.backdrop_path?'url("'+getImageUrl(item.backdrop_path,"w1280")+'")':"none";
}

function youtubeUrl(key,muted=true){return "https://www.youtube.com/embed/"+encodeURIComponent(key)+"?autoplay=1&mute="+(muted?1:0)+"&controls=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1"}

async function loadHeroVideo(item){
 const iframe=$("hero-video"),fallback=$("hero-fallback");
 iframe.classList.remove("is-ready");fallback.classList.add("is-visible");
 try{
   const data=item.media_type==="tv"?await tmdbApi.tvDetails(item.id):await tmdbApi.movieDetails(item.id);
   const videos=data.videos?.results||[];
   const trailer=videos.find(v=>v.site==="YouTube"&&v.type==="Trailer"&&v.official!==false)||videos.find(v=>v.site==="YouTube"&&v.type==="Teaser");
   if(trailer?.key){iframe.src=youtubeUrl(trailer.key,heroMuted);iframe.onload=()=>{iframe.classList.add("is-ready");fallback.classList.remove("is-visible")}}
   else iframe.removeAttribute("src");
 }catch(e){console.warn("Hero trailer unavailable",e)}
}

function renderFeatureStrip(){
 const track=$("feature-track");if(!track)return;
 track.innerHTML=featured.map((item,i)=>'<button class="vivid-feature-card '+(i===activeIndex?"is-active":"")+'" data-index="'+i+'" type="button"><img src="'+getImageUrl(item.backdrop_path||item.poster_path,"w342")+'" alt="" loading="lazy"><strong>'+escapeHtml(item.title)+'</strong></button>').join("");
 track.querySelectorAll(".vivid-feature-card").forEach(b=>b.addEventListener("click",()=>showHero(Number(b.dataset.index),true)));
}

async function showHero(index,userAction=false){
 if(!featured.length)return;
 activeIndex=(index+featured.length)%featured.length;
 const item=featured[activeIndex];
 setHeroText(item);renderFeatureStrip();
 $(".vivid-feature-card.is-active")?.scrollIntoView({behavior:userAction?"smooth":"auto",block:"nearest",inline:"center"});
 clearTimeout(heroTimer);
 void loadHeroVideo(item);
 heroTimer=setTimeout(()=>showHero(activeIndex+1),12000);
}

async function initHero(){
 try{
   const data=await tmdbApi.trending("all","week");
   featured=normalizeResults(data.results||[]).filter(x=>x.backdrop_path).slice(0,7);
   if(featured.length)showHero(0);
 }catch(e){$("hero-title").textContent="Discover something vivid";$("hero-copy").textContent=getErrorMessage(e)}
}

function toggleSound(){heroMuted=!heroMuted;const item=featured[activeIndex];if(item)void loadHeroVideo(item);$("hero-sound").innerHTML='<i class="bi bi-'+(heroMuted?"volume-mute-fill":"volume-up-fill")+'"></i>';$("hero-sound").setAttribute("aria-label",heroMuted?"Unmute trailer":"Mute trailer")}
function togglePause(){heroPlaying=!heroPlaying;clearTimeout(heroTimer);$("hero-pause").innerHTML='<i class="bi bi-'+(heroPlaying?"pause-fill":"play-fill")+'"></i>';$("hero-pause").setAttribute("aria-label",heroPlaying?"Pause trailer":"Play trailer");if(heroPlaying)showHero(activeIndex,true);else $("hero-video").removeAttribute("src")}

function wireRails(){
 document.querySelectorAll("[data-scroll]").forEach(btn=>btn.addEventListener("click",()=>{const el=$(btn.dataset.scroll);if(el)el.scrollBy({left:el.clientWidth*.82*Number(btn.dataset.dir),behavior:"smooth"})}));
 document.querySelectorAll(".vivid-rail").forEach(rail=>rail.addEventListener("scroll",()=>updateRailControls(rail),{passive:true}));
 window.addEventListener("resize",()=>document.querySelectorAll(".vivid-rail").forEach(updateRailControls),{passive:true});
 document.querySelectorAll("[data-load-section]").forEach(button=>button.addEventListener("click",()=>loadMoreSection(button.dataset.loadSection,button)));
}

function updateRailControls(rail){
 if(!rail)return;
 const controls=rail.closest(".vivid-rails")?.querySelector(".vivid-rail-controls");
 if(controls)controls.hidden=!(rail.scrollWidth>rail.clientWidth+8);
}

async function loadSectionBatch(keys){
 const result=await getHomeSections(keys);
 keys.forEach(key=>{
   const railId=key+"-rail";
   const data=result[key];
   if(!data)return;
   renderRail(railId,data.items);
   sectionState[key]={page:data.page,totalPages:data.totalPages};
   const button=document.querySelector('[data-load-section="'+key+'"]');
   if(button)button.hidden=data.page>=data.totalPages;
   updateRailControls($(railId));
 });
}

async function loadMoreSection(key,button){
 const state=sectionState[key]||{page:1,totalPages:1};
 if(button.disabled||state.page>=state.totalPages)return;
 button.disabled=true;button.textContent="Loading…";
 try{
   const data=await getHomeSectionPage(key,state.page+1);
   renderRail(key+"-rail",data.items,{append:true});
   sectionState[key]={page:data.page,totalPages:data.totalPages};
   button.hidden=data.page>=data.totalPages;
   updateRailControls($(key+"-rail"));
 }catch(error){button.textContent="Try again";console.warn("Vivid rail load failed:",error)}
 finally{if(!button.hidden&&button.textContent==="Loading…")button.textContent="Load more";button.disabled=false}
}

function renderContinueWatching(){
 const progressItems=getContinueWatching(10);
 if(!progressItems.length)return;
 const library=getLocalLibrary();
 const all=[...(library.history||[]),...(library.favorites||[]),...(library.watchLater||[])];
 const byKey=new Map(all.map(item=>[item.media_type+":"+item.id,item]));
 const resolved=progressItems.map(item=>byKey.get(item.content_id)).filter(Boolean);
 if(!resolved.length)return;
 const progressMap=Object.fromEntries(progressItems.map(item=>[item.content_id,item]));
 $("continue-section").hidden=false;
 renderRail("continue-rail",resolved,{progressMap});
}

async function renderRecommendations(){
 try{
   const items=await getPersonalRecommendations(12);
   if(!items.length)return;
   $("recommended-section").hidden=false;
   renderRail("recommended-rail",items);
 }catch(error){console.warn("Recommendations unavailable:",error)}
}

async function loadHome(){
 const ids=["trending-rail","now-playing-rail","movies-rail","top-rated-rail","tv-rail","top-tv-rail","airing-rail","anime-rail","kdrama-rail","upcoming-rail"];
 ids.forEach(id=>skeleton($(id)));
 renderContinueWatching();
 void renderRecommendations();
 try{
   await loadSectionBatch(["trending","nowPlaying","popularMovies"]);
   const remaining=["topRatedMovies","popularTv","topRatedTv","airingToday","anime","kdrama","upcoming"];
   const loadNext=()=>loadSectionBatch(remaining);
   if("requestIdleCallback" in window)requestIdleCallback(loadNext,{timeout:1200});else setTimeout(loadNext,80);
 }catch(e){console.error(e)}
}

function showSearch(items){
 const panel=$("search-panel");if(!panel)return;
 panel.innerHTML=items.length?items.slice(0,8).map(m=>'<a class="vivid-search-result" href="'+getMediaUrl(m)+'"><img src="'+getImageUrl(m.poster_path,"w92")+'" alt=""><span><strong>'+escapeHtml(m.title)+'</strong><br><small>'+escapeHtml(m.year||"—")+' · '+(m.media_type==="tv"?"TV":"Movie")+"</small></span></a>").join(""):'<div class="vivid-empty">No titles found.</div>';
 panel.classList.add("is-open");panel.setAttribute("aria-expanded","true");
}

const search=debounce(async q=>{
 if(!q){$("search-panel")?.classList.remove("is-open");return}
 try{showSearch(await searchContent(q),q)}catch(e){$("search-panel").innerHTML='<div class="vivid-empty">'+escapeHtml(getErrorMessage(e))+"</div>";$("search-panel").classList.add("is-open")}
},300);

function wireSearch(){
 const input=$("search-input");if(!input)return;
 input.addEventListener("input",e=>search(e.target.value.trim()));
 document.addEventListener("click",e=>{if(!e.target.closest(".vivid-nav-search")&&!e.target.closest("#search-panel"))$("search-panel")?.classList.remove("is-open")});
}
function wireHeroSwipe(){
 const hero=document.querySelector(".vivid-hero");let startX=0;
 hero.addEventListener("touchstart",e=>{startX=e.changedTouches[0].clientX},{passive:true});
 hero.addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-startX;if(Math.abs(dx)>45)showHero(activeIndex+(dx<0?1:-1),true)},{passive:true});
}
window.addEventListener("scroll",()=>$("topbar")?.classList.toggle("is-scrolled",scrollY>18),{passive:true});
document.addEventListener("keydown",e=>{if(e.target.matches("input,textarea,select"))return;if(e.key==="ArrowLeft")showHero(activeIndex-1,true);if(e.key==="ArrowRight")showHero(activeIndex+1,true)});
document.addEventListener("DOMContentLoaded",()=>{
 wireRails();wireSearch();wireHeroSwipe();
 initHero();loadHome();
 $("hero-prev")?.addEventListener("click",()=>showHero(activeIndex-1,true));
 $("hero-next")?.addEventListener("click",()=>showHero(activeIndex+1,true));
 $("hero-sound")?.addEventListener("click",toggleSound);$("hero-pause")?.addEventListener("click",togglePause);
});
