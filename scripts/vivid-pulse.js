import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const platform = (() => {
  try {
    return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true ? "pwa" : "web";
  } catch { return "web"; }
})();
let uid = null;
let sessionId = null;
let started = false;
function getSessionId() {
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem("vivid:pulse-session");
    if (!sessionId) {
      sessionId = globalThis.crypto?.randomUUID?.() || ("s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      sessionStorage.setItem("vivid:pulse-session", sessionId);
    }
  } catch {
    sessionId = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  return sessionId;
}
function safeDetails(details = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(details).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (/(password|token|secret|email|phone|message|location|address|cookie|authorization|search_term|^query$|query_text|^content$|content_(text|body))/i.test(key)) continue;
    if (typeof value === "string") safe[key] = value.slice(0, 120);
    else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "boolean") safe[key] = value;
  }
  return safe;
}
export async function trackPulseEvent(event, details = {}) {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(event)) return;
  if (!uid || !started) return;
  try {
    await addDoc(collection(db, "analyticsEvents"), {
      event, platform, userId: uid, sessionId: getSessionId(),
      timestamp: serverTimestamp(), appVersion: "web-current",
      details: safeDetails(details)
    });
  } catch (error) {
    console.warn("[Vivid Pulse] Event write failed:", error?.code || error?.message || error);
  }
}
let activeUid = null;
onAuthStateChanged(auth, user => {
  const nextUid = user?.uid || null;
  if (nextUid !== activeUid) {
    // Reset session state when the signed-in account changes.
    activeUid = nextUid;
    uid = nextUid;
    started = false;
  }
  if (!uid) { started = false; return; }
  if (started) return;
  started = true;
  const sid = getSessionId();
  const startedKey = "vivid:pulse-started:" + uid;
  let sessionWasStarted = false;
  try { sessionWasStarted = sessionStorage.getItem(startedKey) === sid; } catch {}
  if (!sessionWasStarted) {
    void trackPulseEvent("app_session_start", { page: location.pathname });
    try { sessionStorage.setItem(startedKey, sid); } catch {}
  }
  void trackPulseEvent("page_view", { page: location.pathname });
});
document.addEventListener("click", event => {
  const downloadLink = event.target.closest?.("#windows-installer, #windows-portable, #android-apk");
  if (downloadLink) {
    const targetPlatform = downloadLink.id === "android-apk" ? "android" : "windows";
    void trackPulseEvent("download_" + targetPlatform, {
      source: location.pathname,
      download_variant: downloadLink.id === "windows-portable" ? "portable" : (downloadLink.id === "windows-installer" ? "installer" : "apk")
    });
    return;
  }
  const target = event.target.closest?.("[data-id][data-type]");
  if (target) {
    void trackPulseEvent("content_click", { content_id: String(target.dataset.id), content_type: String(target.dataset.type), source: location.pathname });
    return;
  }
  if (event.target.closest?.(".vivid-discovery-card,.vivid-search-result")) {
    void trackPulseEvent("content_click", { source: location.pathname });
    return;
  }
  if (event.target.closest?.("#hero-watch,[data-watch],#stream-button,.stream-button")) {
    void trackPulseEvent("stream_click", { source: location.pathname });
  }
});
document.addEventListener("submit", event => {
  const form = event.target;
  if (form.matches?.("[data-landing-email-form]")) void trackPulseEvent("signup_start", { method: "email" });
  else if (form.matches?.("#signup-form")) void trackPulseEvent("signup_submit", { method: "email" });
  else if (form.matches?.("#login-form")) void trackPulseEvent("login_submit", { method: "email" });
});
document.addEventListener("input", event => {
  const input = event.target;
  if (!input.matches?.("#search-input")) return;
  const queryLength = input.value.trim().length;
  if (queryLength < 3) return;
  clearTimeout(input.__vividPulseTimer);
  input.__vividPulseTimer = setTimeout(() => {
    void trackPulseEvent("search_performed", { query_length: queryLength, page: location.pathname });
  }, 800);
});
