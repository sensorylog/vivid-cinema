import { getAnimePage } from "./content.js";
import { tmdbApi } from "./tmdb.js";
import { getImageUrl, normalizeResults } from "./media.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const state = { type: "all", sort: "popularity.desc", year: "", query: "", page: 1, totalPages: 1, request: 0 };
const shelves = [
  { id: "vap-popular", title: "Popular right now", sort: "popularity.desc", type: "all" },
  { id: "vap-series", title: "Anime series", sort: "popularity.desc", type: "tv" },
  { id: "vap-films", title: "Anime films", sort: "popularity.desc", type: "movie" },
  { id: "vap-top-rated", title: "Highest rated", sort: "vote_average.desc", type: "all" }
];
let activeItems = [];
let heroTimer = null;

function titleOf(item) { return item.title || item.name || "Untitled anime"; }
function dateOf(item) { return item.release_date || item.first_air_date || ""; }
function yearOf(item) { return dateOf(item).slice(0, 4); }
function imageOf(item, size = "w342") { return getImageUrl(item.poster_path || item.backdrop_path, size); }
function unique(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = String(item.media_type || "tv") + ":" + String(item.id || "");
    if (!item?.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function sorted(items, sort) {
  const copy = [...items];
  if (sort === "vote_average.desc") return copy.sort((a,b) => Number(b.vote_average || 0) - Number(a.vote_average || 0) || Number(b.vote_count || 0) - Number(a.vote_count || 0));
  if (sort === "first_air_date.desc") return copy.sort((a,b) => yearOf(b).localeCompare(yearOf(a)));
  return copy.sort((a,b) => Number(b.raw?.popularity || b.popularity || 0) - Number(a.raw?.popularity || a.popularity || 0));
}
function card(item) {
  const title = titleOf(item);
  const poster = imageOf(item);
  const type = item.media_type === "movie" ? "FILM" : "SERIES";
  return '<button class="vap-title-card" type="button" data-vap-title="' + escapeHtml(item.media_type + ":" + item.id) + '" aria-label="View ' + escapeHtml(title) + '">' +
    '<span class="vap-poster-wrap">' + (poster ? '<img loading="lazy" decoding="async" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(title) + ' poster">' : '<span class="vap-poster-fallback">VIVID</span>') +
    '<span class="vap-card-tag">PREMIUM</span><span class="vap-card-type">' + type + '</span><span class="vap-card-play" aria-hidden="true">↗</span></span>' +
    '<span class="vap-card-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(yearOf(item) || "Anime") + ' · ★ ' + (Number(item.vote_average) ? Number(item.vote_average).toFixed(1) : "—") + '</small></span></button>';
}
function renderShelf(container, items) {
  if (!container) return;
  container.innerHTML = items.length ? items.map(card).join("") : '<p class="vap-inline-empty">No titles are available in this collection right now.</p>';
}
function showDialog(item) {
  const dialog = $("vap-title-dialog");
  if (!dialog || !item) return;
  const title = titleOf(item);
  const backdrop = getImageUrl(item.backdrop_path || item.poster_path, "w1280");
  const art = $("vap-dialog-art");
  art.style.backgroundImage = backdrop ? 'linear-gradient(0deg,#100e18 0%,rgba(16,14,24,.35) 65%,rgba(16,14,24,.05)),url("' + backdrop.replace(/["\\]/g, "") + '")' : "linear-gradient(135deg,#30204b,#100e18)";
  $("vap-dialog-title").textContent = title;
  $("vap-dialog-meta").textContent = (item.media_type === "movie" ? "Anime film" : "Anime series") + " · " + (yearOf(item) || "Release year unavailable") + " · ★ " + (Number(item.vote_average) ? Number(item.vote_average).toFixed(1) : "—");
  $("vap-dialog-overview").textContent = item.overview || "A synopsis for this title is not available yet.";
  $("vap-dialog-access").textContent = "This is a Premium catalogue preview. Playback and membership access will be enabled through the verified Vivid account system.";
  dialog.showModal();
}
function bindCards() {
  document.querySelectorAll("[data-vap-title]").forEach(button => {
    if (button.id === "vap-hero-open" || button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const [type, id] = button.dataset.vapTitle.split(":");
      const item = activeItems.find(entry => String(entry.media_type || "tv") === type && String(entry.id) === id) ||
        window.__vividAnimePremiumItems?.find(entry => String(entry.media_type || "tv") === type && String(entry.id) === id);
      if (item) showDialog(item);
      else {
        const cached = window.__vividAnimePremiumById?.[type + ":" + id];
        if (cached) showDialog(cached);
      }
    });
  });
}
function setItems(items) {
  const clean = unique(items);
  const registry = new Map(Object.entries(window.__vividAnimePremiumById || {}));
  clean.forEach(item => registry.set((item.media_type || "tv") + ":" + item.id, item));
  window.__vividAnimePremiumItems = [...registry.values()];
  window.__vividAnimePremiumById = Object.fromEntries(registry);
  return clean;
}
async function loadShelves() {
  const jobs = shelves.map(async shelf => {
    const result = await getAnimePage(1, { type: shelf.type, sort_by: shelf.sort });
    const items = sorted(result.items || [], shelf.sort).slice(0, 12);
    return { shelf, items };
  });
  const results = await Promise.allSettled(jobs);
  const all = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { shelf, items } = result.value;
    renderShelf($(shelf.id), items);
    all.push(...items);
  }
  setItems(all);
  bindCards();
  const featured = sorted(all, "popularity.desc").find(item => item.backdrop_path) || all[0];
  if (featured) setHero(featured);
}
function setHero(item) {
  const hero = $("vap-hero");
  const image = getImageUrl(item.backdrop_path || item.poster_path, "w1280");
  if (hero && image) hero.style.setProperty("--vap-hero-image", 'url("' + image.replace(/["\\]/g, "") + '")');
  $("vap-hero-title").textContent = titleOf(item);
  $("vap-hero-copy").textContent = item.overview || "Discover a new favourite from the Vivid Anime Premium catalogue.";
  $("vap-hero-meta").textContent = (item.media_type === "movie" ? "FEATURED ANIME FILM" : "FEATURED ANIME SERIES") + " · " + (yearOf(item) || "VIVID ANIME");
  $("vap-hero-open").dataset.vapTitle = (item.media_type || "tv") + ":" + item.id;
  activeItems = setItems([item, ...(window.__vividAnimePremiumItems || [])]);
  bindCards();
}
async function searchAnime(query, page = 1) {
  const response = await tmdbApi.searchMulti(query, page);
  const raw = (response.results || []).filter(item =>
    ["movie", "tv"].includes(item.media_type) &&
    (item.original_language === "ja" || (item.genre_ids || []).includes(16))
  );
  return raw.flatMap(item => normalizeResults([item], item.media_type));
}
function updateStatus(message) { const node = $("vap-catalogue-status"); if (node) node.textContent = message; }
async function loadCatalogue(reset = true) {
  const request = ++state.request;
  if (reset) state.page = 1;
  const query = state.query.trim();
  updateStatus(query ? "Searching anime…" : "Loading the catalogue…");
  $("vap-catalogue-grid").setAttribute("aria-busy", "true");
  $("vap-load-more").disabled = true;
  try {
    let result;
    if (query) {
      const items = await searchAnime(query, state.page);
      result = { items, totalPages: items.length ? 1 : 0 };
    } else {
      result = await getAnimePage(state.page, {
        type: state.type === "all" ? "" : state.type,
        sort_by: state.sort,
        year: state.year || undefined
      });
    }
    if (request !== state.request) return;
    const items = sorted(result.items || [], state.sort);
    const combined = reset ? items : [...activeItems, ...items];
    activeItems = setItems(combined);
    $("vap-catalogue-grid").innerHTML = items.length ? items.map(card).join("") : '<div class="vap-empty-state"><strong>No anime found</strong><span>Try a different title, year or filter.</span></div>';
    if (!reset && items.length) {
      const prior = $("vap-catalogue-grid").dataset.previousHtml || "";
      $("vap-catalogue-grid").innerHTML = prior + items.map(card).join("");
    }
    $("vap-catalogue-grid").dataset.previousHtml = $("vap-catalogue-grid").innerHTML;
    state.totalPages = Number(result.totalPages || 1);
    $("vap-load-more").hidden = Boolean(query) || state.page >= state.totalPages;
    updateStatus(query ? items.length + " matching anime titles" : "Showing page " + state.page + " of " + state.totalPages + (result.partial ? " · Some catalogue sources did not respond." : ""));
    bindCards();
  } catch (error) {
    if (request !== state.request) return;
    updateStatus("The catalogue could not load. Please try again.");
    if (reset) $("vap-catalogue-grid").innerHTML = '<div class="vap-empty-state"><strong>Anime is taking a moment</strong><span>Check your connection and try again.</span><button type="button" id="vap-retry">Retry</button></div>';
    $("vap-load-more").hidden = true;
    console.warn("Vivid Anime Premium catalogue request failed:", error);
  } finally {
    if (request === state.request) {
      $("vap-catalogue-grid").removeAttribute("aria-busy");
      $("vap-load-more").disabled = false;
    }
  }
}
function bindFilters() {
  document.querySelectorAll("[data-vap-type]").forEach(button => button.addEventListener("click", () => {
    state.type = button.dataset.vapType;
    document.querySelectorAll("[data-vap-type]").forEach(item => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    loadCatalogue(true);
  }));
  $("vap-sort").addEventListener("change", event => { state.sort = event.target.value; loadCatalogue(true); });
  $("vap-year").addEventListener("change", event => { state.year = event.target.value; loadCatalogue(true); });
  $("vap-search-form").addEventListener("submit", event => {
    event.preventDefault();
    state.query = $("vap-search").value.trim().slice(0, 80);
    loadCatalogue(true);
    $("vap-catalogue").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("vap-search-clear").addEventListener("click", () => {
    $("vap-search").value = "";
    state.query = "";
    loadCatalogue(true);
  });
  $("vap-load-more").addEventListener("click", () => { state.page += 1; loadCatalogue(false); });
  $("vap-catalogue-grid").addEventListener("click", event => {
    if (event.target.closest("#vap-retry")) loadCatalogue(true);
  });
  document.querySelectorAll("[data-vap-collection]").forEach(button => button.addEventListener("click", () => {
    const type = button.dataset.vapCollection;
    state.type = type;
    document.querySelectorAll("[data-vap-type]").forEach(item => {
      const active = item.dataset.vapType === type;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    $("vap-catalogue").scrollIntoView({ behavior: "smooth", block: "start" });
    loadCatalogue(true);
  }));
}
function bindDialog() {
  const dialog = $("vap-title-dialog");
  $("vap-dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  $("vap-dialog-account").addEventListener("click", () => {
    window.location.href = "auth.html?returnTo=anime-premium.html";
  });
}
function populateYears() {
  const select = $("vap-year");
  const current = new Date().getFullYear();
  for (let year = current; year >= 1970; year--) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    select.append(option);
  }
}
function init() {
  bindFilters();
  bindDialog();
  populateYears();
  $("vap-hero-open").addEventListener("click", () => {
    const [type, id] = $("vap-hero-open").dataset.vapTitle.split(":");
    const item = window.__vividAnimePremiumById?.[type + ":" + id];
    if (item) showDialog(item);
  });
  loadShelves().then(() => loadCatalogue(true)).catch(error => {
    console.warn("Vivid Anime Premium discovery initialization failed:", error);
    loadCatalogue(true);
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
