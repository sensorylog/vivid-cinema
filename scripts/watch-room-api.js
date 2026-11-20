import { auth } from "./firebase.js";

const API_URL = "/api/watch-rooms";
const SESSION_REFRESH_SKEW_MS = 60_000;
let turnstileScriptPromise = null;
let turnstileConfigPromise = null;
let cachedRoomSession = null;
let attestationInFlight = null;

function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => window.turnstile?.render
      ? resolve(window.turnstile)
      : reject(new Error("Cloudflare browser verification did not load. Please reload and try again."));
    script.onerror = () => reject(new Error("Cloudflare browser verification could not load. Check your connection or content blocker."));
    document.head.append(script);
  }).catch(error => {
    turnstileScriptPromise = null;
    throw error;
  });
  return turnstileScriptPromise;
}

async function getTurnstileConfig() {
  if (!turnstileConfigPromise) {
    turnstileConfigPromise = fetch(API_URL, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    }).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true || typeof payload.siteKey !== "string" || !payload.siteKey) {
        throw new Error(payload?.message || "Watch Rooms browser verification is not configured yet.");
      }
      return payload;
    }).catch(error => {
      turnstileConfigPromise = null;
      throw error;
    });
  }
  return turnstileConfigPromise;
}

async function completeTurnstileChallenge(siteKey) {
  const turnstile = await loadTurnstile();
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Secure browser verification");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483000", "display:grid",
      "place-items:center", "padding:24px", "background:rgba(5,8,16,.82)",
      "backdrop-filter:blur(8px)"
    ].join(";");
    const panel = document.createElement("section");
    panel.style.cssText = [
      "width:min(100%,380px)", "padding:24px", "border:1px solid rgba(255,255,255,.14)",
      "border-radius:18px", "background:#111827", "color:#fff", "font:500 15px/1.5 system-ui,sans-serif",
      "box-shadow:0 24px 80px rgba(0,0,0,.45)", "text-align:center"
    ].join(";");
    const heading = document.createElement("h2");
    heading.textContent = "Securing your Watch Room";
    heading.style.cssText = "margin:0 0 8px;font-size:18px;font-weight:700";
    const description = document.createElement("p");
    description.textContent = "Cloudflare is checking this browser before connecting you to your private space.";
    description.style.cssText = "margin:0 0 16px;color:#cbd5e1;font-size:13px";
    const mount = document.createElement("div");
    mount.style.cssText = "display:flex;justify-content:center;min-height:65px";
    panel.append(heading, description, mount);
    overlay.append(panel);
    document.body.append(overlay);

    let widgetId = null;
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("Browser verification timed out. Please try again.")), 90_000);
    function finish(error, token) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (widgetId !== null) {
        try { turnstile.remove(widgetId); } catch {}
      }
      overlay.remove();
      if (error) reject(error);
      else resolve(token);
    }

    try {
      widgetId = turnstile.render(mount, {
        sitekey: siteKey,
        action: "watch_rooms",
        execution: "execute",
        appearance: "interaction-only",
        callback: token => finish(null, token),
        "error-callback": () => finish(new Error("Cloudflare couldn't verify this browser. Please retry the check.")),
        "expired-callback": () => finish(new Error("Browser verification expired. Please try again."))
      });
      turnstile.execute(widgetId);
    } catch (error) {
      finish(new Error("Cloudflare browser verification could not start. Please reload and try again."));
    }
  });
}

async function getRoomSession(user, idToken) {
  if (
    cachedRoomSession?.uid === user.uid &&
    cachedRoomSession.expiresAt > Date.now() + SESSION_REFRESH_SKEW_MS
  ) return cachedRoomSession.token;

  if (attestationInFlight?.uid === user.uid) return attestationInFlight.promise;

  const promise = (async () => {
    const config = await getTurnstileConfig();
    const turnstileToken = await completeTurnstileChallenge(config.siteKey);
    const response = await fetch(API_URL, {
      method: "POST",
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Authorization": "Bearer " + idToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "attestBrowser", data: { turnstileToken } })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true || typeof payload?.data?.sessionToken !== "string") {
      const error = new Error(payload?.message || "Vivid couldn't verify this browser. Please try again.");
      error.code = "functions/" + String(payload?.code || "failed-precondition");
      throw error;
    }
    cachedRoomSession = {
      uid: user.uid,
      token: payload.data.sessionToken,
      expiresAt: Number(payload.data.expiresAt) || Date.now() + SESSION_REFRESH_SKEW_MS
    };
    return cachedRoomSession.token;
  })().finally(() => {
    if (attestationInFlight?.promise === promise) attestationInFlight = null;
  });
  attestationInFlight = { uid: user.uid, promise };
  return promise;
}

async function sendRoomRequest(action, data, idToken, sessionToken) {
  return fetch(API_URL, {
    method: "POST",
    mode: "same-origin",
    credentials: "omit",
    cache: "no-store",
    headers: {
      "Authorization": "Bearer " + idToken,
      "X-Vivid-Room-Session": sessionToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, data })
  });
}

export function callWatchRoomApi(action) {
  return async (data = {}) => {
    // Wait for Firebase's initial persisted session before deciding that the
    // user is signed out. The Watch Rooms attestation is separate from the
    // Firebase App Check provider used by Auth/Firestore elsewhere in Vivid.
    if (typeof auth.authStateReady === "function") await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) {
      const error = new Error("Please sign in to your Vivid account and try again.");
      error.code = "functions/unauthenticated";
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

    let sessionToken = await getRoomSession(user, idToken);
    let response;
    try {
      response = await sendRoomRequest(action, data, idToken, sessionToken);
    } catch (cause) {
      console.warn("Vivid Watch Rooms API request failed:", cause);
      throw new Error("Vivid couldn't reach the Watch Rooms service. Check your connection and try again.");
    }

    let payload;
    try { payload = await response.json(); }
    catch { throw new Error("Vivid couldn't read the server response. Please try again."); }

    // The server rejects an expired session before running the requested
    // operation, so a single fresh attestation and retry cannot duplicate a
    // room write or message.
    if (response.status === 401 && payload?.code === "room-session-expired") {
      cachedRoomSession = null;
      sessionToken = await getRoomSession(user, idToken);
      response = await sendRoomRequest(action, data, idToken, sessionToken);
      try { payload = await response.json(); }
      catch { throw new Error("Vivid couldn't read the server response. Please try again."); }
    }

    if (!response.ok || payload?.ok !== true) {
      const error = new Error(payload?.message || "We couldn't complete that action right now. Please try again.");
      error.code = "functions/" + String(payload?.code || "internal");
      throw error;
    }
    return { data: payload.data };
  };
}
