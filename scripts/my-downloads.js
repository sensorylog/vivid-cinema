import { DownloadManager } from "./downloads/download-manager.js";
import { createIndexedDBPersistence } from "./downloads/indexeddb-persistence.js";

const byId = id => document.getElementById(id);
const jobsNode = byId("offline-jobs");
const messageNode = byId("offline-message");
let manager = null;
let unsubscribe = null;
let activeOwner = null;
let generation = 0;

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
  if (job.status === "paused") return "Paused";
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
    jobsNode.innerHTML = '<div class="offline-empty"><strong>No downloads yet</strong><p>When an authorized download source is connected, saved movies and episodes will appear here.</p></div>';
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
    if (["queued","downloading"].includes(job.status)) actions.push('<button type="button" data-action="pause" data-id="' + escapeHtml(job.id) + '">Pause</button>');
    if (["paused","failed"].includes(job.status)) actions.push('<button type="button" data-action="retry" data-id="' + escapeHtml(job.id) + '" disabled title="An authorized download source is not configured">Retry unavailable</button>');
    if (job.status !== "cancelled" && job.status !== "completed") actions.push('<button type="button" data-action="cancel" data-id="' + escapeHtml(job.id) + '">Cancel</button>');
    if (!["queued","downloading"].includes(job.status)) actions.push('<button type="button" data-action="remove" data-id="' + escapeHtml(job.id) + '">Remove</button>');
    return '<article class="offline-job"><div><div class="offline-job-title">' + escapeHtml(labelFor(job)) + '</div><div class="offline-job-meta">' + escapeHtml(details) + '</div>' +
      (job.status === "downloading" ? '<div class="offline-progress" aria-label="Download progress"><span style="width:' + progress + '%"></span></div>' : '') +
      (job.error ? '<div class="offline-job-error">' + escapeHtml(job.error) + '</div>' : '') +
      (job.status === "completed" && !job.asset?.uri ? '<div class="offline-job-error">The saved file reference is missing; remove this record to clear it.</div>' : '') +
      '</div><div class="offline-job-actions">' + actions.join("") + '</div></article>';
  }).join("");
}
async function switchOwner(user) {
  const owner = user?.uid ? String(user.uid) : "guest";
  if (owner === activeOwner) return;
  const run = ++generation;
  unsubscribe?.();
  unsubscribe = null;
  try { await manager?.adapter?.dispose?.(); } catch {}
  activeOwner = owner;
  byId("offline-owner").textContent = user?.uid ? "Signed-in account" : "Guest library";
  jobsNode.innerHTML = "";
  messageNode.textContent = "Loading your download library…";
  try {
    const persistence = createIndexedDBPersistence({ ownerId: owner });
    // Deliberately fail closed: no media resolver or download host is configured.
    // This still permits the page to hydrate and manage existing job metadata.
    const adapter = {
      async download() {
        throw new Error("No authorized direct-file download source is configured in Vivid Cinema yet.");
      }
    };
    const nextManager = new DownloadManager({ persistence, adapter, concurrency: 1 });
    await nextManager.hydrate();
    if (run !== generation) { await persistence.close(); return; }
    manager = nextManager;
    unsubscribe = manager.subscribe(render);
  } catch (error) {
    if (run !== generation) return;
    messageNode.textContent = "Your download library could not be opened: " + String(error?.message || error);
    jobsNode.innerHTML = '<div class="offline-empty"><strong>Storage unavailable</strong><p>Enable site storage for Vivid Cinema, then reload this page.</p></div>';
  }
}
jobsNode.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !manager) return;
  const { action, id } = button.dataset;
  button.disabled = true;
  try {
    if (action === "pause") await manager.pause(id);
    if (action === "cancel") await manager.cancel(id);
    if (action === "remove") await manager.remove(id);
    // Retry is intentionally not wired until a real authorized resolver exists.
  } catch (error) {
    messageNode.textContent = "That action could not be completed: " + String(error?.message || error);
  } finally {
    button.disabled = false;
  }
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
