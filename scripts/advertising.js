const AD_CONFIG = Object.freeze({
  enabled: true,
  nativeBanner: true,
  socialBar: true,
  // A visitor can see up to two native placements on one browsing page,
  // with a conservative session cap across page navigation.
  maxNativeRequestsPerSession: 8,
  maxNativePlacementsPerPage: 2,
  socialBarSrc: "https://bancadeltempoidea.org/14/51cedddacdb3782114144ec932519319",
  // Best-effort browser-side cap: load the provider tag at most once per
  // browser profile every 24 hours. This limits tag loads, not impressions
  // generated internally by the provider after the tag has loaded.
  popunder: Object.freeze({
    enabled: true,
    src: "https://aarems.org/1/afc16a6f6fd987b460882c312398d244",
    maxScriptLoadsPerVisitorMs: 24 * 60 * 60 * 1000,
    eligiblePages: Object.freeze(["home", "discover", "collection", "for-you", "anime"])
  }),
  nativeBannerUnits: Object.freeze({
    primary: Object.freeze({
      enabled: true,
      src: "https://bancadeltempoidea.org/21/ccca2189b46a42d139aaf46fcf6e4ca9",
      containerId: "container-ccca2189b46a42d139aaf46fcf6e4ca9"
    }),
    // Activate only after a separate Native Banner zone is created in Adsterra.
    // Never duplicate the primary zone's script or container ID.
    secondary: Object.freeze({
      enabled: false,
      src: "",
      containerId: ""
    })
  })
});

const PAGE_PLACEMENTS = Object.freeze({
  home: [
    { key: "primary", unit: "primary", selector: ".vivid-catalogue-explore", position: "after" },
    { key: "secondary", unit: "secondary", selector: "#top-10", position: "after" }
  ],
  discover: [
    { key: "primary", unit: "primary", selector: ".vivid-discovery-results", position: "after" },
    { key: "secondary", unit: "secondary", selector: ".vivid-discovery-filters", position: "after" }
  ],
  collection: [
    { key: "primary", unit: "primary", selector: "#collection-grid", position: "after-parent" },
    { key: "secondary", unit: "secondary", selector: ".vivid-collection-toolbar", position: "after" }
  ],
  "for-you": [
    { key: "primary", unit: "primary", selector: "#recommendation-grid", position: "after-parent" },
    { key: "secondary", unit: "secondary", selector: ".vivid-for-you-controls", position: "after" }
  ],
  anime: [
    { key: "primary", unit: "primary", selector: "#anime-grid", position: "after-parent" },
    { key: "secondary", unit: "secondary", selector: ".vivid-anime-controls", position: "after" }
  ]
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
    const count = Number(sessionStorage.getItem("vivid:native-ad-requests") || 0);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

function wasPlacementRequested(page, placementKey) {
  try {
    return sessionStorage.getItem(`vivid:native-ad-requested:${page}:${placementKey}`) === "true";
  } catch {
    return false;
  }
}

function markPlacementRequested(page, placementKey) {
  try {
    sessionStorage.setItem(`vivid:native-ad-requested:${page}:${placementKey}`, "true");
    sessionStorage.setItem("vivid:native-ad-requests", String(nativeRequestCount() + 1));
  } catch {}
}

function createNativePlacement(page, placement, index) {
  const unit = AD_CONFIG.nativeBannerUnits[placement.unit];
  if (!unit?.enabled || !unit.src || !unit.containerId) return;
  if (index >= AD_CONFIG.maxNativePlacementsPerPage) return;
  if (nativeRequestCount() >= AD_CONFIG.maxNativeRequestsPerSession) return;
  if (wasPlacementRequested(page, placement.key)) return;

  const anchor = document.querySelector(placement.selector);
  if (!anchor) return;

  const slotId = `vivid-native-ad-slot-${page}-${placement.key}`;
  if (document.getElementById(slotId) || document.getElementById(unit.containerId)) return;

  const slot = document.createElement("aside");
  slot.className = "vivid-ad-slot";
  slot.id = slotId;
  slot.setAttribute("aria-label", "Sponsored content");
  slot.dataset.vividAdSlot = "native";
  slot.dataset.vividAdPlacement = placement.key;
  slot.innerHTML = '<div class="vivid-ad-slot__label">Sponsored</div><div class="vivid-ad-slot__surface"><div class="vivid-ad-slot__loading" aria-hidden="true"></div></div>';

  if (placement.position === "after-parent") anchor.parentElement?.after(slot);
  else anchor.after(slot);
  if (!slot.isConnected) return;

  const load = () => {
    if (!slot.isConnected || slot.dataset.adRequested === "true") return;
    if (nativeRequestCount() >= AD_CONFIG.maxNativeRequestsPerSession) {
      slot.remove();
      return;
    }
    slot.dataset.adRequested = "true";
    markPlacementRequested(page, placement.key);

    const surface = slot.querySelector(".vivid-ad-slot__surface");
    if (!surface) return;
    const container = document.createElement("div");
    container.id = unit.containerId;
    container.className = "vivid-native-ad-container";
    surface.replaceChildren(container);

    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("fetchpriority", "low");
    script.dataset.cfasync = "false";
    script.src = unit.src;
    script.onerror = () => {
      slot.dataset.adState = "unavailable";
      slot.classList.add("is-unavailable");
      slot.setAttribute("aria-hidden", "true");
    };
    script.onload = () => {
      slot.dataset.adState = "loaded";
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

function createNativePlacements() {
  const page = currentPage();
  const placements = PAGE_PLACEMENTS[page];
  if (!AD_CONFIG.enabled || !AD_CONFIG.nativeBanner || !placements || EXCLUDED_PAGES.has(page)) return;
  placements.forEach((placement, index) => createNativePlacement(page, placement, index));
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

function loadPopunder(page) {
  // Redirecting pop-under ads are disabled in the Windows desktop app only.
  // Native banners and the social bar retain their existing behavior.
  if (window.vividDownloads?.available) return;
  const config = AD_CONFIG.popunder;
  // The provider tag is loaded at most once per browser profile per 24h.
  // This is a best-effort tag-load cap; only the provider can cap its
  // internally generated impressions after a tag has loaded.
  if (!config?.enabled || !config.src) return;
  if (!config.eligiblePages.includes(page) || EXCLUDED_PAGES.has(page)) return;

  const storageKey = "vivid:popunder:last-script-load";
  try {
    const lastLoaded = Number(localStorage.getItem(storageKey) || 0);
    if (Number.isFinite(lastLoaded) && lastLoaded > 0 &&
        Date.now() - lastLoaded < config.maxScriptLoadsPerVisitorMs) return;
    // Record before insertion so reloads cannot repeatedly request the tag.
    localStorage.setItem(storageKey, String(Date.now()));
  } catch {
    // Fail closed when storage is unavailable; do not load an uncapped popunder.
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.dataset.cfasync = "false";
  script.dataset.vividPopunder = "true";
  script.src = config.src;
  document.head.append(script);
}

function initVividAdvertising() {
  const page = currentPage();
  if (EXCLUDED_PAGES.has(page)) return;
  createNativePlacements();
  loadPopunder(page);
  loadSocialBar();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initVividAdvertising, { once: true });
} else {
  initVividAdvertising();
}

export { AD_CONFIG, initVividAdvertising };
