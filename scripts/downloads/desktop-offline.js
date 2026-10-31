import { tmdbApi } from "../tmdb.js";

if (window.vividDownloads?.available) {
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
let currentSeasonEpisodes = [];
let seasonRequestId = 0;

function setMessage(message){ byId("offline-message").textContent = message; }
function statusText(job){
  if(job.status==="downloading") return job.phase || "Connecting to peers";
  if(job.status==="paused") return "Paused";
  if(job.status==="verifying") return "Verifying saved data";
  if(job.status==="completed") return "Ready to watch";
  if(job.status==="cancelled") return "Cancelled";
  if(job.status==="failed") return "Needs attention";
  return "Preparing";
}
function render(){
  const completed=jobs.filter(x=>x.status==="completed").length;
  const active=jobs.filter(x=>["downloading","queued","verifying"].includes(x.status)).length;
  byId("offline-total").textContent=String(jobs.length);
  byId("offline-completed").textContent=String(completed);
  byId("offline-active").textContent=String(active);
  if(!jobs.length){
    byId("offline-jobs").innerHTML='<div class="offline-empty"><strong>Your cinema starts here</strong><p>Movies you download will be saved on this device and ready to watch offline.</p></div>';
    return;
  }
  byId("offline-jobs").innerHTML=jobs.map(job=>{
    const progress=Math.max(0,Math.min(100,Number(job.progress)||0));
    const speed=job.speed?bytes(job.speed)+"/s":"";
    const transferSize=job.total?bytes(job.total):"size unknown";
    const peerState=job.peers?job.peers+" peers connected":"No peers connected";
    const detail=[statusText(job),progress.toFixed(1)+"%",bytes(job.downloaded)+" of "+transferSize,speed,["downloading","verifying"].includes(job.status)?peerState:""].filter(Boolean).join(" · ");
    const actions=[];
    if(job.status==="downloading") actions.push('<button data-action="pause" data-id="'+escapeHtml(job.id)+'">Pause</button>');
    if(job.status==="paused"||job.status==="failed") actions.push('<button data-action="resume" data-id="'+escapeHtml(job.id)+'">Resume</button>');
    if(job.status==="completed") actions.push('<button data-action="play" data-id="'+escapeHtml(job.id)+'">Watch now</button>');
    if(job.status==="completed"&&job.filePath) actions.push('<button data-action="show" data-id="'+escapeHtml(job.id)+'">Show in folder</button>');
    if(["downloading","verifying","paused","failed","queued"].includes(job.status)) actions.push('<button data-action="cancel" data-id="'+escapeHtml(job.id)+'">Cancel</button>');
    const files = Array.isArray(job.files) ? job.files : [];
    const episodeList = files.length > 1 ? '<div class="offline-episodes">'+files.map(file =>
      '<button type="button" data-action="play-file" data-id="'+escapeHtml(job.id)+'" data-index="'+file.index+'">'+escapeHtml(file.name)+'</button>'
    ).join("")+'</div>' : "";
    return '<article class="offline-job"><div><div class="offline-job-title">'+escapeHtml(job.title)+'</div><div class="offline-job-meta">'+escapeHtml(detail)+'</div>'+
      (["downloading","paused","verifying","completed"].includes(job.status)?'<div class="offline-progress" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+progress.toFixed(1)+'"><span style="width:'+progress+'%"></span></div>':"")+
      (job.error?'<p class="offline-job-error">'+escapeHtml(job.error)+'</p>':"")+episodeList+
      '</div><div class="offline-job-actions">'+actions.join("")+'</div></article>';
  }).join("");
}
function renderSearch(items){
  searchResults=items;
  const quality=byId("desktop-quality").value;
  const filtered=items.filter(item=>quality==="any"||new RegExp("(?:^|[^0-9])"+quality+"p?(?:[^0-9]|$)","i").test(item.title));
  byId("desktop-search-results").innerHTML=filtered.length?filtered.map(item=>{
    const episodeLabel=Number.isInteger(item.episode)
      ? "S"+String(item.season).padStart(2,"0")+"E"+String(item.episode).padStart(2,"0")+(item.episodeTitle?" · "+item.episodeTitle:"")
      : "";
    return '<article class="offline-result"><div><strong>'+escapeHtml(item.title)+'</strong><p>'+(episodeLabel?'<b>'+escapeHtml(episodeLabel)+'</b> · ':"")+escapeHtml(item.provider)+' · '+escapeHtml(item.size||"Size unknown")+' · '+item.seeds+' seeders</p></div><button type="button" data-result="'+escapeHtml(item.id)+'">Download</button></article>';
  }).join(""):'<p class="offline-muted">No matching releases. Try another quality or search term.</p>';
}
async function loadSeriesSeason(seasonNumber){
  const requestId=++seasonRequestId;
  const list=byId("desktop-episodes");
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
      return '<label class="offline-episode-option"><input type="checkbox" data-episode="'+number+'" checked><span><strong>'+escapeHtml(label)+'</strong><small>'+escapeHtml(String(episode.overview||"").slice(0,180)||"No episode description available.")+escapeHtml(date)+'</small></span></label>';
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
    renderSearch(found);
    setMessage(found.length?"Choose a release beside the episode you want to save.":"No releases found for the selected episodes. Try another season or episode.");
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
  try{const rows=await engine.search(media.title||"");renderSearch(rows);setMessage(rows.length?"Choose a release to save it to this device.":"No releases found. Try a different title.");}
  catch(error){setMessage(error?.message||"Search is unavailable. Check your connection and try again.");}
}
async function refresh(){try{jobs=await engine.list();render();}catch(error){setMessage(error?.message||"Could not load your downloads.");}}
const player = byId("offline-player");
const clock = value => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? hours + ":" + String(minutes).padStart(2,"0") + ":" + String(rest).padStart(2,"0") : minutes + ":" + String(rest).padStart(2,"0");
};
function syncPlayerControls(){
  const duration=Number.isFinite(player.duration)?player.duration:0;
  byId("offline-seek").value=duration?String(Math.round(player.currentTime/duration*1000)):"0";
  byId("offline-time").textContent=clock(player.currentTime)+" / "+clock(duration);
  byId("offline-play-toggle").textContent=player.paused?"Play":"Pause";
}
byId("offline-play-toggle").addEventListener("click",()=>{if(player.paused)void player.play().catch(()=>{});else player.pause();});
byId("offline-seek").addEventListener("input",event=>{if(Number.isFinite(player.duration))player.currentTime=player.duration*(Number(event.target.value)/1000);});
byId("offline-volume").addEventListener("input",event=>{player.volume=Number(event.target.value);player.muted=player.volume===0;});
byId("offline-speed").addEventListener("change",event=>{player.playbackRate=Number(event.target.value)||1;});
byId("offline-fullscreen").addEventListener("click",async()=>{
  const section=byId("offline-player-section");
  try{if(document.fullscreenElement)await document.exitFullscreen();else await section.requestFullscreen();}
  catch{setMessage("Fullscreen is not available on this device.");}
});
let lastPositionSave=0;
player.addEventListener("timeupdate",()=>{
  syncPlayerControls();
  if(player.dataset.jobId&&player.currentTime-lastPositionSave>=5){
    lastPositionSave=player.currentTime;
    void engine.setPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0,player.currentTime).catch(()=>{});
  }
});
player.addEventListener("pause",()=>{
  if(player.dataset.jobId&&player.currentTime>0)void engine.setPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0,player.currentTime).catch(()=>{});
});
player.addEventListener("loadedmetadata",()=>{
  const jobId=player.dataset.jobId, fileIndex=Number(player.dataset.fileIndex)||0;
  void engine.getPlaybackPosition(jobId,fileIndex).then(saved=>{
    if(player.dataset.jobId!==jobId||Number(player.dataset.fileIndex)!==fileIndex)return;
    if(saved>5&&Number.isFinite(player.duration)&&saved<player.duration-30)player.currentTime=saved;
    syncPlayerControls();
  }).catch(syncPlayerControls);
});
player.addEventListener("durationchange",syncPlayerControls);
player.addEventListener("play",syncPlayerControls);
player.addEventListener("pause",syncPlayerControls);
player.addEventListener("ended",()=>{if(player.dataset.jobId)void engine.clearPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0).catch(()=>{});syncPlayerControls();});
window.addEventListener("pagehide",()=>{
  if(player.dataset.jobId&&player.currentTime>0)void engine.setPlaybackPosition(player.dataset.jobId,Number(player.dataset.fileIndex)||0,player.currentTime).catch(()=>{});
});
window.addEventListener("keydown",event=>{
  if(byId("offline-player-section").hidden||event.target.matches("input,textarea,select,button"))return;
  if(event.code==="Space"){event.preventDefault();if(player.paused)void player.play().catch(()=>{});else player.pause();}
  if(event.key==="ArrowRight"&&Number.isFinite(player.duration))player.currentTime=Math.min(player.duration,player.currentTime+10);
  if(event.key==="ArrowLeft")player.currentTime=Math.max(0,player.currentTime-10);
  if(event.key.toLowerCase()==="f")void byId("offline-fullscreen").click();
  if(event.key.toLowerCase()==="m")player.muted=!player.muted;
});
async function play(job,fileIndex=0){
  const url=await engine.mediaUrl(job.id,fileIndex);
  if(!url) throw new Error("The saved video file is not available.");
  const file=Array.isArray(job.files)?job.files[fileIndex]:null;
  const playerTitle=file&&job.files.length>1?job.title+" — "+file.name:job.title;
  byId("offline-player-title").textContent=playerTitle;
  const section=byId("offline-player-section");
  if(player.dataset.jobId!==job.id||player.dataset.fileIndex!==String(fileIndex)){player.pause();player.src=url;player.dataset.jobId=job.id;player.dataset.fileIndex=String(fileIndex);player.load();lastPositionSave=0;}
  player.controls=false;
  byId("offline-custom-controls").hidden=false;
  section.hidden=false;section.scrollIntoView({behavior:"smooth",block:"start"});
  try{await player.play();}catch{setMessage("Your movie is ready. Press Play in the Vivid player to begin.");}
  syncPlayerControls();
}
byId("desktop-search-form").addEventListener("submit",async event=>{
  event.preventDefault();const query=byId("desktop-search-input").value.trim();
  if(query.length<2){setMessage("Enter at least two characters.");return;}
  setMessage("Searching…");byId("desktop-search-results").innerHTML="";
  try{renderSearch(await engine.search(query));setMessage("Choose a release to download.");}
  catch(error){setMessage(error?.message||"Search failed.");}
});
byId("desktop-quality").addEventListener("change",()=>renderSearch(searchResults));
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
      ? {...currentMedia,season:result.season,episode:result.episode}
      : currentMedia||{title:result.title,media_type:"movie"};
    await engine.start(result,mediaForResult);
    setMessage(Number.isInteger(result.episode)?"Episode download added. You can keep browsing while it saves.":"Download added. You can keep browsing while it saves.");
    await refresh();
  }
  catch(error){button.disabled=false;button.textContent="Download";setMessage(error?.message||"Could not start download.");}
});
byId("offline-jobs").addEventListener("click",async event=>{
  const button=event.target.closest("button[data-action]");if(!button)return;
  const {action,id}=button.dataset;button.disabled=true;
  try{
    if(action==="play"||action==="play-file"){const job=jobs.find(item=>item.id===id);if(job)await play(job,action==="play-file"?Number(button.dataset.index)||0:0);}
    else {const ok=await engine.control(id,action);if(!ok)throw new Error("That action is not available.");await refresh();}
  }catch(error){setMessage(error?.message||"Action failed.");}
  finally{button.disabled=false;}
});
player.addEventListener("error",()=>setMessage("This file uses a video format or codec the built-in player cannot decode. Try an MP4 or WebM release."));
byId("offline-player-close").addEventListener("click",()=>{player.pause();player.removeAttribute("src");player.load();player.dataset.jobId="";player.controls=true;byId("offline-custom-controls").hidden=true;byId("offline-player-section").hidden=true;});
engine.onProgress(payload=>{const index=jobs.findIndex(item=>item.id===payload.id);if(index>=0)jobs[index]={...jobs[index],...payload};else jobs.push(payload);render();});
engine.onComplete(()=>{void refresh();setMessage("Download complete. Your movie is ready to watch offline.");});
engine.onError(payload=>{void refresh();setMessage(payload.message||"A download failed.");});
byId("offline-owner").textContent="This device";
byId("desktop-download-search").hidden=false;
byId("offline-notice-copy").textContent="Downloads are saved to your computer in the Vivid Cinema folder. They remain available without an internet connection.";
byId("offline-footnote").textContent="Your videos are stored on this device in the Vivid Cinema folder inside Downloads. Removing a download from Vivid does not silently delete your video files.";
const pending=sessionStorage.getItem("vivid:pending-desktop-download");
if(pending){sessionStorage.removeItem("vivid:pending-desktop-download");try{void searchTitle(JSON.parse(pending));}catch{setMessage("Open a movie page and tap Download to find a release.");}}
else setMessage("Your offline library is ready.");
void refresh();

}
