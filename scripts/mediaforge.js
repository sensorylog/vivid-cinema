const form = document.getElementById("mf-form");
const field = document.getElementById("mf-url");
const status = document.getElementById("mf-status");
const STORAGE_KEY = "vivid:mediaforge:instance-url:v1";
function setStatus(message, kind = "") {
  status.textContent = message;
  if (kind) status.dataset.kind = kind;
  else delete status.dataset.kind;
}
function normalizeInstanceUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Use a base address only; do not include credentials, query strings, or fragments.");
  const host = url.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("Use HTTPS for a remote server. HTTP is allowed only for localhost.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) field.value = normalizeInstanceUrl(saved);
} catch {
  // Storage may be disabled; the default remains usable.
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  let target;
  try {
    target = normalizeInstanceUrl(field.value.trim());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Enter a valid MediaForge address.", "error");
    return;
  }
  try { localStorage.setItem(STORAGE_KEY, target); } catch { /* Opening the service must not depend on storage. */ }
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  if (opened) setStatus("MediaForge opened in a new tab. Sign in there if your instance asks you to.", "success");
  else setStatus("Your browser blocked the new tab. Allow pop-ups for this site, then try again.", "error");
});