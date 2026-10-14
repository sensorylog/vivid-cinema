import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);

// Firebase Auth uses browser-local persistence by default.
export { app, auth, db };
