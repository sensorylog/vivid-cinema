const AD_CONFIG = Object.freeze({
  enabled: true,
  nativeBanner: true,
  socialBar: true,
  maxNativeRequestsPerSession: 2,
  socialBarSrc: "https://bancadeltempoidea.org/14/51cedddacdb3782114144ec932519319",
  nativeBannerSrc: "https://bancadeltempoidea.org/21/ccca2189b46a42d139aaf46fcf6e4ca9",
  nativeContainerId: "container-ccca2189b46a42d139aaf46fcf6e4ca9"
});

const PAGE_PLACEMENTS = Object.freeze({
  home: { selector: ".vivid-catalogue-explore", position: "after" },
  discover: { selector: ".vivid-discovery-results", position: "after" },
  collection: { selector: "#collection-grid", position: "after-parent" },
  "for-you": { selector: "#recommendation-grid", position: "after-parent" },
  anime: { selector: "#anime-grid", position: "after-parent" }
});
const EXCLUDED_PAGES = new Set([
  "watch", "watch-room", "watch-rooms", "live", "login", "auth", "signup",
  "verify-email", "forgot-password", "account", "offline"
]);

function currentPage() {
  return document.body?.dataset.vividPage ||
    location.pathname.split("/").pop()?.replace(/\.html$/i, "") || "home";
}

function nativeRequestCount() {
  try {
    return Number(sessionStorage.getItem("vivid:native-ad-requests") || 0) || 0;
  } catch {
    return 0;
  }
}

function createNativePlacement() {
  const page = currentPage();
  const placement = PAGE_PLACEMENTS[page];
  if (!AD_CONFIG.enabled || !AD_CONFIG.nativeBanner || !placement || EXCLUDED_PAGES.has(page)) return;
  if (nativeRequestCount() >= AD_CONFIG.maxNativeRequestsPerSession) return;
  if (document.getElementById("vivid-native-ad-slot")) return;

  const anchor = document.querySelector(placement.selector);
  if (!anchor) return;

  const slot = document.createElement("aside");
  slot.className = "vivid-ad-slot";
  slot.id = "vivid-native-ad-slot";
  slot.setAttribute("aria-label", "Sponsored content");
  slot.dataset.vividAdSlot = "native";
  slot.innerHTML = '<div class="vivid-ad-slot__label">Sponsored</div><div class="vivid-ad-slot__surface"><div class="vivid-ad-slot__loading" aria-hidden="true"></div></div>';

  if (placement.position === "after-parent") anchor.parentElement?.after(slot);
  else anchor.after(slot);
  if (!slot.isConnected) return;

  const load = () => {
    if (!slot.isConnected || slot.dataset.adRequested === "true") return;
    slot.dataset.adRequested = "true";
    try {
      sessionStorage.setItem("vivid:native-ad-requests", String(nativeRequestCount() + 1));
    } catch {}
    const surface = slot.querySelector(".vivid-ad-slot__surface");
    if (!surface) return;
    const container = document.createElement("div");
    container.id = AD_CONFIG.nativeContainerId;
    container.className = "vivid-native-ad-container";
    surface.replaceChildren(container);

    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("fetchpriority", "low");
    script.dataset.cfasync = "false";
    script.src = AD_CONFIG.nativeBannerSrc;
    script.onerror = () => {
      slot.dataset.adState = "unavailable";
      slot.classList.add("is-unavailable");
      slot.setAttribute("aria-hidden", "true");
    };
    surface.append(script);
    slot.dataset.adState = "requested";
  };

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    }, { rootMargin: "500px 0px", threshold: 0.01 });
    observer.observe(slot);
  } else {
    window.setTimeout(load, 1800);
  }
}

function loadSocialBar() {
  const page = currentPage();
  if (!AD_CONFIG.enabled || !AD_CONFIG.socialBar || EXCLUDED_PAGES.has(page) || !PAGE_PLACEMENTS[page]) return;
  if (document.querySelector('script[data-vivid-social-bar="true"]')) return;
  const script = document.createElement("script");
  script.src = AD_CONFIG.socialBarSrc;
  script.async = true;
  script.dataset.cfasync = "false";
  script.dataset.vividSocialBar = "true";
  document.body.append(script);
}

function initVividAdvertising() {
  const page = currentPage();
  if (EXCLUDED_PAGES.has(page)) return;
  createNativePlacement();
  loadSocialBar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initVividAdvertising, { once: true });
} else {
  initVividAdvertising();
}

export { AD_CONFIG, initVividAdvertising };
