import { VIVID_CONFIG } from "./config.js";
import { clearActiveProfileId, getActiveProfileId, hasActiveProfileSelection, listProfiles } from "./profiles.js";
import { applyPerformanceProfile } from "./performance-profile.js";
import { resolveAndroidBackAction } from "./android-navigation.js";
import "./movie-quick-actions.js";

// Apply the same hardware-aware visual profile in browsers and Electron.
// Electron preload may already have applied it; the helper is idempotent.
applyPerformanceProfile();

const MOBILE_BREAKPOINT = 768;
let initialized = false;

const NAV_STACK_KEY = "vivid:navigation-stack:v1";

function currentRoute() {
  return location.pathname + location.search + location.hash;
}

function readNavigationStack() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(NAV_STACK_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(route => {
      if (typeof route !== "string") return false;
      try { return new URL(route, location.origin).origin === location.origin; }
      catch { return false; }
    }).slice(-40) : [];
  } catch { return []; }
}

function writeNavigationStack(stack) {
  try { sessionStorage.setItem(NAV_STACK_KEY, JSON.stringify(stack.slice(-40))); }
  catch {}
}

function recordCurrentRoute() {
  const route = currentRoute();
  const stack = readNavigationStack();
  if (stack.at(-1) === route) return;
  const previousIndex = stack.lastIndexOf(route);
  if (previousIndex >= 0) stack.splice(previousIndex + 1);
  else stack.push(route);
  writeNavigationStack(stack);
}

function trackInternalNavigation(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest?.("a[href]");
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download") ||
      link.hasAttribute("data-vivid-back") || link.hasAttribute("data-no-page-transition")) return;
  let destination;
  try { destination = new URL(link.href, location.href); } catch { return; }
  if (destination.origin !== location.origin || !["http:", "https:"].includes(destination.protocol)) return;
  const route = destination.pathname + destination.search + destination.hash;
  if (route === currentRoute()) return;
  const stack = readNavigationStack();
  if (stack.at(-1) !== route) {
    stack.push(route);
    writeNavigationStack(stack);
  }
}

function navigateToPreviousVividPage(event) {
  const back = event.target.closest?.("[data-vivid-back]");
  if (!back || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const current = currentRoute();
  const stack = readNavigationStack();
  while (stack.length && stack.at(-1) === current) stack.pop();
  const previous = stack.at(-1);
  if (previous) {
    event.preventDefault();
    writeNavigationStack(stack);
    location.assign(new URL(previous, location.origin).href);
    return;
  }
  try {
    const referrer = document.referrer ? new URL(document.referrer, location.href) : null;
    if (history.length > 1 && referrer?.origin === location.origin) {
      event.preventDefault();
      history.back();
    }
  } catch {}
}


function setStandaloneExperience() {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;
  if (!standalone) return;

  document.documentElement.classList.add("vivid-standalone");
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (!ios) return;

  document.documentElement.classList.add("vivid-ios-standalone");
  let statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (!statusBar) {
    statusBar = document.createElement("meta");
    statusBar.name = "apple-mobile-web-app-status-bar-style";
    document.head.appendChild(statusBar);
  }
  statusBar.content = "black-translucent";
}

function initStandaloneBackGesture() {
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (!standalone || !ios || window.matchMedia?.("(pointer: coarse)")?.matches === false) return;

  let start = null;
  const ignored = target => target?.closest?.(
    "input, textarea, select, button, a, video, iframe, [contenteditable='true'], " +
    "[data-no-swipe-back], .vivid-rail, .vivid-player-frame, .vivid-player-dialog"
  );

  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1 || ignored(event.target)) {
      start = null;
      return;
    }
    const touch = event.touches[0];
    if (touch.clientX > 22 || touch.clientY < 54) {
      start = null;
      return;
    }
    const stack = readNavigationStack();
    if (stack.length < 2) {
      start = null;
      return;
    }
    start = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, { passive: true });

  document.addEventListener("touchend", event => {
    if (!start || event.changedTouches.length !== 1) {
      start = null;
      return;
    }
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Date.now() - start.time;
    start = null;
    if (dx < 112 || Math.abs(dy) > 76 || elapsed > 700) return;
    const stack = readNavigationStack();
    const current = currentRoute();
    while (stack.length && stack.at(-1) === current) stack.pop();
    if (!stack.length) return;
    writeNavigationStack(stack);
    history.back();
  }, { passive: true });

  document.addEventListener("touchcancel", () => { start = null; }, { passive: true });
}

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

function isCollectionType(type) {
  return currentPage() === "collection" && new URLSearchParams(location.search).get("collection") === type;
}

function africanStoriesNavLink(active = false) {
  return '<a class="vivid-african-stories-link" href="african-stories.html"' + (active ? ' aria-current="page"' : '') + '><i class="bi bi-globe2" aria-hidden="true"></i><span>African Stories</span><small class="vivid-nav-development">In Development</small></a>';
}

function navLink(href, icon, label, active = false) {
  return '<a href="' + href + '"' + (active ? ' aria-current="page"' : '') + '><i class="bi ' + icon + '" aria-hidden="true"></i><span>' + label + '</span></a>';
}

function buildPrimaryLinks(page) {
  return [
    navLink("home.html", "bi-house-fill", "Home", page === "home"),
    navLink("collection.html?collection=movies", "bi-film", "Movies", isCollectionType("movies")),
    navLink("collection.html?collection=tv", "bi-tv", "Series", isCollectionType("tv")),
    navLink("anime-premium.html", "bi-stars", "Premium", page.startsWith("anime-premium")),
    navLink("anime.html", "bi-stars", "Free Anime", page === "anime"),
    navLink("live.html", "bi-broadcast-pin", "Live", page === "live"),
    ...(window.vividDownloads?.available ? [navLink("my-downloads.html", "bi-cloud-download", "Offline", page === "downloads-library")] : []),
    africanStoriesNavLink(page === "african-stories"),
    navLink("library.html", "bi-bookmark-fill", "Library", page === "library"),
    '<a id="auth-link" class="vivid-nav-profile" href="account.html" aria-label="Open account"' + (page === "account" ? ' aria-current="page"' : '') + '><i class="bi bi-person-circle" aria-hidden="true"></i><span>Account</span></a>'
  ].join("");
}

function buildSearchControl() {
  return '<a class="vivid-search-trigger vivid-shell-search-link" href="search.html" aria-label="Search Vivid Cinema"><i class="bi bi-search" aria-hidden="true"></i><span>Search</span><kbd>⌘K</kbd></a>';
}

function syncDesktopNavigation() {
  const page = currentPage();
  const nav = document.querySelector(".vivid-nav, .vivid-unified-nav");
  if (!nav) return;

  const notification = nav.querySelector("#release-alert-button");
  const searchControl = nav.querySelector(".vivid-search-trigger, .vivid-nav-search");
  const languageControl = nav.querySelector(".vivid-language, [data-vivid-language], .vivid-language-selector");
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

  const tools = document.createElement("div");
  tools.className = "vivid-nav-tools";
  if (searchControl) tools.appendChild(searchControl);
  else {
    const search = document.createElement("a");
    search.className = "vivid-search-trigger vivid-shell-search-link";
    search.href = "search.html";
    search.setAttribute("aria-label", "Search Vivid Cinema");
    search.innerHTML = '<i class="bi bi-search" aria-hidden="true"></i><span>Search</span>';
    tools.appendChild(search);
  }

  if (notification) tools.appendChild(notification);
  else {
    const alerts = document.createElement("a");
    alerts.className = "vivid-notification-button vivid-shell-notification-link";
    alerts.href = "home.html#release-alert-popover";
    alerts.setAttribute("aria-label", "Open Vivid notifications");
    alerts.innerHTML = '<i class="bi bi-bell" aria-hidden="true"></i>';
    tools.appendChild(alerts);
  }
  nav.appendChild(tools);

  const language = document.createElement("div");
  language.className = "vivid-nav-language-slot";
  if (languageControl) language.appendChild(languageControl);
  nav.appendChild(language);

  nav.classList.remove("vivid-v2-nav");
}

function syncMoreNavigation(nav, page) {
  const menu = document.createElement("div");
  menu.className = "vivid-native-more-menu";
  menu.id = "vivid-more-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "More destinations");
  menu.tabIndex = -1;
  menu.innerHTML = [
    navLink("discover.html", "bi-compass", "Discover", page === "discover"),
    navLink("for-you.html", "bi-stars", "For You", page === "for-you"),
    navLink("anime.html", "bi-stars", "Free Anime", page === "anime"),
    navLink("live.html", "bi-broadcast-pin", "Live", page === "live"),
    navLink("library.html", "bi-bookmark-fill", "Library", page === "library" || page === "downloads-library"),
    africanStoriesNavLink(page === "african-stories"),
    navLink("account.html", "bi-person-circle", "Account", page === "account"),
    navLink("news.html", "bi-newspaper", "News", page === "news"),
    navLink("search.html", "bi-search", "Search", page === "search"),
  ].join("");
  menu.querySelectorAll("a").forEach(link => {
    link.setAttribute("role", "menuitem");
    link.tabIndex = 0;
  });

  const more = nav.querySelector("[data-vivid-more-navigation]");
  if (!more) return;
  const morePages = ["discover", "for-you", "anime", "live", "anime-premium", "library", "downloads-library", "african-stories", "account", "news", "search"];
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-label", "More destinations");
  more.setAttribute("aria-controls", menu.id);
  more.classList.toggle("is-active", morePages.includes(page));
  if (morePages.includes(page)) more.setAttribute("aria-current", "page");
  else more.removeAttribute("aria-current");

  const closeMenu = (restoreFocus = false) => {
    menu.hidden = true;
    more.setAttribute("aria-expanded", "false");
    if (restoreFocus) more.focus({ preventScroll: true });
  };
  more.addEventListener("click", () => {
    const opening = more.getAttribute("aria-expanded") !== "true";
    more.setAttribute("aria-expanded", String(opening));
    menu.hidden = !opening;
  });
  more.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    menu.hidden = false;
    more.setAttribute("aria-expanded", "true");
    menu.querySelector("a")?.focus({ preventScroll: true });
  });
  nav.addEventListener("click", event => {
    if (!event.target.closest("[data-vivid-more-navigation]")) closeMenu();
  });
  menu.addEventListener("click", event => {
    if (event.target.closest("a")) closeMenu();
  });
  menu.addEventListener("keydown", event => {
    const items = [...menu.querySelectorAll('a[role="menuitem"]')];
    const current = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    let next = -1;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0 || !items.length) return;
    event.preventDefault();
    items[next].focus({ preventScroll: true });
  });
  document.addEventListener("click", event => {
    if (nav.contains(event.target) || menu.contains(event.target)) return;
    closeMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || menu.hidden) return;
    closeMenu(true);
  });
  document.body.appendChild(menu);
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
    navLink("collection.html?collection=movies", "bi-film", "Movies", isCollectionType("movies")),
    navLink("collection.html?collection=tv", "bi-tv", "Series", isCollectionType("tv")),
    navLink("anime-premium.html", "bi-stars", "Premium", page.startsWith("anime-premium")),
    '<button type="button" data-vivid-more-navigation aria-label="More destinations"><i class="bi bi-three-dots" aria-hidden="true"></i><span>More</span></button>'
  ].join("");
  syncMoreNavigation(nav, page);
  nav.classList.add("vivid-v2-mobile-nav");
}

function syncNavigation() {
  syncDesktopNavigation();
  syncMobileNavigation();
}

const PROFILE_SESSION_UID_KEY = "vivid:profile-session-uid:v1";
const PROFILE_RETURN_TO_KEY = "vivid:profile-return-to:v1";

function rememberProfileReturnRoute() {
  const page = location.pathname.split("/").filter(Boolean).pop() || "home.html";
  if (["profiles.html", "auth.html", "login.html", "forgot-password.html", "auth-diagnostics.html", "verify-email.html", "anime-premium-return.html"].includes(page)) return;
  try { sessionStorage.setItem(PROFILE_RETURN_TO_KEY, currentRoute()); } catch {}
}

async function enforceProfileSelection(user) {
  if (!user?.uid) return;
  const page = location.pathname.split("/").filter(Boolean).pop() || "home.html";
  if (["profiles.html", "auth.html", "login.html", "forgot-password.html", "auth-diagnostics.html", "verify-email.html", "anime-premium-return.html"].includes(page)) return;
  const redirectToProfiles = () => {
    rememberProfileReturnRoute();
    if (page !== "profiles.html") window.location.replace("profiles.html");
  };
  if (!hasActiveProfileSelection(user.uid)) {
    redirectToProfiles();
    return;
  }
  try {
    const profiles = await listProfiles(user);
    const activeId = getActiveProfileId(user.uid);
    if (!profiles.some(profile => profile.id === activeId)) {
      clearActiveProfileId(user.uid);
      redirectToProfiles();
      return;
    }
    if (page === "auth.html") window.location.replace("home.html");
  } catch (error) {
    console.warn("Vivid could not validate the active viewing profile:", error);
    if (!hasActiveProfileSelection(user.uid)) redirectToProfiles();
  }
}

function syncAccountNavigation() {
  // The shared shell rebuilds the header on every page, so account routing must
  // follow Firebase's restored session instead of a hard-coded sign-up URL.
  void (async () => {
    try {
      const [{ auth }, { onAuthStateChanged }] = await Promise.all([
        import("./firebase.js"),
        import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
      ]);

      // Do not route returning users to sign-in while Firebase is restoring its saved session.
      if (typeof auth.authStateReady === "function") await auth.authStateReady();

      onAuthStateChanged(auth, (user) => {
        let previousUid = "";
        try { previousUid = localStorage.getItem(PROFILE_SESSION_UID_KEY) || ""; } catch {}
        if (previousUid && previousUid !== String(user?.uid || "")) clearActiveProfileId(previousUid);
        if (user?.uid) {
          try { localStorage.setItem(PROFILE_SESSION_UID_KEY, String(user.uid)); } catch {}
        } else {
          if (previousUid) clearActiveProfileId(previousUid);
          try { localStorage.removeItem(PROFILE_SESSION_UID_KEY); } catch {}
        }
        const destination = user ? "account.html" : "auth.html";
        document.querySelectorAll("#auth-link, [data-vivid-nav-auth], .vivid-nav-account, .vivid-nav-action").forEach((link) => {
          link.href = destination;
          link.setAttribute("aria-label", user ? "Open account" : "Sign in");
          const label = link.querySelector("span");
          if (label) label.textContent = user ? "Account" : "Sign in";
        });
        window.vividAuthUser = user || null;
        window.vividAuthResolved = true;
        window.dispatchEvent(new CustomEvent("vivid:auth-ready", { detail: user || null }));
        if (user) void enforceProfileSelection(user);
      });
    } catch (error) {
      console.warn("Vivid account navigation could not resolve the auth session:", error);
      document.querySelectorAll("#auth-link, [data-vivid-nav-auth], .vivid-nav-account, .vivid-nav-action")
        .forEach((link) => { if (!link.getAttribute("href")) link.href = "auth.html"; });
    }
  })();
}

function showPostAuthNotice() {
  let message = "";
  try {
    message = sessionStorage.getItem("vivid:auth-success") || "";
    sessionStorage.removeItem("vivid:auth-success");
  } catch {}
  if (!message || document.getElementById("vivid-auth-success")) return;

  const notice = document.createElement("div");
  notice.id = "vivid-auth-success";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 16px)",
    left: "50%",
    transform: "translateX(-50%)",
    width: "max-content",
    maxWidth: "min(92vw, 560px)",
    boxSizing: "border-box",
    zIndex: "2147483000",
    padding: "14px 18px",
    border: "1px solid rgba(126, 231, 135, .45)",
    borderRadius: "14px",
    background: "rgba(15, 24, 19, .97)",
    color: "#b7f7c0",
    boxShadow: "0 12px 36px rgba(0, 0, 0, .35)",
    font: "600 14px/1.45 system-ui, sans-serif",
    textAlign: "center",
    opacity: "0",
    transition: "opacity 180ms ease"
  });
  document.body.appendChild(notice);
  requestAnimationFrame(() => { notice.style.opacity = "1"; });
  window.setTimeout(() => {
    notice.style.opacity = "0";
    window.setTimeout(() => notice.remove(), 220);
  }, 5200);
}

function initThemeToggle() {
  // Theme remains available to the document state, but the app shell stays
  // visually identical to the compact mobile navigation. Do not inject the
  // legacy light/dark control into app-page headers.
  if (currentPage() !== "landing") return;
  const root = document.documentElement;
  const nav = document.querySelector(".landing-header");
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
  let authorMeta = document.querySelector('meta[name="author"]');
  if (!authorMeta) {
    authorMeta = document.createElement("meta");
    authorMeta.name = "author";
    document.head.appendChild(authorMeta);
  }
  authorMeta.content = "Johnson Kyei Baffour";

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
  const isWindowsDesktop = window.vividDownloads?.available === true;
  if (isWindowsDesktop) {
    if (page === "landing") return;
    const stack = readNavigationStack();
    let hasInternalPreviousPage = stack.length > 1 && stack.at(-1) === currentRoute();
    try {
      const previous = document.referrer ? new URL(document.referrer, location.href) : null;
      hasInternalPreviousPage ||= previous?.origin === location.origin &&
        (previous.pathname + previous.search + previous.hash) !== currentRoute();
    } catch {}
    if (page === "home" && !hasInternalPreviousPage) return;
  } else if (["home", "landing", "live"].includes(page)) {
    return;
  }
  const back = document.createElement("a");
  back.className = "vivid-page-back";
  back.href = "home.html";
  back.dataset.vividBack = "true";
  back.innerHTML = '<span aria-hidden="true">‹</span><span>Back</span>';
  main.prepend(back);
}

function initNativeBackNavigation() {
  let native = false;
  try { native = Boolean(window.Capacitor?.isNativePlatform?.()); } catch {}
  if (!native || window.__vividNativeBackNavigationReady) return;

  const plugin = window.Capacitor?.Plugins?.VividNavigation;
  if (!plugin?.addListener || typeof plugin.exitApp !== "function") return;
  window.__vividNativeBackNavigationReady = true;

  plugin.addListener("backButton", ({ canGoBack = false } = {}) => {
    // Dismiss the top native HTML dialog before navigating away from its page.
    const dialogs = [...document.querySelectorAll("dialog[open]")];
    const activeDialog = dialogs.at(-1);
    if (activeDialog) {
      activeDialog.close();
      return;
    }

    const moreMenu = document.querySelector(".vivid-native-more-menu:not([hidden])");
    if (moreMenu) {
      moreMenu.hidden = true;
      document.querySelector("[data-vivid-more-navigation]")?.setAttribute("aria-expanded", "false");
      return;
    }

    const playerOverlay = document.querySelector("#player-overlay");
    if (playerOverlay && !playerOverlay.hidden) {
      window.dispatchEvent(new CustomEvent("vivid:android-back"));
      return;
    }

    const action = resolveAndroidBackAction({
      currentRoute: currentRoute(),
      stack: readNavigationStack(),
      canGoBack,
      historyLength: history.length
    });

    if (action.type === "route") {
      writeNavigationStack(action.stack);
      location.assign(new URL(action.route, location.origin).href);
      return;
    }
    if (action.type === "history") {
      history.back();
      return;
    }
    void plugin.exitApp().catch(error => {
      console.warn("Vivid could not close the Android activity:", error);
    });
  }).catch(error => {
    window.__vividNativeBackNavigationReady = false;
    console.warn("Vivid Android Back navigation could not initialize:", error);
  });
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

  const visible = (item) => item && item.offsetParent !== null && item.getClientRects().length > 0;
  const railFor = (target) => target.closest(".vivid-rail, .vivid-library-continue-rail, .vivid-library-shelf, .vivid-watch-rec-rail, .vivid-cast-list, .vivid-similar-rail, .vivid-video-rail") || target.parentElement;

  document.addEventListener("keydown", event => {
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
    const target = event.target.closest(selector);
    if (!target || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const rail = railFor(target);
    if (!rail) return;

    const items = [...rail.querySelectorAll(selector)].filter(visible);
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

    // Vertical navigation is scoped to sibling rails/sections instead of the
    // entire document, preventing a Down press from jumping into an unrelated
    // card far below the current shelf.
    const currentRect = target.getBoundingClientRect();
    const currentSection = target.closest("section, main, .vivid-section, .vivid-rail-wrap") || rail.parentElement;
    const candidates = [...(currentSection || document).querySelectorAll(selector)]
      .filter(item => item !== target && visible(item) && railFor(item) !== rail);

    const direction = event.key === "ArrowDown" ? 1 : -1;
    const vertical = candidates
      .map(item => ({ item, rect: item.getBoundingClientRect() }))
      .filter(({ rect }) => direction > 0
        ? rect.top > currentRect.top + 8
        : rect.bottom < currentRect.bottom - 8)
      .map(({ item, rect }) => ({
        item,
        distance:
          Math.abs((rect.left + rect.width / 2) - (currentRect.left + currentRect.width / 2)) +
          Math.abs(rect.top - currentRect.top) * 0.45
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    if (!vertical) return;
    event.preventDefault();
    vertical.item.focus({ preventScroll: true });
    vertical.item.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, true);
}

function ensureDesignSystemStyles() {
  const styles = ["tokens", "typography", "spacing", "motion", "theme"];
  styles.forEach(name => {
    if (document.querySelector(`link[data-vivid-design-system="${name}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `./styles/${name}.css?v=1`;
    link.dataset.vividDesignSystem = name;
    document.head.appendChild(link);
  });
}

function ensureMediaLayoutStyles() {
  if (!document.querySelector('link[data-vivid-media-layout]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./styles/vivid-media-layout.css?v=1";
    link.dataset.vividMediaLayout = "true";
    document.head.appendChild(link);
  }
  if (!document.querySelector('link[data-vivid-premium-experience]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./styles/vivid-premium-experience.css?v=3";
    link.dataset.vividPremiumExperience = "true";
    document.head.appendChild(link);
  }
}

function initHeaderScrollBehavior() {
  const headers = [...document.querySelectorAll(".vivid-topbar, .vivid-unified-header, .vivid-discovery-nav, .vivid-library-nav, .vivid-title-nav, .vivid-watch-nav")];
  if (!headers.length) return;
  let lastY = Math.max(0, window.scrollY || 0);
  let ticking = false;
  const update = () => {
    const y = Math.max(0, window.scrollY || 0);
    const delta = y - lastY;
    headers.forEach(header => {
      header.classList.toggle("is-scrolled", y > 18);
      if (y < 72) header.classList.remove("vivid-header-hidden");
      else if (delta > 7) header.classList.add("vivid-header-hidden");
      else if (delta < -7) header.classList.remove("vivid-header-hidden");
    });
    if (Math.abs(delta) > 2) lastY = y;
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });
  update();
}

function initAppShell() {
  if (initialized) return;
  initialized = true;

  ensureDesignSystemStyles();
  ensureMediaLayoutStyles();
  setStandaloneExperience();
  document.body.classList.add("vivid-app-experience");
  document.documentElement.dataset.vividReady = "false";
  const storedTheme = (() => { try { return localStorage.getItem("vivid:theme"); } catch { return null; } })();
  document.documentElement.dataset.vividTheme = storedTheme === "light" ? "light" : "dark";
  setViewportState();
  setConnectionState();
  setPageIdentity();
  if (window.vividDownloads?.available === true) {
    document.body.classList.add("vivid-windows-desktop");
  }
  syncVividBranding();
  showPostAuthNotice();
  syncNavigation();
  initHeaderScrollBehavior();
  initThemeToggle();
  recordCurrentRoute();
  initNativeBackNavigation();
  ensureBackControl();
  ensureSkipLink();
  initCinematicFocusNavigation();
  initStandaloneBackGesture();

  window.addEventListener("resize", setViewportState, { passive: true });
  window.addEventListener("online", setConnectionState);
  window.addEventListener("offline", setConnectionState);

  document.addEventListener("click", trackInternalNavigation, true);
  document.addEventListener("click", navigateToPreviousVividPage);

  requestAnimationFrame(() => {
    document.documentElement.dataset.vividReady = "true";
    const scheduleIdle = (callback, timeout = 1800) => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(callback, { timeout });
      else window.setTimeout(callback, Math.min(timeout, 900));
    };
    scheduleIdle(() => { syncAccountNavigation(); }, 1200);
    scheduleIdle(() => { void import("./google-tag.js").catch(() => {}); }, 1800);
    scheduleIdle(() => { void import("./achievements.js").catch(error => console.warn("Vivid achievements could not initialize:", error)); }, 2200);
    scheduleIdle(() => { void import("./pwa.js").catch(error => console.warn("Vivid offline support could not initialize:", error)); }, 2400);
    scheduleIdle(() => { void import("./analytics.js").catch(() => {}); }, 3000);
    scheduleIdle(() => { void import("./vivid-pulse.js").catch(error => console.warn("Vivid background telemetry unavailable:", error)); }, 3800);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAppShell, { once: true });
} else {
  initAppShell();
}

export { initAppShell, MOBILE_BREAKPOINT };
