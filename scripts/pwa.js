const SW_PATH = "./service-worker.js";
let deferredInstallPrompt = null;
let activeRegistration = null;
let updateControl = null;

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
  document.body.appendChild(button);
  updateControl = button;

  button.addEventListener("click", () => {
    if (!registration.waiting) return;
    button.disabled = true;
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  });

  const show = () => { button.hidden = false; };
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
    const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "./" });
    activeRegistration = registration;
    createUpdateControl(registration);
    // Check for a fresh worker immediately so visual/code fixes are not held behind
    // a long-lived cached shell. The new worker still takes control normally.
    void registration.update().catch(() => {});

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    }, { once: true });

    return registration;
  } catch (error) {
    console.error("Vivid service worker registration failed:", error);
    return null;
  }
}

function initPwa() {
  createInstallControl();
  createNetworkStatus();
  if (window.isSecureContext) void registerServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPwa, { once: true });
} else {
  initPwa();
}

export { registerServiceWorker, activeRegistration };
