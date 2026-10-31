import { DownloadManager } from "./downloads/download-manager.js";
import { createIndexedDBPersistence } from "./downloads/indexeddb-persistence.js";
import { createBrowserDownloadAdapter } from "./downloads/browser-direct-adapter.js";
import { createOfflinePlaybackController } from "./downloads/offline-playback.js";
import { VIVID_DOWNLOADS } from "./downloads/provider-integration.js";

const byId = id => document.getElementById(id);
const jobsNode = byId("offline-jobs");
const messageNode = byId("offline-message");
const playerSection = byId("offline-player-section");
const video = byId("offline-player");
let manager = null, playback = null, activeAdapter = null, unsubscribe = null, activeOwner = null, generation = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}
function formatBytes(value) {
  const bytes = Number(value); if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B","KB","MB","GB","TB"], index = Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),4);
  return (bytes/Math.pow(1024,index)).toFixed(index ? 1 : 0)+" "+units[index];
}
function labelFor(job) {
  const media=job.media||{}, episode=media.season==null?"":" · S"+String(media.season).padStart(2,"0")+" E"+String(media.episode).padStart(2,"0");
  return (media.title||"Untitled")+episode;
}
function statusLabel(job) {
  if(job.status==="completed")return "Downloaded";
  if(job.status==="downloading")return "Downloading · "+Math.round(job.progress||0)+"%";
  if(job.status==="queued")return "Waiting in queue";
  if(job.status==="paused")return "Stopped · restart from the beginning";
  if(job.status==="cancelled")return "Cancelled";
  return "Download failed";
}
function render(jobs) {
  const completed=jobs.filter(job=>job.status==="completed").length, active=jobs.filter(job=>["queued","downloading"].includes(job.status)).length;
  byId("offline-total").textContent=String(jobs.length); byId("offline-completed").textContent=String(completed); byId("offline-active").textContent=String(active);
  if(!jobs.length){jobsNode.innerHTML='<div class="offline-empty"><strong>No downloads yet</strong><p>Open a movie or series title and tap Download to check its available qualities.</p></div>';messageNode.textContent="Your download queue is empty.";return;}
  messageNode.textContent=jobs.length+(jobs.length===1?" item in your device library.":" items in your device library.");
  jobsNode.innerHTML=jobs.map(job=>{
    const progress=Math.max(0,Math.min(100,Number(job.progress)||0)), bytes=formatBytes(job.bytesDownloaded), total=formatBytes(job.totalBytes);
    const details=[job.quality||"Auto",statusLabel(job),bytes?(bytes+(total?" / "+total:"")):""].filter(Boolean).join(" · ");
    const actions=[];
    if(["queued","downloading"].includes(job.status))actions.push('<button type="button" data-action="pause" data-id="'+escapeHtml(job.id)+'">Stop</button>');
    if(["paused","failed"].includes(job.status))actions.push('<button type="button" data-action="retry" data-id="'+escapeHtml(job.id)+'">Restart</button>');
    if(job.status==="completed"&&job.asset?.uri)actions.push('<button type="button" data-action="play" data-id="'+escapeHtml(job.id)+'">Play</button>');
    if(job.status!=="cancelled"&&job.status!=="completed")actions.push('<button type="button" data-action="cancel" data-id="'+escapeHtml(job.id)+'">Cancel</button>');
    if(!["queued","downloading"].includes(job.status))actions.push('<button type="button" data-action="remove" data-id="'+escapeHtml(job.id)+'">Remove</button>');
    return '<article class="offline-job"><div><div class="offline-job-title">'+escapeHtml(labelFor(job))+'</div><div class="offline-job-meta">'+escapeHtml(details)+'</div>'+
      (job.status==="downloading"?'<div class="offline-progress" aria-label="Download progress"><span style="width:'+progress+'%"></span></div>':"")+
      (job.error?'<div class="offline-job-error">'+escapeHtml(job.error)+'</div>':"")+'</div><div class="offline-job-actions">'+actions.join("")+'</div></article>';
  }).join("");
}
async function switchOwner(user) {
  const owner=user?.uid?String(user.uid):"guest"; if(owner===activeOwner)return;
  const run=++generation; unsubscribe?.(); unsubscribe=null;
  try{await playback?.stop();}catch{} try{await manager?.persistence?.close?.();}catch{}
  activeOwner=owner; byId("offline-owner").textContent=user?.uid?"Signed-in account":"Guest library";
  jobsNode.innerHTML=""; messageNode.textContent="Loading your download library…";
  try{
    const persistence=createIndexedDBPersistence({ownerId:owner});
    const integration=VIVID_DOWNLOADS;
    const directAdapter = createBrowserDownloadAdapter({
      resolve: (job, context) => integration.resolve(job, context),
      allowedHosts: [location.hostname]
    });
    const adapter = directAdapter;
    const nextManager=new DownloadManager({persistence,adapter,concurrency:1}); await nextManager.hydrate();
    if(run!==generation){await persistence.close();return;}
    manager=nextManager; activeAdapter=adapter; playback=createOfflinePlaybackController({adapter,video}); unsubscribe=manager.subscribe(render);
    await consumePendingDownload();
  }catch(error){
    if(run!==generation)return;
    messageNode.textContent="Browser downloads are unavailable: "+String(error?.message||error);
    jobsNode.innerHTML='<div class="offline-empty"><strong>Storage unavailable</strong><p>This browser needs IndexedDB and Origin Private File System support for offline video files.</p></div>';
  }
}
async function consumePendingDownload(){
  let pending;
  try{pending=JSON.parse(sessionStorage.getItem("vivid:pending-download")||"null");}catch{}
  if(!pending?.media||!pending?.option)return;
  sessionStorage.removeItem("vivid:pending-download");
  const integration=VIVID_DOWNLOADS;
  try{
    const media={...pending.media,source_id:String(pending.option.sourceId||integration.sourceId),source_file:String(pending.option.id)};
    await manager.enqueue(media,{quality:String(pending.option.quality||pending.option.label||"Auto")});
    messageNode.textContent="Download added to your queue.";
  }catch(error){messageNode.textContent="Could not start this download: "+String(error?.message||error);}
}
jobsNode.addEventListener("click",async event=>{
  const button=event.target.closest("button[data-action]"); if(!button||!manager)return;
  const {action,id}=button.dataset; button.disabled=true;
  try{
    if(action==="pause")await manager.pause(id);
    if(action==="retry")await manager.retry(id);
    if(action==="cancel")await manager.cancel(id);
    if(action==="remove")await manager.remove(id);
    if(action==="export"){
      const job=manager.snapshot().find(item=>item.id===id); if(!job?.asset?.uri)throw new Error("This completed download has no local file reference.");
      if(typeof activeAdapter?.getAssetUrl!=="function")throw new Error("The saved file cannot be exported by this browser.");
      const fileUrl=await activeAdapter.getAssetUrl(job.asset);
      const media=job.media||{}, mime=String(job.asset.mimeType||"video/mp4");
      const extension=({"video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov","video/ogg":"ogv"})[mime]||"mp4";
      const episode=media.season==null?"":" - S"+String(media.season).padStart(2,"0")+"E"+String(media.episode).padStart(2,"0");
      const filename=(String(media.title||"Vivid Cinema")+episode).replace(/[<>:"/\\|?*\\u0000-\\u001f]/g,"-").trim()+"."+extension;
      const link=document.createElement("a");link.href=fileUrl;link.download=filename;link.rel="noopener";document.body.appendChild(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(fileUrl),120000);
      messageNode.textContent="Your video file is being saved by the browser.";
    }
    if(action==="play"){
      const job=manager.snapshot().find(item=>item.id===id); if(!job?.asset?.uri)throw new Error("This completed download has no local file reference.");
      byId("offline-player-title").textContent=labelFor(job);playerSection.hidden=false;await playback.play(job.asset);playerSection.scrollIntoView({behavior:"smooth",block:"start"});
      try{await video.play();}catch{messageNode.textContent="Offline file is ready. Tap Play in the video controls to start.";}
    }
  }catch(error){messageNode.textContent="That action could not be completed: "+String(error?.message||error);}
  finally{button.disabled=false;}
});
byId("offline-player-close").addEventListener("click",async()=>{await playback?.stop();playerSection.hidden=true;});
async function start(){
  try{
    const [{auth},{onAuthStateChanged}]=await Promise.all([import("./firebase.js"),import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")]);
    if(typeof auth.authStateReady==="function")await auth.authStateReady();
    onAuthStateChanged(auth,user=>{void switchOwner(user);});
  }catch(error){console.warn("Vivid download library is using guest storage:",error);await switchOwner(null);}
}
void start();
