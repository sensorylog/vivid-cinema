import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { buildTitleUrl, buildWatchUrl, getRoute } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { upsertLibraryItem, startLibrarySync } from "./library.js";
import { getPlaybackProgress, savePlaybackProgress, removePlaybackProgress } from "./recommendations.js";
import { VIVID_CONFIG } from "./config.js";

const $=id=>document.getElementById(id);
const route=getRoute();
const VIDAPI_ORIGIN=new URL(VIVID_CONFIG.vidapiEmbedBaseUrl).origin;
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
 const base=String(VIVID_CONFIG.vidapiEmbedBaseUrl||"").replace(/\/+$/,"");
 const query=new URLSearchParams({autoplay:"1"});
 if(Number(startAt)>5)query.set("resumeAt",String(Math.floor(Number(startAt))));
 const suffix="?"+query.toString();
 if(params.type==="tv")return base+"/embed/tv/"+encodeURIComponent(params.id)+"/"+params.season+"/"+params.episode+suffix;
 return base+"/embed/movie/"+encodeURIComponent(params.id)+suffix;
}
function recordHistory(){
 if(!media)return;
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
  '<section class="vivid-player-section" aria-label="Video player"><div class="vivid-player-frame"><div id="player-status" class="vivid-player-status" role="status" aria-live="polite">'+(saved?"Resuming where you left off…":"Preparing VidAPI player…")+'</div><iframe id="vidapi-player" title="'+escapeHtml(title)+' player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="origin" loading="eager"></iframe></div><div class="vivid-player-bar"><div><i class="bi bi-shield-check"></i><span>Powered by VidAPI</span></div><div><a href="'+escapeHtml(buildTitleUrl(media.id,media.media_type))+'">Back to title</a><a id="player-open" href="#" target="_blank" rel="noopener noreferrer">Open player</a></div></div></section>'+
  (isTv?'<section class="vivid-watch-note"><i class="bi bi-collection-play"></i><div><strong>Episode playback</strong><span>Use the episode list on the title page to switch seasons and episodes.</span></div></section>':"")+
  '<section class="vivid-watch-recommendations"><div class="vivid-section-heading"><div><span>AFTER WATCHING</span><h2>More like this</h2></div></div><div id="watch-recommendations" class="vivid-watch-rec-rail">'+recommendationCards()+'</div></section>';
 const player=$("vidapi-player"),status=$("player-status");
 let loaded=false;
 const timeout=window.setTimeout(()=>{if(!loaded&&status){status.textContent="VidAPI is taking longer than expected. You can open the player directly or return to the title.";status.classList.add("is-warning")}},9000);
 player.addEventListener("load",()=>{loaded=true;window.clearTimeout(timeout);status?.remove()},{once:true});
 const embedUrl=buildEmbedUrl(params,saved?.progress||route.params.get("startAt")||0);
 player.src=embedUrl;
 const openPlayer=$("player-open"); if(openPlayer)openPlayer.href=embedUrl;
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
