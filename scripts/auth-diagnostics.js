const output = document.getElementById("diagnostics-output");
const lines = [];
function add(label, value) {
  lines.push(label + ": " + value);
  output.textContent = lines.join("\n");
}
function errorMessage(error) {
  return String(error?.message || error || "unknown error").replace(/[\r\n]+/g, " ").slice(0, 240);
}
async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
async function runDiagnostics() {
  add("Page origin", window.location.origin);
  add("Browser online flag", navigator.onLine ? "online" : "offline");
  add("Service worker controller", navigator.serviceWorker?.controller ? "active" : "none");
  let config;
  try {
    const response = await fetchWithTimeout("./init.json?auth-diagnostic=" + Date.now(), {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error("init.json returned HTTP " + response.status);
    config = await response.json();
    if (!config?.apiKey || !config?.projectId || !config?.authDomain) {
      throw new Error("Firebase config is missing apiKey, projectId, or authDomain");
    }
    add("Firebase config", "loaded; projectId=" + config.projectId + "; authDomain=" + config.authDomain + "; API key present (value hidden)");
    if (config.projectId !== "vivid-cinema") add("CONFIG WARNING", "expected projectId vivid-cinema; check the deployed init.json");
  } catch (error) {
    add("Firebase config", "FAILED — " + errorMessage(error));
    add("Next clue", "Check init.json deployment, browser network access, and service-worker cache. No Auth API probe was made.");
    return;
  }
  const endpoint = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + encodeURIComponent(config.apiKey);
  try {
    // Empty JSON intentionally omits email and password. This is a non-authenticating API-key/connectivity probe.
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    const code = String(payload?.error?.message || payload?.error?.status || "no structured error");
    if (/MISSING_EMAIL|INVALID_ARGUMENT/i.test(code)) {
      add("Firebase Auth endpoint", "REACHABLE; HTTP " + response.status + "; API key accepted for this request");
      add("Probe response", code + " (expected because this probe intentionally sends no credentials)");
    } else if (/API_KEY_INVALID|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|PROJECT_NOT_FOUND|API_KEY_EXPIRED/i.test(code)) {
      add("Firebase Auth endpoint", "REJECTED; HTTP " + response.status + "; " + code);
      add("Likely next check", "Google Cloud API key restrictions, key status, and Firebase Authentication API access.");
    } else {
      add("Firebase Auth endpoint", "HTTP " + response.status + "; response code=" + code);
      add("Interpretation", "The endpoint responded. Use the response code above to investigate Firebase project/API-key configuration.");
    }
  } catch (error) {
    add("Firebase Auth endpoint", "FAILED — " + errorMessage(error));
    add("Likely next check", "Browser Network/Console for Content Security Policy (CSP), DNS, connection blocking, or an extension/network filter.");
  }
  add("Cloudflare note", "The repository Worker is for plot-search fallback; this probe calls Firebase Auth directly.");
}
document.getElementById("copy-results")?.addEventListener("click", () => {
  const range = document.createRange();
  range.selectNodeContents(output);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});
void runDiagnostics();
