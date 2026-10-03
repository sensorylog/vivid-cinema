import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { buildTitleUrl, buildWatchUrl, getRoute } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { upsertLibraryItem, startLibrarySync } from "./library.js";
import { getPlaybackProgress, savePlaybackProgress, removePlaybackProgress } from "./recommendations.js";
import { VIVID_CONFIG } from "./config.js";
import { setCastMedia } from "./cast.js";

const $=id=>document.getElementById(id);
const route=getRoute();
const VIDAPI_ORIGIN=new URL(VIVID_CONFIG.api.vidapiEmbedBaseUrl).origin;
let media=null,details=null,currentParams=null,nextEpisode=null;

function getParams(){
 const id=route.params.get("id");
 const type=route.params.get("type")==="tv"?"tv":"movie";
 const season=Math.max(0,Number.parseInt(route.params.get("season")||"1",10)||1);
 const episode=Math.max(1,Number.parseInt(route.params.get("episode")||"1",10)||1);
 return {id,type,season,episode};
}

function progressKey(){return media?media.media_type+":"+media.id:"";}
function buildEmbedUrl(params,startAt=0){
 const base=String(VIVID_CONFIG.api.vidapiEmbedBaseUrl||"").replace(/\/+$/,"");
 const query=new URLSearchParams({autoplay:"1"});
 if(Number(startAt)>5)query.set("resumeAt",String(Math.floor(Number(startAt))));
 query.set("controls","1");
 query.set("overlay","1");
 const suffix="?"+query.toString();
 if(params.type==="tv")return base+"/embed/tv/"+encodeURIComponent(params.id)+"/"+params.season+"/"+params.episode+suffix;
 return base+"/embed/movie/"+encodeURIComponent(params.id)+suffix;
}
function recordHistory(){
 if(!media||!media.title||/^Loading\b/.test(media.title))return;
 upsertLibraryItem("history",{id:media.id,media_type:media.media_type,title:media.title,year:media.year,poster_path:media.poster_path,backdrop_path:media.backdrop_path});
}
function recommendationCards(){
 const items=normalizeResults(details?.recommendations?.results||[],media?.media_type).slice(0,10);
 const fallback=normalizeResults(details?.similar?.results||[],media?.media_type).slice(0,10);
 const list=items.length?items:fallback;
 return list.length?list.map(item=>'<a class="vivid-watch-rec-card" href="'+escapeHtml(getMediaUrl(item))+'"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(item.title)+'"><strong>'+escapeHtml(item.title)+'</strong><small>★ '+(item.vote_average?item.vote_average.toFixed(1):"—")+'</small></a>').join(""):'<p class="vivid-muted">More recommendations will appear as you explore Vivid.</p>';
}
function renderShell(params){
 const isTv=params.type==="tv";
 const title=media.title||"Vivid Cinema";
 const episodeTitle=isTv&&details?.episode?details.episode.name:"";
 const saved=getPlaybackProgress(progressKey());
 document.title=(episodeTitle?episodeTitle+" · ":"")+title+" · Vivid Cinema";
 $("watch-content").innerHTML=
  '<section class="vivid-watch-hero"><div id="watch-backdrop" class="vivid-watch-backdrop" style="--watch-backdrop:url(\''+getImageUrl(media.backdrop_path,"w1280")+'\')"></div><div class="vivid-watch-head"><div><span id="watch-kicker" class="vivid-watch-kicker">'+(isTv?"TV · SEASON "+params.season+" · EPISODE "+params.episode:"MOVIE")+'</span><h1 id="watch-title">'+escapeHtml(episodeTitle||title)+'</h1><p id="watch-overview">'+escapeHtml(isTv&&details?.episode?.overview?details.episode.overview:media.overview||"")+'</p></div><a class="vivid-button vivid-button--secondary" href="'+escapeHtml(buildTitleUrl(media.id,media.media_type))+'"><i class="bi bi-info-circle"></i> Details</a></div></section>'+
  '<section class="vivid-player-section" aria-label="Video player"><div class="vivid-player-placeholder"><div><span class="vivid-player-placeholder-kicker"><i class="bi bi-play-circle"></i> READY TO WATCH</span><h2>'+(isTv?escapeHtml(episodeTitle||title):escapeHtml(title))+'</h2><p>Playback opens in a focused player over this page. Your title page stays right where you left it.</p><button id="start-playback" class="vivid-button vivid-button--primary" type="button"><i class="bi bi-play-fill"></i> Start watching</button></div></div><div class="vivid-player-bar"><div><i class="bi bi-shield-check"></i><span>Powered by VidAPI</span></div><div><a href="'+escapeHtml(buildTitleUrl(media.id,media.media_type))+'">Back to title</a></div></div></section>' +
  '<div id="watch-player-modal" class="vivid-watch-player-modal" aria-hidden="true"><div class="vivid-watch-player-dialog" role="dialog" aria-modal="true" aria-labelledby="watch-player-title"><div class="vivid-watch-player-head"><div><span>NOW PLAYING</span><h2 id="watch-player-title">'+escapeHtml(isTv?episodeTitle||title:title)+'</h2></div><button id="close-watch-player" type="button" aria-label="Close player"><i class="bi bi-x-lg"></i></button></div><div class="vivid-watch-player-frame"><div id="player-status" class="vivid-player-status" role="status" aria-live="polite">'+(saved?"Resuming where you left off…":"Preparing VidAPI player…")+'</div><iframe id="vidapi-player" title="'+escapeHtml(title)+' player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write" allowfullscreen referrerpolicy="origin"></iframe></div></div></div>'+
  (isTv?'<section class="vivid-watch-note"><i class="bi bi-collection-play"></i><div><strong>Episode playback</strong><span>Use the episode list on the title page to switch seasons and episodes.</span></div></section>':"")+
  '<section class="vivid-watch-recommendations"><div class="vivid-section-heading"><div><span>AFTER WATCHING</span><h2>More like this</h2></div></div><div id="watch-recommendations" class="vivid-watch-rec-rail">'+recommendationCards()+'</div></section>';
 const modal=$("watch-player-modal");
 const player=$("vidapi-player");
 const start=$("start-playback");
 const close=$("close-watch-player");
 let loaded=false,timeout=0,previousFocus=null;
 const embedUrl=buildEmbedUrl(params,saved?.progress||route.params.get("startAt")||0);
 setCastMedia({ url: embedUrl, title: isTv ? (episodeTitle || title) : title });
 const openPlayer=()=>{
   previousFocus=document.activeElement;
   modal?.classList.add("is-open");
   modal?.setAttribute("aria-hidden","false");
   document.body.classList.add("vivid-modal-open");
   start?.blur();
   close?.focus();
   loaded=false;
   if(player) player.src=embedUrl;
   timeout=window.setTimeout(()=>{const status=$("player-status");if(!loaded&&status){status.textContent="VidAPI is taking longer than expected.";status.classList.add("is-warning")}},9000);
 };
 const closePlayer=()=>{
   if(!modal)return;
   modal.classList.remove("is-open");
   modal.setAttribute("aria-hidden","true");
   document.body.classList.remove("vivid-modal-open");
   if(player)player.src="about:blank";
   if(timeout)window.clearTimeout(timeout);
   if(previousFocus&&typeof previousFocus.focus==="function")previousFocus.focus();
 };
 start?.addEventListener("click",openPlayer);
 close?.addEventListener("click",closePlayer);
 modal?.addEventListener("click",(event)=>{if(event.target===modal)closePlayer()});
 document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&modal?.classList.contains("is-open"))closePlayer()});
 player?.addEventListener("load",()=>{loaded=true;window.clearTimeout(timeout);$("player-status")?.remove()});
}
function hydrateWatchDetails(params){
 if(!media)return;
 const isTv=params.type==="tv";
 const episodeTitle=isTv&&details?.episode?details.episode.name:"";
 const title=media.title||"Vivid Cinema";
 const titleNode=$("watch-title");
 const overviewNode=$("watch-overview");
 const kickerNode=$("watch-kicker");
 const backdrop=$("watch-backdrop");
 const player=$("vidapi-player");
 if(titleNode)titleNode.textContent=episodeTitle||title;
 if(overviewNode)overviewNode.textContent=isTv&&details?.episode?.overview?details.episode.overview:(media.overview||"");
 if(kickerNode)kickerNode.textContent=isTv?"TV · SEASON "+params.season+" · EPISODE "+params.episode:"MOVIE";
 if(backdrop)backdrop.style.setProperty("--watch-backdrop","url('"+getImageUrl(media.backdrop_path,"w1280")+"')");
 if(player)player.title=title+" player";
 const recommendations=$("watch-recommendations");
 if(recommendations)recommendations.innerHTML=recommendationCards();
 document.title=(episodeTitle?episodeTitle+" · ":"")+title+" · Vivid Cinema";
 recordHistory();
}
async function prepareNextEpisode(params){
 if(params.type!=="tv")return null;
 try{
   const season=await tmdbApi.tvSeason(params.id,params.season);
   const current=Number(params.episode);
   const next=(season.episodes||[]).find(ep=>Number(ep.episode_number)===current+1);
   if(next)return {season:params.season,episode:current+1,title:next.name};
   const seasons=(details?.seasons||[]).filter(s=>Number(s.season_number)>Number(params.season)&&Number(s.episode_count)>0);
   const nextSeason=seasons[0];
   if(nextSeason)return {season:Number(nextSeason.season_number),episode:1,title:"Episode 1"};
 }catch(_){}
 return null;
}
function handlePlayerEvent(event){
 if(event.origin!==VIDAPI_ORIGIN)return;
 const payload=event.data;
 if(!payload||payload.type!=="PLAYER_EVENT"||!payload.data)return;
 const data=payload.data;
 const info=data.player_info||{};
 if(String(info.mediaType||"")!==String(media?.media_type||""))return;
 if(info.tmdb != null && String(info.tmdb) !== String(media?.id))return;
 if(currentParams?.type==="tv"){
   if(info.season != null && Number(info.season)!==Number(currentParams.season))return;
   if(info.episode != null && Number(info.episode)!==Number(currentParams.episode))return;
 }
 const progress=Number(data.player_progress)||0;
 const duration=Number(data.player_duration)||0;
 if(progress>0){
   savePlaybackProgress(progressKey(),{progress,duration,season:info.season??currentParams?.season,episode:info.episode??currentParams?.episode,title:media.title,media_type:media.media_type,id:media.id});
 }
 if(data.player_status==="completed"){
   removePlaybackProgress(progressKey());
   if(media.media_type==="tv"&&nextEpisode){
     const target=buildWatchUrl(media.id,"tv",nextEpisode.season,nextEpisode.episode);
     window.setTimeout(()=>{window.location.href=target},1200);
   }
 }
}
window.addEventListener("message",handlePlayerEvent);
async function load(){
 currentParams=getParams();
 if(!currentParams.id){
  $("watch-content").innerHTML='<section class="vivid-watch-error"><i class="bi bi-exclamation-circle"></i><h1>Playback link is incomplete.</h1><p>Choose a title from Vivid Cinema and start playback again.</p><a class="vivid-button vivid-button--secondary" href="home.html">Browse titles</a></section>';return;
 }

 // VidAPI only needs the media ID/type (and season/episode for TV) to begin
 // playback. Do not make the player wait for TMDB details, credits or providers.
 media=normalizeMedia({
   id:currentParams.id,
   overview:"",
   title:currentParams.type==="tv"?"Loading episode…":"Loading movie…",
   poster_path:"",
   backdrop_path:""
 },currentParams.type);
 renderShell(currentParams);

 try{
  details=currentParams.type==="tv"?await tmdbApi.tvDetails(currentParams.id):await tmdbApi.movieDetails(currentParams.id);
  media=normalizeMedia(details,currentParams.type);
  if(currentParams.type==="tv"){
    const episodePromise=tmdbApi.tvSeason(currentParams.id,currentParams.season)
      .then(season=>(season.episodes||[]).find(ep=>Number(ep.episode_number)===Number(currentParams.episode))||null)
      .catch(()=>null);
    details.episode=await episodePromise;
    nextEpisode=await prepareNextEpisode(currentParams);
  }
  hydrateWatchDetails(currentParams);
 }catch(error){
  // Playback is already available through VidAPI even if TMDB metadata is unavailable.
  // Keep the player alive and surface only the metadata failure in the page copy.
  console.warn("Vivid metadata unavailable while playback is active:",error);
  const overviewNode=$("watch-overview");
  if(overviewNode)overviewNode.textContent="Playback is ready. Title information is temporarily unavailable.";
 }
}
document.addEventListener("DOMContentLoaded",()=>{void startLibrarySync().catch(()=>{});load();});
