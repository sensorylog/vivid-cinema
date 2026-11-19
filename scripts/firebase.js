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

// Capture the actual Firebase App Check token-exchange rejection. The AI SDK
// only receives a dummy App Check token after this request fails, which hides
// the useful HTTP response body behind a generic AI/error wrapper.
let lastAppCheckExchangeFailure = null;
const APP_CHECK_EXCHANGE_URL =
  /(?:content-)?firebaseappcheck\\.googleapis\\.com\\/v1(?:beta)?\\/projects\\/[^/]+\\/apps\\/[^/?]+:exchangeRecaptchaEnterpriseToken/i;

function installAppCheckExchangeDiagnostics() {
  if (typeof window === "undefined" || typeof window.fetch !== "function" ||
      window.fetch.__vividAppCheckDiagnostics) return;

  const nativeFetch = window.fetch.bind(window);
  const diagnosticFetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input?.url || "";
    const isAppCheckExchange = APP_CHECK_EXCHANGE_URL.test(requestUrl);
    const response = await nativeFetch(input, init);
    if (!isAppCheckExchange) return response;

    if (response.ok) {
      lastAppCheckExchangeFailure = null;
      return response;
    }

    let responseBody = null;
    try {
      responseBody = await response.clone().json();
    } catch {
      try {
        responseBody = { message: (await response.clone().text()).slice(0, 500) };
      } catch {
        responseBody = { message: "The App Check error response body could not be read." };
      }
    }

    const apiError = responseBody?.error || responseBody || {};
    lastAppCheckExchangeFailure = {
      status: response.status,
      endpoint: "exchangeRecaptchaEnterpriseToken",
      code: apiError.code || response.status,
      message: String(apiError.message || response.statusText || "App Check token exchange failed").slice(0, 500),
      apiStatus: apiError.status || null,
      details: Array.isArray(apiError.details) ? apiError.details : [],
      retryAfter: response.headers.get("Retry-After"),
      capturedAt: new Date().toISOString()
    };
    console.error("Vivid App Check token exchange rejected:", lastAppCheckExchangeFailure);
    return response;
  };

  diagnosticFetch.__vividAppCheckDiagnostics = true;
  window.fetch = diagnosticFetch;
}

installAppCheckExchangeDiagnostics();

export function getLastAppCheckExchangeFailure() {
  return lastAppCheckExchangeFailure;
}

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

// Prefer IndexedDB persistence on desktop WebViews, then localStorage, with memory only as a last resort.
// Explicitly provide the browser popup resolver so Google sign-in keeps working in supported browsers.
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
const db = getFirestore(app);

// The configured persistence order deliberately favors durable IndexedDB storage.
export { app, appCheck, appCheckError, appCheckSkippedReason, auth, db, firebaseConfig, RECAPTCHA_ENTERPRISE_SITE_KEY };
