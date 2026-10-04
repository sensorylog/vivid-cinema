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

function syncVividBranding() {
  const iconPath = "./icons/vivid-icon.svg";
  const applyHeadIcon = (selector, rel, type = null) => {
    let link = document.querySelector(selector);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.href = iconPath;
    if (type) link.type = type;
  };

  applyHeadIcon('link[rel="icon"]', "icon", "image/svg+xml");
  applyHeadIcon('link[rel="apple-touch-icon"]', "apple-touch-icon");
  applyHeadIcon('link[rel="manifest"]', "manifest");

  document.querySelectorAll(".vivid-brand, .vivid-legal-brand, .logo").forEach(brand => {
    if (brand.dataset.vividBrandReady === "true") return;
    brand.dataset.vividBrandReady = "true";
    brand.classList.add("vivid-site-brand");
    brand.innerHTML = '<img class="vivid-brand-icon" src="./icons/vivid-icon.svg" alt="" aria-hidden="true" decoding="async"><span class="vivid-brand-wordmark">Vivid<span>Cinema</span></span>';
    brand.style.display = "inline-flex";
    brand.style.alignItems = "center";
    brand.style.gap = "9px";
    const icon = brand.querySelector(".vivid-brand-icon");
    if (icon) {
      icon.style.width = "32px";
      icon.style.height = "32px";
      icon.style.flex = "0 0 32px";
      icon.style.display = "block";
      icon.style.objectFit = "contain";
    }
  });
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
  syncVividBranding();

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
