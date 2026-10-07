const SW_PATH = "./service-worker.js";
let deferredInstallPrompt = null;
let activeRegistration = null;
let updateControl = null;
const INSTALL_GUIDE_DISMISSED = "vivid:install-guide:dismissed";
function installGuideDismissed() {
  try { return localStorage.getItem(INSTALL_GUIDE_DISMISSED) === "1"; } catch { return false; }
}
function dismissInstallGuide() {
  try { localStorage.setItem(INSTALL_GUIDE_DISMISSED, "1"); } catch {}
}
function createInstallGuide() {
  if (isStandalone() || installGuideDismissed() || document.querySelector("[data-vivid-install-guide]")) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const modal = document.createElement("div");
  modal.className = "vivid-install-guide";
  modal.dataset.vividInstallGuide = "true";
  modal.innerHTML = '<div class="vivid-install-guide-backdrop" data-install-close></div><section class="vivid-install-guide-card" role="dialog" aria-modal="true" aria-labelledby="vivid-install-title"><button class="vivid-install-guide-close" type="button" aria-label="Close" data-install-close>×</button><span class="vivid-install-guide-kicker">VIVID CINEMA</span><h2 id="vivid-install-title">Take Vivid with you.</h2><p>Add Vivid to your Home Screen for a faster, app-like cinema experience.</p><ol>' +
    (ios ? '<li>Tap <strong>Share</strong> in Safari.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li>' : '<li>Tap <strong>Install app</strong> when your browser offers it.</li><li>Confirm <strong>Install</strong>.</li>') +
    '</ol><button class="vivid-install-guide-done" type="button" data-install-close>Got it</button></section>';
  document.body.appendChild(modal);
  const close = () => { dismissInstallGuide(); modal.remove(); };
  modal.querySelectorAll("[data-install-close]").forEach(el => el.addEventListener("click", close));
  if (ios) window.setTimeout(() => modal.isConnected && !installGuideDismissed() && modal.classList.add("is-visible"), 900);
  else modal.classList.add("is-visible");
  window.addEventListener("appinstalled", close, { once: true });
}


function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;
}

function createInstallControl() {
  if (isStandalone() || document.querySelector("[data-vivid-install]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "vivid-pwa-install";
  button.dataset.vividInstall = "true";
  button.hidden = true;
  button.setAttribute("aria-label", "Install Vivid Cinema");
  button.innerHTML = '<span aria-hidden="true">＋</span><span>Install app</span>';
  document.body.appendChild(button);

  button.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    button.hidden = true;
    if (choice?.outcome === "accepted") window.dispatchEvent(new CustomEvent("vivid:pwa-installed"));
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    button.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    button.hidden = true;
  });
}

function createNetworkStatus() {
  if (document.querySelector("[data-vivid-network-status]")) return;

  const status = document.createElement("div");
  status.className = "vivid-pwa-status";
  status.dataset.vividNetworkStatus = "true";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = navigator.onLine;
  status.textContent = "You're offline. Vivid's saved app shell is still available.";
  document.body.appendChild(status);

  const update = () => {
    status.hidden = navigator.onLine;
    status.textContent = navigator.onLine
      ? "Back online."
      : "You're offline. Vivid's saved app shell is still available.";
    if (navigator.onLine) {
      window.setTimeout(() => { status.hidden = true; }, 2200);
    }
  };

  window.addEventListener("online", update);
  window.addEventListener("offline", update);
}

function createUpdateControl(registration) {
  if (updateControl) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "vivid-pwa-update";
  button.dataset.vividUpdate = "true";
  button.textContent = "Update Vivid";
  button.hidden = true;
  button.setAttribute("aria-label", "Update Vivid Cinema");
  document.body.appendChild(button);
  updateControl = button;

  const markDone = () => {
    try { localStorage.setItem("vivid:update-prompt:v1", "1"); } catch {}
    button.hidden = true;
  };

  const show = () => {
    try {
      if (localStorage.getItem("vivid:update-prompt:v1") === "1") return;
    } catch {}
    button.hidden = false;
  };

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Updating…";
    markDone();
    try { await registration.update(); } catch {}
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  });

  // Existing controlled visitors get this migration prompt once.
  // First-time visitors are never interrupted by it.
  if (navigator.serviceWorker.controller) show();
  if (registration.waiting) show();

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) show();
    });
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "./", updateViaCache: "none" });
    activeRegistration = registration;
    createUpdateControl(registration);

    // Listen before the update check so an activated worker always reloads
    // the document and switches the app shell as one coherent version.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    }, { once: true });

    // iOS Home Screen apps can retain an older worker/cache longer than Safari.
    // updateViaCache:"none" makes the worker update check bypass the HTTP cache.
    void registration.update().catch(() => {});

    return registration;
  } catch (error) {
    console.error("Vivid service worker registration failed:", error);
    return null;
  }
}

function markIosStandalone() {
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && isStandalone()) {
    document.documentElement.classList.add("vivid-ios-standalone");
  }
}

function initPwa() {
  markIosStandalone();
  createInstallControl();
  createNetworkStatus();

  // iOS Safari does not expose beforeinstallprompt, so give users the
  // native Safari "Add to Home Screen" steps instead. Never show the
  // guide inside the installed app or after the user dismissed it.
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isMainCinemaSite = document.body?.dataset?.vividPage === "home";

  if (ios && !isStandalone() && isMainCinemaSite) {
    // Do not interrupt early app-shell paint. The guide appears only after
    // the full main cinema surface is ready and visible.
    const showGuideWhenReady = () => {
      if (document.visibilityState !== "visible" || isStandalone() || installGuideDismissed()) return;
      window.setTimeout(() => {
        if (document.visibilityState === "visible" && !isStandalone() && !installGuideDismissed()) {
          createInstallGuide();
        }
      }, 1800);
    };

    const waitForShell = () => {
      if (document.documentElement.dataset.vividReady === "true") {
        showGuideWhenReady();
        return;
      }
      const observer = new MutationObserver(() => {
        if (document.documentElement.dataset.vividReady !== "true") return;
        observer.disconnect();
        showGuideWhenReady();
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-vivid-ready"] });
    };

    waitForShell();
  }

  if (window.isSecureContext) void registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPwa, { once: true });
} else {
  initPwa();
}

export { registerServiceWorker, activeRegistration };
