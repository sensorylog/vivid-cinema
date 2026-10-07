import { tmdbApi } from "./scripts/tmdb.js";
import { getHomeSections, getHomeSectionPage, searchContent } from "./scripts/content.js";
import { getImageUrl, getMediaUrl, getPersonUrl, normalizeResults } from "./scripts/media.js";
import { getLocalLibrary } from "./scripts/library.js";
import { getContinueWatching, getPlaybackProgress, getPersonalRecommendations, getBecauseYouLiked, getTonightPick, dismissTonightPick, formatProgress } from "./scripts/recommendations.js";
import { escapeHtml, debounce, getErrorMessage } from "./scripts/utils.js";
import { buildWatchUrl } from "./scripts/routes.js";
import { checkForReleaseAlerts, deliverReleaseAlerts, getPendingReleaseAlerts, requestReleaseAlerts, dismissReleaseAlert, clearReleaseAlerts, getReleaseAlertState } from "./scripts/release-alerts.js";
import { startIntelligenceSync, shouldShowColdStart, completeColdStart, dismissColdStart, recordBehavior, getTasteProfile, getTasteStrength } from "./scripts/intelligence.js";
import { searchIntelligently, getRecentSearches, rememberSearch, clearRecentSearches } from "./scripts/search.js";
import { startCinemaReminderLoop } from "./scripts/cinema-reminders.js";
import { enableCinemaPush, getServerReleaseAlerts, dismissServerReleaseAlert } from "./scripts/push-notifications.js";

const $=id=>document.getElementById(id);
let featured=[],activeIndex=0,heroMuted=true,heroPlaying=true,heroTimer=null,heroLoadToken=0;

const rails={};
let serverReleaseAlerts=[];
const sectionState={};
const loadingSections=new Set();

const SECTION_RAIL_IDS=Object.freeze({
 trending:"trending-rail",
 nowPlaying:"now-playing-rail",
 popularMovies:"movies-rail",
 topRatedMovies:"top-rated-rail",
 popularTv:"tv-rail",
 topRatedTv:"top-tv-rail",
 airingToday:"airing-rail",
 anime:"anime-rail",
 kdrama:"kdrama-rail",
 upcoming:"upcoming-rail"
});

function skeleton(container,count=8){if(!container)return;container.innerHTML='<div class="vivid-loading">'+Array.from({length:count},()=>'<div class="vivid-skeleton-card"></div>').join("")+'</div>'}

function card(media,options={}){
 const title=media.title||"Untitled", rating=Number(media.vote_average||0).toFixed(1);
 const progress=options.progress;
 const signal=options.signal||"";
 const progressBar=progress&&Number(progress.percentage)>0?'<div class="vivid-card-progress"><span style="width:'+Math.min(100,Number(progress.percentage)||0)+'%"></span></div>':"";
 return '<article class="vivid-card" data-id="'+escapeHtml(media.id)+'" data-type="'+escapeHtml(media.media_type||"movie")+'" tabindex="0" role="link" aria-label="'+escapeHtml(title)+'">'+
 '<div class="vivid-card-media"><img src="'+getImageUrl(media.poster_path,"w342")+'" alt="'+escapeHtml(title)+'" loading="lazy" decoding="async">'+
 (signal?'<span class="vivid-card-signal">'+escapeHtml(signal)+"</span>":"")+(rating!=="0.0"?'<span class="vivid-rating">★ '+rating+"</span>":"")+progressBar+'</div>'+
 '<div class="vivid-card-info"><div class="vivid-card-title">'+escapeHtml(title)+'</div><div class="vivid-card-sub">'+escapeHtml(media.year||"—")+(media.media_type==="tv"?" · Series":" · Movie")+(progress?" · "+formatProgress(progress):"")+"</div></div></article>";
}

function wireCards(container){
 container?.querySelectorAll(".vivid-card").forEach(c=>{
   const open=()=>{
     if(c.dataset.recommendation==="true"){
       recordBehavior("recommendation_clicked",{id:c.dataset.id,media_type:c.dataset.type,title:c.dataset.title||""},{surface:c.dataset.surface||"recommendation",position:Number(c.dataset.position||0)});
     }
     const progress=getPlaybackProgress(c.dataset.type+":"+c.dataset.id);
     location.href=progress ? buildWatchUrl(c.dataset.id,c.dataset.type,progress.season,progress.episode,progress.progress) : getMediaUrl({id:c.dataset.id,media_type:c.dataset.type});
   };
   c.addEventListener("click",open);
   c.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
 });
}

async function renderTonightPick() {
  const section = $("tonight-section");
  if (!section) return;
  try {
    const items = await getTonightPick({ limit: 8 });
    const item = items[0];
    if (!item) { section.hidden = true; return; }
    section.hidden = false;
    $("tonight-title").textContent = item.title;
    $("tonight-reason").textContent = item.recommendationReason || "A strong match for your taste tonight.";
    $("tonight-poster").src = getImageUrl(item.poster_path, "w500");
    $("tonight-poster").alt = item.title + " poster";
    $("tonight-watch").href = buildWatchUrl(item.id, item.media_type || "movie");
    $("tonight-another").onclick = async () => { dismissTonightPick(item); await renderTonightPick(); };
    $("tonight-not-tonight").onclick = async () => { dismissTonightPick(item); await renderTonightPick(); };
  } catch {
    section.hidden = true;
  }
}
function renderRail(id,items=[],options={}){
 const el=$(id);if(!el)return;
 const normalized=items.map(x=>x.media_type?x:normalizeResults([x])[0]).filter(Boolean);
 const isRecommendation=/^(recommended-rail|because-rail)$/.test(id);
 const html=normalized.length?normalized.map((item,index)=>{const markup=card(item,{progress:options.progressMap?.[item.media_type+":"+item.id],signal:options.signal});if(isRecommendation){const key=item.media_type+":"+item.id;recordBehavior("recommendation_impression",item,{surface:id,position:index});return markup.replace("<article class=\"vivid-card\"","<article data-recommendation=\"true\" data-surface=\""+id+"\" data-position=\""+index+"\" data-title=\""+escapeHtml(item.title||"").replace(/"/g,"&quot;")+"\" class=\"vivid-card\"");}return markup;}).join(""):'<div class="vivid-empty">Nothing available right now.</div>';
 el.innerHTML=options.append&&el.querySelector(".vivid-card")?el.innerHTML+html:html;
 wireCards(el);
 rails[id]=el;
}

function sectionSignal(key){
 const labels={trending:"Trending",nowPlaying:"Now playing",popularMovies:"Popular",topRatedMovies:"Top rated",popularTv:"Popular",topRatedTv:"Top rated",airingToday:"Airing today",anime:"Anime",kdrama:"K-Drama",upcoming:"Coming soon"};
 return labels[key]||"";
}

function formatRuntime(item){
 const minutes=Number(item?.raw?.runtime||item?.runtime||0);
 if(!Number.isFinite(minutes)||minutes<=0)return "";
 const hours=Math.floor(minutes/60), mins=minutes%60;
 return hours ? hours+"h"+(mins?" "+mins+"m":"") : minutes+"m";
}
function setHeroText(item){
 $("hero-title").textContent=item.title;
 $("hero-copy").textContent=item.overview||"Explore this title on Vivid Cinema.";
 const runtime=formatRuntime(item);
 const meta=['<span>'+escapeHtml(item.year||"—")+'</span>','<span class="vivid-dot"></span>','<span>'+escapeHtml(item.media_type==="tv"?"TV Series":"Movie")+'</span>'];
 if(runtime) meta.push('<span class="vivid-dot"></span>','<span>'+escapeHtml(runtime)+'</span>');
 if(Number(item.vote_average||0)>0) meta.push('<span class="vivid-dot"></span>','<span>★ '+Number(item.vote_average).toFixed(1)+'</span>');
 $("hero-meta").innerHTML=meta.join("");
 $("hero-watch").href=buildWatchUrl(item.id,item.media_type,item.media_type==="tv"?1:null,item.media_type==="tv"?1:null);
 $("hero-more").onclick=()=>location.href=getMediaUrl(item);
 $("hero-fallback").style.backgroundImage=item.backdrop_path?'url("'+getImageUrl(item.backdrop_path,"w1280")+'")':"none";
}
function youtubeUrl(key,muted=true){
 const params=new URLSearchParams({
   autoplay:"1",mute:muted?"1":"0",controls:"0",playsinline:"1",rel:"0",
   iv_load_policy:"3",enablejsapi:"1",origin:window.location.origin
 });
 return "https://www.youtube.com/embed/"+encodeURIComponent(key)+"?"+params.toString();
}

function sendHeroPlayerCommand(func){
 const iframe=$("hero-video");
 if(!iframe?.contentWindow)return false;
 try{iframe.contentWindow.postMessage(JSON.stringify({event:"command",func,args:[]}),"https://www.youtube.com");return true}catch{return false}
}

async function loadHeroVideo(item){
 const iframe=$("hero-video"),fallback=$("hero-fallback");
 if(!iframe||!fallback||!item)return false;
 const token=++heroLoadToken;
 iframe.classList.remove("is-ready");
 fallback.classList.add("is-visible");
 try{
   const data=item.media_type==="tv"?await tmdbApi.tvDetails(item.id):await tmdbApi.movieDetails(item.id);
   if(token!==heroLoadToken)return false;
   const videos=data?.videos?.results||[];
   const trailer=
     videos.find(v=>v?.site==="YouTube"&&v?.key&&v.type==="Trailer"&&v.official!==false)||
     videos.find(v=>v?.site==="YouTube"&&v?.key&&v.type==="Trailer")||
     videos.find(v=>v?.site==="YouTube"&&v?.key&&v.type==="Teaser")||
     videos.find(v=>v?.site==="YouTube"&&v?.key);
   if(!trailer?.key){iframe.removeAttribute("src");iframe.dataset.videoKey="";return false;}
   iframe.onload=()=>{
     if(token!==heroLoadToken)return;
     iframe.classList.add("is-ready");
     fallback.classList.remove("is-visible");
     if(!heroPlaying){sendHeroPlayerCommand("pauseVideo");return;}
     // Some browsers/YouTube player loads ignore the first autoplay attempt even
     // when the embed is muted. Retry through the documented IFrame API command
     // channel without rebuilding the iframe or changing the current title.
     [250,800,1800,3200].forEach(delay=>setTimeout(()=>{
       if(token!==heroLoadToken||!heroPlaying)return;
       sendHeroPlayerCommand("playVideo");
     },delay));
   };
   iframe.onerror=()=>{if(token!==heroLoadToken)return;iframe.classList.remove("is-ready");fallback.classList.add("is-visible");};
   iframe.src=youtubeUrl(trailer.key,heroMuted);
   iframe.dataset.videoKey=trailer.key;
   return true;
 }catch(error){
   if(token!==heroLoadToken)return false;
   iframe.classList.remove("is-ready");
   fallback.classList.add("is-visible");
   console.warn("Hero trailer unavailable:",error);
   return false;
 }
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
 setHeroText(item);
 renderFeatureStrip();
 const activeCard=document.querySelector(".vivid-feature-card.is-active");
 if(activeCard){
   const track=$("feature-track");
   const left=activeCard.offsetLeft-Math.max(0,(track.clientWidth-activeCard.offsetWidth)/2);
   track.scrollTo({left:Math.max(0,left),behavior:userAction?"smooth":"auto"});
 }
 clearTimeout(heroTimer);
 void loadHeroVideo(item);
 heroTimer=setTimeout(()=>showHero(activeIndex+1),18000);
}
async function initHero(){
 try{
   let data;
   try{data=await tmdbApi.trending("all","week")}catch(e){console.warn("Featured fallback",e);data=await tmdbApi.trending("movie","week")}
   featured=normalizeResults(data.results||[]).filter(x=>x.backdrop_path||x.poster_path).slice(0,8);
   if(featured[0]?.backdrop_path){const preload=new Image();preload.decoding="async";preload.src=getImageUrl(featured[0].backdrop_path,"w1280");}
   if(featured.length)showHero(0);
 }catch(e){$("hero-title").textContent="Discover something vivid";$("hero-copy").textContent=getErrorMessage(e)}
}

function toggleSound(){
 heroMuted=!heroMuted;
 const changed=sendHeroPlayerCommand(heroMuted?"mute":"unMute");
 if(!changed){const item=featured[activeIndex];if(item)void loadHeroVideo(item);}
 const button=$("hero-sound");
 if(button){button.innerHTML='<i class="bi bi-'+(heroMuted?"volume-mute-fill":"volume-up-fill")+'"></i>';button.setAttribute("aria-label",heroMuted?"Unmute trailer":"Mute trailer");}
}
function togglePause(){
 heroPlaying=!heroPlaying;
 clearTimeout(heroTimer);
 sendHeroPlayerCommand(heroPlaying?"playVideo":"pauseVideo");
 const button=$("hero-pause");
 if(button){button.innerHTML='<i class="bi bi-'+(heroPlaying?"pause-fill":"play-fill")+'"></i>';button.setAttribute("aria-label",heroPlaying?"Pause trailer":"Play trailer");}
 if(heroPlaying)heroTimer=setTimeout(()=>showHero(activeIndex+1),18000);
}

function wireRails(){
 document.querySelectorAll("[data-scroll]").forEach(btn=>btn.addEventListener("click",e=>{
   e.preventDefault();
   const el=$(btn.dataset.scroll);
   if(el)el.scrollBy({left:el.clientWidth*.82*Number(btn.dataset.dir),behavior:"smooth"});
 }));
 document.querySelectorAll(".vivid-rail").forEach(rail=>rail.addEventListener("scroll",()=>updateRailControls(rail),{passive:true}));
 window.addEventListener("resize",()=>document.querySelectorAll(".vivid-rail").forEach(updateRailControls),{passive:true});
 document.addEventListener("click",e=>{
   const button=e.target.closest("[data-load-section]");
   if(!button)return;
   e.preventDefault();
   e.stopPropagation();
   void loadMoreSection(button.dataset.loadSection,button);
 });
}

function updateRailControls(rail){
 if(!rail)return;
 const controls=rail.closest(".vivid-rails")?.querySelector(".vivid-rail-controls");
 if(controls)controls.hidden=!(rail.scrollWidth>rail.clientWidth+8);
}

async function loadSectionBatch(keys){
 const results=await Promise.allSettled(keys.map(key=>getHomeSectionPage(key,1)));
 results.forEach((result,index)=>{
   const key=keys[index];
   const railId=SECTION_RAIL_IDS[key];
   if(!railId)return;
   if(result.status!=="fulfilled"){
     console.warn("Vivid home section failed:",key,result.reason);
     const el=$(railId);
     if(el)el.innerHTML='<div class="vivid-empty">Unable to load this section. Try again.</div>';
     return;
   }
   const data=result.value;
   renderRail(railId,data.items,{signal:sectionSignal(key)});
   sectionState[key]={page:data.page,totalPages:data.totalPages};
   const button=document.querySelector('[data-load-section="'+key+'"]');
   if(button)button.hidden=data.page>=data.totalPages;
   updateRailControls($(railId));
 });
}

async function loadMoreSection(key,button){
 if(!button||button.disabled||loadingSections.has(key))return;
 const railId=SECTION_RAIL_IDS[key];
 if(!railId){
   console.warn("Vivid load more: unknown section",key);
   return;
 }
 // If state was never recorded (race / partial load), still try the next page.
 const state=sectionState[key];
 const currentPage=Number(state?.page||1);
 const totalPages=Number(state?.totalPages||500);
 if(state&&currentPage>=totalPages){
   button.hidden=true;
   return;
 }
 const nextPage=Math.min(currentPage+1,totalPages);
 button.disabled=true;
 loadingSections.add(key);
 button.setAttribute("aria-busy","true");
 button.textContent="Loading…";
 try{
   const data=await getHomeSectionPage(key,nextPage);
   if(!data.items.length){
     // Nothing more from TMDB — stop the button cleanly.
     sectionState[key]={page:data.page||nextPage,totalPages:data.page||nextPage};
     button.hidden=true;
     button.textContent="Load more";
     return;
   }
   renderRail(railId,data.items,{append:true,signal:sectionSignal(key)});
   $(railId)?.classList.add("is-expanded");
   sectionState[key]={page:data.page,totalPages:data.totalPages};
   button.hidden=data.page>=data.totalPages;
   button.textContent="Load more";
   updateRailControls($(railId));
 }catch(error){
   button.textContent="Try again";
   console.warn("Vivid rail load failed:",key,error);
 }finally{
   loadingSections.delete(key);
   button.disabled=false;
   button.removeAttribute("aria-busy");
   if(!button.hidden && button.textContent==="Loading…")button.textContent="Load more";
 }
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
   const [items,because]=await Promise.all([getPersonalRecommendations(12),getBecauseYouLiked(12)]);
     await renderTonightPick();
   if(items.length){
     $("recommended-section").hidden=false;
     renderRail("recommended-rail",items);
   }
   if(because.length){
     const seed=because[0]?.recommendationReason?.replace(/^Because you liked /,"");
     if(seed) $("because-title").textContent="Because you liked "+seed;
     $("because-section").hidden=false;
     renderRail("because-rail",because);
   }
 }catch(error){console.warn("Recommendations unavailable:",error)}
}
async function composeHomepage() {
  const strength = getTasteStrength();
  const wrap = document.querySelector(".vivid-section-wrap");
  if (!wrap || strength < 0.28) return;
  const sections = ["continue-section","recommended-section","because-section","tonight-section","trending","now-playing","tv","upcoming","movies","top-rated","top-tv"]
    .map(id => document.getElementById(id)).filter(Boolean);
  ["movies","top-rated","top-tv"].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  if (strength >= 0.55) { const el = document.getElementById("tv"); if (el) el.hidden = true; }
  const order = ["continue-section","recommended-section","because-section","tonight-section","trending","now-playing","tv","upcoming","movies","top-rated","top-tv"];
  order.forEach(id => { const el = document.getElementById(id); if (el) wrap.appendChild(el); });
  const head = document.querySelector("#recommended-section .vivid-rail-head p");
  if (head) head.textContent = "A mix shaped by what you watch, like and finish.";
  const trending = document.querySelector("#trending .vivid-rail-head p");
  if (trending) trending.textContent = "A fresh signal beyond your usual taste.";
  try {
    const taste = await getTasteProfile();
    if (Number(taste.media?.tv || 0) > Number(taste.media?.movie || 0)) {
      const tv = document.getElementById("tv");
      const upcoming = document.getElementById("upcoming");
      if (tv) tv.hidden = false;
      if (upcoming) upcoming.hidden = true;
    }
  } catch {}
}

async function maybeShowColdStart(){
 if(!shouldShowColdStart())return;
 try{
  const data=await getHomeSectionPage("trending",1);
  const candidates=normalizeResults(data.items||[]).slice(0,10);
  if(candidates.length<3)return;
  const selected=new Set();
  const modal=document.createElement("div");
  modal.className="vivid-onboarding-modal";
  modal.innerHTML='<div class="vivid-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="vivid-onboarding-title"><div class="vivid-onboarding-head"><div><span>MAKE VIVID YOURS</span><h2 id="vivid-onboarding-title">Pick a few you already love.</h2><p>Choose at least 3. We’ll use them to shape your first recommendations.</p></div><button type="button" class="vivid-onboarding-close" aria-label="Skip personalization"><i class="bi bi-x-lg"></i></button></div><div class="vivid-onboarding-grid">'+candidates.map(item=>'<button type="button" class="vivid-onboarding-card" data-key="'+escapeHtml(item.media_type+":"+item.id)+'"><img src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(item.title)+'"><span>'+escapeHtml(item.title)+'</span></button>').join("")+'</div><div class="vivid-onboarding-actions"><small id="vivid-onboarding-count">0 selected</small><div><button type="button" class="vivid-button vivid-button--ghost" id="vivid-onboarding-skip">Skip</button><button type="button" class="vivid-button vivid-button--primary" id="vivid-onboarding-save" disabled>Continue</button></div></div></div>';
  document.body.appendChild(modal);
  const update=()=>{const n=selected.size;modal.querySelector("#vivid-onboarding-count").textContent=n+" selected";modal.querySelector("#vivid-onboarding-save").disabled=n<3};
  modal.querySelectorAll(".vivid-onboarding-card").forEach(button=>button.addEventListener("click",()=>{const k=button.dataset.key;if(selected.has(k)){selected.delete(k);button.classList.remove("is-selected")}else if(selected.size<6){selected.add(k);button.classList.add("is-selected")}update()}));
  const close=()=>{dismissColdStart();modal.remove()};
  modal.querySelector(".vivid-onboarding-close").addEventListener("click",close);
  modal.querySelector("#vivid-onboarding-skip").addEventListener("click",close);
  modal.querySelector("#vivid-onboarding-save").addEventListener("click",async()=>{await completeColdStart(candidates.filter(x=>selected.has(x.media_type+":"+x.id)));modal.remove();await renderRecommendations()});
 }catch(error){console.warn("Vivid cold-start unavailable:",error)}
}

async function loadHome(){
 const ids=["trending-rail","now-playing-rail","movies-rail","top-rated-rail","tv-rail","top-tv-rail","upcoming-rail"];
 ids.forEach(id=>skeleton($(id)));
 renderContinueWatching();

 // The first viewport gets the smallest useful data set first. Secondary shelves
 // still load automatically, but they never compete with the hero and first rows.
 const primary=["trending","nowPlaying","popularMovies"];
 try{await loadSectionBatch(primary)}catch(error){console.warn("Vivid primary home load failed:",error)}

 const loadSecondary=async()=>{
   // Keep secondary shelves from creating a seven-request burst. Each small
   // batch can paint before the next one starts, keeping scrolling responsive.
   for(const batch of [["topRatedMovies","popularTv"],["topRatedTv"],["upcoming"]]){
     try{await loadSectionBatch(batch)}catch(error){console.warn("Vivid secondary home load failed:",batch,error)}
     await new Promise(resolve=>window.setTimeout(resolve,80));
   }
 };
 if("requestIdleCallback" in window)requestIdleCallback(()=>void loadSecondary(),{timeout:1800});
 else window.setTimeout(()=>void loadSecondary(),900);

 const loadRecommendations=()=>void renderRecommendations().then(composeHomepage);
 if("requestIdleCallback" in window)requestIdleCallback(loadRecommendations,{timeout:2600});
 else window.setTimeout(loadRecommendations,1800);
}
let searchDialog=null;
let searchInput=null;
let searchRequestId=0;

function ensureSearchDialog(){
  if(searchDialog?.isConnected)return searchDialog;
  searchDialog=document.createElement("section");
  searchDialog.className="vivid-search-dialog";
  searchDialog.id="vivid-search-dialog";
  searchDialog.hidden=true;
  searchDialog.setAttribute("role","dialog");
  searchDialog.setAttribute("aria-modal","true");
  searchDialog.setAttribute("aria-labelledby","vivid-search-title");
  searchDialog.innerHTML=
    '<div class="vivid-search-backdrop" data-search-close></div>'+
    '<div class="vivid-search-window">'+
      '<div class="vivid-search-top">'+
        '<div class="vivid-search-field">'+
          '<i class="bi bi-search" aria-hidden="true"></i>'+
          '<input id="vivid-search-input" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search movies, shows, people…" aria-label="Search Vivid Cinema">'+
          '<button type="button" class="vivid-search-clear" data-search-clear aria-label="Clear search" hidden><i class="bi bi-x-lg" aria-hidden="true"></i></button>'+
        '</div>'+
        '<button type="button" class="vivid-search-close" data-search-close aria-label="Close search">Cancel</button>'+
      '</div>'+
      '<div class="vivid-search-content">'+
        '<div class="vivid-search-intro" id="vivid-search-title"><span>SEARCH</span><strong>What do you want to watch?</strong><p>Find movies, series, people and more.</p></div>'+
        '<div class="vivid-search-results" id="vivid-search-results" aria-live="polite"></div>'+
      '</div>'+
    '</div>';
  document.body.appendChild(searchDialog);
  searchInput=$("vivid-search-input");
  searchDialog.querySelector("[data-search-clear]")?.addEventListener("click",()=>{searchInput.value="";searchInput.focus({preventScroll:true});showRecentSearches()});
  searchDialog.querySelectorAll("[data-search-close]").forEach(el=>el.addEventListener("click",closeSearch));
  searchInput?.addEventListener("input",e=>{
    const query=e.target.value.trim();
    searchDialog.querySelector("[data-search-clear]").hidden=!query;
    search(query);
  });
  searchInput?.addEventListener("keydown",e=>{
    if(e.key==="Escape"){e.preventDefault();closeSearch();return}
    if(e.key==="Enter"&&e.target.value.trim()){e.preventDefault();void runSearch(e.target.value.trim())}
  });
  return searchDialog;
}

function lockSearchScroll(){
  const y=window.scrollY;
  document.body.dataset.searchScrollY=String(y);
  document.body.style.position="fixed";
  document.body.style.top="-"+y+"px";
  document.body.style.left="0";
  document.body.style.right="0";
  document.body.style.width="100%";
  document.body.classList.add("vivid-search-open");
  document.documentElement.classList.add("vivid-search-open");
}
function unlockSearchScroll(){
  const y=Number(document.body.dataset.searchScrollY||0);
  document.body.classList.remove("vivid-search-open");
  document.documentElement.classList.remove("vivid-search-open");
  document.body.style.position="";
  document.body.style.top="";
  document.body.style.left="";
  document.body.style.right="";
  document.body.style.width="";
  delete document.body.dataset.searchScrollY;
  window.scrollTo(0,y);
}
function openSearch(){
  const dialog=ensureSearchDialog();
  dialog.hidden=false;
  requestAnimationFrame(()=>{
    lockSearchScroll();
    searchInput?.focus({preventScroll:true});
    if(!searchInput?.value.trim())showRecentSearches();
  });
}
function closeSearch(){
  if(!searchDialog || searchDialog.hidden)return;
  searchDialog.hidden=true;
  searchInput?.blur();
  unlockSearchScroll();
}
function showRecentSearches(){
  const results=$("vivid-search-results");
  if(!results)return;
  const recent=getRecentSearches();
  results.innerHTML=recent.length
    ? '<div class="vivid-search-label">RECENT SEARCHES</div>'+recent.map(q=>'<button type="button" class="vivid-search-recent" data-recent-search="'+escapeHtml(q)+'"><i class="bi bi-clock-history" aria-hidden="true"></i><span>'+escapeHtml(q)+'</span><i class="bi bi-arrow-up-left" aria-hidden="true"></i></button>').join("")
    : '<div class="vivid-search-empty"><i class="bi bi-search" aria-hidden="true"></i><strong>Start typing to search</strong><span>Try a movie, series, actor, or genre.</span></div>';
  results.querySelectorAll("[data-recent-search]").forEach(button=>button.addEventListener("click",()=>{
    searchInput.value=button.dataset.recentSearch;
    searchInput.dispatchEvent(new Event("input",{bubbles:true}));
    void runSearch(button.dataset.recentSearch);
  }));
}
function showSearchLoading(query){
  const results=$("vivid-search-results");
  if(!results)return;
  results.innerHTML='<div class="vivid-search-state"><span class="vivid-search-spinner" aria-hidden="true"></span><strong>Searching for “'+escapeHtml(query)+'”</strong></div>';
}
function showSearch(items,intent,query=""){
  const results=$("vivid-search-results");
  if(!results)return;
  const intentLabel=[intent?.type?intent.type==="tv"?"TV":"Movies":"",intent?.genres?.length?"Genre":"",intent?.similarity?"For you":""].filter(Boolean).join(" · ");
  const context=intentLabel?'<div class="vivid-search-context">'+escapeHtml(intentLabel)+'</div>':"";
  const cards=items.length?items.map(m=>{
    const person=m.media_type==="person";
    const href=person?getPersonUrl(m):getMediaUrl(m);
    const meta=person?"Person":(m.year||"—")+" · "+(m.media_type==="tv"?"TV Series":"Movie");
    return '<a class="vivid-search-result" href="'+escapeHtml(href)+'"><img src="'+getImageUrl(m.poster_path,"w185")+'" alt="" loading="lazy" decoding="async"><span><strong>'+escapeHtml(m.title)+'</strong><small>'+escapeHtml(meta)+'</small></span><i class="bi bi-chevron-right" aria-hidden="true"></i></a>';
  }).join(""):'<div class="vivid-search-empty"><i class="bi bi-search" aria-hidden="true"></i><strong>No matches found</strong><span>Try a different title, actor, genre, or shorter search.</span></div>';
  results.innerHTML=(query?'<div class="vivid-search-label">RESULTS FOR “'+escapeHtml(query)+'”</div>':"")+context+cards;
}
async function runSearch(q){
  const requestId=++searchRequestId;
  const query=String(q||"").trim();
  if(!query){showRecentSearches();return}
  showSearchLoading(query);
  try{
    try{recordBehavior("search_query",null,{query})}catch{}
    const result=await searchIntelligently(query);
    if(requestId!==searchRequestId)return;
    rememberSearch(query);
    showSearch(result.items,result.intent,query);
  }catch(error){
    if(requestId!==searchRequestId)return;
    const results=$("vivid-search-results");
    if(results)results.innerHTML='<div class="vivid-search-empty"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><strong>Search is temporarily unavailable</strong><span>'+escapeHtml(getErrorMessage(error))+'</span></div>';
  }
}
const search=debounce((q)=>void runSearch(q),260);
function wireSearch(){
  const trigger=document.querySelector("[data-search-trigger]");
  if(!trigger)return;
  trigger.addEventListener("click",openSearch);
  document.addEventListener("keydown",e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openSearch()}
    if(e.key==="Escape"&&searchDialog&&!searchDialog.hidden)closeSearch();
  });
}
async function browseByLetter(letter){
 const rail=$("alphabet-rail"),status=$("alphabet-status");
 if(!rail||!status)return;
 document.querySelectorAll("[data-letter]").forEach(button=>{
   const active=button.dataset.letter===letter;
   button.classList.toggle("is-active",active);
   button.setAttribute("aria-pressed",String(active));
 });
 if(letter==="all"){
   rail.hidden=true;
   status.textContent="Choose a letter to browse the catalogue.";
   return;
 }
 status.textContent="Finding titles…";
 rail.hidden=false;
 rail.innerHTML='<div class="vivid-loading">'+Array.from({length:6},()=>'<div class="vivid-skeleton-card"></div>').join("")+'</div>';
 try{
   const items=await searchContent(letter==="0-9"?"0":letter);
   const matches=items.filter(item=>{
     const title=String(item.title||"").trim();
     return letter==="0-9" ? /^[0-9]/.test(title) : title.toUpperCase().startsWith(letter);
   }).slice(0,12);
   if(!matches.length){
     rail.innerHTML='<div class="vivid-empty">No titles beginning with '+escapeHtml(letter)+" were found right now.</div>";
     status.textContent="No matching titles found.";
     return;
   }
   renderRail("alphabet-rail",matches);
   status.textContent=(letter==="0-9"?"Titles beginning with a number":"Titles beginning with "+letter)+" · "+matches.length+" shown";
   rail.scrollIntoView({behavior:"smooth",block:"nearest"});
 }catch(error){
   rail.innerHTML='<div class="vivid-empty">Unable to load this part of the catalogue. Try again.</div>';
   status.textContent=getErrorMessage(error);
 }
}

function wireAlphabet(){
 document.querySelectorAll("[data-letter]").forEach(button=>button.addEventListener("click",()=>void browseByLetter(button.dataset.letter)));
}

function formatAlertTime(value){const diff=Math.max(0,Date.now()-Number(value||0)),mins=Math.floor(diff/60000),hrs=Math.floor(mins/60),days=Math.floor(hrs/24);if(mins<1)return "just now";if(mins<60)return mins+"m ago";if(hrs<24)return hrs+"h ago";if(days<7)return days+"d ago";return new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric"});}
async function refreshServerReleaseCenter(){serverReleaseAlerts=await getServerReleaseAlerts();renderReleaseAlerts();}
function renderReleaseAlerts(){
 const list=$("release-alert-list"),count=$("release-alert-count"),button=$("release-alert-button");if(!list)return;
 const localAlerts=getPendingReleaseAlerts(),alerts=[...serverReleaseAlerts,...localAlerts.filter(local=>!serverReleaseAlerts.some(remote=>remote.key&&remote.key===local.key))].sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0)),state=getReleaseAlertState();
 if(count){count.textContent=alerts.length>9?"9+":String(alerts.length);count.hidden=!alerts.length}button?.classList.toggle("has-alerts",alerts.length>0);
 const updated=$("release-alert-updated");if(updated)updated.textContent=state.lastCheckedAt?"Checked "+formatAlertTime(state.lastCheckedAt):"Not checked yet";
 const summary=$("release-alert-summary");if(summary)summary.textContent=alerts.length?alerts.length+" new "+(alerts.length===1?"release":"releases")+" waiting for you.":"Keeping an eye on your saved titles.";
 const enable=$("release-alert-enable");if(enable){const permission=window.Notification?.permission||"unsupported";enable.textContent=permission==="granted"?"Enabled":permission==="denied"?"Blocked":"Enable";enable.disabled=permission==="granted"}
 list.innerHTML=alerts.length?alerts.slice(0,12).map(alert=>{const meta=alert.type==="tv-season"?"New season · S"+alert.season:alert.type==="tv-episode"?"New episode · S"+alert.season+" E"+alert.episode:"New release · "+(alert.releaseTypeLabel||"Available now");const href=alert.media_type==="tv"?"title.html?id="+encodeURIComponent(alert.id)+"&type=tv":"title.html?id="+encodeURIComponent(alert.id)+"&type=movie";return '<div class="vivid-release-alert"><a href="'+href+'"><i class="bi '+(alert.type==="tv-episode"?"bi-tv":alert.type==="tv-season"?"bi-collection-play":"bi-film")+'"></i><span><strong>'+escapeHtml(alert.title)+'</strong><small>'+escapeHtml(meta+(alert.episodeTitle?" · "+alert.episodeTitle:""))+'</small></span></a><button type="button" data-dismiss-release="'+escapeHtml(alert.key)+'" aria-label="Dismiss '+escapeHtml(alert.title)+'"><i class="bi bi-x"></i></button></div>'}).join(""):'<div class="vivid-release-empty"><div class="vivid-release-empty-icon"><i class="bi bi-check2-circle"></i></div><strong>You’re all caught up</strong><p>When a title you follow gets a new release, episode or season, it will appear here.</p></div>';
}
async function refreshReleaseAlerts(force=false){
 const refresh=$("release-alert-refresh");if(refresh){refresh.disabled=true;refresh.setAttribute("aria-busy","true")}
 try{const alerts=await checkForReleaseAlerts({force});if(alerts.length&&window.Notification?.permission==="granted")await deliverReleaseAlerts(alerts)}catch(error){console.warn("Vivid release alerts unavailable:",error)}
 finally{if(refresh){refresh.disabled=false;refresh.removeAttribute("aria-busy")}}renderReleaseAlerts();
}
function wireReleaseAlerts(){
 const button=$("release-alert-button"),popover=$("release-alert-popover"),close=$("release-alert-close"),enable=$("release-alert-enable"),refresh=$("release-alert-refresh"),clear=$("release-alert-clear");
 const toggle=()=>{if(!popover)return;popover.hidden=!popover.hidden;button?.setAttribute("aria-expanded",String(!popover.hidden));renderReleaseAlerts();if(!popover.hidden)void refreshServerReleaseCenter()};button?.addEventListener("click",toggle);close?.addEventListener("click",()=>{popover.hidden=true;button?.setAttribute("aria-expanded","false")});
 refresh?.addEventListener("click",()=>void refreshReleaseAlerts(true));clear?.addEventListener("click",async()=>{clearReleaseAlerts();await Promise.all(serverReleaseAlerts.map(alert=>dismissServerReleaseAlert(alert.docId)));serverReleaseAlerts=[];renderReleaseAlerts()});
 enable?.addEventListener("click",async()=>{let result="unsupported";
 try{
   result=await enableCinemaPush();
   const status=$("release-alert-status");
   if(status)status.textContent="Background release alerts are enabled. Vivid can notify you even when the site is closed.";
 }catch(error){
   const status=$("release-alert-status");
   if(status)status.textContent=error?.message||"Could not enable background notifications.";
   console.warn("Vivid push setup failed:",error);
 }
 await refreshReleaseAlerts(true);renderReleaseAlerts()});
 document.addEventListener("click",event=>{const dismiss=event.target.closest("[data-dismiss-release]");if(dismiss){const key=dismiss.dataset.dismissRelease;const remote=serverReleaseAlerts.find(alert=>alert.key===key||alert.docId===key);if(remote){void dismissServerReleaseAlert(remote.docId);serverReleaseAlerts=serverReleaseAlerts.filter(alert=>alert.docId!==remote.docId)}dismissReleaseAlert(key);renderReleaseAlerts();return}if(popover&&!popover.hidden&&!event.target.closest("#release-alert-popover")&&!event.target.closest("#release-alert-button")){popover.hidden=true;button?.setAttribute("aria-expanded","false")}});
}

function wireHeroSwipe(){
 const hero=document.querySelector(".vivid-hero");if(!hero)return;let startX=0,startY=0;
 hero.addEventListener("touchstart",e=>{const t=e.changedTouches[0];startX=t.clientX;startY=t.clientY},{passive:true});
 hero.addEventListener("touchend",e=>{const t=e.changedTouches[0],dx=t.clientX-startX,dy=t.clientY-startY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)showHero(activeIndex+(dx<0?1:-1),true)},{passive:true});
}
window.addEventListener("scroll",()=>{$("topbar")?.classList.toggle("is-scrolled",scrollY>18)},{passive:true});
document.addEventListener("keydown",e=>{if(e.target.matches("input,textarea,select"))return;if(e.key==="ArrowLeft")showHero(activeIndex-1,true);if(e.key==="ArrowRight")showHero(activeIndex+1,true)});
document.addEventListener("DOMContentLoaded",()=>{
  startCinemaReminderLoop();

  // Paint Home immediately. Intelligence/auth sync is optional enrichment and must
  // never be allowed to block the catalogue from loading.
  wireRails();wireSearch();wireAlphabet();wireHeroSwipe();wireReleaseAlerts();
  initHero();void loadHome();void refreshReleaseAlerts();void refreshServerReleaseCenter();
  $("hero-prev")?.addEventListener("click",()=>showHero(activeIndex-1,true));
  $("hero-next")?.addEventListener("click",()=>showHero(activeIndex+1,true));
  $("hero-sound")?.addEventListener("click",toggleSound);
  $("hero-pause")?.addEventListener("click",togglePause);

  // Personalization runs in the background after the core Home UI has started.
  void (async()=>{
    const needsColdStart=shouldShowColdStart();
    if(needsColdStart)document.body.classList.add("vivid-onboarding-active");
    try{await Promise.race([
      startIntelligenceSync(),
      new Promise(resolve=>window.setTimeout(resolve,1800))
    ])}catch{}
    try{
      if(shouldShowColdStart())await maybeShowColdStart();
    }catch{}
    if(needsColdStart)document.body.classList.remove("vivid-onboarding-active");
  })();
});
