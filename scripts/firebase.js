import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAuth, browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence, browserPopupRedirectResolver } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

const RECAPTCHA_ENTERPRISE_SITE_KEY = "6Lfs5PMtAAAAAAH8_fR_A6g4uAftFvAv0uNsehTB";
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

// App Check must initialize before services that use it. The site key is public;
// Gemini authorization remains behind the Firebase AI Logic proxy.
let appCheck = null;
let appCheckError = null;
let appCheckSkippedReason = null;
if (!RECAPTCHA_ENTERPRISE_SITE_KEY) {
  appCheckError = new Error("The reCAPTCHA Enterprise site key is not configured.");
  console.error("Vivid App Check is not configured:", appCheckError.message);
} else if (LOCAL_HOSTS.has(window.location.hostname)) {
  // Localhost and loopback were intentionally removed from the reCAPTCHA
  // Enterprise allowed-domain list. Use the deployed Hosting domain to test AI.
  appCheckSkippedReason =
    "App Check is intentionally skipped on local development hosts; test Gemini on the deployed Cloudflare Pages or Firebase Hosting site.";
} else {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    appCheckError = error instanceof Error ? error : new Error(String(error));
    // Keep the rest of Vivid usable, but expose the exact cause to AI diagnostics.
    console.warn("Vivid App Check could not initialize:", {
      hostname: window.location.hostname,
      origin: window.location.origin,
      code: appCheckError.code || null,
      message: appCheckError.message,
      hint: "Allow vivid-cinema.pages.dev and vivid-cinema.web.app in Firebase App Check and the reCAPTCHA Enterprise site's allowed domains."
    });
  }
}

// Prefer durable localStorage persistence on desktop WebViews, then IndexedDB, with memory only as a last resort.
// Explicitly provide the browser popup resolver so Google sign-in keeps working in supported browsers.
const auth = initializeAuth(app, {
  persistence: [browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
const db = getFirestore(app);

// The configured persistence order deliberately favors durable browser-local storage.
export { app, appCheck, appCheckError, appCheckSkippedReason, auth, db };
