import { getCloudflareApiUrl } from "./cloudflare-api.js";

const ENDPOINT = getCloudflareApiUrl("/api/app-check");
let scriptPromise = null;
let configPromise = null;
let tokenExchangePromise = null;

function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = (error, turnstile) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve(turnstile);
      }
    };
    const timeout = window.setTimeout(
      () => finish(new Error("Cloudflare browser verification took too long to load. Check your connection or content blocker, then retry.")),
      12_000
    );
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => window.turnstile?.render
      ? finish(null, window.turnstile)
      : finish(new Error("Cloudflare browser verification did not initialize."));
    script.onerror = () => finish(new Error("Cloudflare browser verification could not load. Check your connection or content blocker, then retry."));
    document.head.append(script);
  }).catch(error => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

async function getConfig() {
  if (!configPromise) {
    configPromise = fetch(ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    }).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true || typeof payload.siteKey !== "string" || !payload.siteKey) {
        throw new Error(payload?.message || "Secure browser verification is not configured yet.");
      }
      return payload;
    }).catch(error => {
      configPromise = null;
      throw error;
    });
  }
  return configPromise;
}

const SIGNUP_CHALLENGE_KEY = "vivid:signup-verification";

function isSignupChallenge() {
  try { return sessionStorage.getItem(SIGNUP_CHALLENGE_KEY) === "1"; }
  catch { return false; }
}

function clearSignupChallenge() {
  try { sessionStorage.removeItem(SIGNUP_CHALLENGE_KEY); } catch {}
}

async function runManagedChallenge(siteKey) {
  const turnstile = await loadTurnstile();
  if (!document.body) {
    await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return new Promise((resolve, reject) => {
    const showSignupOverlay = isSignupChallenge();
    let host = document.createElement("div");
    let mount = document.createElement("div");

    if (showSignupOverlay) {
      host.setAttribute("role", "dialog");
      host.setAttribute("aria-modal", "true");
      host.setAttribute("aria-label", "Secure Vivid account verification");
      host.style.cssText = [
        "position:fixed", "inset:0", "z-index:2147483000", "display:grid",
        "place-items:center", "padding:24px", "background:rgba(5,8,16,.82)",
        "backdrop-filter:blur(8px)"
      ].join(";");

      const panel = document.createElement("section");
      panel.style.cssText = [
        "width:min(100%,380px)", "padding:24px", "border:1px solid rgba(255,255,255,.14)",
        "border-radius:18px", "background:#111827", "color:#fff",
        "font:500 15px/1.5 system-ui,sans-serif", "box-shadow:0 24px 80px rgba(0,0,0,.45)",
        "text-align:center"
      ].join(";");
      const heading = document.createElement("h2");
      heading.textContent = "Securing your Vivid account";
      heading.style.cssText = "margin:0 0 8px;font-size:18px;font-weight:700";
      const description = document.createElement("p");
      description.textContent = "A quick browser security check helps protect your new account and library.";
      description.style.cssText = "margin:0 0 16px;color:#cbd5e1;font-size:13px";
      mount.style.cssText = "display:flex;justify-content:center;min-height:65px";
      panel.append(heading, description, mount);
      host.append(panel);
    } else {
      // Public browsing and ordinary returning sessions must never be blocked
      // by a full-screen verification gate. Managed Turnstile stays quiet
      // unless Cloudflare itself decides that an interaction is necessary.
      host.setAttribute("aria-label", "Browser security verification");
      host.style.cssText = [
        "position:fixed", "right:16px", "bottom:16px", "z-index:2147483000",
        "display:flex", "justify-content:center", "min-width:0", "min-height:0",
        "pointer-events:auto"
      ].join(";");
      mount.style.cssText = "display:flex;justify-content:center;min-height:0";
      host.append(mount);
    }

    document.body.append(host);

    let widgetId = null;
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error("Browser verification timed out. Please retry.")), 20_000);
    function finish(error, token) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (widgetId !== null) {
        try { turnstile.remove(widgetId); } catch {}
      }
      host.remove();
      if (error) reject(error);
      else resolve(token);
    }

    try {
      widgetId = turnstile.render(mount, {
        sitekey: siteKey,
        action: "vivid_app_check",
        execution: "execute",
        appearance: "interaction-only",
        callback: token => finish(null, token),
        "error-callback": () => finish(new Error("Cloudflare couldn't verify this browser. Please retry.")),
        "expired-callback": () => finish(new Error("Browser verification expired. Please try again."))
      });
      turnstile.execute(widgetId);
    } catch {
      finish(new Error("Cloudflare browser verification could not start. Please reload and try again."));
    }
  });
}

async function exchangeTurnstileProof() {
  const config = await getConfig();
  const turnstileToken = await runManagedChallenge(config.siteKey);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    mode: "same-origin",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstileToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (
    !response.ok ||
    payload?.ok !== true ||
    typeof payload.token !== "string" ||
    !Number.isFinite(payload.expireTimeMillis)
  ) {
    throw new Error(payload?.message || "Vivid couldn't complete secure browser verification.");
  }
  clearSignupChallenge();
  return { token: payload.token, expireTimeMillis: payload.expireTimeMillis };
}

// Firebase App Check caches the returned token until it needs renewal. Share
// only the in-flight exchange so one single-use Turnstile token is never
// redeemed twice by concurrent Firebase service requests.
export function getTurnstileAppCheckToken() {
  if (!tokenExchangePromise) {
    tokenExchangePromise = exchangeTurnstileProof().finally(() => {
      tokenExchangePromise = null;
    });
  }
  return tokenExchangePromise;
}
