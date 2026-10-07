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
  const appleTouchIconPath = "./icons/vivid-icon-180.png";
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
  let apple = document.querySelector('link[rel="apple-touch-icon"]');
  if (!apple) { apple = document.createElement("link"); apple.rel = "apple-touch-icon"; document.head.appendChild(apple); }
  apple.href = appleTouchIconPath;
  let manifest = document.querySelector('link[rel="manifest"]');
  if (!manifest) { manifest = document.createElement("link"); manifest.rel = "manifest"; document.head.appendChild(manifest); }
  manifest.href = "./manifest.json";

  document.querySelectorAll(".vivid-brand, .vivid-legal-brand, .logo").forEach(brand => {
    if (brand.dataset.vividBrandReady === "true") return;
    brand.dataset.vividBrandReady = "true";
    brand.classList.add("vivid-site-brand");
    brand.innerHTML = '<img class="vivid-brand-icon" src="./icons/vivid-icon.svg" alt="" aria-hidden="true" decoding="async"><span class="vivid-brand-wordmark">Vivid<span>Cinema</span></span>';
    brand.style.display = "inline-flex";
    brand.style.alignItems = "center";
    brand.style.gap = "9px";
  });
}

function currentPage() {
  return document.body?.dataset?.vividPage || document.documentElement.dataset.vividPage || "";
}

function isBrowsePage(page = currentPage()) {
  return ["discover", "collection", "anime"].includes(page);
}

function navLink(href, icon, label, active = false) {
  return '<a href="' + href + '"' + (active ? ' aria-current="page"' : '') + '><i class="bi ' + icon + '" aria-hidden="true"></i><span>' + label + '</span></a>';
}

function buildPrimaryLinks(page) {
  return [
    navLink("home.html", "bi-house-fill", "Home", page === "home"),
    navLink("discover.html", "bi-grid-fill", "Browse", isBrowsePage(page)),
    navLink("library.html", "bi-bookmark-fill", "Library", page === "library"),
    navLink("news.html", "bi-newspaper", "News", page === "news"),
    navLink("search.html", "bi-search", "Search", page === "search")
  ].join("");
}

function buildSearchControl() {
  return '<a class="vivid-search-trigger vivid-shell-search-link" href="search.html" aria-label="Search Vivid Cinema"><i class="bi bi-search" aria-hidden="true"></i><span>Search</span><kbd>⌘K</kbd></a>';
}

function syncDesktopNavigation() {
  const page = currentPage();
  const nav = document.querySelector(".vivid-nav, .vivid-unified-nav");
  if (!nav) return;

  const oldNotification = nav.querySelector("#release-alert-button");
  const oldAuth = nav.querySelector(".vivid-nav-action[data-vivid-nav-auth], #auth-link, #discover-auth, #library-auth, #collection-auth, #title-auth, #watch-auth, .vivid-nav-action");
  const auth = oldAuth || Object.assign(document.createElement("a"), { className: "vivid-nav-action", href: "auth.html", textContent: "Sign in" });
  auth.classList.add("vivid-nav-action");
  if (!auth.getAttribute("href")) auth.setAttribute("href", "auth.html");

  nav.innerHTML = "";
  const brand = document.createElement("a");
  brand.className = "vivid-brand";
  brand.href = "home.html";
  brand.innerHTML = '<img class="vivid-brand-icon" src="./icons/vivid-icon.svg" alt="" aria-hidden="true" decoding="async"><span class="vivid-brand-wordmark">Vivid<span>Cinema</span></span>';
  nav.appendChild(brand);

  const links = document.createElement("div");
  links.className = "vivid-navlinks";
  links.innerHTML = buildPrimaryLinks(page);
  nav.appendChild(links);

  nav.insertAdjacentHTML("beforeend", buildSearchControl());

  if (oldNotification) nav.appendChild(oldNotification);
  nav.appendChild(auth);
  nav.classList.add("vivid-v2-nav");
}

function syncMobileNavigation() {
  const page = currentPage();
  let nav = document.querySelector(".vivid-mobile-nav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "vivid-mobile-nav";
    nav.setAttribute("aria-label", "Mobile navigation");
    document.body.appendChild(nav);
  }
  nav.innerHTML = [
    navLink("home.html", "bi-house-fill", "Home", page === "home"),
    navLink("discover.html", "bi-grid-fill", "Browse", isBrowsePage(page)),
    navLink("library.html", "bi-bookmark-fill", "Library", page === "library"),
    navLink("news.html", "bi-newspaper", "News", page === "news"),
    navLink("search.html", "bi-search", "Search", page === "search")
  ].join("");
  nav.classList.add("vivid-v2-mobile-nav");
}

function syncNavigation() {
  syncDesktopNavigation();
  syncMobileNavigation();
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

function ensureSkipLink() {
  const main = document.querySelector("main");
  if (!main) return;
  if (!main.id) main.id = "main-content";
  if (document.querySelector(".vivid-skip-link")) return;
  const skip = document.createElement("a");
  skip.className = "vivid-skip-link";
  skip.href = "#" + main.id;
  skip.textContent = "Skip to main content";
  document.body.prepend(skip);
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
  const main = document.querySelector("main");
  if (!main || document.querySelector("[data-vivid-back]")) return;
  const page = document.body?.dataset?.vividPage || "";
  if (["home", "landing"].includes(page)) return;
  const back = document.createElement("a");
  back.className = "vivid-page-back";
  back.href = "home.html";
  back.dataset.vividBack = "true";
  back.innerHTML = '<span aria-hidden="true">‹</span><span>Back</span>';
  main.prepend(back);
}

function initCinematicFocusNavigation() {
  const selector = [
    ".vivid-card[tabindex]",
    ".vivid-feature-card[tabindex]",
    ".vivid-cast[tabindex]",
    ".vivid-similar-card[tabindex]",
    ".vivid-video-card[tabindex]",
    ".vivid-watch-rec-card[tabindex]"
  ].join(",");
  document.addEventListener("keydown", event => {
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
    const target = event.target.closest(selector);
    if (!target || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest("input,textarea,select,button,a") && !target.matches("a")) return;
    const rail = target.parentElement;
    if (!rail) return;
    const items = [...rail.querySelectorAll(selector)].filter(item => item.offsetParent !== null);
    const index = items.indexOf(target);
    if (index < 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const nextIndex = index + (event.key === "ArrowRight" ? 1 : -1);
      if (!items[nextIndex]) return;
      event.preventDefault();
      items[nextIndex].focus({ preventScroll: true });
      items[nextIndex].scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      return;
    }
    const currentRect = target.getBoundingClientRect();
    const candidates = [...document.querySelectorAll(selector)].filter(item => item !== target && item.offsetParent !== null);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const vertical = candidates
      .map(item => ({ item, rect: item.getBoundingClientRect() }))
      .filter(({rect}) => direction > 0 ? rect.top > currentRect.top + 8 : rect.bottom < currentRect.bottom - 8)
      .map(({item,rect}) => ({
        item,
        distance: Math.abs((rect.left + rect.width/2) - (currentRect.left + currentRect.width/2)) +
          Math.abs(rect.top - currentRect.top) * 0.35
      }))
      .sort((a,b) => a.distance - b.distance)[0];
    if (!vertical) return;
    event.preventDefault();
    vertical.item.focus({ preventScroll: true });
    vertical.item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, true);
}

function initAppShell() {
  if (initialized) return;
  initialized = true;

  document.documentElement.dataset.vividReady = "false";
  void import("./analytics.js").catch(() => {});
  const storedTheme = (() => { try { return localStorage.getItem("vivid:theme"); } catch { return null; } })();
  document.documentElement.dataset.vividTheme = storedTheme === "light" ? "light" : "dark";
  setViewportState();
  setConnectionState();
  setPageIdentity();
  syncVividBranding();
  syncNavigation();
  initThemeToggle();
  ensureBackControl();
  ensureSkipLink();
  initCinematicFocusNavigation();

  window.addEventListener("resize", setViewportState, { passive: true });
  window.addEventListener("online", setConnectionState);
  window.addEventListener("offline", setConnectionState);

  document.addEventListener("click", event => {
    const back = event.target.closest("[data-vivid-back]");
    if (!back) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.history.length > 1) {
      try {
        const ref = document.referrer ? new URL(document.referrer, location.href) : null;
        if (ref?.origin === location.origin) { event.preventDefault(); window.history.back(); }
      } catch {}
    }
  });

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
