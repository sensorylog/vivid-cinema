import { tmdbApi } from "./scripts/tmdb.js";
import { getHomeSections, getHomeSectionPage, searchContent } from "./scripts/content.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./scripts/media.js";
import { getLocalLibrary } from "./scripts/library.js";
import { getContinueWatching, getPlaybackProgress, getPersonalRecommendations, formatProgress } from "./scripts/recommendations.js";
import { escapeHtml, debounce, getErrorMessage } from "./scripts/utils.js";
import { buildWatchUrl } from "./scripts/routes.js";

const $=id=>document.getElementById(id);
let featured=[],activeIndex=0,heroMuted=true,heroPlaying=true,heroTimer=null;
const rails={};
const sectionState={};

// Keep data keys separate from DOM ids. Several sections intentionally use human-friendly
// ids (for example `movies-rail`) while the TMDB loader keys are API-oriented.
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
 const contentId=media.content_id||((media.media_type||"movie")+":"+media.id);
 const progressBar=progress&&Number(progress.percentage)>0?'<div class="vivid-card-progress"><span style="width:'+Math.min(100,Number(progress.percentage)||0)+'%"></span></div>':"";
 return '<article class="vivid-card" data-id="'+escapeHtml(media.id)+'" data-type="'+escapeHtml(media.media_type||"movie")+'" tabindex="0" role="link" aria-label="'+escapeHtml(title)+'">'+
 '<div class="vivid-card-media"><img src="'+getImageUrl(media.poster_path,"w342")+'" alt="'+escapeHtml(title)+'" loading="lazy" decoding="async">'+
 (signal?'<span class="vivid-card-signal">'+escapeHtml(signal)+"</span>":"")+(rating!=="0.0"?'<span class="vivid-rating">★ '+rating+"</span>":"")+progressBar+'</div>'+
 '<div class="vivid-card-info"><div class="vivid-card-title">'+escapeHtml(title)+'</div><div class="vivid-card-sub">'+escapeHtml(media.year||"—")+(media.media_type==="tv"?" · Series":" · Movie")+(progress?" · "+formatProgress(progress):"")+"</div></div></article>";
}

function wireCards(container){
 container?.querySelectorAll(".vivid-card").forEach(c=>{
   const open=()=>{
     const progress=getPlaybackProgress(c.dataset.type+":"+c.dataset.id);
     location.href=progress ? buildWatchUrl(c.dataset.id,c.dataset.type,progress.season,progress.episode,progress.progress) : getMediaUrl({id:c.dataset.id,media_type:c.dataset.type});
   };
   c.addEventListener("click",open);
   c.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
 });
}

function renderRail(id,items=[],options={}){
 const el=$(id);if(!el)return;
 const normalized=items.map(x=>x.media_type?x:normalizeResults([x])[0]).filter(Boolean);
 const html=normalized.length?normalized.map(item=>card(item,{progress:options.progressMap?.[item.media_type+":"+item.id],signal:options.signal})).join(""):'<div class="vivid-empty">Nothing available right now.</div>';
 el.innerHTML=options.append&&el.querySelector(".vivid-card")?el.innerHTML+html:html;
 wireCards(el);
 rails[id]=el;
}

function sectionSignal(key){
 const labels={trending:"Trending",nowPlaying:"Now playing",popularMovies:"Popular",topRatedMovies:"Top rated",popularTv:"Popular",topRatedTv:"Top rated",airingToday:"Airing today",anime:"Anime",kdrama:"K-Drama",upcoming:"Coming soon"};
 return labels[key]||"";
}

function setHeroText(item){
 $("hero-title").textContent=item.title;
 $("hero-copy").textContent=item.overview||"Explore this title on Vivid Cinema.";
 $("hero-meta").innerHTML='<span>'+escapeHtml(item.year||"—")+'</span><span class="vivid-dot"></span><span>'+escapeHtml(item.media_type==="tv"?"TV Series":"Movie")+'</span><span class="vivid-dot"></span><span>★ '+Number(item.vote_average||0).toFixed(1)+'</span>';
 $("hero-watch").href=buildWatchUrl(item.id,item.media_type,item.media_type==="tv"?1:null,item.media_type==="tv"?1:null);
 $("hero-more").onclick=()=>location.href=getMediaUrl(item);
 $("hero-fallback").style.backgroundImage=item.backdrop_path?'url("'+getImageUrl(item.backdrop_path,"w1280")+'")':"none";
}

let heroPlayer=null,heroPlayerToken=0,ytApiPromise=null;

function youtubeUrl(key,muted=true){
 const p=new URLSearchParams({
   autoplay:"1",mute:muted?"1":"0",controls:"0",playsinline:"1",rel:"0",
   modestbranding:"1",enablejsapi:"1",iv_load_policy:"3",origin:location.origin
 });
 return "https://www.youtube.com/embed/"+encodeURIComponent(key)+"?"+p.toString();
}

function loadYouTubeApi(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(ytApiPromise)return ytApiPromise;
 ytApiPromise=new Promise((resolve,reject)=>{
   const previous=window.onYouTubeIframeAPIReady;
   window.onYouTubeIframeAPIReady=()=>{try{previous?.();}catch{} resolve(window.YT)};
   const script=document.createElement("script");
   script.src="https://www.youtube.com/iframe_api";
   script.async=true;
   script.onerror=()=>{ytApiPromise=null;reject(new Error("YouTube player API failed to load"))};
   document.head.appendChild(script);
   setTimeout(()=>reject(new Error("YouTube player API timed out")),10000);
 });
 return ytApiPromise;
}

function destroyHeroPlayer(){
 try{heroPlayer?.destroy?.()}catch{}
 heroPlayer=null;
}

async function waitForHeroPlayback(token){
 const iframe=$("hero-video"),fallback=$("hero-fallback");
 try{
   await loadYouTubeApi();
   if(token!==heroPlayerToken||!iframe.src)return false;
   await new Promise(resolve=>{
     let done=false;
     const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok)};
     const timer=setTimeout(()=>finish(false),7000);
     destroyHeroPlayer();
     heroPlayer=new YT.Player(iframe,{
       events:{
         onReady:event=>{
           if(token!==heroPlayerToken){finish(false);return}
           try{
             event.target.mute();
             if(!heroMuted){event.target.unMute();event.target.setVolume(100)}
             if(heroPlaying)event.target.playVideo();
           }catch{}
         },
         onStateChange:event=>{
           if(token!==heroPlayerToken){finish(false);return}
           if(event.data===YT.PlayerState.PLAYING){
             iframe.classList.add("is-ready");
             fallback.classList.remove("is-visible");
             finish(true);
           }
         },
         onError:()=>finish(false)
       }
     });
   });
   return iframe.classList.contains("is-ready");
 }catch(e){
   console.warn("Hero playback unavailable",e);
   return false;
 }
}

async function loadHeroVideo(item){
 const iframe=$("hero-video"),fallback=$("hero-fallback");
 const token=++heroPlayerToken;
 destroyHeroPlayer();
 iframe.classList.remove("is-ready");
 fallback.classList.add("is-visible");
 try{
   const data=item.media_type==="tv"?await tmdbApi.tvVideos(item.id):await tmdbApi.movieVideos(item.id);
   if(token!==heroPlayerToken)return false;
   const videos=(data.videos?.results||[]).filter(v=>v.site==="YouTube"&&v.key);
   const trailer=videos.find(v=>v.type==="Trailer"&&v.official!==false)
     ||videos.find(v=>v.type==="Trailer")
     ||videos.find(v=>v.type==="Teaser")
     ||videos.find(v=>v.type==="Clip")
     ||videos[0];
   if(!trailer?.key){iframe.removeAttribute("src");return false}
   iframe.src=youtubeUrl(trailer.key,heroMuted);
   return await waitForHeroPlayback(token);
 }catch(e){
   iframe.classList.remove("is-ready");
   fallback.classList.add("is-visible");
   console.warn("Hero trailer unavailable",e);
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
 setHeroText(item);renderFeatureStrip();
 const activeCard=$(".vivid-feature-card.is-active"); if(activeCard){const track=$("feature-track"); const left=activeCard.offsetLeft-Math.max(0,(track.clientWidth-activeCard.offsetWidth)/2); track.scrollTo({left:Math.max(0,left),behavior:userAction?"smooth":"auto"});}
 clearTimeout(heroTimer);
 const playing=await loadHeroVideo(item);
 if(playing&&heroPlaying&&!userAction)heroTimer=setTimeout(()=>showHero(activeIndex+1),18000);
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

function toggleSound(){heroMuted=!heroMuted;if(heroPlayer){try{heroMuted?heroPlayer.mute():heroPlayer.unMute();}catch{}} else {const item=featured[activeIndex];if(item)void loadHeroVideo(item);}$("hero-sound").innerHTML='<i class="bi bi-'+(heroMuted?"volume-mute-fill":"volume-up-fill")+'"></i>';$("hero-sound").setAttribute("aria-label",heroMuted?"Unmute trailer":"Mute trailer")}
function togglePause(){heroPlaying=!heroPlaying;clearTimeout(heroTimer);if(heroPlayer){try{heroPlaying?heroPlayer.playVideo():heroPlayer.pauseVideo();}catch{}} $("hero-pause").innerHTML='<i class="bi bi-'+(heroPlaying?"pause-fill":"play-fill")+'"></i>';$("hero-pause").setAttribute("aria-label",heroPlaying?"Pause trailer":"Play trailer");if(heroPlaying&&!heroPlayer)showHero(activeIndex,true)}

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
 const state=sectionState[key]||{page:1,totalPages:1};
 if(!button||button.disabled)return;
 if(state.page>=state.totalPages){
   button.hidden=true;
   return;
 }
 button.disabled=true;
 button.setAttribute("aria-busy","true");
 button.textContent="Loading…";
 try{
   const nextPage=Math.min(state.page+1,state.totalPages);
   const data=await getHomeSectionPage(key,nextPage);
   const railId=SECTION_RAIL_IDS[key];
   if(!railId)throw new Error("Unknown rail: "+key);
   if(!data.items.length)throw new Error("No titles returned for "+key+" page "+nextPage);
   renderRail(railId,data.items,{append:true,signal:sectionSignal(key)});
   sectionState[key]={page:data.page,totalPages:data.totalPages};
   button.hidden=data.page>=data.totalPages;
   button.textContent=button.hidden?"Load more":"Load more";
   updateRailControls($(railId));
 }catch(error){
   button.textContent="Try again";
   console.warn("Vivid rail load failed:",key,error);
 }finally{
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

 // Load the complete catalogue in small parallel batches. This keeps the first
 // rows fast while guaranteeing that deeper rails do not depend on scrolling.
 const batches=[
   ["trending","nowPlaying","popularMovies"],
   ["topRatedMovies","popularTv","topRatedTv"],
   ["airingToday","anime","kdrama"],
   ["upcoming"]
 ];
 for(const batch of batches){
   try{
     await loadSectionBatch(batch);
   }catch(error){
     console.warn("Vivid home batch failed:",batch,error);
   }
 }

 if("requestIdleCallback" in window)requestIdleCallback(()=>void renderRecommendations(),{timeout:1200});
 else setTimeout(()=>void renderRecommendations(),500);
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
 const hero=document.querySelector(".vivid-hero");let startX=0,startY=0;
 hero.addEventListener("touchstart",e=>{
   const t=e.changedTouches[0];startX=t.clientX;startY=t.clientY;
 },{passive:true});
 hero.addEventListener("touchend",e=>{
   const t=e.changedTouches[0],dx=t.clientX-startX,dy=t.clientY-startY;
   if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.25)showHero(activeIndex+(dx<0?1:-1),true);
 },{passive:true});
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
