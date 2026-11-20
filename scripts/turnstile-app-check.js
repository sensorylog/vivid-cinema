const ENDPOINT = "/api/app-check";
let scriptPromise = null;
let configPromise = null;
let tokenExchangePromise = null;
let cachedAppCheckToken = null;

function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => window.turnstile?.render
      ? resolve(window.turnstile)
      : reject(new Error("Cloudflare browser verification did not initialize."));
    script.onerror = () => reject(new Error("Cloudflare browser verification could not load."));
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

async function runManagedChallenge(siteKey) {
  const turnstile = await loadTurnstile();
  if (!document.body) {
    await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Secure Vivid browser verification");
    overlay.style.cssText = [
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
    heading.textContent = "Verifying this browser";
    heading.style.cssText = "margin:0 0 8px;font-size:18px;font-weight:700";
    const description = document.createElement("p");
    description.textContent = "Vivid uses Cloudflare's secure check to protect your account and library.";
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
  return { token: payload.token, expireTimeMillis: payload.expireTimeMillis };
}

// Firebase App Check caches the returned token until it needs renewal. Share
// only the in-flight exchange so one single-use Turnstile token is never
// redeemed twice by concurrent Firebase service requests.
export function getTurnstileAppCheckToken() {
  if (cachedAppCheckToken?.expireTimeMillis > Date.now() + 60_000) {
    return Promise.resolve(cachedAppCheckToken);
  }
  if (!tokenExchangePromise) {
    tokenExchangePromise = exchangeTurnstileProof().then(token => {
      cachedAppCheckToken = token;
      return token;
    }).finally(() => {
      tokenExchangePromise = null;
    });
  }
  return tokenExchangePromise;
}
