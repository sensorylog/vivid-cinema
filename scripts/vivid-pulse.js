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
let resolveInitialAuth;
let initialAuthResolved = false;
const initialAuthReady = new Promise((resolve) => { resolveInitialAuth = resolve; });
function finishInitialAuth(user) {
  if (initialAuthResolved) return;
  initialAuthResolved = true;
  resolveInitialAuth(user || null);
}
function getSessionId() {
  if (sessionId) return sessionId;
  try {
    const storageKey = "vivid:pulse-session:" + (uid || "signed-out");
    sessionId = sessionStorage.getItem(storageKey);
    if (!sessionId) {
      sessionId = globalThis.crypto?.randomUUID?.() || ("s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      sessionStorage.setItem(storageKey, sessionId);
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
  if (!uid || !started) return { skipped: true, reason: "not_authenticated_or_session_not_ready" };
  try {
    const ref = await addDoc(collection(db, "analyticsEvents"), {
      event, platform, userId: uid, sessionId: getSessionId(),
      timestamp: serverTimestamp(), appVersion: "web-current",
      details: safeDetails(details)
    });
    return { recorded: true, id: ref.id };
  } catch (error) {
    console.warn("[Vivid Pulse] Event write failed:", error?.code || error?.message || error);
    return { skipped: true, reason: error?.code || "write_failed" };
  }
}

export async function recordPulseDownload(targetPlatform, source = "downloads_page") {
  if (!["windows", "android"].includes(targetPlatform)) {
    return { skipped: true, reason: "unsupported_download_platform" };
  }
  // Wait for Firebase Auth's first state resolution so an existing signed-in
  // user is not mistaken for a signed-out visitor during initialization.
  await initialAuthReady;
  return trackPulseEvent("download_" + targetPlatform, { source });
}
let activeUid = null;
onAuthStateChanged(auth, user => {
  const nextUid = user?.uid || null;
  if (nextUid !== activeUid) {
    // Reset session state when the signed-in account changes.
    activeUid = nextUid;
    uid = nextUid;
    sessionId = null;
    started = false;
  }
  if (!uid) {
    started = false;
    finishInitialAuth(null);
    return;
  }
  if (started) {
    finishInitialAuth(user);
    return;
  }
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
  finishInitialAuth(user);
});
document.addEventListener("click", event => {
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
