import "./analytics.js";
import "./pwa.js";
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

function initThemeToggle() {
  const root = document.documentElement;
  const nav = document.querySelector(".vivid-unified-nav, .vivid-nav, .vivid-discovery-nav, .vivid-library-nav, .vivid-title-nav, .vivid-watch-nav, .landing-header");
  if (!nav || nav.querySelector(".vivid-theme-toggle")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "vivid-theme-toggle";
  button.setAttribute("aria-label", "Switch to light mode");
  button.title = "Switch theme";
  button.innerHTML = '<i class="bi bi-sun" aria-hidden="true"></i>';

  const apply = (theme, persist = true) => {
    root.dataset.vividTheme = theme;
    button.innerHTML = theme === "light"
      ? '<i class="bi bi-moon-stars" aria-hidden="true"></i>'
      : '<i class="bi bi-sun" aria-hidden="true"></i>';
    button.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
    if (persist) { try { localStorage.setItem("vivid:theme", theme); } catch {} }
  };

  button.addEventListener("click", () => apply(root.dataset.vividTheme === "light" ? "dark" : "light"));
  apply(root.dataset.vividTheme, false);

  const action = nav.querySelector(".vivid-nav-action, .landing-signin");
  if (action?.parentElement === nav) nav.insertBefore(button, action);
  else nav.appendChild(button);
}

function setPageIdentity() {
  const page = document.body?.dataset?.vividPage || "unknown";
  document.documentElement.dataset.vividPage = page;
  document.documentElement.dataset.vividApp = "vivid-cinema";
  if (!document.title || document.title === "Welcome to Vivid Cinema") {
    document.title = page === "home" ? "Home · Vivid Cinema" : VIVID_CONFIG.appName;
  }
}

function ensureBackControl() {
  // Keep an existing page-specific Back control; create one only when a page lacks it.
  const main=document.querySelector("main");
  if(!main || document.querySelector("[data-vivid-back]")) return;
  const page=document.body?.dataset?.vividPage||"";
  if(["home","landing"].includes(page)) return;
  const back=document.createElement("a");
  back.className="vivid-page-back";
  back.href="home.html";
  back.dataset.vividBack="true";
  back.innerHTML='<span aria-hidden="true">‹</span><span>Back</span>';
  main.prepend(back);
}

function initAppShell() {
  if (initialized) return;
  initialized = true;

  document.documentElement.dataset.vividReady = "false";
  const storedTheme = (() => { try { return localStorage.getItem("vivid:theme"); } catch { return null; } })();
  document.documentElement.dataset.vividTheme = storedTheme === "light" ? "light" : "dark";
  setViewportState();
  setConnectionState();
  setPageIdentity();
  syncVividBranding();
  initThemeToggle();
  ensureBackControl();

  window.addEventListener("resize", setViewportState, { passive: true });
  window.addEventListener("online", setConnectionState);
  window.addEventListener("offline", setConnectionState);

  document.addEventListener("click", event => { const back=event.target.closest("[data-vivid-back]"); if(!back) return; if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey) return; if(window.history.length>1){try{const ref=document.referrer?new URL(document.referrer,location.href):null;if(ref?.origin===location.origin){event.preventDefault();window.history.back();}}catch{}} });

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
