const HOLD_DELAY = 520;
const MOVE_TOLERANCE = 12;
const CARD_SELECTOR = ".vivid-card--poster";
let pending = null;
let suppressClickUntil = 0;
let activeCard = null;
let activeItem = null;
let overlay = null;
let restoreFocus = null;
let sheetStartY = null;
let libraryModulePromise = null;

function getLibraryModule() {
  if (!libraryModulePromise) {
    libraryModulePromise = import("./library.js").catch(error => {
      libraryModulePromise = null;
      throw error;
    });
  }
  return libraryModulePromise;
}

function ensureStyles() {
  if (document.querySelector('link[data-vivid-quick-actions-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/styles/vivid-movie-quick-actions.css";
  link.dataset.vividQuickActionsStyle = "true";
  document.head.appendChild(link);
}

function cardItem(card) {
  if (!card) return null;
  const anchor = card.matches("a[href]") ? card : card.querySelector("a[href]");
  let id = String(card.dataset.id || card.dataset.movieId || "").trim();
  let type = card.dataset.type === "tv" ? "tv" : "movie";

  if (anchor?.href) {
    try {
      const url = new URL(anchor.href, location.href);
      id ||= url.searchParams.get("id") || url.searchParams.get("movieId") || "";
      const queryType = url.searchParams.get("type") || url.searchParams.get("media_type");
      if (queryType === "tv") type = "tv";
      if (queryType === "movie") type = "movie";
    } catch {}
  }
  if (!/^\d+$/.test(id)) return null;

  const titleNode = card.querySelector(
    ".vivid-card-title, .vivid-card-info strong, .vivid-discovery-copy strong, " +
    ".vivid-for-you-copy strong, .vivid-search-page-result strong, " +
    ".vivid-news-search-card strong, .vivid-library-card strong, strong"
  );
  const title = String(card.dataset.title || titleNode?.textContent || card.getAttribute("aria-label") || "Untitled").trim();
  const image = card.querySelector("img");
  let posterPath = "";
  if (image?.src) {
    try {
      const url = new URL(image.src, location.href);
      const match = url.pathname.match(/\/t\/p\/[^/]+(\/.*)$/);
      if (url.hostname === "image.tmdb.org" && match) posterPath = match[1];
    } catch {}
  }
  const meta = card.querySelector(".vivid-card-sub, .vivid-discovery-copy small, small");
  const year = String(card.dataset.year || meta?.textContent?.match(/\b(?:18|19|20)\d{2}\b/)?.[0] || "");
  return {
    id,
    media_type: type,
    title: title.slice(0, 180),
    year,
    poster_path: posterPath,
    backdrop_path: ""
  };
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.className = "vivid-quick-actions-backdrop";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="vivid-quick-actions-panel" role="dialog" aria-modal="true" aria-labelledby="vivid-quick-actions-title">
      <div class="vivid-quick-actions-grabber" aria-hidden="true"></div>
      <header class="vivid-quick-actions-header">
        <img class="vivid-quick-actions-poster" alt="" />
        <div class="vivid-quick-actions-heading">
          <span class="vivid-quick-actions-eyebrow">VIVID LIBRARY</span>
          <h2 id="vivid-quick-actions-title"></h2>
          <p class="vivid-quick-actions-meta">Save this title without leaving your browse session.</p>
        </div>
        <button class="vivid-quick-actions-close" type="button" aria-label="Close quick actions"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
      </header>
      <div class="vivid-quick-actions-list">
        <button class="vivid-quick-action" type="button" data-collection="favorites" aria-pressed="false">
          <span class="vivid-quick-action-icon"><i class="bi bi-heart" aria-hidden="true"></i></span>
          <span class="vivid-quick-action-copy"><strong>Favourites</strong><small>Add to your favourites</small></span>
          <span class="vivid-quick-action-state">Add</span>
        </button>
        <button class="vivid-quick-action" type="button" data-collection="watchLater" aria-pressed="false">
          <span class="vivid-quick-action-icon"><i class="bi bi-clock" aria-hidden="true"></i></span>
          <span class="vivid-quick-action-copy"><strong>Watch Later</strong><small>Keep it for another time</small></span>
          <span class="vivid-quick-action-state">Add</span>
        </button>
      </div>
      <p class="vivid-quick-actions-feedback" role="status" aria-live="polite">Your saved titles stay in My Library.</p>
    </section>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeOverlay();
  });
  overlay.querySelector(".vivid-quick-actions-close").addEventListener("click", closeOverlay);
  const panel = overlay.querySelector(".vivid-quick-actions-panel");
  panel.addEventListener("touchstart", event => {
    sheetStartY = event.target.closest(".vivid-quick-actions-grabber, .vivid-quick-actions-header")
      ? event.touches[0]?.clientY ?? null : null;
  }, { passive: true });
  panel.addEventListener("touchend", event => {
    const endY = event.changedTouches[0]?.clientY;
    if (sheetStartY !== null && Number.isFinite(endY) && endY - sheetStartY > 90) closeOverlay();
    sheetStartY = null;
  }, { passive: true });
  overlay.querySelectorAll("[data-collection]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!activeItem) return;
      const collection = button.dataset.collection;
      button.disabled = true;
      try {
        const library = await getLibraryModule();
        if (!activeItem) return;
        const wasSaved = library.hasLibraryItem(collection, activeItem);
        library.toggleLibraryItem(collection, activeItem);
        updateActionStates(library);
        const label = collection === "favorites" ? "Favourites" : "Watch Later";
        overlay.querySelector(".vivid-quick-actions-feedback").textContent =
          wasSaved ? "Removed from " + label + "." : "Added to " + label + ".";
      } catch {
        overlay.querySelector(".vivid-quick-actions-feedback").textContent =
          "Your library is unavailable right now. Please try again.";
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && overlay && !overlay.hidden) closeOverlay();
  });
  return overlay;
}

function updateActionStates(library) {
  if (!overlay || !activeItem || !library) return;
  overlay.querySelectorAll("[data-collection]").forEach(button => {
    const collection = button.dataset.collection;
    const saved = library.hasLibraryItem(collection, activeItem);
    button.setAttribute("aria-pressed", String(saved));
    button.classList.toggle("is-saved", saved);
    const icon = button.querySelector(".vivid-quick-action-icon i");
    const state = button.querySelector(".vivid-quick-action-state");
    const description = button.querySelector(".vivid-quick-action-copy small");
    if (collection === "favorites") {
      icon.className = saved ? "bi bi-heart-fill" : "bi bi-heart";
      state.textContent = saved ? "Added" : "Add";
      description.textContent = saved ? "Already in your favourites" : "Add to your favourites";
    } else {
      icon.className = saved ? "bi bi-clock-fill" : "bi bi-clock";
      state.textContent = saved ? "Added" : "Add";
      description.textContent = saved ? "Already in Watch Later" : "Keep it for another time";
    }
  });
}

async function openOverlay(card, item) {
  activeCard = card;
  activeItem = item;
  restoreFocus = document.activeElement;
  const view = ensureOverlay();
  const poster = view.querySelector(".vivid-quick-actions-poster");
  const image = card.querySelector("img");
  poster.src = image?.src || "";
  poster.hidden = !image?.src;
  poster.alt = item.title ? item.title + " poster" : "";
  view.querySelector("#vivid-quick-actions-title").textContent = item.title;
  view.querySelector(".vivid-quick-actions-meta").textContent =
    [item.year, item.media_type === "tv" ? "TV series" : "Movie"].filter(Boolean).join(" · ") +
    "  ·  Save without opening details";
  view.querySelector(".vivid-quick-actions-feedback").textContent = "Loading your saved titles…";
  view.querySelectorAll("[data-collection]").forEach(button => { button.disabled = true; });
  view.hidden = false;
  document.body.classList.add("vivid-quick-actions-open");
  view.querySelector("[data-collection='favorites']").focus({ preventScroll: true });
  try {
    const library = await getLibraryModule();
    if (activeItem !== item || view.hidden) return;
    updateActionStates(library);
    view.querySelectorAll("[data-collection]").forEach(button => { button.disabled = false; });
    view.querySelector(".vivid-quick-actions-feedback").textContent = "Your saved titles stay in My Library.";
  } catch {
    view.querySelectorAll("[data-collection]").forEach(button => { button.disabled = false; });
    view.querySelector(".vivid-quick-actions-feedback").textContent = "Your library is unavailable right now. Please try again.";
  }
}

function closeOverlay() {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  document.body.classList.remove("vivid-quick-actions-open");
  activeItem = null;
  activeCard = null;
  if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
  restoreFocus = null;
}

function clearPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending = null;
}

function onPointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false) return;
  if (event.target.closest("button, input, select, textarea, a[data-no-quick-actions]")) return;
  const card = event.target.closest(CARD_SELECTOR);
  if (!card || card.closest(".vivid-quick-actions-backdrop")) return;
  const item = cardItem(card);
  if (!item) return;
  clearPending();
  pending = {
    card,
    item,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    timer: setTimeout(() => {
      if (!pending) return;
      suppressClickUntil = Date.now() + 900;
      void openOverlay(card, item);
      pending = null;
    }, HOLD_DELAY)
  };
}

function onPointerMove(event) {
  if (!pending || event.pointerId !== pending.pointerId) return;
  if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > MOVE_TOLERANCE) clearPending();
}

function onClickCapture(event) {
  if (Date.now() >= suppressClickUntil) return;
  suppressClickUntil = 0;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function init() {
  if (document.documentElement.dataset.vividQuickActionsReady === "true") return;
  document.documentElement.dataset.vividQuickActionsReady = "true";
  ensureStyles();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", clearPending, true);
  document.addEventListener("pointercancel", clearPending, true);
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("contextmenu", event => {
    if (event.target.closest(CARD_SELECTOR) && Date.now() < suppressClickUntil) event.preventDefault();
  }, true);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}

export { cardItem };
