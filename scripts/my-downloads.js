import { DownloadManager } from "./downloads/download-manager.js";
import { createIndexedDBPersistence } from "./downloads/indexeddb-persistence.js";
import { createBrowserDownloadAdapter } from "./downloads/browser-direct-adapter.js";
import { createOfflinePlaybackController } from "./downloads/offline-playback.js";
import { createInternetArchiveSource } from "./downloads/internet-archive-source.js";

const byId = id => document.getElementById(id);
const jobsNode = byId("offline-jobs");
const messageNode = byId("offline-message");
const searchMessage = byId("archive-search-message");
const resultsNode = byId("archive-results");
const playerSection = byId("offline-player-section");
const video = byId("offline-player");
const source = createInternetArchiveSource();
let manager = null;
let playback = null;
let unsubscribe = null;
let activeOwner = null;
let generation = 0;
let searchGeneration = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[char]);
}
function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B","KB","MB","GB","TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024,index)).toFixed(index ? 1 : 0) + " " + units[index];
}
function labelFor(job) {
  const media = job.media || {};
  const episode = media.season == null ? "" : " · S" + String(media.season).padStart(2,"0") + " E" + String(media.episode).padStart(2,"0");
  return (media.title || "Untitled") + episode;
}
function statusLabel(job) {
  if (job.status === "completed") return "Saved offline";
  if (job.status === "downloading") return "Downloading · " + Math.round(job.progress || 0) + "%";
  if (job.status === "queued") return "Waiting in queue";
  if (job.status === "paused") return "Stopped · retry starts over";
  if (job.status === "cancelled") return "Cancelled";
  return "Download failed";
}
function render(jobs) {
  const completed = jobs.filter(job => job.status === "completed").length;
  const active = jobs.filter(job => ["queued","downloading"].includes(job.status)).length;
  byId("offline-total").textContent = String(jobs.length);
  byId("offline-completed").textContent = String(completed);
  byId("offline-active").textContent = String(active);
  if (!jobs.length) {
    jobsNode.innerHTML = '<div class="offline-empty"><strong>No downloads yet</strong><p>Find a licensed film above and save it to this browser.</p></div>';
    messageNode.textContent = "Your device download queue is empty.";
    return;
  }
  messageNode.textContent = jobs.length + (jobs.length === 1 ? " item in your device library." : " items in your device library.");
  jobsNode.innerHTML = jobs.map(job => {
    const progress = Math.max(0,Math.min(100,Number(job.progress)||0));
    const bytes = formatBytes(job.bytesDownloaded);
    const total = formatBytes(job.totalBytes);
    const details = [job.quality || "Auto",statusLabel(job),bytes ? (bytes + (total ? " / " + total : "")) : ""].filter(Boolean).join(" · ");
    const actions = [];
    if (["queued","downloading"].includes(job.status)) actions.push('<button type="button" data-action="pause" data-id="' + escapeHtml(job.id) + '">Stop</button>');
    if (["paused","failed"].includes(job.status)) actions.push('<button type="button" data-action="retry" data-id="' + escapeHtml(job.id) + '">Restart</button>');
    if (job.status === "completed") actions.push('<button type="button" data-action="play" data-id="' + escapeHtml(job.id) + '">Play offline</button>');
    if (job.status !== "cancelled" && job.status !== "completed") actions.push('<button type="button" data-action="cancel" data-id="' + escapeHtml(job.id) + '">Cancel</button>');
    if (!["queued","downloading"].includes(job.status)) actions.push('<button type="button" data-action="remove" data-id="' + escapeHtml(job.id) + '">Remove</button>');
    return '<article class="offline-job"><div><div class="offline-job-title">' + escapeHtml(labelFor(job)) + '</div><div class="offline-job-meta">' + escapeHtml(details) + '</div>' +
      (job.status === "downloading" ? '<div class="offline-progress" aria-label="Download progress"><span style="width:' + progress + '%"></span></div>' : '') +
      (job.error ? '<div class="offline-job-error">' + escapeHtml(job.error) + '</div>' : '') +
      (job.status === "completed" && !job.asset?.uri ? '<div class="offline-job-error">The saved file reference is missing; remove this record to clear it.</div>' : '') +
      '</div><div class="offline-job-actions">' + actions.join("") + '</div></article>';
  }).join("");
}
function stableNumericId(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return String((hash >>> 0) || 1);
}
function renderArchiveResults(items) {
  resultsNode.innerHTML = items.map(item => '<article class="archive-result" data-archive-id="' + escapeHtml(item.identifier) + '">' +
    '<div class="archive-result-copy"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml([item.year,item.creator].filter(Boolean).join(" · ")) + '</span>' +
    '<a href="' + escapeHtml(item.detailUrl) + '" target="_blank" rel="noopener noreferrer">View item on Internet Archive</a></div>' +
    '<button type="button" data-action="inspect" data-id="' + escapeHtml(item.identifier) + '">Check files &amp; rights</button><div class="archive-file-options" id="archive-files-' + escapeHtml(item.identifier) + '"></div></article>').join("");
}
async function inspectArchiveItem(identifier, button) {
  button.disabled = true;
  button.textContent = "Checking…";
  const slot = byId("archive-files-" + identifier);
  try {
    const item = await source.getItem(identifier);
    if (!item.rightsApproved) {
      slot.innerHTML = '<p class="archive-rights-blocked">Downloads disabled: this item does not declare a supported public-domain or Creative Commons license. <a href="' + escapeHtml(item.detailUrl) + '" target="_blank" rel="noopener noreferrer">Review its rights information</a>.</p>';
      return;
    }
    if (!item.files.length) {
      slot.innerHTML = '<p class="archive-rights-blocked">A supported license is declared, but no eligible direct video file was found.</p>';
      return;
    }
    slot.innerHTML = '<p class="archive-rights-approved">License declaration found: ' + escapeHtml(item.licenseUrl || item.rights || "Public domain") + '. Confirm the item’s rights before use.</p>' +
      item.files.map(file => '<div class="archive-file"><span><strong>' + escapeHtml(file.format) + '</strong><small>' + escapeHtml(file.name) + ' · ' + escapeHtml(formatBytes(file.size)) + '</small></span>' +
      '<button type="button" data-action="download-archive" data-id="' + escapeHtml(identifier) + '" data-file="' + escapeHtml(file.name) + '" data-title="' + escapeHtml(item.title) + '" data-year="' + escapeHtml(item.year) + '" data-size="' + String(file.size) + '">Download</button></div>').join("");
  } catch (error) {
    slot.innerHTML = '<p class="archive-rights-blocked">' + escapeHtml(error?.message || error) + '</p>';
  } finally {
    button.disabled = false;
    button.textContent = "Refresh files";
  }
}
async function switchOwner(user) {
  const owner = user?.uid ? String(user.uid) : "guest";
  if (owner === activeOwner) return;
  const run = ++generation;
  unsubscribe?.();
  unsubscribe = null;
  try { await playback?.stop(); } catch {}
  try { await manager?.persistence?.close?.(); } catch {}
  activeOwner = owner;
  byId("offline-owner").textContent = user?.uid ? "Signed-in account" : "Guest library";
  jobsNode.innerHTML = "";
  messageNode.textContent = "Loading your download library…";
  try {
    const persistence = createIndexedDBPersistence({ ownerId: owner });
    const adapter = createBrowserDownloadAdapter({
      resolve: job => source.resolve(job),
      allowedHosts: ["*.archive.org"]
    });
    const nextManager = new DownloadManager({ persistence, adapter, concurrency: 1 });
    await nextManager.hydrate();
    if (run !== generation) { await persistence.close(); return; }
    manager = nextManager;
    playback = createOfflinePlaybackController({ adapter, video });
    unsubscribe = manager.subscribe(render);
  } catch (error) {
    if (run !== generation) return;
    messageNode.textContent = "Browser downloads are unavailable: " + String(error?.message || error);
    jobsNode.innerHTML = '<div class="offline-empty"><strong>Storage unavailable</strong><p>This browser needs Origin Private File System (OPFS) support for direct offline video files. Try a current Chromium-based browser.</p></div>';
  }
}
jobsNode.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !manager) return;
  const { action, id } = button.dataset;
  button.disabled = true;
  try {
    if (action === "pause") await manager.pause(id);
    if (action === "retry") await manager.retry(id);
    if (action === "cancel") await manager.cancel(id);
    if (action === "remove") await manager.remove(id);
    if (action === "play") {
      const job = manager.snapshot().find(item => item.id === id);
      if (!job?.asset?.uri) throw new Error("This completed download has no local file reference.");
      byId("offline-player-title").textContent = labelFor(job);
      playerSection.hidden = false;
      await playback.play(job.asset);
      playerSection.scrollIntoView({ behavior: "smooth", block: "start" });
      try { await video.play(); } catch { messageNode.textContent = "Offline file is ready. Tap Play in the video controls to start."; }
    }
  } catch (error) {
    messageNode.textContent = "That action could not be completed: " + String(error?.message || error);
  } finally {
    button.disabled = false;
  }
});
byId("archive-search-form").addEventListener("submit", async event => {
  event.preventDefault();
  const query = byId("archive-search-query").value.trim();
  const run = ++searchGeneration;
  searchMessage.textContent = "Searching Internet Archive…";
  resultsNode.innerHTML = "";
  try {
    const items = await source.search(query);
    if (run !== searchGeneration) return;
    renderArchiveResults(items);
    searchMessage.textContent = items.length ? items.length + " catalogue results. Check each item’s license and files before downloading." : "No matching movie items were found.";
  } catch (error) {
    if (run === searchGeneration) searchMessage.textContent = "Catalogue search failed: " + String(error?.message || error);
  }
});
resultsNode.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "inspect") {
    await inspectArchiveItem(button.dataset.id, button);
    return;
  }
  if (button.dataset.action === "download-archive") {
    if (!manager) { searchMessage.textContent = "Browser download storage is not available on this browser."; return; }
    button.disabled = true;
    try {
      const identifier = button.dataset.id;
      const file = button.dataset.file;
      const identity = identifier + ":" + file;
      const title = button.dataset.title || identifier;
      await manager.enqueue({
        id: stableNumericId(identity),
        media_type: "movie",
        title,
        year: button.dataset.year || "",
        source_id: identifier,
        source_file: file
      }, { quality: formatBytes(button.dataset.size) });
      searchMessage.textContent = "Added " + title + " to your download queue.";
    } catch (error) {
      searchMessage.textContent = "Could not queue this file: " + String(error?.message || error);
    } finally {
      button.disabled = false;
    }
  }
});
byId("offline-player-close").addEventListener("click", async () => {
  await playback?.stop();
  playerSection.hidden = true;
});
async function start() {
  try {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
    ]);
    if (typeof auth.authStateReady === "function") await auth.authStateReady();
    onAuthStateChanged(auth, user => { void switchOwner(user); });
  } catch (error) {
    console.warn("Vivid download library is using guest storage:", error);
    await switchOwner(null);
  }
}
void start();
