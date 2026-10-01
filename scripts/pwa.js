const SW_PATH = "./service-worker.js";
let deferredInstallPrompt = null;

function createInstallControl() {
  if (document.querySelector("[data-vivid-install]")) return;
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

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register(SW_PATH, { scope: "./" });
  } catch (error) {
    console.error("Vivid service worker registration failed:", error);
  }
}

function initPwa() {
  createInstallControl();
  if (window.isSecureContext) void registerServiceWorker();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPwa, { once: true });
else initPwa();

export { registerServiceWorker };