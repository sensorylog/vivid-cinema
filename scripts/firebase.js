import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAuth, browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence, browserPopupRedirectResolver } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { initializeAppCheck, CustomProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getTurnstileAppCheckToken } from "./turnstile-app-check.js?v=20261127-profile-flow-1";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function validFirebaseConfig(config) {
  return Boolean(
    config &&
    typeof config.apiKey === "string" && config.apiKey &&
    typeof config.projectId === "string" && config.projectId &&
    typeof config.authDomain === "string" && config.authDomain
  );
}

async function loadFirebaseConfig() {
  // Prefer the checked-in config file. The Hosting reserved endpoint can be
  // unavailable in some deployments; it must never prevent the local fallback.
  const urls = [
    new URL("./init.json", window.location.href).href,
    new URL("/__/firebase/init.json", window.location.origin).href
  ];
  let lastError = null;

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        credentials: "same-origin"
      });
      if (!response.ok) {
        lastError = new Error("Firebase configuration request failed (" + response.status + ").");
        continue;
      }
      const config = await response.json();
      if (!validFirebaseConfig(config)) {
        lastError = new Error("Firebase configuration is missing required fields.");
        continue;
      }
      return config;
    } catch (error) {
      lastError = error?.name === "AbortError"
        ? new Error("Firebase configuration request timed out.")
        : error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  console.error("Vivid Cinema could not load Firebase configuration:", lastError);
  throw lastError || new Error("Firebase configuration could not be loaded.");
}

const firebaseConfig = await loadFirebaseConfig();
const app = initializeApp(firebaseConfig);

// App Check initializes before Firebase services that use it. The custom
// provider verifies the browser with Cloudflare Turnstile, then exchanges that
// proof for a real Firebase App Check token. Auth, Firestore and Watch Rooms
// therefore keep App Check protection without reCAPTCHA Enterprise assessments.
let appCheck = null;
let appCheckError = null;
let appCheckSkippedReason = null;
let appCheckPromise = null;

// Do not initialize App Check during ordinary page startup. Its custom
// provider performs a Turnstile exchange, so eager initialization can block
// public visitors before they choose a protected action.
export async function ensureAppCheck() {
  if (appCheck) return appCheck;
  if (LOCAL_HOSTS.has(window.location.hostname)) {
    appCheckSkippedReason =
      "App Check is intentionally skipped on local development hosts; test protected Firebase services on the deployed Vivid site.";
    return null;
  }
  if (appCheckError) throw appCheckError;
  if (!appCheckPromise) {
    appCheckPromise = Promise.resolve().then(() => {
      appCheck = initializeAppCheck(app, {
        provider: new CustomProvider({ getToken: getTurnstileAppCheckToken }),
        isTokenAutoRefreshEnabled: false
      });
      return appCheck;
    }).catch(error => {
      appCheckError = error instanceof Error ? error : new Error(String(error));
      appCheckPromise = null;
      console.warn("Vivid custom App Check could not initialize:", {
        hostname: window.location.hostname,
        origin: window.location.origin,
        code: appCheckError.code || null,
        message: appCheckError.message,
        hint: "Check the Cloudflare Turnstile widget hostnames and Pages environment variables."
      });
      throw appCheckError;
    });
  }
  return appCheckPromise;
}

// Prefer IndexedDB persistence on desktop WebViews, then localStorage, with memory only as a last resort.
// Explicitly provide the browser popup resolver so Google sign-in keeps working in supported browsers.
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
const db = getFirestore(app);

// The configured persistence order deliberately favors durable IndexedDB storage.
export { app, appCheck, appCheckError, appCheckSkippedReason, auth, db, firebaseConfig };
