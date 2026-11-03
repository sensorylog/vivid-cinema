import { tmdbApi } from "../tmdb.js";
import { matchesSelectedRelease } from "./release-matcher.js";
import { describeLoadedMedia, probePlaybackCapabilities } from "./media-capabilities.js";
import { inspectMediaUrl } from "./media-inspector.js";
import { choosePreferredTrack, clearSubtitleOverlay, parseSubtitleFile, renderSubtitleAtTime } from "./subtitle-engine.js";
import { getPlaybackPreferences, playbackProfileKey, savePlaybackPreferences } from "./playback-preferences.js";
import { createTranscodePlayer } from "./transcode-player.js";

if (window.vividDownloads?.available) {
document.body.classList.add("vivid-desktop-offline-library");
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const bytes = value => {
  const n = Number(value) || 0;
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B","KB","MB","GB","TB"]; let size=n, index=0;
  while(size>=1024 && index<units.length-1){size/=1024;index++;}
  return size.toFixed(index?1:0)+" "+units[index];
};
const engine = window.vividDownloads;
let currentMedia = null;
let jobs = [];
let searchResults = [];
const BATCH_KEY = "vivid:desktop-download-batch";
let batchQueue = [];
try { const saved = JSON.parse(sessionStorage.getItem(BATCH_KEY) || "[]"); batchQueue = Array.isArray(saved) ? saved.slice(0, 5) : []; } catch { batchQueue = []; }
let currentSeasonEpisodes = [];
let seasonRequestId = 0;
let activePreferenceKey = "default";
let currentPlaybackPreferences = {};
let activeExternalSubtitleCues = [];
let externalSubtitleLabel = "";

function setMessage(message){ byId("offline-message").textContent = message; }
function statusText(job){
  if(job.status==="downloading") return "Downloading";
  if(job.status==="queued") return "In queue";
  if(job.status==="paused") return "Paused";
  if(job.status==="verifying") return "Finishing up";
  if(job.status==="completed") return "Saved";
  if(job.status==="failed") return "Needs attention";
  return "Preparing";
}
function transferText(job){
  const parts=[];
  const speed=Math.max(0,Number(job.speed)||0);
  const downloaded=Math.max(0,Number(job.downloaded)||0);
  const total=Math.max(0,Number(job.total)||0);
  const peers=Math.max(0,Number(job.peers)||0);
  if(speed>0)parts.push(bytes(speed)+"/s");
  else if(job.phase)parts.push(String(job.phase));
  if(peers>0)parts.push(peers+" peers");
  if(total>0)parts.push(bytes(downloaded)+" / "+bytes(total));
  if(speed>0&&total>downloaded){
    const seconds=Math.ceil((total-downloaded)/speed);
    const eta=seconds>=3600?Math.floor(seconds/3600)+"h "+Math.floor(seconds%3600/60)+"m":seconds>=60?Math.floor(seconds/60)+"m "+seconds%60+"s":seconds+"s";
    parts.push("about "+eta+" left");
  }
  return parts.join(" · ");
}
function transferMarkup(job){
  const detail=transferText(job);
  return detail?'<small class="offline-transfer-meta" data-transfer-meta="'+escapeHtml(job.id)+'">'+escapeHtml(detail)+'</small>':"";
}
function updateAggregateSpeed(){
  const total=jobs.filter(job=>job.status==="downloading").reduce((sum,job)=>sum+Math.max(0,Number(job.speed)||0),0);
  const node=byId("offline-total-speed");
  if(node)node.textContent=bytes(total)+"/s combined";
}
function batchIdentity(media){
  return [media.media_type,media.id,media.season??"",media.episode??""].join(":");
}
function saveBatchQueue(){
  try{sessionStorage.setItem(BATCH_KEY,JSON.stringify(batchQueue.slice(0,5)));}catch{}
  renderBatchQueue();
}
function renderBatchQueue(){
  const node=byId("desktop-batch-queue");
  if(!node)return;
  if(!batchQueue.length){node.hidden=true;node.innerHTML="";return;}
  node.hidden=false;
  node.innerHTML='<h3>Download batch · '+batchQueue.length+'/5</h3><p>Add up to five different movies or episodes. Your batch stays here while you choose other titles.</p><ul>'+batchQueue.map((item,index)=>{
    const media=item.media||{},episode=Number.isInteger(media.episode)?" · S"+String(media.season).padStart(2,"0")+"E"+String(media.episode).padStart(2,"0"):"";
    return '<li>'+escapeHtml(media.title||item.result?.title||"Selected title")+escapeHtml(episode)+' <small> — '+escapeHtml(item.result?.title||"Release")+'</small> <button type="button" data-batch-remove="'+index+'" aria-label="Remove from batch">Remove</button></li>';
  }).join("")+'</ul><div class="offline-batch-queue-actions"><button type="button" data-batch-start>Start batch ('+batchQueue.length+')</button><button type="button" data-batch-clear>Clear batch</button></div>';
}
function mediaForResult(item){
  if(!currentMedia)return null;
  return currentMedia.media_type==="tv"&&Number.isInteger(item.episode)
    ? {...currentMedia,season:item.season,episode:item.episode,episodeTitle:item.episodeTitle}
    : currentMedia;
}
function addSelectedToBatch(){
  const checked=[...byId("desktop-search-results").querySelectorAll('input[data-batch-result]:checked')];
  if(!checked.length){setMessage("Select at least one matching release first.");return;}
  let added=0,duplicates=0;
  for(const input of checked){
    const result=searchResults.find(item=>item.id===input.dataset.batchResult);
    const media=result&&mediaForResult(result);
    if(!result||!media||!matchesSelectedRelease(media,result))continue;
    const key=batchIdentity(media);
    if(batchQueue.some(item=>batchIdentity(item.media)===key)){duplicates++;continue;}
    if(batchQueue.length>=5)break;
    batchQueue.push({result:{id:result.id,title:result.title,provider:result.provider,size:result.size,seeds:result.seeds,peers:result.peers},media});
  added++;
  }
  saveBatchQueue();
  setMessage(added?added+" item(s) added to your batch. "+(duplicates?duplicates+" duplicate title/episode selection(s) skipped.":""):"Batch is full or those titles are already selected.");
}
async function startBatch(){
  if(!batchQueue.length)return;
  const button=byId("desktop-batch-queue").querySelector("[data-batch-start]");
  if(button){button.disabled=true;button.textContent="Starting batch…";}
  const pending=[...batchQueue];
  const results=await Promise.allSettled(pending.map(item=>engine.start(item.result,item.media)));
  let started=0;
  results.forEach((result,index)=>{
    if(result.status==="fulfilled"){
      const key=batchIdentity(pending[index].media);
      batchQueue=batchQueue.filter(item=>batchIdentity(item.media)!==key);
      started++;
    }
  });
  saveBatchQueue();
  await refresh();
  setMessage(started+" of "+pending.length+" batch download(s) started."+(batchQueue.length?" "+batchQueue.length+" item(s) remain in the batch; retry when ready.":""));
}

let libraryFilter="all";
let libraryQuery="";
let librarySort="recent";
function posterMarkup(media){
  const poster=String(media?.poster_path||"");
  const safePoster=/^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(poster)&&!poster.split("/").includes("..");
  return '<div class="offline-poster" aria-hidden="true"><span>VIVID</span>'+(safePoster?'<img loading="lazy" decoding="async" src="https://image.tmdb.org/t/p/w342'+escapeHtml(poster)+'" alt="">':"")+'</div>';
}
function errorMarkup(job){
  if(job.status!=="failed"||!job.error)return "";
  return '<p class="offline-job-error" role="status">'+escapeHtml(job.error)+'</p>';
}
function progressMarkup(job){
  if(!["downloading","paused","verifying","completed","queued"].includes(job.status))return "";
  const progress=Math.max(0,Math.min(100,Number(job.progress)||0));
  return '<div class="offline-progress" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+progress.toFixed(1)+'"><span style="width:'+progress+'%"></span></div>';
}
function actionMarkup(job){
  const actions=[];
  if(job.status==="downloading")actions.push('<button type="button" data-action="pause" data-id="'+escapeHtml(job.id)+'">Pause</button>');
  if(job.status==="paused"||job.status==="failed")actions.push('<button type="button" data-action="resume" data-id="'+escapeHtml(job.id)+'">Resume</button>');
  if(job.status==="completed")actions.push('<button type="button" class="is-primary" data-action="play" data-id="'+escapeHtml(job.id)+'">Watch now</button>');
  actions.push('<button type="button" data-action="details" data-id="'+escapeHtml(job.id)+'">Details</button>');
  if(job.status==="completed"&&job.filePath)actions.push('<button type="button" data-action="show" data-id="'+escapeHtml(job.id)+'">Show in folder</button>');
  if(["downloading","verifying","paused","failed","queued"].includes(job.status))actions.push('<button type="button" data-action="cancel" data-id="'+escapeHtml(job.id)+'">Cancel</button>');
  return actions.length?'<div class="offline-job-actions">'+actions.join("")+'</div>':"";
}
function fileMarkup(job){
  const files=Array.isArray(job.files)?job.files:[];
  if(!files.length)return "";
  const total=files.reduce((sum,file)=>sum+Math.max(0,Number(file.size)||0),0);
  if(files.length===1)return '<p class="offline-file-meta">'+escapeHtml(files[0].name)+' · '+bytes(files[0].size)+'</p>';
  return '<details class="offline-file-list"><summary>'+files.length+' playable files · '+bytes(total)+'</summary>'+files.map(file=>'<button type="button" data-action="play-file" data-id="'+escapeHtml(job.id)+'" data-index="'+Number(file.index)+'">'+escapeHtml(file.name)+' · '+bytes(file.size)+'</button>').join("")+'</details>';
}
function episodeMarkup(job){
  const media=job.media||{};
  const progress=Math.max(0,Math.min(100,Number(job.progress)||0));
  const season=Math.max(0,Math.floor(Number(media.season)||0));
  const episode=Math.max(0,Math.floor(Number(media.episode)||0));
  const episodeLabel="S"+String(season).padStart(2,"0")+"E"+String(episode).padStart(2,"0");
  const title=media.episodeTitle||job.title||"Episode";
  return '<article class="offline-episode-row" data-job-id="'+escapeHtml(job.id)+'"><div class="offline-episode-copy"><span class="offline-episode-number">'+episodeLabel+'</span><strong>'+escapeHtml(title)+'</strong><small class="offline-episode-status">'+escapeHtml(statusText(job))+(job.status==="downloading"?" · "+Math.round(progress)+"%":"")+'</small>'+progressMarkup(job)+transferMarkup(job)+errorMarkup(job)+fileMarkup(job)+'</div>'+actionMarkup(job)+'</article>';
}
function matchesLibrary(job){
  const media=job.media||{};
  const isSeries=media.media_type==="tv";
  if(libraryFilter==="downloading"&&!["downloading","queued","verifying"].includes(job.status))return false;
  if(libraryFilter==="saved"&&job.status!=="completed")return false;
  if(libraryFilter==="movies"&&isSeries)return false;
  if(libraryFilter==="series"&&!isSeries)return false;
  if(libraryFilter==="attention"&&!["failed","paused"].includes(job.status))return false;
  if(libraryQuery&&!String([job.title,media.title,media.episodeTitle].join(" ")).toLowerCase().includes(libraryQuery))return false;
  return true;
}
async function showTitleDetails(job){
  const dialog=byId("offline-title-dialog");
  const media=job.media||{};
  const isSeries=media.media_type==="tv";
  const title=String(media.title||job.title||"Untitled");
  const poster=String(media.poster_path||"");
  const safePoster=/^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(poster)&&!poster.split("/").includes("..");
  const image=safePoster?"https://image.tmdb.org/t/p/w500"+poster:"";
  const heading=byId("offline-title-detail-title");
  const copy=byId("offline-title-detail-copy");
  const art=byId("offline-title-detail-art");
  heading.textContent=title;
  art.style.backgroundImage=image?'url("'+image.replace(/["\\\\]/g,"")+'")':"";
  copy.textContent=isSeries?"TV series · Saved episodes":"Movie · Local library";
  byId("offline-title-detail-overview").textContent=String(media.overview||"Loading title information…");
  byId("offline-title-detail-meta").textContent=isSeries?"Series library":"Saved movie";
  byId("offline-title-detail-watch").hidden=job.status!=="completed";
  byId("offline-title-detail-watch").dataset.jobId=job.id;
  if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","");
  if(!media.id)return;
  try{
    const detail=isSeries?await tmdbApi.tvDetailsBasic(media.id):await tmdbApi.movieDetailsBasic(media.id);
    const date=String(detail?.release_date||detail?.first_air_date||"");
    const year=date.slice(0,4);
    const rating=Number(detail?.vote_average);
    const genres=Array.isArray(detail?.genres)?detail.genres.map(item=>item.name).filter(Boolean).slice(0,4).join(" · "):"";
    byId("offline-title-detail-overview").textContent=String(detail?.overview||media.overview||"No description is available for this title.");
    byId("offline-title-detail-meta").textContent=[year,Number.isFinite(rating)&&rating>0?"★ "+rating.toFixed(1):"",genres].filter(Boolean).join(" · ")|| (isSeries?"Series library":"Saved movie");
    const detailPoster=String(detail?.poster_path||"");
    if(/^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(detailPoster)&&!detailPoster.split("/").includes(".."))art.style.backgroundImage='url("https://image.tmdb.org/t/p/w500'+detailPoster+'")';
  }catch{
    byId("offline-title-detail-overview").textContent=String(media.overview||"Title information is unavailable offline. Your saved media remains in your library.");
  }
}
byId("offline-title-detail-close").addEventListener("click",()=>byId("offline-title-dialog").close());
byId("offline-title-detail-watch").addEventListener("click",async event=>{
  const job=jobs.find(item=>item.id===event.currentTarget.dataset.jobId);
  if(!job)return;
  byId("offline-title-dialog").close();
  try{await play(job,0);}catch(error){setMessage(error?.message||"Could not open this saved title.");}
});
function render(){
  const completedJobs=jobs.filter(x=>x.status==="completed");
  const completed=completedJobs.length;
  const active=jobs.filter(x=>["downloading","queued","verifying"].includes(x.status)).length;
  const savedBytes=completedJobs.reduce((sum,job)=>sum+(Array.isArray(job.files)&&job.files.length?job.files.reduce((fileSum,file)=>fileSum+Math.max(0,Number(file.size)||0),0):Math.max(0,Number(job.total)||0)),0);
  byId("offline-total").textContent=String(jobs.length);
  byId("offline-completed").textContent=String(completed);
  byId("offline-active").textContent=String(active);
  updateAggregateSpeed();
  byId("offline-storage").textContent=bytes(savedBytes);
  const visible=jobs.filter(matchesLibrary);
  const seriesCount=new Set(jobs.filter(job=>job.media?.media_type==="tv").map(job=>String(job.media.id||job.media.title||job.title))).size;
  const countNode=byId("offline-library-count");
  if(countNode)countNode.textContent=jobs.length+" downloads · "+seriesCount+" series";
  if(!jobs.length){
    byId("offline-jobs").innerHTML='<div class="offline-empty"><strong>Your cinema starts here</strong><p>Movies and episodes you save will appear here, ready for offline watching.</p></div>';
    return;
  }
  if(!visible.length){
    byId("offline-jobs").innerHTML='<div class="offline-empty"><strong>No matching titles</strong><p>Try another search or choose a different filter.</p></div>';
    return;
  }
  const series=new Map(), movies=[];
  for(const job of visible){
    const media=job.media||{};
    if(media.media_type==="tv"){
      const key=String(media.id||media.title||job.title).toLowerCase();
      if(!series.has(key))series.set(key,[]);
      series.get(key).push(job);
    }else movies.push(job);
  }
  const entries=[];
  for(const group of series.values()){
    group.sort((a,b)=>(Number(a.media?.season)||0)-(Number(b.media?.season)||0)||(Number(a.media?.episode)||0)-(Number(b.media?.episode)||0));
    const first=group[0],media=first.media||{},title=media.title||first.title||"Untitled series";
    const activeCount=group.filter(job=>["downloading","queued","verifying"].includes(job.status)).length;
    const savedCount=group.filter(job=>job.status==="completed").length;
    const newest=Math.max(...group.map(job=>Number(job.updatedAt||job.createdAt)||0));
    const seasons=new Map();for(const episodeJob of group){const seasonNumber=Math.max(0,Math.floor(Number(episodeJob.media?.season)||0));if(!seasons.has(seasonNumber))seasons.set(seasonNumber,[]);seasons.get(seasonNumber).push(episodeJob);}const seasonMarkup=[...seasons.entries()].sort((a,b)=>a[0]-b[0]).map(([seasonNumber,episodes])=>'<details class="offline-season-group" open><summary>Season '+seasonNumber+' <span>'+episodes.length+' episodes</span></summary><div>'+episodes.map(episodeMarkup).join("")+'</div></details>').join("");const markup='<article class="offline-series-card"><header class="offline-series-card-heading">'+posterMarkup(media)+'<div><span class="offline-card-kicker">TV SERIES</span><h3>'+escapeHtml(title)+'</h3><p>'+group.length+' episodes · '+savedCount+' saved'+(activeCount?' · '+activeCount+' in progress':'')+'</p><button type="button" class="offline-details-button" data-action="details" data-id="'+escapeHtml(first.id)+'">Series details</button></div></header><div class="offline-series-episodes">'+seasonMarkup+'</div></article>';
    const size=group.reduce((sum,job)=>sum+(Array.isArray(job.files)?job.files.reduce((fileSum,file)=>fileSum+Math.max(0,Number(file.size)||0),0):Math.max(0,Number(job.total)||0)),0);
    entries.push({time:newest,title,size,markup});
  }
  for(const job of movies){
    const media=job.media||{},progress=Math.max(0,Math.min(100,Number(job.progress)||0));
    const title=media.title||job.title||"Untitled movie";
    const detail=statusText(job)+(job.status==="downloading"?" · "+Math.round(progress)+"%":"");
    const markup='<article class="offline-media-card" data-job-id="'+escapeHtml(job.id)+'">'+posterMarkup(media)+'<div class="offline-media-copy"><span class="offline-card-kicker">MOVIE</span><h3>'+escapeHtml(title)+'</h3><p class="offline-card-status">'+escapeHtml(detail)+'</p>'+progressMarkup(job)+transferMarkup(job)+errorMarkup(job)+fileMarkup(job)+actionMarkup(job)+'</div></article>';
    const size=Array.isArray(job.files)?job.files.reduce((sum,file)=>sum+Math.max(0,Number(file.size)||0),0):Math.max(0,Number(job.total)||0);
    entries.push({time:Number(job.updatedAt||job.createdAt)||0,title,size,markup});
  }
  entries.sort((a,b)=>librarySort==="title"?a.title.localeCompare(b.title,undefined,{sensitivity:"base"}):librarySort==="largest"?b.size-a.size||b.time-a.time:b.time-a.time);
  byId("offline-jobs").innerHTML='<div class="offline-library-grid">'+entries.map(entry=>entry.markup).join("")+'</div>';
}
async function renderContinueWatching(){
  const section=byId("offline-continue-section");
  const list=byId("offline-continue-list");
  if(!section||!list)return;
  const candidates=jobs.filter(job=>job.status==="completed").slice(0,40);
  if(!candidates.length){section.hidden=true;list.replaceChildren();return;}
  const results=await Promise.all(candidates.map(async job=>{
    try{return {job,position:Number(await engine.getPlaybackPosition(job.id,0))||0};}
    catch{return {job,position:0};}
  }));
  const resumable=results.filter(item=>item.position>5).sort((a,b)=>b.position-a.position).slice(0,8);
  if(!resumable.length){section.hidden=true;list.replaceChildren();return;}
  section.hidden=false;
  list.innerHTML=resumable.map(({job,position})=>{
    const media=job.media||{};
    const title=media.episodeTitle||media.title||job.title||"Saved title";
    const label=media.media_type==="tv"?"S"+String(media.season||0).padStart(2,"0")+"E"+String(media.episode||0).padStart(2,"0"):"MOVIE";
    return '<article class="offline-continue-card">'+posterMarkup(media)+'<div><span class="offline-card-kicker">'+escapeHtml(label)+'</span><strong>'+escapeHtml(title)+'</strong><small>Continue from '+escapeHtml(clock(position))+'</small><button type="button" data-action="continue" data-id="'+escapeHtml(job.id)+'">Continue watching</button></div></article>';
  }).join("");
}
function renderSearch(items){
  searchResults=[...items].sort((a,b)=>(Number(b.seeds)||0)-(Number(a.seeds)||0)||(Number(b.peers)||0)-(Number(a.peers)||0));
  const identityMatches=currentMedia?searchResults.filter(item=>{
    const media=mediaForResult(item);
    return media&&matchesSelectedRelease(media,item);
  }):items;
  const quality=byId("desktop-quality").value;
  const filtered=identityMatches.filter(item=>quality==="any"||new RegExp("(?:^|[^0-9])"+quality+"p?(?:[^0-9]|$)","i").test(item.title));
  byId("desktop-add-selected").hidden=!filtered.length||!currentMedia;
  byId("desktop-search-results").innerHTML=filtered.length?filtered.map(item=>{
    const episodeLabel=Number.isInteger(item.episode)
      ? "S"+String(item.season).padStart(2,"0")+"E"+String(item.episode).padStart(2,"0")+(item.episodeTitle?" · "+item.episodeTitle:"")
      : "";
    const checkbox=currentMedia?'<label class="offline-result-select"><input type="checkbox" data-batch-result="'+escapeHtml(item.id)+'"><span><strong>'+escapeHtml(item.title)+'</strong><p>'+(episodeLabel?'<b>'+escapeHtml(episodeLabel)+'</b> · ':"")+escapeHtml(item.provider)+' · '+escapeHtml(item.size||"Size unknown")+' · '+Math.max(0,Number(item.seeds)||0)+' seeds · '+Math.max(0,Number(item.peers)||0)+' peers</p></span></label>':'<div><strong>'+escapeHtml(item.title)+'</strong><p>'+escapeHtml(item.provider)+' · '+escapeHtml(item.size||"Size unknown")+'</p></div>';
    return '<article class="offline-result">'+checkbox+'<button type="button" data-result="'+escapeHtml(item.id)+'">Download</button></article>';
  }).join(""):'<p class="offline-muted">'+(currentMedia&&items.length?"No releases matched this exact title and release identity.":"No matching releases. Try another quality or search term.")+'</p>';
  return filtered.length;
}
async function loadSeriesSeason(seasonNumber){
  const requestId=++seasonRequestId;
  const list=byId("desktop-episodes");
  byId("desktop-episode-select-all").textContent="Select all";
  list.innerHTML='<p class="offline-muted">Loading season episodes…</p>';
  currentSeasonEpisodes=[];
  byId("desktop-search-results").innerHTML="";
  try{
    const data=await tmdbApi.tvSeason(currentMedia.id,seasonNumber);
    if(requestId!==seasonRequestId)return;
    currentSeasonEpisodes=Array.isArray(data?.episodes)?data.episodes:[];
    list.innerHTML=currentSeasonEpisodes.length?currentSeasonEpisodes.map(episode=>{
      const number=Number(episode.episode_number)||0;
      const label="Episode "+number+" · "+String(episode.name||"Untitled episode");
      const date=episode.air_date?" · "+episode.air_date:"";
      return '<label class="offline-episode-option"><input type="checkbox" data-episode="'+number+'"><span><strong>'+escapeHtml(label)+'</strong><small>'+escapeHtml(String(episode.overview||"").slice(0,180)||"No episode description available.")+escapeHtml(date)+'</small></span></label>';
    }).join(""):'<p class="offline-muted">No episodes are listed for this season.</p>';
  }catch(error){
    if(requestId!==seasonRequestId)return;
    list.innerHTML='<p class="offline-muted">Could not load this season: '+escapeHtml(error?.message||"Please try again.")+'</p>';
  }
}
async function searchSelectedEpisodes(){
  const selected=[...byId("desktop-episodes").querySelectorAll('input[data-episode]:checked')]
    .map(input=>currentSeasonEpisodes.find(episode=>Number(episode.episode_number)===Number(input.dataset.episode)))
    .filter(Boolean);
  if(!selected.length){setMessage("Select at least one episode first.");return;}
  const season=Number(byId("desktop-season-select").value);
  const found=[];
  byId("desktop-episode-search").disabled=true;
  byId("desktop-search-results").innerHTML="";
  try{
    for(let index=0;index<selected.length;index++){
      const episode=selected[index], number=Number(episode.episode_number);
      const query=(currentMedia.title||"")+" S"+String(season).padStart(2,"0")+"E"+String(number).padStart(2,"0");
      setMessage("Finding releases for episode "+number+" ("+(index+1)+" of "+selected.length+")…");
      try{
        const rows=await engine.search(query);
        found.push(...rows.map(row=>({...row,season,episode:number,episodeTitle:String(episode.name||"")})));
      }catch(error){console.warn("Episode release search failed:",query,error);}
    }
    const matched=renderSearch(found);
    setMessage(matched?"Select one matching release per episode, then add up to five to your batch.":"No releases matched the selected episodes. Try another season or episode.");
  }finally{byId("desktop-episode-search").disabled=false;}
}
async function searchTitle(media){
  currentMedia=media;
  byId("desktop-search-input").value=media.title||"";
  const seriesPicker=byId("desktop-series-picker");
  if(media.media_type==="tv"){
    seriesPicker.hidden=false;
    byId("desktop-series-title").textContent=media.title||"Choose episodes";
    byId("desktop-search-results").innerHTML="";
    let seasons=Array.isArray(media.seasons)?media.seasons:[];
    if(!seasons.length){
      try{const details=await tmdbApi.tvDetailsBasic(media.id);seasons=Array.isArray(details?.seasons)?details.seasons:[];}
      catch(error){setMessage("Could not load series seasons: "+(error?.message||"Please try again."));return;}
    }
    seasons=seasons.filter(season=>Number.isInteger(Number(season.season_number))&&Number(season.season_number)>=0&&Number(season.episode_count)>0)
      .sort((a,b)=>Number(a.season_number)-Number(b.season_number));
    const seasonSelect=byId("desktop-season-select");
    seasonSelect.innerHTML=seasons.map(season=>'<option value="'+Number(season.season_number)+'">'+escapeHtml(season.name||("Season "+season.season_number))+' ('+Number(season.episode_count)+' episodes)</option>').join("");
    if(!seasons.length){byId("desktop-episodes").innerHTML='<p class="offline-muted">No seasons with episodes are available for this series.</p>';setMessage("No season information is available for this series.");return;}
    const first=seasons.find(season=>Number(season.season_number)>0)||seasons[0];
    seasonSelect.value=String(first.season_number);
    setMessage("Choose a season and tick the episodes you want to download.");
    await loadSeriesSeason(first.season_number);
    return;
  }
  seriesPicker.hidden=true;
  setMessage("Searching available releases for "+(media.title||"your title")+"…");
  try{const query=[media.title,media.year].filter(Boolean).join(" ");const rows=await engine.search(query);const matched=renderSearch(rows);setMessage(matched?"Choose the exact release, or add it to your batch.":"No releases matched "+(media.title||"this title")+" ("+(media.year||"release year unknown")+").");}
  catch(error){setMessage(error?.message||"Search is unavailable. Check your connection and try again.");}
}
const posterLookups=new Set();
async function hydratePosterArtwork(){
  const queue=jobs.filter(job=>{
    const media=job.media||{};
    if(media.poster_path||!media.id)return false;
    const key=media.media_type+":"+media.id;
    if(posterLookups.has(key))return false;
    posterLookups.add(key);
    return true;
  });
  let changed=false;
  const worker=async()=>{
    while(queue.length){
      const job=queue.shift(),media=job.media||{};
      try{
        const details=media.media_type==="tv"
          ? await tmdbApi.tvDetailsBasic(media.id)
          : await tmdbApi.movieDetailsBasic(media.id);
        const poster=String(details?.poster_path||"");
        if(/^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(poster)&&!poster.split("/").includes("..")){
          for(const candidate of jobs){
            const candidateMedia=candidate.media||{};
            if(candidateMedia.media_type===media.media_type&&String(candidateMedia.id||"")===String(media.id||"")){
              candidateMedia.poster_path=poster;
              changed=true;
            }
          }
        }
      }catch{}
    }
  };
  await Promise.all([worker(),worker()]);
  if(changed)render();
}
let progressRenderTimer=0;
function scheduleProgressRender(){
  if(progressRenderTimer)return;
  progressRenderTimer=setTimeout(()=>{
    progressRenderTimer=0;
    render();
  },300);
}
async function refresh(){
  if(progressRenderTimer){clearTimeout(progressRenderTimer);progressRenderTimer=0;}
  try{
    jobs=(await engine.list()).filter(job=>job.status!=="cancelled");
    render();
    void renderContinueWatching();
    void hydratePosterArtwork();
  }catch(error){setMessage(error?.message||"Could not load your downloads.");}
}
const player = byId("offline-player");
const transcodePlayer = createTranscodePlayer(player);
let audioContext = null;
let audioSource = null;
let audioGain = null;
let audioCompressor = null;
let audioDelay = null;
let audioGraphUnavailable = false;
let capabilityReportPromise = null;
let diagnosticsRequest = 0;
const clock = value => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? hours + ":" + String(minutes).padStart(2,"0") + ":" + String(rest).padStart(2,"0") : minutes + ":" + String(rest).padStart(2,"0");
};
async function updatePlaybackDiagnostics(){
  const request=++diagnosticsRequest;
  const filename=player.dataset.mediaFilename||"";
  const media=describeLoadedMedia(player,filename);
  const summary=byId("offline-media-summary");
  summary.textContent=media.filename+" · "+media.container.label+" · "+media.resolution+" · "+(media.duration===null?"Duration unavailable":clock(media.duration))+" · "+media.codec;
  const details=byId("offline-file-details");
  details.textContent="Inspecting actual container and track metadata…";
  if(player.dataset.transcodeSessionId){
    let codecs={};
    try{codecs=JSON.parse(player.dataset.transcodeCodecs||"{}");}catch{}
    details.textContent="FFmpeg compatibility stream · H.264 video · "+(codecs.outputAudio||"No audio stream")+" · Original video: "+(codecs.inputVideo||"unknown")+" · Original audio: "+(codecs.inputAudio||"none");
  }else{
  try{
    const inspected=await inspectMediaUrl(player.currentSrc,filename);
    if(request!==diagnosticsRequest)return;
    const videoTrack=inspected.tracks.find(track=>track.kind==="video"&&Number.isFinite(track.frameRate)&&track.frameRate>0);
    player.dataset.frameRate=videoTrack?String(videoTrack.frameRate):"";
    const frameControlsAvailable=Boolean(videoTrack);
    byId("offline-frame-back").disabled=!frameControlsAvailable;
    byId("offline-frame-forward").disabled=!frameControlsAvailable;
    const trackSummary=inspected.tracks.length?inspected.tracks.map(track=>track.kind+": "+track.codec+(track.language?" ("+track.language+")":"")+(track.kind==="video"&&track.frameRate?" · "+track.frameRate.toFixed(3)+" fps":"")).join(" · "):"No tracks identified in inspected metadata";
    const duration=Number.isFinite(inspected.duration)?clock(inspected.duration):"Duration not present in inspected metadata";
    const resolution=inspected.width&&inspected.height?Math.round(inspected.width)+" × "+Math.round(inspected.height):media.resolution;
    details.textContent=inspected.format+" · "+trackSummary+" · "+duration+" · "+resolution+" · "+(inspected.partial?"Metadata scan limited to first 32 MiB":"Metadata scan complete")+". "+inspected.note;
  }catch(error){
    if(request===diagnosticsRequest){player.dataset.frameRate="";byId("offline-frame-back").disabled=true;byId("offline-frame-forward").disabled=true;details.textContent="Media metadata scan unavailable: "+(error?.message||"Unknown inspection error");}
  }
  }
  if(!capabilityReportPromise)capabilityReportPromise=probePlaybackCapabilities({video:player});
  const report=await capabilityReportPromise;
  if(request!==diagnosticsRequest)return;
  const grid=byId("offline-capability-grid");
  grid.replaceChildren();
  const addGroup=(title,items)=>{
    const group=document.createElement("section");
    group.className="offline-capability-group";
    const heading=document.createElement("h4");heading.textContent=title;group.appendChild(heading);
    const list=document.createElement("ul");
    for(const item of items){
      const row=document.createElement("li");
      const name=document.createElement("span");name.textContent=item.label;
      const state=document.createElement("strong");
      state.textContent=item.supported?"Reported supported":"Not reported";
      state.className=item.supported?"is-supported":"is-unknown";
      row.append(name,state);
      if(item.mediaCapabilities){
        const detail=document.createElement("small");
        detail.textContent=(item.mediaCapabilities.smooth===null?"":item.mediaCapabilities.smooth?"Smooth estimate":"May not be smooth")
          +(item.mediaCapabilities.powerEfficient===null?"":(item.mediaCapabilities.smooth===null?"":" · ")+(item.mediaCapabilities.powerEfficient?"Power efficient":"Not power efficient"));
        row.appendChild(detail);
      }
      list.appendChild(row);
    }
    group.appendChild(list);grid.appendChild(group);
  };
  addGroup("Video codecs",report.videoProfiles);
  addGroup("Audio codecs",report.audioProfiles);
  byId("offline-capability-note").textContent=report.note+" These estimates describe this Windows device and Chromium build; they do not confirm the codecs inside the selected file.";
}
function syncPlayerControls(){
  const duration=Number.isFinite(player.duration)?player.duration:0;
  if(seekPreviewTarget===null)byId("offline-seek").value=duration?String(Math.round(player.currentTime/duration*100000)):"0";
  byId("offline-time").textContent=clock(player.currentTime)+" / "+clock(duration);
  byId("offline-play-toggle").textContent=player.paused?"Play":"Pause";
  byId("offline-play-toggle").setAttribute("aria-label",player.paused?"Play":"Pause");
}
function ensureAudioProcessing(){
  if(audioGraphUnavailable)return false;
  if(audioGain&&audioDelay)return true;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass){
    audioGraphUnavailable=true;
    setMessage("Audio boost and delay are unavailable in this Windows media session.");
    return false;
  }
  try{
    audioContext=audioContext||new AudioContextClass();
    audioSource=audioSource||audioContext.createMediaElementSource(player);
    audioGain=audioContext.createGain();
    audioCompressor=audioContext.createDynamicsCompressor();
    audioCompressor.threshold.value=-1;
    audioCompressor.knee.value=0;
    audioCompressor.ratio.value=20;
    audioCompressor.attack.value=0.003;
    audioCompressor.release.value=0.15;
    audioDelay=audioContext.createDelay(0.6);
    audioGain.gain.value=Number(byId("offline-audio-boost").value)/100;
    audioDelay.delayTime.value=Number(byId("offline-audio-delay").value)/1000;
    audioSource.connect(audioGain);
    audioGain.connect(audioCompressor);
    audioCompressor.connect(audioDelay);
    audioDelay.connect(audioContext.destination);
    void audioContext.resume().catch(error=>setMessage("Audio processing could not start: "+(error?.message||"Please try again.")));
    return true;
  }catch(error){
    audioGraphUnavailable=true;
    setMessage("Audio processing could not be enabled: "+(error?.message||"This file may not support enhanced audio."));
    return false;
  }
}
let seekFeedbackTimer=0;
function seekBy(seconds){
  if(!Number.isFinite(player.duration))return;
  player.currentTime=Math.max(0,Math.min(player.duration,player.currentTime+seconds));
  const feedback=byId("offline-seek-feedback");
  if(Math.abs(seconds)===10)feedback.textContent=seconds<0?"−10 seconds":"+10 seconds";else feedback.textContent=(seconds<0?"−":"+")+Math.abs(seconds)+" seconds";
  feedback.className="offline-seek-feedback "+(seconds<0?"is-back":"is-forward");
  feedback.hidden=false;
  if(seekFeedbackTimer)clearTimeout(seekFeedbackTimer);
  seekFeedbackTimer=setTimeout(()=>{feedback.hidden=true;},850);
}
function clearExternalSubtitle(){
  const track=byId("offline-external-subtitle");
  if(track)track.remove();
  if(player.dataset.subtitleUrl){URL.revokeObjectURL(player.dataset.subtitleUrl);delete player.dataset.subtitleUrl;}
  activeExternalSubtitleCues=[];
  externalSubtitleLabel="";
  clearSubtitleOverlay(byId("offline-subtitle-overlay"));
  subtitleCueBaseTimes=[];
  activeSubtitleTrack=null;
  refreshSubtitleTracks();
}
let chapterTrack=null;
let chapterCues=[];
const introPattern=/\b(intro|opening|recap|previously on)\b/i;
const creditsPattern=/\b(credits|end credits|closing credits|outro)\b/i;
function readChapterCues(){
  const tracks=Array.from(player.textTracks||[]);
  chapterTrack=tracks.find(track=>track.kind==="chapters")||null;
  if(chapterTrack&&chapterTrack.mode==="disabled")chapterTrack.mode="hidden";
  chapterCues=chapterTrack?Array.from(chapterTrack.cues||[]).filter(cue=>Number.isFinite(cue.startTime)&&Number.isFinite(cue.endTime)&&cue.endTime>cue.startTime).sort((a,b)=>a.startTime-b.startTime):[];
  byId("offline-chapter-controls").hidden=chapterCues.length===0;
  updateChapterControls();
}
function updateChapterControls(){
  const controls=byId("offline-chapter-controls");
  if(!chapterCues.length){controls.hidden=true;return;}
  controls.hidden=false;
  const now=Number(player.currentTime)||0;
  const activeIndex=chapterCues.findIndex(cue=>now>=cue.startTime&&now<cue.endTime);
  const active=activeIndex>=0?chapterCues[activeIndex]:null;
  const chapterText=String(active?.text||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  byId("offline-chapter-label").textContent=chapterText?chapterText.slice(0,56):active?"Chapter "+(activeIndex+1):"Chapters";
  byId("offline-chapter-previous").disabled=chapterCues.every(cue=>cue.startTime>=now-0.5);
  byId("offline-chapter-next").disabled=!chapterCues.some(cue=>cue.startTime>now+0.5);
  const introIndex=chapterCues.findIndex(cue=>introPattern.test(String(cue.text||"")));
  const intro= chapterCues[introIndex];
  const skipIntro=byId("offline-skip-intro");
  skipIntro.hidden=!(intro&&now>=intro.startTime-0.5&&now<intro.endTime);
  const credits=chapterCues.find(cue=>creditsPattern.test(String(cue.text||""))&&now>=cue.startTime&&now<cue.endTime);
  byId("offline-skip-credits").hidden=!credits;
}
function seekToChapter(direction){
  if(!chapterCues.length)return;
  const now=Number(player.currentTime)||0;
  if(direction>0){
    const next=chapterCues.find(cue=>cue.startTime>now+0.5);
    if(next)player.currentTime=next.startTime;
    return;
  }
  const activeIndex=chapterCues.findIndex(cue=>now>=cue.startTime&&now<cue.endTime);
  if(activeIndex>=0&&now-chapterCues[activeIndex].startTime>3){
    player.currentTime=chapterCues[activeIndex].startTime;
    return;
  }
  const prior=chapterCues.filter(cue=>cue.startTime<now-0.5);
  if(prior.length)player.currentTime=prior[prior.length-1].startTime;
}
byId("offline-chapter-previous").addEventListener("click",()=>seekToChapter(-1));
byId("offline-chapter-next").addEventListener("click",()=>seekToChapter(1));
byId("offline-skip-intro").addEventListener("click",()=>{
  const intro=chapterCues.find(cue=>introPattern.test(String(cue.text||"")));
  if(!intro)return;
  const next=chapterCues.find(cue=>cue.startTime>=intro.endTime-0.5);
  player.currentTime=next?next.startTime:intro.endTime;
});
byId("offline-skip-credits").addEventListener("click",()=>{
  const credits=chapterCues.find(cue=>creditsPattern.test(String(cue.text||""))&&player.currentTime>=cue.startTime&&player.currentTime<cue.endTime);
  if(credits)player.currentTime=Math.min(Number.isFinite(player.duration)?player.duration:credits.endTime,Math.max(credits.endTime,credits.startTime));
});
function loadExternalSubtitle(file){
  if(!file)return;
  const extension=(file.name.split(".").pop()||"").toLowerCase();
  try{
    const reader=new FileReader();
    reader.onerror=()=>setMessage("Could not read that subtitle file.");
    reader.onload=()=>{
      try{
        const cues=parseSubtitleFile(String(reader.result||""),extension);
        clearExternalSubtitle();
        activeExternalSubtitleCues=cues;
        externalSubtitleLabel=file.name;
        refreshSubtitleTracks();
        byId("offline-subtitle-track").value="-2";
        renderExternalSubtitle();
        setMessage("Loaded "+cues.length+" subtitle cues from "+file.name+".");
        saveCurrentPlaybackPreferences({subtitleExternalLabel:file.name});
      }catch(error){setMessage(error?.message||"Could not load this subtitle.");}
    };
    reader.readAsText(file);
  }catch(error){setMessage(error?.message||"Could not read that subtitle file.");}
}
function subtitleRenderPreferences(){
  return {
    size:byId("offline-subtitle-size").value,
    font:byId("offline-subtitle-font").value,
    color:byId("offline-subtitle-color").value,
    outline:byId("offline-subtitle-outline").checked,
    position:byId("offline-subtitle-position").value,
    background:Number(byId("offline-subtitle-background").value)/100
  };
}
function renderExternalSubtitle(){
  const offset=Number(byId("offline-subtitle-offset").value)||0;
  renderSubtitleAtTime(byId("offline-subtitle-overlay"),activeExternalSubtitleCues,player.currentTime-offset,subtitleRenderPreferences());
}
function saveCurrentPlaybackPreferences(patch){
  currentPlaybackPreferences={...currentPlaybackPreferences,...patch};
  savePlaybackPreferences(activePreferenceKey,patch);
}
function applyPlaybackPreferences(){
  const prefs=getPlaybackPreferences(activePreferenceKey);
  currentPlaybackPreferences=prefs;
  const values={
    "offline-audio-language":prefs.audioLanguage||"",
    "offline-subtitle-language":prefs.subtitleLanguage||"",
    "offline-subtitle-size":prefs.subtitleSize||"auto",
    "offline-subtitle-font":prefs.font||"auto",
    "offline-subtitle-color":prefs.color||"auto",
    "offline-subtitle-position":prefs.position||"auto",
    "offline-subtitle-background":String(Math.round((Number(prefs.background??0.25))*100)),
    "offline-subtitle-offset":String(Number(prefs.subtitleOffset)||0)
  };
  for(const [id,value] of Object.entries(values))byId(id).value=value;
  byId("offline-subtitle-outline").checked=prefs.outline!==false;
  byId("offline-player-section").dataset.subtitleSize=values["offline-subtitle-size"];
  byId("offline-subtitle-background-value").textContent=values["offline-subtitle-background"]+"%";
  byId("offline-subtitle-offset-value").textContent=(Number(values["offline-subtitle-offset"])>0?"+":"")+Number(values["offline-subtitle-offset"]).toFixed(1)+"s";
}
function refreshSubtitleTracks(){
  const select=byId("offline-subtitle-track");
  if(!select)return;
  const tracks=player.textTracks;
  select.innerHTML="";
  const off=document.createElement("option");off.value="-1";off.textContent="Off";select.appendChild(off);
  if(activeExternalSubtitleCues.length){
    const external=document.createElement("option");external.value="-2";external.textContent=externalSubtitleLabel||"External subtitles";select.appendChild(external);
  }
  let selected="-1";
  const preferred=String(currentPlaybackPreferences.subtitleLanguage||"");
  const subtitleOff=currentPlaybackPreferences.subtitleOff===true||preferred==="off";
  const eligibleTracks=Array.from(tracks||[]).filter(track=>track.kind!=="chapters");
  const preferredIndex=choosePreferredTrack(eligibleTracks,preferred);
  const selectable=[];
  for(let index=0;index<tracks.length;index++){
    const track=tracks[index];
    if(track.kind==="chapters")continue;
    selectable.push({track,index});
    const option=document.createElement("option");
    option.value=String(index);
    option.textContent=track.label||track.language||("Subtitle "+(index+1));
    select.appendChild(option);
    if(track.mode==="showing")selected=option.value;
  }
  if(activeExternalSubtitleCues.length){selected="-2";for(const item of selectable)item.track.mode="disabled";}
  else if(subtitleOff){selected="-1";for(const item of selectable)item.track.mode="disabled";}
  else if(preferredIndex>=0){
    const preferredTrack=selectable[preferredIndex];
    if(preferredTrack){selected=String(preferredTrack.index);for(const item of selectable)item.track.mode=item===preferredTrack?"showing":"disabled";}
  }
  select.value=selected;
  select.parentElement.hidden=selectable.length===0&&!activeExternalSubtitleCues.length;
}
function applySubtitleOffset(){
  const offset=Number(byId("offline-subtitle-offset").value)||0;
  byId("offline-subtitle-offset-value").textContent=(offset>0?"+":"")+offset.toFixed(1)+"s";
  if(activeSubtitleTrack&&subtitleCueBaseTimes.length){
    const cues=activeSubtitleTrack.cues;
    if(cues)subtitleCueBaseTimes.forEach((base,index)=>{
      const cue=cues[index];if(!cue)return;
      cue.startTime=Math.max(0,base.start+offset);
      cue.endTime=Math.max(cue.startTime+0.001,base.end+offset);
    });
  }
  renderExternalSubtitle();
  saveCurrentPlaybackPreferences({subtitleOffset:offset});
}
function audioTrackLabel(track,index){
  const parts=[];
  const label=String(track.label||"").trim();
  const language=String(track.language||"").trim();
  const kind=String(track.kind||"").trim();
  if(label)parts.push(label);
  if(language&&language.toLowerCase()!=="und"&&language.toLowerCase()!==label.toLowerCase())parts.push(language.toUpperCase());
  if(kind&&kind!=="main"&&kind!=="alternative")parts.push(kind);
  return parts.length?parts.join(" · "):"Audio "+(index+1);
}
function refreshAudioTracks(){
  const select=byId("offline-audio-track");
  const tracks=player.audioTracks;
  if(!select||!tracks||typeof tracks.length!=="number"){if(select)select.parentElement.hidden=true;return;}
  select.innerHTML="";
  if(!tracks.length){select.parentElement.hidden=true;return;}
  // Some Matroska files expose audio tracks without marking a default track.
  // Explicitly enable the first track so a playable video is not silently muted.
  let selectedIndex=choosePreferredTrack(tracks,currentPlaybackPreferences.audioTrackLanguage||currentPlaybackPreferences.audioLanguage);
  if(selectedIndex<0)for(let index=0;index<tracks.length;index++)if(tracks[index].enabled){selectedIndex=index;break;}
  if(selectedIndex<0)selectedIndex=0;
  for(let index=0;index<tracks.length;index++)tracks[index].enabled=index===selectedIndex;
  for(let index=0;index<tracks.length;index++){
    const track=tracks[index],option=document.createElement("option");
    option.value=String(index);
    option.textContent=audioTrackLabel(track,index);
    option.selected=index===selectedIndex;
    select.appendChild(option);
  }
  select.value=String(selectedIndex);
  select.parentElement.hidden=false;
}

byId("offline-play-toggle").addEventListener("click",()=>{if(player.paused)void player.play().catch(()=>{});else player.pause();});
byId("offline-skip-back").addEventListener("click",()=>seekBy(-10));
byId("offline-skip-forward").addEventListener("click",()=>seekBy(10));
function stepFrame(direction){
  const frameRate=Number(player.dataset.frameRate);
  if(!Number.isFinite(player.duration)||!Number.isFinite(frameRate)||frameRate<=0){
    setMessage("Frame stepping is unavailable because this file's nominal frame rate could not be read.");
    return;
  }
  player.pause();
  const currentFrame=Math.round(player.currentTime*frameRate);
  const lastFrame=Math.max(0,Math.ceil(player.duration*frameRate)-1);
  const nextFrame=Math.max(0,Math.min(lastFrame,currentFrame+(direction<0?-1:1)));
  player.currentTime=Math.min(player.duration,nextFrame/frameRate);
}
byId("offline-frame-back").addEventListener("click",()=>stepFrame(-1));
byId("offline-frame-forward").addEventListener("click",()=>stepFrame(1));
byId("offline-pip").addEventListener("click",async()=>{
  try{
    if(document.pictureInPictureElement===player){await document.exitPictureInPicture();return;}
    if(!document.pictureInPictureEnabled||typeof player.requestPictureInPicture!=="function")throw new Error("Picture in Picture is not supported by this Windows media session.");
    await player.requestPictureInPicture();
  }catch(error){setMessage(error?.message||"Picture in Picture could not be opened.");}
});
player.addEventListener("enterpictureinpicture",()=>{byId("offline-pip").textContent="Exit picture in picture";});
player.addEventListener("leavepictureinpicture",()=>{byId("offline-pip").textContent="Picture in picture";});
byId("offline-cinema-mode").addEventListener("click",()=>{
  const active=playerSection.classList.toggle("windowed-cinema");
  byId("offline-cinema-mode").setAttribute("aria-pressed",String(active));
  byId("offline-cinema-mode").textContent=active?"Exit windowed cinema":"Windowed cinema";
});
byId("offline-subtitle-file").addEventListener("change",event=>{
  const file=event.target.files?.[0];loadExternalSubtitle(file);event.target.value="";
});
byId("offline-subtitle-size").addEventListener("change",event=>{
  byId("offline-player-section").dataset.subtitleSize=event.target.value;
});
byId("offline-subtitle-offset").addEventListener("input",applySubtitleOffset);
byId("offline-subtitle-track").addEventListener("change",event=>{
  const selected=Number(event.target.value),tracks=player.textTracks;
  for(let index=0;index<tracks.length;index++)tracks[index].mode=selected>=0&&index===selected?"showing":"disabled";
  if(selected!==-2){activeExternalSubtitleCues=[];externalSubtitleLabel="";clearSubtitleOverlay(byId("offline-subtitle-overlay"));}
  if(selected===-1){subtitleCueBaseTimes=[];activeSubtitleTrack=null;}
  else if(selected>=0){
    activeSubtitleTrack=tracks[selected];
    subtitleCueBaseTimes=Array.from(activeSubtitleTrack.cues||[]).map(cue=>({start:cue.startTime,end:cue.endTime}));
    applySubtitleOffset();
    saveCurrentPlaybackPreferences({subtitleTrackLanguage:activeSubtitleTrack.language||"",subtitleLanguage:activeSubtitleTrack.language||""});
  }else if(selected===-2){activeSubtitleTrack=null;subtitleCueBaseTimes=[];renderExternalSubtitle();}
  saveCurrentPlaybackPreferences({subtitleOff:selected===-1});
});
byId("offline-audio-language").addEventListener("change",event=>{
  saveCurrentPlaybackPreferences({audioLanguage:event.target.value,audioTrackLanguage:""});
  refreshAudioTracks();
});
byId("offline-subtitle-language").addEventListener("change",event=>{
  saveCurrentPlaybackPreferences({subtitleLanguage:event.target.value,subtitleOff:event.target.value==="off"});
  refreshSubtitleTracks();
  if(event.target.value==="off"){byId("offline-subtitle-track").value="-1";byId("offline-subtitle-track").dispatchEvent(new Event("change"));}
});
for(const id of ["offline-subtitle-size","offline-subtitle-font","offline-subtitle-color","offline-subtitle-position","offline-subtitle-outline","offline-subtitle-background"]){
  byId(id).addEventListener("input",()=>{
    const prefs=subtitleRenderPreferences();
    byId("offline-player-section").dataset.subtitleSize=prefs.size;
    byId("offline-subtitle-background-value").textContent=Math.round(prefs.background*100)+"%";
    saveCurrentPlaybackPreferences({subtitleSize:prefs.size,font:prefs.font,color:prefs.color,position:prefs.position,outline:prefs.outline,background:prefs.background});
    renderExternalSubtitle();
  });
}
byId("offline-audio-track").addEventListener("change",event=>{
  const tracks=player.audioTracks,index=Number(event.target.value);
  if(!tracks||!Number.isInteger(index)||!tracks[index])return;
  for(let i=0;i<tracks.length;i++)tracks[i].enabled=i===index;
  saveCurrentPlaybackPreferences({audioTrackLanguage:tracks[index].language||"",audioLanguage:tracks[index].language||""});
  refreshAudioTracks();
  setMessage("Selected "+audioTrackLabel(tracks[index],index)+".");
});

const seekInput=byId("offline-seek");
const seekPreview=byId("offline-seek-preview");
const seekPreviewVideo=document.createElement("video");
seekPreviewVideo.muted=true;
seekPreviewVideo.playsInline=true;
seekPreviewVideo.preload="metadata";
let seekPreviewTarget=null;
let seekPreviewSource="";
let seekPreviewRequest=0;
function resetSeekPreviewSource(){
  diagnosticsRequest++;
  seekPreviewRequest++;
  seekPreviewTarget=null;
  seekPreviewSource="";
  seekPreviewVideo.pause();
  seekPreviewVideo.removeAttribute("src");
  seekPreviewVideo.load();
  seekPreview.hidden=true;
}
function ensureSeekPreviewSource(){
  if(player.dataset.transcodeSessionId)return false;
  const source=player.currentSrc||player.src;
  if(!source||source===seekPreviewSource)return Boolean(source);
  seekPreviewRequest++;
  seekPreviewSource=source;
  seekPreviewTarget=null;
  seekPreviewVideo.src=source;
  seekPreviewVideo.load();
  return true;
}
function drawSeekPreview(){
  if(seekPreview.hidden||seekPreviewVideo.readyState<2)return;
  if(seekPreviewTarget!==null&&Math.abs(seekPreviewVideo.currentTime-seekPreviewTarget)>0.05)return;
  const context=seekPreview.getContext("2d");
  if(!context)return;
  try{context.drawImage(seekPreviewVideo,0,0,seekPreview.width,seekPreview.height);}catch{}
}
function updateSeekPreview(target){
  if(player.dataset.transcodeSessionId){seekPreview.hidden=true;return;}
  if(!Number.isFinite(target)||!ensureSeekPreviewSource())return;
  seekPreviewTarget=Math.max(0,Math.min(Number.isFinite(player.duration)?player.duration:target,target));
  const request=++seekPreviewRequest;
  const seekWhenReady=()=>{
    if(request!==seekPreviewRequest||seekPreviewTarget===null)return;
    if(seekPreviewVideo.readyState<1)return;
    try{
      if(Math.abs(seekPreviewVideo.currentTime-seekPreviewTarget)<0.025){drawSeekPreview();return;}
      seekPreviewVideo.currentTime=seekPreviewTarget;
    }catch{}
  };
  if(seekPreviewVideo.readyState>=1)seekWhenReady();
}
seekPreviewVideo.addEventListener("loadedmetadata",()=>{
  if(seekPreviewTarget!==null)updateSeekPreview(seekPreviewTarget);
});
seekPreviewVideo.addEventListener("seeked",drawSeekPreview);
seekPreviewVideo.addEventListener("loadeddata",drawSeekPreview);
seekInput.addEventListener("input",event=>{
  if(!Number.isFinite(player.duration))return;
  seekPreview.hidden=false;
  updateSeekPreview(player.duration*(Number(event.target.value)/100000));
});
function commitSeekPreview(){
  if(seekPreviewTarget!==null&&Number.isFinite(player.duration))player.currentTime=seekPreviewTarget;
  seekPreviewTarget=null;
  seekPreview.hidden=true;
}
seekInput.addEventListener("change",commitSeekPreview);
seekInput.addEventListener("pointerup",commitSeekPreview);
seekInput.addEventListener("pointercancel",commitSeekPreview);
seekInput.addEventListener("keyup",event=>{if(["ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"].includes(event.key))commitSeekPreview();});
seekInput.addEventListener("blur",commitSeekPreview);
byId("offline-volume").addEventListener("input",event=>{player.volume=Number(event.target.value);player.muted=player.volume===0;});
byId("offline-audio-boost").addEventListener("input",event=>{
  const value=Math.max(100,Math.min(250,Number(event.target.value)||100));
  byId("offline-audio-boost-value").textContent=value+"%";
  if(ensureAudioProcessing()&&audioGain)audioGain.gain.setTargetAtTime(value/100,audioContext.currentTime,0.015);
});
byId("offline-audio-delay").addEventListener("input",event=>{
  const value=Math.max(0,Math.min(500,Number(event.target.value)||0));
  byId("offline-audio-delay-value").textContent=value+" ms";
  if(ensureAudioProcessing()&&audioDelay)audioDelay.delayTime.setTargetAtTime(value/1000,audioContext.currentTime,0.015);
});
byId("offline-speed").addEventListener("change",event=>{player.playbackRate=Number(event.target.value)||1;});
function currentFullscreenElement(){
  return document.fullscreenElement||document.webkitFullscreenElement||null;
}
function syncFullscreenButton(){
  const active=currentFullscreenElement()===byId("offline-player-section");
  const button=byId("offline-fullscreen");
  button.textContent=active?"Exit fullscreen":"Fullscreen";
  button.setAttribute("aria-pressed",String(active));
  // Native Chromium controls do not participate in our fade animation.
  // In fullscreen, use only Vivid's floating controls; restore native controls on exit.
  player.controls=!active;
}
async function togglePlayerFullscreen(){
  const section=byId("offline-player-section");
  try{
    const active=currentFullscreenElement();
    if(active===section){
      const exit=document.exitFullscreen||document.webkitExitFullscreen;
      if(typeof exit==="function")await exit.call(document);
      return;
    }
    if(active){
      const exit=document.exitFullscreen||document.webkitExitFullscreen;
      if(typeof exit==="function")await exit.call(document);
    }
    const standardRequest=section.requestFullscreen;
    const request=standardRequest||section.webkitRequestFullscreen;
    if(typeof request!=="function")throw new Error("Fullscreen API is unavailable.");
    const result=standardRequest
      ? request.call(section,{navigationUI:"hide"})
      : request.call(section);
    await Promise.resolve(result);
    showPlayerControls();
  }catch(error){
    syncFullscreenButton();
    setMessage("Fullscreen could not be opened on this device. "+(error?.message||""));
  }
}
byId("offline-fullscreen").addEventListener("click",togglePlayerFullscreen);
let lastPositionSave=0;
let resumePosition=0;
let controlsHideTimer=0;
let subtitleCueBaseTimes=[];
let activeSubtitleTrack=null;
function hasKeyboardFocusedPlayerControl(){
  const section=byId("offline-player-section");
  return Boolean(section.querySelector(":focus-visible"));
}
function hidePlayerControlsNow(){
  const section=byId("offline-player-section");
  if(!player.paused&&!hasKeyboardFocusedPlayerControl())section.classList.add("controls-hidden");
}
function showPlayerControls(){
  const section=byId("offline-player-section");
  section.classList.remove("controls-hidden");
  if(controlsHideTimer)clearTimeout(controlsHideTimer);
  if(!player.paused){
    controlsHideTimer=setTimeout(()=>{
      hidePlayerControlsNow();
    },2200);
  }
}
function hidePlayerControls(){
  const section=byId("offline-player-section");
  if(controlsHideTimer)clearTimeout(controlsHideTimer);
  if(!player.paused&&!hasKeyboardFocusedPlayerControl()){
    controlsHideTimer=setTimeout(hidePlayerControlsNow,280);
  }
}
function findNextEpisode(job){
  const media=job?.media||{};
  const episode=Number(media.episode),season=Number(media.season);
  const seriesTitle=String(media.title||"").trim().toLowerCase();
  if(!seriesTitle||!Number.isInteger(episode)||episode<1||!Number.isInteger(season))return null;
  return jobs.find(candidate=>{
    if(candidate.status!=="completed"||candidate.id===job.id)return false;
    const next=candidate.media||{};
    const nextSeason=Number(next.season),nextEpisode=Number(next.episode);
    const isFollowingEpisode=(nextSeason===season&&nextEpisode===episode+1)
      ||(nextSeason===season+1&&nextEpisode===1);
    return next.media_type==="tv"&&String(next.id||"")===String(media.id||"")
      &&String(next.title||"").trim().toLowerCase()===seriesTitle&&isFollowingEpisode;
  })||null;
}
function syncNextEpisode(job){
  const next=findNextEpisode(job);
  const button=byId("offline-next-episode");
  button.hidden=!next;
  button.dataset.jobId=next?.id||"";
  button.textContent=next?"Next episode · S"+String(next.media.season).padStart(2,"0")+"E"+String(next.media.episode).padStart(2,"0"):"Next episode";
}
byId("offline-resume-continue").addEventListener("click",async()=>{
  const prompt=byId("offline-resume-prompt");
  if(resumePosition>0&&Number.isFinite(player.duration)&&resumePosition<player.duration-1)player.currentTime=resumePosition;
  prompt.hidden=true;resumePosition=0;
  try{await player.play();}catch{setMessage("Press Play to continue watching.");}
  showPlayerControls();
});
byId("offline-resume-restart").addEventListener("click",async()=>{
  const prompt=byId("offline-resume-prompt");
  prompt.hidden=true;resumePosition=0;player.currentTime=0;
  if(player.dataset.jobId)void engine.clearPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0).catch(()=>{});
  try{await player.play();}catch{setMessage("Press Play to start from the beginning.");}
  showPlayerControls();
});
byId("offline-next-episode").addEventListener("click",async()=>{
  const next=jobs.find(job=>job.id===byId("offline-next-episode").dataset.jobId);
  if(!next)return;
  try{await play(next,0);}catch(error){setMessage(error?.message||"Could not open the next episode.");}
});
const playerSection=byId("offline-player-section");
playerSection.addEventListener("pointermove",showPlayerControls);
playerSection.addEventListener("pointerdown",showPlayerControls);
playerSection.addEventListener("pointerleave",hidePlayerControls);
playerSection.addEventListener("focusin",showPlayerControls);
playerSection.addEventListener("focusout",()=>{if(!playerSection.matches(":focus-within"))showPlayerControls();});
document.addEventListener("fullscreenchange",()=>{syncFullscreenButton();showPlayerControls();});
document.addEventListener("webkitfullscreenchange",()=>{syncFullscreenButton();showPlayerControls();});
player.addEventListener("play",showPlayerControls);
player.addEventListener("pause",showPlayerControls);
player.addEventListener("timeupdate",()=>{
  syncPlayerControls();
  if(player.dataset.jobId&&player.currentTime-lastPositionSave>=5){
    lastPositionSave=player.currentTime;
    void engine.setPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0,player.currentTime).catch(()=>{});
  }
});
player.addEventListener("pause",()=>{
  // Opening the resume prompt pauses the initial autoplay attempt; do not overwrite
  // the saved position with zero before the user chooses Continue or Start over.
  if(!byId("offline-resume-prompt").hidden)return;
  if(player.dataset.jobId&&player.currentTime>0)void engine.setPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0,player.currentTime).catch(()=>{});
});
player.addEventListener("loadedmetadata",()=>{
  const jobId=player.dataset.jobId, fileIndex=Number(player.dataset.fileIndex)||0;
  void engine.getPlaybackPosition(jobId,fileIndex).then(saved=>{
    if(player.dataset.jobId!==jobId||Number(player.dataset.fileIndex)!==fileIndex)return;
    if(saved>5&&Number.isFinite(player.duration)&&saved<player.duration-30){
      resumePosition=saved;
      byId("offline-resume-copy").textContent="Continue from "+clock(saved)+"?";
      byId("offline-resume-prompt").hidden=false;
      player.pause();
      showPlayerControls();
    }else{
      resumePosition=0;
      byId("offline-resume-prompt").hidden=true;
    }
    syncPlayerControls();
  }).catch(()=>{resumePosition=0;byId("offline-resume-prompt").hidden=true;syncPlayerControls();});
});
player.addEventListener("durationchange",syncPlayerControls);
player.addEventListener("loadedmetadata",()=>{void updatePlaybackDiagnostics();});
player.addEventListener("loadedmetadata",refreshAudioTracks);
function describePlaybackError(){
  byId("offline-audio-track").parentElement.hidden=true;
  const code=Number(player.error?.code||0);
  if(code===1){setMessage("Playback was interrupted. Press Play to continue.");return;}
  if(code===2){setMessage("Vivid could not read this saved media file. Check that the download is complete and still exists.");return;}
  if(code===3||code===4){setMessage("This video format is not supported by the built-in player. Try another copy encoded as MP4 (H.264 video and AAC audio).");return;}
  setMessage("Vivid could not start this video. Check the file and try again.");
}
player.addEventListener("error",describePlaybackError);
player.addEventListener("waiting",()=>{
  if(!player.paused)setMessage("Buffering your saved video…");
});
player.addEventListener("stalled",()=>{
  if(!player.paused)setMessage("The local media stream has paused while reading data. Checking playback…");
});
player.addEventListener("playing",()=>{
  const status=byId("offline-message").textContent;
  if(/buffering|local media stream has paused/i.test(status))setMessage("Your movie is playing offline.");
});

player.addEventListener("loadedmetadata",refreshSubtitleTracks);
player.addEventListener("timeupdate",renderExternalSubtitle);
player.addEventListener("seeked",renderExternalSubtitle);
player.addEventListener("loadedmetadata",readChapterCues);
player.addEventListener("timeupdate",()=>{if(!chapterTrack||!chapterCues.length)readChapterCues();else updateChapterControls();});
player.textTracks?.addEventListener?.("addtrack",readChapterCues);
player.textTracks?.addEventListener?.("change",readChapterCues);
player.addEventListener("loadeddata",refreshAudioTracks);
player.addEventListener("canplay",refreshAudioTracks);
player.textTracks?.addEventListener?.("addtrack",refreshSubtitleTracks);
player.textTracks?.addEventListener?.("removetrack",refreshSubtitleTracks);
player.textTracks?.addEventListener?.("change",refreshSubtitleTracks);
if(player.audioTracks){
  player.audioTracks.addEventListener?.("addtrack",refreshAudioTracks);
  player.audioTracks.addEventListener?.("removetrack",refreshAudioTracks);
  player.audioTracks.addEventListener?.("change",refreshAudioTracks);
}
player.addEventListener("play",syncPlayerControls);
player.addEventListener("pause",syncPlayerControls);
player.addEventListener("ended",()=>{
  if(player.dataset.jobId)void engine.clearPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0).catch(()=>{});
  byId("offline-resume-prompt").hidden=true;
  const job=jobs.find(item=>item.id===player.dataset.jobId);
  syncNextEpisode(job);
  showPlayerControls();
  syncPlayerControls();
});
window.addEventListener("pagehide",()=>{
  if(player.dataset.jobId&&player.currentTime>0)void engine.setPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0,player.currentTime).catch(()=>{});
  void releaseLocalMedia();
});
window.addEventListener("keydown",event=>{
  if(playerSection.hidden||event.target.matches("input,textarea,select,button,[contenteditable='true']"))return;
  const key=event.key.toLowerCase();
  if(event.code==="Space"||key==="k"){event.preventDefault();if(player.paused)void player.play().catch(()=>{});else player.pause();return;}
  if(key==="arrowright"||key==="l"){event.preventDefault();seekBy(event.shiftKey?30:5);return;}
  if(key==="arrowleft"||key==="j"){event.preventDefault();seekBy(event.shiftKey?-30:-5);return;}
  if(key==="."||key===">"){event.preventDefault();stepFrame(1);return;}
  if(key===","||key==="<"){event.preventDefault();stepFrame(-1);return;}
  if(key==="f"){event.preventDefault();void byId("offline-fullscreen").click();return;}
  if(key==="p"){event.preventDefault();void byId("offline-pip").click();return;}
  if(key==="c"){event.preventDefault();byId("offline-cinema-mode").click();return;}
  if(key==="m"){event.preventDefault();player.muted=!player.muted;return;}
  if(key==="arrowup"){event.preventDefault();player.volume=Math.min(1,player.volume+0.05);if(player.volume>0)player.muted=false;byId("offline-volume").value=String(player.volume);return;}
  if(key==="arrowdown"){event.preventDefault();player.volume=Math.max(0,player.volume-0.05);byId("offline-volume").value=String(player.volume);}
});
async function releaseLocalMedia(){
  const sessionId=player.dataset.transcodeSessionId;
  const token=player.dataset.localMediaToken;
  player.dataset.transcodeSessionId="";
  player.dataset.transcodeCodecs="";
  player.dataset.localMediaToken="";
  if(sessionId){
    transcodePlayer.reset();
    try{await engine.stopTranscode(sessionId);}catch{}
  }
  if(token){
    player.pause();
    player.removeAttribute("src");
    player.load();
    try{await engine.releaseLocalFile(token);}catch{}
  }
}
async function playLocalFile(){
  const file=await engine.openLocalTranscode();
  if(!file)return;
  await releaseLocalMedia();
  resetSeekPreviewSource();clearExternalSubtitle();chapterTrack=null;chapterCues=[];
  activePreferenceKey="local:"+file.fileName+":"+file.fileSize;applyPlaybackPreferences();
  transcodePlayer.load(file);
  player.dataset.frameRate="";byId("offline-frame-back").disabled=true;byId("offline-frame-forward").disabled=true;player.dataset.jobId="";player.dataset.fileIndex="0";
  player.dataset.mediaFilename=file.fileName;player.dataset.localMediaToken="";player.dataset.transcodeSessionId=file.sessionId;player.dataset.transcodeCodecs=JSON.stringify(file.codecs||{});
  lastPositionSave=0;resumePosition=0;
  byId("offline-player-title").textContent=file.fileName;
  byId("offline-resume-prompt").hidden=true;byId("offline-next-episode").hidden=true;
  byId("offline-player-section").dataset.subtitleSize="medium";byId("offline-subtitle-size").value="medium";
  player.controls=false;byId("offline-custom-controls").hidden=false;
  playerSection.classList.remove("controls-hidden");playerSection.hidden=false;
  playerSection.scrollIntoView({behavior:"smooth",block:"start"});
  try{await player.play();setMessage("Opened "+file.fileName+" with Vivid compatibility playback.");}catch{setMessage("Your video is ready. Press Play in the Vivid player to begin.");}
  syncPlayerControls();
}
byId("offline-open-local-file").addEventListener("click",async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{await playLocalFile();}catch(error){setMessage(error?.message||"Could not open that video file.");}
  finally{button.disabled=false;}
});
async function play(job,fileIndex=0){
  const file=Array.isArray(job.files)?job.files[fileIndex]:null;
  const media=await engine.openDownloadTranscode(job.id,fileIndex);
  if(!media) throw new Error("The saved video file is not available.");
  await releaseLocalMedia();
  const playerTitle=file&&job.files.length>1?job.title+" — "+file.name:job.title;
  byId("offline-player-title").textContent=playerTitle;
  syncNextEpisode(job);
  byId("offline-resume-prompt").hidden=true;
  resumePosition=0;
  const section=byId("offline-player-section");
  player.pause();clearExternalSubtitle();activePreferenceKey=playbackProfileKey(job,fileIndex);applyPlaybackPreferences();resetSeekPreviewSource();transcodePlayer.load(media);player.dataset.frameRate="";byId("offline-frame-back").disabled=true;byId("offline-frame-forward").disabled=true;player.dataset.jobId=job.id;player.dataset.fileIndex=String(fileIndex);player.dataset.localMediaToken="";player.dataset.transcodeSessionId=media.sessionId;player.dataset.transcodeCodecs=JSON.stringify(media.codecs||{});player.dataset.mediaFilename=media.fileName||file?.name||job.title||"Saved media";if(player.muted&&player.volume>0)player.muted=false;lastPositionSave=0;byId("offline-player-section").dataset.subtitleSize="medium";byId("offline-subtitle-size").value="medium";
  player.controls=false;
  byId("offline-custom-controls").hidden=false;
  section.classList.remove("controls-hidden");
  section.hidden=false;section.scrollIntoView({behavior:"smooth",block:"start"});
  try{await player.play();}catch{setMessage("Your movie is ready. Press Play in the Vivid player to begin.");}
  syncPlayerControls();
}
byId("desktop-search-form").addEventListener("submit",async event=>{
  event.preventDefault();const query=byId("desktop-search-input").value.trim();
  if(query.length<2){setMessage("Enter at least two characters.");return;}
  if(!currentMedia){setMessage("Choose a movie or series from the Vivid catalogue and tap Download so its exact identity can be checked.");return;}
  setMessage("Searching…");byId("desktop-search-results").innerHTML="";
  try{renderSearch(await engine.search(query));setMessage("Choose a release to download.");}
  catch(error){setMessage(error?.message||"Search failed.");}
});
byId("desktop-quality").addEventListener("change",()=>renderSearch(searchResults));
byId("desktop-add-selected").addEventListener("click",addSelectedToBatch);
byId("desktop-batch-queue").addEventListener("click",async event=>{
  const remove=event.target.closest("button[data-batch-remove]");
  if(remove){batchQueue.splice(Number(remove.dataset.batchRemove),1);saveBatchQueue();return;}
  if(event.target.closest("[data-batch-clear]")){batchQueue=[];saveBatchQueue();return;}
  if(event.target.closest("[data-batch-start]"))await startBatch();
});
byId("desktop-season-select").addEventListener("change",event=>{void loadSeriesSeason(Number(event.target.value));});
byId("desktop-episode-select-all").addEventListener("click",()=>{
  const inputs=[...byId("desktop-episodes").querySelectorAll('input[data-episode]')];
  const selectAll=inputs.some(input=>!input.checked);
  inputs.forEach(input=>{input.checked=selectAll;});
  byId("desktop-episode-select-all").textContent=selectAll?"Clear selection":"Select all";
});
byId("desktop-episode-search").addEventListener("click",()=>{void searchSelectedEpisodes();});
byId("desktop-search-results").addEventListener("click",async event=>{
  const button=event.target.closest("button[data-result]");if(!button)return;
  const result=searchResults.find(item=>item.id===button.dataset.result);if(!result)return;
  button.disabled=true;button.textContent="Starting…";
  try{
    const mediaForResult=currentMedia?.media_type==="tv"&&Number.isInteger(result.episode)
      ? {...currentMedia,season:result.season,episode:result.episode,episodeTitle:result.episodeTitle}
      : currentMedia||{title:result.title,media_type:"movie"};
    await engine.start(result,mediaForResult);
    setMessage(Number.isInteger(result.episode)?"Episode download added. You can keep browsing while it saves.":"Download added. You can keep browsing while it saves.");
    await refresh();
  }
  catch(error){setMessage(error?.message||"Could not start download.");}
  finally{
    // "Starting…" only represents the IPC request. Once the job is accepted,
    // restore the result button; transfer progress belongs in the download row.
    if(button.isConnected){button.disabled=false;button.textContent="Download";}
  }
});
byId("offline-continue-list").addEventListener("click",async event=>{const button=event.target.closest("button[data-action=\"continue\"]");if(!button)return;const job=jobs.find(item=>item.id===button.dataset.id);if(!job)return;button.disabled=true;try{await play(job,0);}catch(error){setMessage(error?.message||"Could not resume this title.");}finally{button.disabled=false;}});
byId("offline-jobs").addEventListener("click",async event=>{
  const button=event.target.closest("button[data-action]");if(!button)return;
  const {action,id}=button.dataset;button.disabled=true;
  try{
    if(action==="details"){const job=jobs.find(item=>item.id===id);if(job)await showTitleDetails(job);}
    else if(action==="continue"||action==="play"||action==="play-file"){const job=jobs.find(item=>item.id===id);if(job)await play(job,action==="play-file"?Number(button.dataset.index)||0:0);}
    else {const ok=await engine.control(id,action);if(!ok)throw new Error("That action is not available.");await refresh();}
  }catch(error){setMessage(error?.message||"Action failed.");}
  finally{button.disabled=false;}
});
byId("offline-player-close").addEventListener("click",async()=>{
  if(controlsHideTimer)clearTimeout(controlsHideTimer);
  if(currentFullscreenElement()===playerSection){
    const exit=document.exitFullscreen||document.webkitExitFullscreen;
    try{if(typeof exit==="function")await exit.call(document);}catch{}
  }
  void releaseLocalMedia();
  player.pause();clearExternalSubtitle();chapterTrack=null;chapterCues=[];byId("offline-chapter-controls").hidden=true;byId("offline-skip-intro").hidden=true;byId("offline-skip-credits").hidden=true;byId("offline-audio-boost").value="100";byId("offline-audio-boost-value").textContent="100%";byId("offline-audio-delay").value="0";byId("offline-audio-delay-value").textContent="0 ms";if(audioGain&&audioContext)audioGain.gain.setTargetAtTime(1,audioContext.currentTime,0.015);if(audioDelay&&audioContext)audioDelay.delayTime.setTargetAtTime(0,audioContext.currentTime,0.015);player.removeAttribute("src");player.load();player.dataset.jobId="";player.dataset.mediaFilename="";diagnosticsRequest++;
  player.controls=true;byId("offline-custom-controls").hidden=true;byId("offline-player-section").classList.remove("windowed-cinema");byId("offline-player-section").hidden=true;
  byId("offline-cinema-mode").setAttribute("aria-pressed","false");byId("offline-cinema-mode").textContent="Windowed cinema";
  byId("offline-audio-track").parentElement.hidden=true;byId("offline-resume-prompt").hidden=true;
  byId("offline-next-episode").hidden=true;resumePosition=0;byId("offline-player-section").classList.remove("controls-hidden");
  syncFullscreenButton();
});
function updateJobProgress(job){
  const id=String(job.id);
  updateAggregateSpeed();
  const card=[...byId("offline-jobs").querySelectorAll("[data-job-id]")].find(node=>node.dataset.jobId===id);
  if(!card)return;
  const progress=Math.max(0,Math.min(100,Number(job.progress)||0));
  const status=card.querySelector(".offline-card-status,.offline-episode-status");
  if(status)status.textContent=statusText(job)+(job.status==="downloading"?" · "+Math.round(progress)+"%":"");
  const transfer=card.querySelector("[data-transfer-meta]");
  const detail=transferText(job);
  if(transfer)transfer.textContent=detail;
  else if(detail){const node=document.createElement("small");node.className="offline-transfer-meta";node.dataset.transferMeta=job.id;node.textContent=detail;status?.after(node);}
  const bar=card.querySelector('[role="progressbar"]');
  if(bar){bar.setAttribute("aria-valuenow",progress.toFixed(1));const fill=bar.querySelector("span");if(fill)fill.style.width=progress+"%";}
}
engine.onProgress(payload=>{
  if(payload.status==="cancelled"||payload.removed){jobs=jobs.filter(item=>item.id!==payload.id);scheduleProgressRender();return;}
  const index=jobs.findIndex(item=>item.id===payload.id);
  if(index<0){jobs.push(payload);scheduleProgressRender();return;}
  const previous=jobs[index];jobs[index]={...previous,...payload};
  if(previous.status!==payload.status)scheduleProgressRender();else updateJobProgress(jobs[index]);
});
engine.onComplete(()=>{void refresh();setMessage("Download complete. Your movie is ready to watch offline.");});
engine.onError(()=>{void refresh();setMessage("A download needs attention. Try Resume, or cancel it and choose another release.");});
byId("offline-library-search").addEventListener("input",event=>{
  libraryQuery=event.target.value.trim().toLowerCase();
  render();
});
byId("offline-library-sort").addEventListener("change",event=>{
  librarySort=event.target.value;
  render();
});
byId("offline-library-tools").addEventListener("click",event=>{
  const button=event.target.closest("button[data-library-filter]");
  if(!button)return;
  libraryFilter=button.dataset.libraryFilter;
  byId("offline-library-tools").querySelectorAll("button[data-library-filter]").forEach(item=>item.setAttribute("aria-pressed",String(item===button)));
  render();
});
byId("offline-jobs").addEventListener("error",event=>{
  if(event.target instanceof HTMLImageElement&&event.target.closest(".offline-poster"))event.target.remove();
},true);
byId("offline-open-local-file").hidden=false;
byId("offline-owner").textContent="This device";
byId("offline-list-title").textContent="Your library";
byId("desktop-download-search").hidden=false;
byId("offline-library-tools").hidden=false;
byId("offline-library-count").hidden=false;
renderBatchQueue();
byId("offline-notice-copy").textContent="Downloads are saved to your computer in the Vivid Cinema folder. They remain available without an internet connection.";
byId("offline-footnote").textContent="Your videos are stored on this device in the Vivid Cinema folder inside Downloads. Removing a download from Vivid does not silently delete your video files.";
const pending=sessionStorage.getItem("vivid:pending-desktop-download");
if(pending){sessionStorage.removeItem("vivid:pending-desktop-download");try{void searchTitle(JSON.parse(pending));}catch{setMessage("Open a movie page and tap Download to find a release.");}}
else setMessage("Your offline library is ready.");
void refresh();

}
