import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

async function loadFirebaseConfig() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  try {
    // Firebase Hosting exposes the runtime config at this reserved endpoint.
    // Using ./init.json breaks OAuth when no physical init.json exists in the repo.
    const urls = [
      new URL("/__/firebase/init.json", window.location.origin).href,
      "./init.json"
    ];

    let lastError = null;
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          lastError = new Error("Firebase configuration request failed: " + response.status);
          continue;
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        if (error?.name === "AbortError") throw error;
      }
    }
    throw lastError || new Error("Firebase configuration could not be loaded.");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Firebase configuration request timed out.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

const firebaseConfig = await loadFirebaseConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Firebase Auth uses browser-local persistence by default. Avoid a separate
// asynchronous persistence change racing with the first sign-in request.

export { app, auth, db };
