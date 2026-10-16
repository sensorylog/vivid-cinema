import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

const RECAPTCHA_ENTERPRISE_SITE_KEY = "6LfSuCArAAAAANqKO_UmgvT_0_gvZ9nLqiah3FpY";
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
    "App Check is intentionally skipped on local development hosts; test Gemini on vivid-cinema.web.app.";
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
      code: appCheckError.code || null,
      message: appCheckError.message
    });
  }
}

const auth = getAuth(app);
const db = getFirestore(app);

// Firebase Auth uses browser-local persistence by default.
export { app, appCheck, appCheckError, appCheckSkippedReason, auth, db };
