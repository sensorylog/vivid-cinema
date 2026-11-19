import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const loading = document.getElementById("watch-rooms-loading");
const privateContent = document.getElementById("watch-rooms-private");
const errorPanel = document.getElementById("watch-rooms-error");
const errorMessage = document.getElementById("watch-rooms-error-message");
const retryButton = document.getElementById("watch-rooms-retry");

function showSessionError(error) {
  if (loading) loading.hidden = true;
  if (privateContent) privateContent.hidden = true;
  if (errorMessage) {
    errorMessage.textContent = error?.message
      ? "Vivid couldn't confirm your account. Check your connection and try again."
      : "Please check your connection and try again.";
  }
  if (errorPanel) errorPanel.hidden = false;
  console.warn("Vivid Watch Rooms could not verify the current session:", error);
}

function requireVividAccount() {
  const returnTo = "watch-rooms.html";
  window.location.replace("auth.html?returnTo=" + encodeURIComponent(returnTo));
}

async function initializeWatchRoomsAccess() {
  if (!auth) throw new Error("Firebase Authentication is unavailable.");

  // Wait for Firebase to restore its persisted session before deciding whether
  // this private page should redirect. This avoids flashing private UI to guests.
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }

  onAuthStateChanged(auth, user => {
    if (!user || user.isAnonymous) {
      requireVividAccount();
      return;
    }

    if (loading) loading.hidden = true;
    if (errorPanel) errorPanel.hidden = true;
    if (privateContent) privateContent.hidden = false;
    document.body.dataset.vividWatchRoomsAccess = "authenticated";
  }, showSessionError);
}

retryButton?.addEventListener("click", () => window.location.reload());

initializeWatchRoomsAccess().catch(showSessionError);
