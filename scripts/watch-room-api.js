import { auth, appCheck } from "./firebase.js";
import { getLimitedUseToken } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

const API_URL = "https://vivid-cinema-api.vercel.app/api/watch-rooms";

export function callWatchRoomApi(action) {
  return async (data = {}) => {
    // Firebase Auth may still be restoring IndexedDB/local persistence when a
    // caller first reaches this helper. Wait for that initial state before
    // deciding that the user is signed out.
    if (typeof auth.authStateReady === "function") await auth.authStateReady();
    let user = auth.currentUser;
    if (!user) {
      const error = new Error("Please sign in to your Vivid account and try again.");
      error.code = "functions/unauthenticated";
      throw error;
    }
    if (!appCheck) {
      const error = new Error("Vivid couldn't verify this app. Refresh the page and try again.");
      error.code = "functions/failed-precondition";
      throw error;
    }

    let idToken, appCheckResult;
    try {
      [idToken, appCheckResult] = await Promise.all([
        user.getIdToken(),
        getLimitedUseToken(appCheck)
      ]);
    } catch (cause) {
      console.warn("Vivid Watch Rooms could not obtain request credentials:", cause);
      const error = new Error("Vivid couldn't obtain your sign-in or app-verification token. Refresh the page and try again.");
      error.code = String(cause?.code || "").startsWith("app-check/")
        ? "functions/failed-precondition"
        : "functions/unauthenticated";
      throw error;
    }
    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Authorization": "Bearer " + idToken,
          "X-Firebase-AppCheck": appCheckResult.token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action, data })
      });
    } catch (cause) {
      console.warn("Vivid Watch Rooms API request failed:", cause);
      throw new Error("Vivid couldn't reach the Watch Rooms service. Check your connection and try again.");
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error("Vivid couldn't read the server response. Please try again."); }
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(payload?.message || "We couldn't complete that action right now. Please try again.");
      error.code = "functions/" + String(payload?.code || "internal");
      throw error;
    }
    return { data: payload.data };
  };
}
