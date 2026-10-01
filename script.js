import { tmdbApi } from "./scripts/tmdb.js";
import { discoverMovies, getHomeSections, searchContent } from "./scripts/content.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./scripts/media.js";
import { escapeHtml, debounce, getErrorMessage } from "./scripts/utils.js";

const $=id=>document.getElementById(id);
let featured=[],activeIndex=0,heroMuted=true,heroPlaying=true,heroTimer=null,heroRequest=0,searchOpen=false;
const rails={};

function skeleton(container,count=8){if(!container)return;container.innerHTML='<div class="vivid-loading">'+Array.from({length:count},()=>'<div class="vivid-skeleton-card" aria-hidden="true"></div>').join("")+'</div>'}
function card(media){
 const title=media.title||"Untitled", rating=Number(media.vote_average||0).toFixed(1);
 return '<article class="vivid-card" data-id="'+escapeHtml(media.id)+'" data-type="'+escapeHtml(media.media_type)+'" tabindex="0" role="link" aria-label="'+escapeHtml(title)+'">'+
 '<div class="vivid-card-media"><img src="'+getImageUrl(media.poster_path,"w342")+'" alt="'+escapeHtml(title)+'" loading="lazy" decoding="async" onerror="this.style.visibility=\'hidden\'">'+
 (rating!=="0.0"?'<span class="vivid-rating" aria-label="Rating '+rating+' out of 10">★ '+rating+"</span>":"")+'</div>'+
 '<div class="vivid-card-info"><div class="vivid-card-title">'+escapeHtml(title)+'</div><div class="vivid-card-sub">'+escapeHtml(media.year||"—")+(media.media_type==="tv"?" · Series":" · Movie")+"</div></div></article>";
}
function renderRail(id,items=[]){
 const el=$(id);if(!el)return;
 const normalized=items.map(x=>x.media_type?x:normalizeResults([x])[0]).filter(Boolean);
 el.innerHTML=normalized.length?normalized.map(card).join(""):'<div class="vivid-empty">Nothing available right now.</div>';
 el.querySelectorAll(".vivid-card").forEach(c=>{
   const open=()=>location.href=getMediaUrl({id:c.dataset.id,media_type:c.dataset.type});
   c.addEventListener("click",open);c.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
 });
 rails[id]=el;
}
function setHeroText(item){
 $("hero-title").textContent=item.title;
 $("hero-copy").textContent=item.overview||"Explore this title on Vivid Cinema.";
 $("hero-meta").innerHTML='<span>'+escapeHtml(item.year||"—")+'</span><span class="vivid-dot"></span><span>'+escapeHtml(item.media_type==="tv"?"TV Series":"Movie")+'</span><span class="vivid-dot"></span><span>★ '+Number(item.vote_average||0).toFixed(1)+'</span>';
 $("hero-watch").href=getMediaUrl(item);$("hero-more").onclick=()=>location.href=getMediaUrl(item);
 $("hero-fallback").style.backgroundImage=item.backdrop_path?'url("'+getImageUrl(item.backdrop_path,"w1280")+'")':"none";
}
function youtubeUrl(key,muted=true){return "https://www.youtube.com/embed/"+encodeURIComponent(key)+"?autoplay=1&mute="+(muted?1:0)+"&controls=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1"}
async function loadHeroVideo(item){
 const iframe=$("hero-video"),fallback=$("hero-fallback"),request=++heroRequest;
 iframe.classList.remove("is-ready");fallback.classList.add("is-visible");
 try{
   const data=item.media_type==="tv"?await tmdbApi.tvDetails(item.id):await tmdbApi.movieDetails(item.id);
   if(request!==heroRequest)return;
   const videos=data.videos?.results||[];
   const trailer=videos.find(v=>v.site==="YouTube"&&v.type==="Trailer"&&v.official!==false)||videos.find(v=>v.site==="YouTube"&&v.type==="Teaser");
   if(trailer?.key){
     iframe.src=youtubeUrl(trailer.key,heroMuted);
     iframe.onload=()=>{if(request===heroRequest){iframe.classList.add("is-ready");fallback.classList.remove("is-visible")}};
   }else{iframe.removeAttribute("src");}
 }catch(e){if(request===heroRequest)console.warn("Hero trailer unavailable",e)}
}
function renderFeatureStrip(){
 const track=$("feature-track");if(!track)return;
 track.innerHTML=featured.map((item,i)=>'<button class="vivid-feature-card '+(i===activeIndex?"is-active":"")+'" data-index="'+i+'" type="button" aria-label="Show '+escapeHtml(item.title)+'"><img src="'+getImageUrl(item.backdrop_path||item.poster_path,"w342")+'" alt="" loading="lazy" decoding="async"><strong>'+escapeHtml(item.title)+'</strong></button>').join("");
 track.querySelectorAll(".vivid-feature-card").forEach(b=>b.addEventListener("click",()=>showHero(Number(b.dataset.index),true)));
}
async function showHero(index,userAction=false){
 if(!featured.length)return;
 activeIndex=(index+featured.length)%featured.length;
 const item=featured[activeIndex];setHeroText(item);renderFeatureStrip();
 const active=document.querySelector(".vivid-feature-card.is-active");active?.scrollIntoView({behavior:userAction?"smooth":"auto",block:"nearest",inline:"center"});
 clearTimeout(heroTimer);await loadHeroVideo(item);
 if(heroPlaying)heroTimer=setTimeout(()=>showHero(activeIndex+1),12000);
}
async function initHero(){
 try{
   const data=await tmdbApi.trending("all","week");
   featured=normalizeResults(data.results||[]).filter(x=>x.backdrop_path).slice(0,7);
   if(featured.length)await showHero(0);
   else throw new Error("No featured titles available");
 }catch(e){$("hero-title").textContent="Discover something vivid";$("hero-copy").textContent=getErrorMessage(e)}
}
function toggleSound(){
 heroMuted=!heroMuted;const item=featured[activeIndex];if(item)loadHeroVideo(item);
 $("hero-sound").innerHTML='<i class="bi bi-'+(heroMuted?"volume-mute-fill":"volume-up-fill")+'"></i>';
 $("hero-sound").setAttribute("aria-label",heroMuted?"Unmute trailer":"Mute trailer");
}
function togglePause(){
 heroPlaying=!heroPlaying;clearTimeout(heroTimer);
 $("hero-pause").innerHTML='<i class="bi bi-'+(heroPlaying?"pause-fill":"play-fill")+'"></i>';
 if(heroPlaying){const item=featured[activeIndex];if(item)loadHeroVideo(item);heroTimer=setTimeout(()=>showHero(activeIndex+1),12000)}
 else{$("hero-video").src="";$("hero-video").classList.remove("is-ready");$("hero-fallback").classList.add("is-visible")}
 $("hero-pause").setAttribute("aria-label",heroPlaying?"Pause trailer":"Play trailer");
}
function wireRails(){
 document.querySelectorAll("[data-scroll]").forEach(btn=>btn.addEventListener("click",()=>{const el=$(btn.dataset.scroll);if(el)el.scrollBy({left:el.clientWidth*.82*Number(btn.dataset.dir),behavior:"smooth"})}));
}
async function loadHome(){
 ["trending-rail","movies-rail","top-rail","tv-rail","anime-rail","kdrama-rail","upcoming-rail"].forEach(id=>skeleton($(id)));
 const s=await getHomeSections();
 renderRail("trending-rail",s.trending);renderRail("movies-rail",s.popularMovies);renderRail("top-rail",s.topRatedMovies);renderRail("tv-rail",s.popularTv);renderRail("upcoming-rail",s.upcoming);
 const [anime,kdrama]=await Promise.allSettled([
   discoverMovies({with_genres:16,sort_by:"popularity.desc"}),
   tmdbApi.discoverTv({with_original_language:"ko",sort_by:"popularity.desc"}).then(d=>normalizeResults(d.results||[],"tv"))
 ]);
 renderRail("anime-rail",anime.status==="fulfilled"?anime.value:[]);
 renderRail("kdrama-rail",kdrama.status==="fulfilled"?kdrama.value:[]);
}
function showSearch(items){
 const panel=$("search-panel");if(!panel)return;
 panel.innerHTML=items.length?items.slice(0,8).map(m=>'<a class="vivid-search-result" href="'+getMediaUrl(m)+'"><img src="'+getImageUrl(m.poster_path,"w92")+'" alt=""><span><strong>'+escapeHtml(m.title)+'</strong><br><small>'+escapeHtml(m.year||"—")+' · '+(m.media_type==="tv"?"TV":"Movie")+"</small></span></a>").join(""):'<div class="vivid-empty">No titles found.</div>';
 panel.classList.add("is-open");panel.setAttribute("aria-expanded","true");searchOpen=true;
}
const search=debounce(async q=>{
 if(!q){$("search-panel")?.classList.remove("is-open");searchOpen=false;return}
 try{showSearch(await searchContent(q))}catch(e){$("search-panel").innerHTML='<div class="vivid-empty">'+escapeHtml(getErrorMessage(e))+"</div>";$("search-panel").classList.add("is-open")}
},300);
function wireSearch(){
 const input=$("search-input");if(!input)return;
 input.addEventListener("input",e=>search(e.target.value.trim()));
 input.addEventListener("focus",()=>input.closest(".vivid-nav-search")?.classList.add("is-focused"));
 document.addEventListener("click",e=>{
   if(!e.target.closest(".vivid-nav-search")&&!e.target.closest("#search-panel")){$("search-panel")?.classList.remove("is-open");searchOpen=false;input.closest(".vivid-nav-search")?.classList.remove("is-focused")}
 });
}
function wireHeroSwipe(){
 const hero=document.querySelector(".vivid-hero");let startX=0,startY=0;
 hero.addEventListener("touchstart",e=>{startX=e.changedTouches[0].clientX;startY=e.changedTouches[0].clientY},{passive:true});
 hero.addEventListener("touchend",e=>{const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.25)showHero(activeIndex+(dx<0?1:-1),true)},{passive:true});
}
window.addEventListener("scroll",()=>$("topbar")?.classList.toggle("is-scrolled",scrollY>18),{passive:true});
document.addEventListener("visibilitychange",()=>{if(document.hidden){clearTimeout(heroTimer)}else if(heroPlaying&&featured.length){clearTimeout(heroTimer);heroTimer=setTimeout(()=>showHero(activeIndex+1),8000)}});
document.addEventListener("keydown",e=>{
 if(e.target.matches("input,textarea,select"))return;
 if(e.key==="ArrowLeft")showHero(activeIndex-1,true);if(e.key==="ArrowRight")showHero(activeIndex+1,true);
});
document.addEventListener("DOMContentLoaded",()=>{
 wireRails();wireSearch();wireHeroSwipe();initHero();loadHome();
 $("hero-prev")?.addEventListener("click",()=>showHero(activeIndex-1,true));$("hero-next")?.addEventListener("click",()=>showHero(activeIndex+1,true));
 $("hero-sound")?.addEventListener("click",toggleSound);$("hero-pause")?.addEventListener("click",togglePause);
});
