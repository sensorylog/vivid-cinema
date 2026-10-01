import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

async function loadFirebaseConfig() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("./init.json", { cache: "force-cache", signal: controller.signal });
    if (!response.ok) throw new Error("Firebase configuration could not be loaded.");
    return await response.json();
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

export { app, auth, db };
