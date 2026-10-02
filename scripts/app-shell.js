import "./analytics.js";
import { VIVID_CONFIG } from "./config.js";

const MOBILE_BREAKPOINT = 768;
let initialized = false;

function setViewportState() {
  document.documentElement.dataset.viewport =
    window.innerWidth < MOBILE_BREAKPOINT ? "mobile" : "desktop";
}

function setConnectionState() {
  document.documentElement.dataset.network =
    navigator.onLine ? "online" : "offline";
}

function setPageIdentity() {
  const page = document.body?.dataset?.vividPage || "unknown";
  document.documentElement.dataset.vividPage = page;
  document.documentElement.dataset.vividApp = "vivid-cinema";
  if (!document.title || document.title === "Welcome to Vivid Cinema") {
    document.title = page === "home" ? "Home · Vivid Cinema" : VIVID_CONFIG.appName;
  }
}

function initAppShell() {
  if (initialized) return;
  initialized = true;

  document.documentElement.dataset.vividReady = "false";
  document.documentElement.dataset.vividTheme = "cinematic";
  setViewportState();
  setConnectionState();
  setPageIdentity();

  window.addEventListener("resize", setViewportState, { passive: true });
  window.addEventListener("online", setConnectionState);
  window.addEventListener("offline", setConnectionState);

  document.addEventListener("click", event => { const back=event.target.closest("[data-vivid-back]"); if(!back) return; if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return; if(window.history.length>1){event.preventDefault();window.history.back();} });

  requestAnimationFrame(() => {
    document.documentElement.dataset.vividReady = "true";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAppShell, { once: true });
} else {
  initAppShell();
}

export { initAppShell, MOBILE_BREAKPOINT };
