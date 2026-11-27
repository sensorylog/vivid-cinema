import { DownloadManager } from "./downloads/download-manager.js";
import { createIndexedDBPersistence } from "./downloads/indexeddb-persistence.js";
import { createBrowserDownloadAdapter } from "./downloads/browser-direct-adapter.js";
import { createOfflinePlaybackController } from "./downloads/offline-playback.js";
import { getActiveProfileId, initializeProfileFoundation } from "./profiles.js";

async function loadHlsRuntime() {
  if (window.Hls) return;
  await new Promise(resolve => {
    const script = document.createElement("script");
    script.async = true;
    script.src = window.vividDownloads?.available
      ? "/desktop/node_modules/hls.js/dist/hls.min.js"
      : "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js";
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  });
}

if (window.vividDownloads?.available) {
  // Start the Windows library immediately. HLS.js is only needed if a file
  // requires compatibility transcoding, never to render the saved library.
  void import("./downloads/desktop-offline.js?windows-offline-hls-v4").catch(error => {
    console.error("Vivid offline library could not start:", error);
    const message = document.getElementById("offline-message");
    if (message) message.textContent = "Your offline library could not be opened. " + (error?.message || "Please restart Vivid Cinema.");
  });
} else {
  await loadHlsRuntime();
const byId = id => document.getElementById(id);
const jobsNode = byId("offline-jobs");
const messageNode = byId("offline-message");
const playerSection = byId("offline-player-section");
const video = byId("offline-player");
let manager = null, playback = null, activeAdapter = null, unsubscribe = null, activeOwner = null, generation = 0, currentAuth = null;

async function offlineOwnerKey(uid, profileId) {
  const source = String(uid) + "::" + String(profileId);
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== "function") {
    throw new Error("Secure profile-scoped offline storage is unavailable in this browser.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return "profile-" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
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
  if(!jobs.length){jobsNode.innerHTML='<div class="offline-empty"><strong>No downloads yet</strong><p>Vivid does not currently have an authorized direct-download source connected.</p></div>';messageNode.textContent="Your download queue is empty.";return;}
  messageNode.textContent=jobs.length+(jobs.length===1?" item in your device library.":" items in your device library.");
  jobsNode.innerHTML=jobs.map(job=>{
    const progress=Math.max(0,Math.min(100,Number(job.progress)||0)), bytes=formatBytes(job.bytesDownloaded), total=formatBytes(job.totalBytes);
    const details=[job.quality||"Auto",statusLabel(job),bytes?(bytes+(total?" / "+total:"")):""].filter(Boolean).join(" · ");
    const actions=[];
    if(["queued","downloading"].includes(job.status))actions.push('<button type="button" data-action="pause" data-id="'+escapeHtml(job.id)+'">Stop</button>');
    if(["paused","failed"].includes(job.status))actions.push('<button type="button" data-action="retry" data-id="'+escapeHtml(job.id)+'">Restart</button>');
    if(job.status==="completed"&&job.asset?.uri){actions.push('<button type="button" data-action="play" data-id="'+escapeHtml(job.id)+'">Play</button>');actions.push('<button type="button" data-action="export" data-id="'+escapeHtml(job.id)+'">Save file</button>');}
    if(job.status!=="cancelled"&&job.status!=="completed")actions.push('<button type="button" data-action="cancel" data-id="'+escapeHtml(job.id)+'">Cancel</button>');
    if(!["queued","downloading"].includes(job.status))actions.push('<button type="button" data-action="remove" data-id="'+escapeHtml(job.id)+'">Remove</button>');
    return '<article class="offline-job"><div><div class="offline-job-title">'+escapeHtml(labelFor(job))+'</div><div class="offline-job-meta">'+escapeHtml(details)+'</div>'+
      (job.status==="downloading"?'<div class="offline-progress" aria-label="Download progress"><span style="width:'+progress+'%"></span></div>':"")+
      (job.error?'<div class="offline-job-error">'+escapeHtml(job.error)+'</div>':"")+'</div><div class="offline-job-actions">'+actions.join("")+'</div></article>';
  }).join("");
}
async function migrateLegacyOfflineJobs(uid, profileId, scopedOwner) {
  if (!uid || profileId !== "owner") return;
  const markerKey = "vivid:offline-profile-migration:v1:" + String(uid);
  if (localStorage.getItem(markerKey) === "1") return;
  const legacy = createIndexedDBPersistence({ ownerId: String(uid) });
  const scoped = createIndexedDBPersistence({ ownerId: scopedOwner });
  try {
    const [legacyJobs, scopedJobs] = await Promise.all([legacy.load(), scoped.load()]);
    const merged = new Map(scopedJobs.map(job => [String(job.id), job]));
    for (const job of legacyJobs) {
      const id = String(job?.id || "");
      if (!id) continue;
      const current = merged.get(id);
      if (!current || Number(job.updatedAt || 0) > Number(current.updatedAt || 0)) merged.set(id, job);
    }
    const next = [...merged.values()];
    if (next.length) await scoped.save(next);
    const verified = await scoped.load();
    const verifiedIds = new Set(verified.map(job => String(job.id)));
    if (next.some(job => !verifiedIds.has(String(job.id)))) {
      throw new Error("Existing offline downloads could not be verified in the owner profile.");
    }
    localStorage.setItem(markerKey, "1");
  } finally {
    await Promise.allSettled([legacy.close(), scoped.close()]);
  }
}
async function switchOwner(user) {
  if(user?.uid){
    try{await initializeProfileFoundation(user);}
    catch(error){console.warn("Vivid profile migration is unavailable while opening offline metadata:",error);}
  }
  const profileId=user?.uid?getActiveProfileId(user.uid):"guest";
  const owner=user?.uid?await offlineOwnerKey(user.uid,profileId):"guest";
  if(owner===activeOwner)return;
  const run=++generation; unsubscribe?.(); unsubscribe=null;
  try{await playback?.stop();}catch{}
  try{
    const activeJobs=(manager?.snapshot?.()||[]).filter(job=>["queued","downloading"].includes(job.status));
    await Promise.allSettled(activeJobs.map(job=>manager.pause(job.id)));
  }catch{}
  try{await manager?.persistence?.close?.();}catch{}
  activeOwner=owner; byId("offline-owner").textContent=user?.uid?"Signed-in account":"Guest library";
  jobsNode.innerHTML=""; messageNode.textContent="Loading your download library…";
  try{
    const persistence=createIndexedDBPersistence({ownerId:owner});
    const directAdapter = createBrowserDownloadAdapter({
      resolve: async () => { throw new Error("Vivid has no authorized direct-download source connected."); },
      allowedHosts: [location.hostname]
    });
    const adapter = directAdapter;
    const nextManager=new DownloadManager({persistence,adapter,concurrency:1}); await nextManager.hydrate();
    if(run!==generation){await persistence.close();return;}
    manager=nextManager; activeAdapter=adapter; playback=createOfflinePlaybackController({adapter,video}); unsubscribe=manager.subscribe(render);
    const stalePending = sessionStorage.getItem("vivid:pending-download");
    if (stalePending) {
      sessionStorage.removeItem("vivid:pending-download");
      messageNode.textContent = "That queued download is no longer available because no authorized direct-download source is connected.";
    }
  }catch(error){
    if(run!==generation)return;
    messageNode.textContent="Browser downloads are unavailable: "+String(error?.message||error);
    jobsNode.innerHTML='<div class="offline-empty"><strong>Storage unavailable</strong><p>This browser needs IndexedDB and Origin Private File System support for offline video files.</p></div>';
  }
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
      const filename=(String(media.title||"Vivid Cinema")+episode).replace(/[<>:"|?*]/g,"-").replace(/[\\/]/g,"-").replace(/\p{Cc}/gu,"-").trim()+"."+extension;
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
    currentAuth=auth;
    if(typeof auth.authStateReady==="function")await auth.authStateReady();
    onAuthStateChanged(auth,user=>{void switchOwner(user);});
    window.addEventListener("vivid:profile-changed",event=>{
      if(currentAuth?.currentUser?.uid===String(event.detail?.uid||""))void switchOwner(currentAuth.currentUser);
    });
  }catch(error){console.warn("Vivid download library is using guest storage:",error);await switchOwner(null);}
}
void start();

}
