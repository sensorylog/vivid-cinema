import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth, browserLocalPersistence, setPersistence } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
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

// Keep auth local across page changes and browser restarts. Do not await this
// in a click handler: doing so can consume the user-activation window that
// mobile browsers require before opening Google's OAuth popup.
void setPersistence(auth, browserLocalPersistence).catch(error => {
  console.warn("Firebase local auth persistence could not be enabled:", error);
});

export { app, auth, db };
