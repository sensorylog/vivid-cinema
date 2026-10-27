import { app, auth, db, firebaseConfig, RECAPTCHA_ENTERPRISE_SITE_KEY } from "./firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  onAuthStateChanged, signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

// Use a separate Firebase app for anonymous analytics so analytics never changes
// the site's real sign-in state or exposes personal account features to anonymous users.
const anonymousApp = initializeApp(firebaseConfig, "vivid-pulse-anonymous");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
if (RECAPTCHA_ENTERPRISE_SITE_KEY && !LOCAL_HOSTS.has(window.location.hostname)) {
  try {
    initializeAppCheck(anonymousApp, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    console.warn("[Vivid Pulse] Anonymous App Check initialization failed:", error?.message || error);
  }
}
const anonymousAuth = initializeAuth(anonymousApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence]
});
const anonymousDb = getFirestore(anonymousApp);

const platform = (() => {
  try {
    const nativePlatform = window.Capacitor?.getPlatform?.();
    if (nativePlatform === "android") return "android";
    if (window.navigator.userAgent.includes("Electron")) return "windows";
    return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true ? "pwa" : "web";
  } catch { return "web"; }
})();
let uid = null;
let activeDb = db;
let identityType = "account";
let activeIdentityKey = null;
let sessionId = null;
let started = false;
let preferredIdentity = "anonymous";
let anonymousUserPromise = null;

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
  if (!/^[a-z][a-z0-9_]{1,59}$/.test(event) || !uid || !started) return false;
  try {
    await addDoc(collection(activeDb, "analyticsEvents"), {
      event, platform, userId: uid, sessionId: getSessionId(),
      timestamp: serverTimestamp(), appVersion: "web-current",
      details: safeDetails({ ...details, identity_type: identityType })
    });
    return true;
  } catch (error) {
    console.warn("[Vivid Pulse] Event write failed:", error?.code || error?.message || error);
    return false;
  }
}
function beginTracking(user, targetDb, anonymous) {
  if (!user || (anonymous && preferredIdentity !== "anonymous")) return;
  const nextKey = (anonymous ? "anonymous:" : "account:") + user.uid;
  if (nextKey !== activeIdentityKey) {
    activeIdentityKey = nextKey;
    uid = user.uid;
    activeDb = targetDb;
    identityType = anonymous || user.isAnonymous ? "anonymous" : "account";
    started = false;
  }
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

  // A first-open event means the native app actually launched; a download click alone never does.
  if (platform === "windows" || platform === "android") {
    let alreadyOpened = false;
    try { alreadyOpened = localStorage.getItem("vivid:pulse-first-open:" + platform) === "1"; } catch { return; }
    if (!alreadyOpened) {
      void trackPulseEvent("app_first_open", { platform, signal: "native_app_launch" }).then(written => {
        if (written) {
          try { localStorage.setItem("vivid:pulse-first-open:" + platform, "1"); } catch {}
        }
      });
    }
  }
}
async function getAnonymousUser() {
  if (anonymousAuth.currentUser) return anonymousAuth.currentUser;
  if (!anonymousUserPromise) {
    anonymousUserPromise = new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(anonymousAuth, user => {
        unsubscribe();
        resolve(user);
      }, () => resolve(null));
    }).then(async user => user || (await signInAnonymously(anonymousAuth)).user)
      .finally(() => { anonymousUserPromise = null; });
  }
  return anonymousUserPromise;
}
onAuthStateChanged(auth, user => {
  if (user) {
    preferredIdentity = "account";
    beginTracking(user, db, false);
    return;
  }
  preferredIdentity = "anonymous";
  void getAnonymousUser().then(anonymousUser => {
    if (preferredIdentity === "anonymous") beginTracking(anonymousUser, anonymousDb, true);
  }).catch(error => {
    console.warn("[Vivid Pulse] Anonymous analytics unavailable:", error?.code || error?.message || error);
  });
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
