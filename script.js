import { tmdbApi } from "./scripts/tmdb.js";
import { getHomeSections, getHomeSectionPage, searchContent } from "./scripts/content.js";
import { getImageUrl, getMediaUrl, getPersonUrl, normalizeResults } from "./scripts/media.js";
import { getLocalLibrary } from "./scripts/library.js";
import { getContinueWatching, getPlaybackProgress, getPersonalRecommendations, getBecauseYouLiked, getTonightPick, dismissTonightPick, formatProgress } from "./scripts/recommendations.js";
import { escapeHtml, debounce, getErrorMessage } from "./scripts/utils.js";
import { buildWatchUrl } from "./scripts/routes.js";
import { checkForReleaseAlerts, deliverReleaseAlerts, getPendingReleaseAlerts, requestReleaseAlerts, dismissReleaseAlert, clearReleaseAlerts, getReleaseAlertState } from "./scripts/release-alerts.js";
import { startIntelligenceSync, shouldShowColdStart, completeColdStart, dismissColdStart, recordBehavior, getTasteProfile, getTasteStrength } from "./scripts/intelligence.js";
import { searchIntelligently, getRecentSearches, getRecentSearchOwner, rememberSearch, clearRecentSearches } from "./scripts/search.js";
import { startCinemaReminderLoop } from "./scripts/cinema-reminders.js";
import { enableCinemaPush, getServerReleaseAlerts, dismissServerReleaseAlert } from "./scripts/push-notifications.js";

const $=id=>document.getElementById(id);
let featured=[],activeIndex=0;
let homeRecommendationRequestId=0;
let tonightPickRequestId=0;
let homeRefreshQueued=false;

const rails={};
let serverReleaseAlerts=[];
const sectionState={};
const loadingSections=new Set();

const SECTION_RAIL_IDS=Object.freeze({
 top10:"top-10-rail",
 trending:"trending-rail",
 nowPlaying:"now-playing-rail",
 popularMovies:"movies-rail",
 topRatedMovies:"top-rated-rail",
 popularTv:"tv-rail",
 topRatedTv:"top-tv-rail",
 airingToday:"airing-rail",
 anime:"anime-rail",
 kdrama:"kdrama-rail",
 upcoming:"upcoming-rail",
 netflix:"netflix-rail",
 primeVideo:"prime-video-rail",
 hboMax:"hbo-max-rail",
 disneyPlus:"disney-plus-rail",
 appleTvPlus:"apple-tv-plus-rail",
 hulu:"hulu-rail",
 paramountPlus:"paramount-plus-rail",
 newReleases:"new-releases-rail"
});

function skeleton(container,count=8){if(!container)return;container.innerHTML='<div class="vivid-loading">'+Array.from({length:count},()=>'<div class="vivid-skeleton-card"></div>').join("")+'</div>'}

function formatRemaining(progress){
 const duration=Number(progress?.duration||0),position=Number(progress?.progress||0);
 if(!duration||position<=0)return "";
 const minutes=Math.max(1,Math.ceil((duration-position)/60));
 if(minutes>=60){const hours=Math.floor(minutes/60),mins=minutes%60;return hours+" HR"+(mins?" "+mins+" MIN":"")+" LEFT";}
 return minutes+" MIN LEFT";
}

function card(media,options={}){
 const title=media.title||"Untitled", rating=Number(media.vote_average||0).toFixed(1);
 const progress=options.progress;
 const signal=options.signal||"";
 const rank=Number(options.rank||0);
 const recommendationReason=media.recommendationReason||"";
 const isContinue=Boolean(options.continueWatching);
 const imagePath=isContinue?(media.backdrop_path||media.poster_path):media.poster_path;
 const imageSize=isContinue?"w780":"w342";
 const progressBar=progress&&Number(progress.percentage)>0?'<div class="vivid-card-progress"><span style="width:'+Math.min(100,Number(progress.percentage)||0)+'%"></span></div>':"";
 const rankMarkup=rank?'<span class="vivid-top10-rank" aria-hidden="true">'+String(rank).padStart(2,"0")+'</span>':"";
 const remaining=isContinue?formatRemaining(progress):"";
 const remainingMarkup=remaining?'<span class="vivid-continue-remaining">'+escapeHtml(remaining)+"</span>":"";
 const ariaSuffix=rank?' — ranked '+rank:(recommendationReason?' — '+recommendationReason:"");
 return '<article class="vivid-card'+(rank?' vivid-top10-card':"")+(isContinue?' vivid-continue-card':"")+'" data-id="'+escapeHtml(media.id)+'" data-type="'+escapeHtml(media.media_type||"movie")+'" tabindex="0" role="link" aria-label="'+escapeHtml(title)+escapeHtml(ariaSuffix)+'">'+
 (rank?rankMarkup:"")+'<div class="vivid-card-media"><img src="'+getImageUrl(imagePath,imageSize)+'" alt="'+escapeHtml(title)+'" loading="lazy" decoding="async">'+
 (signal&&!rank?'<span class="vivid-card-signal">'+escapeHtml(signal)+"</span>":"")+(rating!=="0.0"&&!rank?'<span class="vivid-rating">★ '+rating+"</span>":"")+remainingMarkup+progressBar+'</div>'+
 '<div class="vivid-card-info">'+(recommendationReason?'<div class="vivid-card-reason">'+escapeHtml(recommendationReason)+'</div>':"")+'<div class="vivid-card-title">'+escapeHtml(title)+'</div><div class="vivid-card-sub">'+escapeHtml(media.year||"—")+(media.media_type==="tv"?" · Series":" · Movie")+(progress&&!isContinue?" · "+formatProgress(progress):"")+"</div></div></article>";
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

async function renderTonightPick(expectedRequestId = homeRecommendationRequestId) {
  const requestId = ++tonightPickRequestId;
  const section = $("tonight-section");
  if (!section) return;
  try {
    const items = await getTonightPick({ limit: 8 });
    if (expectedRequestId !== homeRecommendationRequestId || requestId !== tonightPickRequestId) return;
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
    if (expectedRequestId === homeRecommendationRequestId && requestId === tonightPickRequestId) section.hidden = true;
  }
}
function renderRail(id,items=[],options={}){
 const el=$(id);if(!el)return;
 const normalized=items.map(x=>x.media_type?x:normalizeResults([x])[0]).filter(Boolean);
 const isRecommendation=/^(recommended-rail|because-rail)$/.test(id);
 const html=normalized.length?normalized.map((item,index)=>{const markup=card(item,{progress:options.progressMap?.[item.media_type+":"+item.id],signal:options.signal,rank:options.rankStart?options.rankStart+index:0,continueWatching:options.continueWatching});if(isRecommendation){const key=item.media_type+":"+item.id;recordBehavior("recommendation_impression",item,{surface:id,position:index});return markup.replace("<article class=\"vivid-card\"","<article data-recommendation=\"true\" data-surface=\""+id+"\" data-position=\""+index+"\" data-title=\""+escapeHtml(item.title||"").replace(/"/g,"&quot;")+"\" class=\"vivid-card\"");}return markup;}).join(""):'<div class="vivid-empty">Nothing available right now.</div>';
 el.innerHTML=options.append&&el.querySelector(".vivid-card")?el.innerHTML+html:html;
 wireCards(el);
 rails[id]=el;
}

function sectionSignal(key){
 const labels={top10:"Top 10",trending:"Trending",nowPlaying:"Now playing",popularMovies:"Popular",topRatedMovies:"Top rated",popularTv:"Popular",topRatedTv:"Top rated",airingToday:"Airing today",anime:"Anime",kdrama:"K-Drama",upcoming:"Coming soon",newReleases:"New releases",netflix:"Netflix",primeVideo:"Prime Video",hboMax:"HBO Max",disneyPlus:"Disney+",appleTvPlus:"Apple TV+",hulu:"Hulu",paramountPlus:"Paramount+"};
 return labels[key]||"";
}

function syncFeatureStripSelection(activeHero=window.vividCinemaActiveHero){
 const track=$("feature-track");if(!track)return;
 const id=activeHero?.id==null?null:String(activeHero.id);
 const type=activeHero?.media_type||"";
 activeIndex=id===null?-1:featured.findIndex(item=>String(item.id)===id&&item.media_type===type);
 track.querySelectorAll(".vivid-feature-card").forEach(button=>{
   button.classList.toggle("is-active",Number(button.dataset.index)===activeIndex);
 });
}

function renderFeatureStrip(){
 const track=$("feature-track");if(!track)return;
 track.innerHTML=featured.map((item,i)=>'<button class="vivid-feature-card '+(i===activeIndex?"is-active":"")+'" data-index="'+i+'" type="button" aria-label="Feature '+escapeHtml(item.title)+'"><img src="'+getImageUrl(item.backdrop_path||item.poster_path,"w342")+'" alt="" loading="lazy"><strong>'+escapeHtml(item.title)+'</strong></button>').join("");
 track.querySelectorAll(".vivid-feature-card").forEach(button=>button.addEventListener("click",()=>{
   const item=featured[Number(button.dataset.index)];
   if(!item)return;
   const select=window.vividCinemaSelectHero;
   if(typeof select==="function"&&select(item))return;
   window.location.href=getMediaUrl(item);
 }));
 syncFeatureStripSelection();
}

window.addEventListener("vivid:hero-change",event=>syncFeatureStripSelection(event.detail));

async function initFeatureStrip(){
 try{
   let data;
   try{data=await tmdbApi.trending("all","week")}catch(error){console.warn("Featured strip fallback",error);data=await tmdbApi.trending("movie","week")}
   featured=normalizeResults(data.results||[]).filter(item=>item.backdrop_path||item.poster_path).slice(0,8);
   if(featured[0]?.backdrop_path){const preload=new Image();preload.decoding="async";preload.fetchPriority="high";preload.src=getImageUrl(featured[0].backdrop_path,"w1280");}
   renderFeatureStrip();
 }catch(error){
   console.warn("Featured strip unavailable:",error);
   const track=$("feature-track");
   if(track)track.replaceChildren();
 }
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
   renderRail(railId,data.items,{signal:sectionSignal(key),rankStart:key==="top10"?1:0});
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
   renderRail(railId,data.items,{append:true,signal:sectionSignal(key),rankStart:key==="top10"?($(railId)?.querySelectorAll(".vivid-top10-card").length||0)+1:0});
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
 const section=$("continue-section"),rail=$("continue-rail");
 const progressItems=getContinueWatching(10);
 if(!progressItems.length){
  if(section)section.hidden=true;
  if(rail)rail.innerHTML="";
  return;
 }
 const library=getLocalLibrary();
 const all=[...(library.history||[]),...(library.favorites||[]),...(library.watchLater||[])];
 const byKey=new Map(all.map(item=>[item.media_type+":"+item.id,item]));
 const resolved=progressItems.map(item=>byKey.get(item.content_id)).filter(Boolean);
 if(!resolved.length){
  if(section)section.hidden=true;
  if(rail)rail.innerHTML="";
  return;
 }
 const progressMap=Object.fromEntries(progressItems.map(item=>[item.content_id,item]));
 section.hidden=false;
 renderRail("continue-rail",resolved,{progressMap,continueWatching:true});
}

async function renderRecommendations(){
 const requestId=++homeRecommendationRequestId;
 try{
   const [items,because]=await Promise.all([getPersonalRecommendations(12),getBecauseYouLiked(12)]);
   if(requestId!==homeRecommendationRequestId)return;
   await renderTonightPick(requestId);
   if(requestId!==homeRecommendationRequestId)return;
   if(items.length){
     $("recommended-section").hidden=false;
     renderRail("recommended-rail",items);
   }else{
     $("recommended-section").hidden=true;
     $("recommended-rail").innerHTML="";
   }
   if(because.length){
     const seed=because[0]?.recommendationReason?.replace(/^Because you liked /,"");
     if(seed) $("because-title").textContent="Because you liked "+seed;
     $("because-section").hidden=false;
     renderRail("because-rail",because);
   }else{
     $("because-section").hidden=true;
     $("because-rail").innerHTML="";
   }
 }catch(error){
   if(requestId===homeRecommendationRequestId)console.warn("Recommendations unavailable:",error);
 }
}

function clearPersonalizedHome(){
 homeRecommendationRequestId++;
 tonightPickRequestId++;
 ["continue-section","recommended-section","because-section","tonight-section"].forEach(id=>{const section=$(id);if(section)section.hidden=true;});
 ["continue-rail","recommended-rail","because-rail"].forEach(id=>{const rail=$(id);if(rail)rail.innerHTML="";});
}

function queuePersonalizedHomeRefresh({clear=false}={}){
 if(clear)clearPersonalizedHome();
 if(homeRefreshQueued)return;
 homeRefreshQueued=true;
 queueMicrotask(()=>{
  homeRefreshQueued=false;
  renderContinueWatching();
  void renderRecommendations().then(composeHomepage);
 });
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
 const ids=["top-10-rail","trending-rail","now-playing-rail","movies-rail","top-rated-rail","tv-rail","top-tv-rail","upcoming-rail","new-releases-rail","netflix-rail","prime-video-rail","hbo-max-rail","disney-plus-rail","apple-tv-plus-rail","hulu-rail","paramount-plus-rail"];
 ids.forEach(id=>skeleton($(id)));
 renderContinueWatching();

 // The first viewport gets the smallest useful data set first. Secondary shelves
 // still load automatically, but they never compete with the hero and first rows.
 const primary=["top10","trending","nowPlaying","popularMovies"];
 try{await loadSectionBatch(primary)}catch(error){console.warn("Vivid primary home load failed:",error)}

 const loadSecondary=async()=>{
   // Keep secondary shelves from creating a seven-request burst. Each small
   // batch can paint before the next one starts, keeping scrolling responsive.
   for(const batch of [["top10","topRatedMovies","popularTv"],["topRatedTv"],["upcoming","newReleases"],["netflix","primeVideo"],["hboMax","disneyPlus"],["appleTvPlus","hulu"],["paramountPlus"]]){
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
let searchReturnFocus=null;
let searchBackgroundInert=[];

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
function getSearchFocusables() {
  if (!searchDialog) return [];
  return [...searchDialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && el.getClientRects().length);
}
function openSearch(){
  const dialog=ensureSearchDialog();
  searchReturnFocus=document.activeElement instanceof HTMLElement ? document.activeElement : null;
  searchBackgroundInert=[...document.body.children].filter(el=>el!==dialog).map(el=>({el,inert:el.inert}));
  searchBackgroundInert.forEach(({el})=>{el.inert=true;});
  dialog.hidden=false;
  // Focus synchronously inside the trusted tap/click. iOS Safari may not open
  // its virtual keyboard when focus is deferred to requestAnimationFrame.
  lockSearchScroll();
  searchInput?.focus({preventScroll:true});
  if(!searchInput?.value.trim())showRecentSearches();
}
function closeSearch(){
  if(!searchDialog || searchDialog.hidden)return;
  searchDialog.hidden=true;
  searchInput?.blur();
  searchBackgroundInert.forEach(({el,inert})=>{el.inert=inert;});
  searchBackgroundInert=[];
  unlockSearchScroll();
  if(searchReturnFocus?.isConnected)searchReturnFocus.focus({preventScroll:true});
  searchReturnFocus=null;
}

document.addEventListener("keydown",event=>{
  if(!searchDialog || searchDialog.hidden)return;
  if(event.key!=="Tab")return;
  const focusables=getSearchFocusables();
  if(!focusables.length){event.preventDefault();return;}
  const first=focusables[0], last=focusables[focusables.length-1];
  if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();return;}
  if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
});

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
  const searchOwnerAtStart=getRecentSearchOwner();
  if(!query){showRecentSearches();return}
  showSearchLoading(query);
  try{
    const result=await searchIntelligently(query);
    if(requestId!==searchRequestId)return;
    rememberSearch(query,searchOwnerAtStart);
    showSearch(result.items,result.intent,query);
  }catch(error){
    if(requestId!==searchRequestId)return;
    const results=$("vivid-search-results");
    if(results)results.innerHTML='<div class="vivid-search-empty"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><strong>Search is temporarily unavailable</strong><span>'+escapeHtml(getErrorMessage(error))+'</span></div>';
  }
}
const search=debounce((q)=>void runSearch(q),260);
function wireSearch(){
  const triggers=document.querySelectorAll("[data-search-trigger]");
  if(!triggers.length)return;
  triggers.forEach(trigger=>trigger.addEventListener("click",event=>{
    event.preventDefault();
    openSearch();
  }));
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

window.addEventListener("scroll",()=>{$("topbar")?.classList.toggle("is-scrolled",scrollY>18)},{passive:true});
document.addEventListener("DOMContentLoaded",()=>{
  startCinemaReminderLoop();

  // Paint Home immediately. Intelligence/auth sync is optional enrichment and must
  // never be allowed to block the catalogue from loading.
  wireRails();wireSearch();wireAlphabet();wireReleaseAlerts();
  window.addEventListener("vivid:account-switched",()=>queuePersonalizedHomeRefresh({clear:true}));
  window.addEventListener("vivid:library-changed",()=>queuePersonalizedHomeRefresh());
  window.addEventListener("vivid:progress-changed",()=>renderContinueWatching());
  window.addEventListener("vivid:recommendations-invalidated",()=>queuePersonalizedHomeRefresh());
  initFeatureStrip();void loadHome();void refreshReleaseAlerts();void refreshServerReleaseCenter();

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

let searchHistoryOwner = null;
window.addEventListener("vivid:search-history-ready", event => {
  const nextOwner = event.detail?.owner || "guest";
  const changedOwner = searchHistoryOwner !== null && searchHistoryOwner !== nextOwner;
  searchHistoryOwner = nextOwner;
  const dialog = $("vivid-search-dialog");
  if (!dialog || dialog.hidden) return;
  if (changedOwner) {
    searchRequestId++;
    if (searchInput) searchInput.value = "";
    showRecentSearches();
  } else if (!searchInput?.value.trim()) {
    showRecentSearches();
  }
});
