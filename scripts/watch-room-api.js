import { getCloudflareApiUrl } from "./cloudflare-api.js";
import { auth, ensureAppCheck } from "./firebase.js";
import { getToken } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

const API_URL = getCloudflareApiUrl("/api/watch-rooms");

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
    let appCheck;
    try { appCheck = await ensureAppCheck(); }
    catch (cause) {
      const diagnosticCode = String(cause?.code || "appCheck/not-initialized");
      console.error("Vivid Watch Rooms Cloudflare Turnstile verification initialization failed:", {
        hostname: window.location.hostname,
        origin: window.location.origin,
        code: diagnosticCode,
        message: cause?.message || "Cloudflare Turnstile-backed verification did not initialize."
      });
      const error = new Error(
        "Cloudflare browser verification is unavailable (" + diagnosticCode + "). Reload Vivid and try again. If it continues, check the Turnstile widget hostname and Cloudflare Pages configuration."
      );
      error.code = diagnosticCode;
      error.cause = cause || undefined;
      throw error;
    }
    if (!appCheck) {
      const error = new Error("Browser verification is unavailable on this local development host.");
      error.code = "appCheck/not-initialized";
      throw error;
    }

    let idToken;
    try {
      idToken = await user.getIdToken();
    } catch (cause) {
      console.error("Vivid Watch Rooms Firebase ID-token acquisition failed:", {
        code: cause?.code || "unknown",
        message: cause?.message || String(cause)
      });
      const error = new Error(
        String(cause?.code || "").startsWith("auth/")
          ? "Your Vivid sign-in token could not be refreshed. Check your connection and try again."
          : "Vivid couldn't obtain your sign-in token. Check your connection and try again."
      );
      error.code = String(cause?.code || "").startsWith("auth/")
        ? "functions/unauthenticated"
        : "functions/unavailable";
      throw error;
    }

    let appCheckResult;
    try {
      appCheckResult = await getToken(appCheck, false);
    } catch (cause) {
      // Firebase App Check SDK errors use the "appCheck/" namespace (camelCase).
      // Preserve the exact SDK cause in logs for diagnosis without exposing it to users.
      console.error("Vivid Watch Rooms standard App Check token acquisition failed:", {
        code: cause?.code || "unknown",
        message: cause?.message || String(cause)
      });
      const diagnosticCode = String(cause?.code || "appCheck/unknown");
      const error = new Error(
        "Browser verification failed (" + diagnosticCode + "). " +
        (cause?.message || "Check the site's Firebase App Check provider and allowed domains, then reload.")
      );
      error.code = diagnosticCode;
      error.cause = cause;
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
