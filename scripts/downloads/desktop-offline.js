if (window.vividDownloads?.available) {
const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const bytes = value => {
  const n = Number(value) || 0;
  if (!n) return "—";
  const units = ["B","KB","MB","GB","TB"]; let size=n, index=0;
  while(size>=1024 && index<units.length-1){size/=1024;index++;}
  return size.toFixed(index?1:0)+" "+units[index];
};
const engine = window.vividDownloads;
let currentMedia = null;
let jobs = [];
let searchResults = [];

function setMessage(message){ byId("offline-message").textContent = message; }
function statusText(job){
  if(job.status==="downloading") return "Downloading";
  if(job.status==="paused") return "Paused";
  if(job.status==="completed") return "Ready to watch";
  if(job.status==="cancelled") return "Cancelled";
  if(job.status==="failed") return "Needs attention";
  return "Preparing";
}
function render(){
  const completed=jobs.filter(x=>x.status==="completed").length;
  const active=jobs.filter(x=>["downloading","queued"].includes(x.status)).length;
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
    const detail=[statusText(job),progress.toFixed(1)+"%",bytes(job.downloaded)+" of "+bytes(job.total),speed,job.peers?job.peers+" peers":""].filter(Boolean).join(" · ");
    const actions=[];
    if(job.status==="downloading") actions.push('<button data-action="pause" data-id="'+escapeHtml(job.id)+'">Pause</button>');
    if(job.status==="paused"||job.status==="failed") actions.push('<button data-action="resume" data-id="'+escapeHtml(job.id)+'">Resume</button>');
    if(job.status==="completed") actions.push('<button data-action="play" data-id="'+escapeHtml(job.id)+'">Watch now</button>');
    if(job.status==="completed"&&job.filePath) actions.push('<button data-action="show" data-id="'+escapeHtml(job.id)+'">Show in folder</button>');
    if(["downloading","paused","failed","queued"].includes(job.status)) actions.push('<button data-action="cancel" data-id="'+escapeHtml(job.id)+'">Cancel</button>');
    return '<article class="offline-job"><div><div class="offline-job-title">'+escapeHtml(job.title)+'</div><div class="offline-job-meta">'+escapeHtml(detail)+'</div>'+
      (["downloading","paused","completed"].includes(job.status)?'<div class="offline-progress"><span style="width:'+progress+'%"></span></div>':"")+
      (job.error?'<p class="offline-job-error">'+escapeHtml(job.error)+'</p>':"")+
      '</div><div class="offline-job-actions">'+actions.join("")+'</div></article>';
  }).join("");
}
function renderSearch(items){
  searchResults=items;
  const quality=byId("desktop-quality").value;
  const filtered=items.filter(item=>quality==="any"||new RegExp("(?:^|[^0-9])"+quality+"p?(?:[^0-9]|$)","i").test(item.title));
  byId("desktop-search-results").innerHTML=filtered.length?filtered.map(item=>
    '<article class="offline-result"><div><strong>'+escapeHtml(item.title)+'</strong><p>'+escapeHtml(item.provider)+' · '+escapeHtml(item.size||"Size unknown")+' · '+item.seeds+' seeders</p></div><button type="button" data-result="'+escapeHtml(item.id)+'">Download</button></article>'
  ).join(""):'<p class="offline-muted">No matching releases. Try another quality or search term.</p>';
}
async function searchTitle(media){
  currentMedia=media;
  byId("desktop-search-input").value=media.title||"";
  setMessage("Searching available releases for "+(media.title||"your title")+"…");
  try{const rows=await engine.search(media.title||"");renderSearch(rows);setMessage(rows.length?"Choose a release to save it to this device.":"No releases found. Try a different title.");}
  catch(error){setMessage(error?.message||"Search is unavailable. Check your connection and try again.");}
}
async function refresh(){try{jobs=await engine.list();render();}catch(error){setMessage(error?.message||"Could not load your downloads.");}}
async function play(job){
  const url=await engine.mediaUrl(job.id);
  if(!url) throw new Error("The saved video file is not available.");
  byId("offline-player-title").textContent=job.title;
  const section=byId("offline-player-section"), video=byId("offline-player");
  if(video.dataset.jobId!==job.id){video.pause();video.src=url;video.dataset.jobId=job.id;video.load();}
  section.hidden=false;section.scrollIntoView({behavior:"smooth",block:"start"});
  try{await video.play();}catch{setMessage("Your movie is ready. Press Play in the player to begin.");}
}
byId("desktop-search-form").addEventListener("submit",async event=>{
  event.preventDefault();const query=byId("desktop-search-input").value.trim();
  if(query.length<2){setMessage("Enter at least two characters.");return;}
  setMessage("Searching…");byId("desktop-search-results").innerHTML="";
  try{renderSearch(await engine.search(query));setMessage("Choose a release to download.");}
  catch(error){setMessage(error?.message||"Search failed.");}
});
byId("desktop-quality").addEventListener("change",()=>renderSearch(searchResults));
byId("desktop-search-results").addEventListener("click",async event=>{
  const button=event.target.closest("button[data-result]");if(!button)return;
  const result=searchResults.find(item=>item.id===button.dataset.result);if(!result)return;
  button.disabled=true;button.textContent="Starting…";
  try{await engine.start(result,currentMedia||{title:result.title,media_type:"movie"});setMessage("Download added. You can keep browsing while it saves.");await refresh();}
  catch(error){button.disabled=false;button.textContent="Download";setMessage(error?.message||"Could not start download.");}
});
byId("offline-jobs").addEventListener("click",async event=>{
  const button=event.target.closest("button[data-action]");if(!button)return;
  const {action,id}=button.dataset;button.disabled=true;
  try{
    if(action==="play"){const job=jobs.find(item=>item.id===id);if(job)await play(job);}
    else {const ok=await engine.control(id,action);if(!ok)throw new Error("That action is not available.");await refresh();}
  }catch(error){setMessage(error?.message||"Action failed.");}
  finally{button.disabled=false;}
});
byId("offline-player").addEventListener("error",()=>setMessage("This file uses a video format or codec the built-in player cannot decode. Try an MP4 or WebM release."));
byId("offline-player-close").addEventListener("click",()=>{const video=byId("offline-player");video.pause();video.removeAttribute("src");video.load();video.dataset.jobId="";byId("offline-player-section").hidden=true;});
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
