import { tmdbApi } from "./tmdb.js";
import { getHomeSectionPage } from "./content.js";
import { getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";

const RAILS = Object.freeze({
  trending:"trending-rail",
  nowPlaying:"now-playing-rail",
  popularMovies:"movies-rail",
  topRatedMovies:"top-rated-rail",
  popularTv:"tv-rail",
  topRatedTv:"top-tv-rail",
  upcoming:"upcoming-rail"
});

const $ = id => document.getElementById(id);

function card(item){
  const title=escapeHtml(item.title||"Untitled");
  const type=item.media_type==="tv"?"Series":"Movie";
  const rating=Number(item.vote_average||0);
  return '<article class="vivid-card" data-id="'+escapeHtml(item.id)+'" data-type="'+item.media_type+'" tabindex="0" role="link" aria-label="'+title+'">'+
    '<div class="vivid-card-media"><img src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+title+'" loading="lazy" decoding="async">'+
    (rating>0?'<span class="vivid-rating">★ '+rating.toFixed(1)+'</span>':"")+'</div>'+
    '<div class="vivid-card-info"><div class="vivid-card-title">'+title+'</div><div class="vivid-card-sub">'+escapeHtml(item.year||"—")+" · "+type+"</div></div></article>";
}
function wireCards(rail){
  rail.querySelectorAll(".vivid-card").forEach(el=>{
    const open=()=>{location.href=getMediaUrl({id:el.dataset.id,media_type:el.dataset.type})};
    el.addEventListener("click",open);
    el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
  });
}
function render(key,items){
  const rail=$(RAILS[key]); if(!rail)return;
  rail.innerHTML=items?.length?items.map(card).join(""):'<div class="vivid-empty">Nothing available right now.</div>';
  wireCards(rail);
}
function skeletons(){
  Object.values(RAILS).forEach(id=>{
    const rail=$(id);
    if(rail&&!rail.querySelector(".vivid-card")&&!rail.querySelector(".vivid-skeleton-card"))
      rail.innerHTML='<div class="vivid-loading">'+Array.from({length:8},()=>'<div class="vivid-skeleton-card"></div>').join("")+'</div>';
  });
}
async function loadCatalogue(){
  skeletons();
  const keys=Object.keys(RAILS);
  const results=await Promise.allSettled(keys.map(key=>getHomeSectionPage(key,1)));
  results.forEach((result,i)=>{
    const key=keys[i],rail=$(RAILS[key]);
    if(result.status==="fulfilled"){
      render(key,result.value.items||[]);
      const button=document.querySelector('[data-load-section="'+key+'"]');
      if(button)button.hidden=Number(result.value.page||1)>=Number(result.value.totalPages||1);
    }else if(rail){
      rail.innerHTML='<div class="vivid-empty">Unable to load this section. Try again.</div>';
      console.warn("Vivid Home fallback failed:",key,result.reason);
    }
  });
}
async function loadHeroFallback(){
  const title=$("hero-title"),copy=$("hero-copy"),meta=$("hero-meta"),bg=$("hero-fallback"),watch=$("hero-watch"),more=$("hero-more");
  if(!title||title.textContent!=="Loading Vivid Cinema…")return;
  try{
    const data=await tmdbApi.trending("all","week");
    const item=(data.results||[]).find(x=>x?.backdrop_path||x?.poster_path);
    if(!item)return;
    const name=item.title||item.name||"Untitled";
    title.textContent=name;
    copy.textContent=item.overview||"Explore this title on Vivid Cinema.";
    meta.innerHTML='<span>'+escapeHtml((item.release_date||item.first_air_date||"").slice(0,4)||"—")+'</span><span class="vivid-dot"></span><span>'+escapeHtml(item.media_type==="tv"?"TV Series":"Movie")+'</span>';
    if(bg)bg.style.backgroundImage='url("'+getImageUrl(item.backdrop_path||item.poster_path,"w1280")+'")';
    if(watch)watch.href="watch.html?id="+encodeURIComponent(item.id)+"&type="+encodeURIComponent(item.media_type==="tv"?"tv":"movie");
    if(more)more.onclick=()=>{location.href=getMediaUrl({id:item.id,media_type:item.media_type==="tv"?"tv":"movie"})};
  }catch(error){console.warn("Vivid Home hero fallback failed:",error)}
}
function boot(){
  if(document.body?.dataset?.vividPage!=="home")return;
  window.setTimeout(()=>{
    const first=$(RAILS.trending);
    if(!first?.querySelector(".vivid-card"))void loadCatalogue();
    void loadHeroFallback();
  },1800);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});
else boot();
