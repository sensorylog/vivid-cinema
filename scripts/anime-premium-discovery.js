import { getAnimePage } from "./content.js";
import { tmdbApi } from "./tmdb.js";
import { getImageUrl, normalizeResults } from "./media.js";
import { escapeHtml } from "./utils.js";
import { isAnimeMetadata } from "./anime-eligibility.js";
import { filterAllowedTitles } from "./parental-controls.js";

const $ = id => document.getElementById(id);
const state = { type: "all", sort: "popularity.desc", year: "", query: "", page: 1, totalPages: 1, request: 0 };
const shelves = [
  { id: "vap-popular", title: "Popular right now", sort: "popularity.desc", type: "all" },
  { id: "vap-series", title: "Anime series", sort: "popularity.desc", type: "tv" },
  { id: "vap-films", title: "Anime films", sort: "popularity.desc", type: "movie" },
  { id: "vap-top-rated", title: "Highest rated", sort: "vote_average.desc", type: "all" }
];
const IDENTITY_MASKS = [
  "M120 5 L202 40 L235 112 L208 268 L120 316 L32 268 L5 112 L38 40 Z",
  "M120 4 C150 34 222 45 232 126 C242 214 185 285 120 316 C55 285 -2 214 8 126 C18 45 90 34 120 4 Z",
  "M120 4 L151 40 L212 28 L203 95 L238 146 L192 196 L182 284 L120 316 L58 284 L48 196 L2 146 L37 95 L28 28 L89 40 Z",
  "M120 5 C157 29 220 24 235 95 L205 173 L220 252 L120 316 L20 252 L35 173 L5 95 C20 24 83 29 120 5 Z",
  "M120 4 L224 72 L202 226 L120 316 L38 226 L16 72 Z",
  "M120 4 C173 36 229 67 230 140 C230 220 175 291 120 316 C65 291 10 220 10 140 C11 67 67 36 120 4 Z"
];
let activeItems = [];
let identityCardInstance = 0;

function titleOf(item) { return item.title || item.name || "Untitled anime"; }
function dateOf(item) { return item.release_date || item.first_air_date || item.date || ""; }
function yearOf(item) { return dateOf(item).slice(0, 4) || String(item.year || ""); }
function imageOf(item, size = "w342") { return getImageUrl(item.poster_path || item.backdrop_path, size); }
function unique(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    if (!item || !item.id) return false;
    const key = String(item.media_type || "tv") + ":" + String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function sorted(items, sort) {
  const copy = [...items];
  if (sort === "vote_average.desc") return copy.sort((a,b) => Number(b.vote_average || 0) - Number(a.vote_average || 0) || Number(b.vote_count || b.raw?.vote_count || 0) - Number(a.vote_count || a.raw?.vote_count || 0));
  if (sort === "first_air_date.desc") return copy.sort((a,b) => yearOf(b).localeCompare(yearOf(a)) || dateOf(b).localeCompare(dateOf(a)));
  return copy.sort((a,b) => Number(b.raw?.popularity || b.popularity || 0) - Number(a.raw?.popularity || a.popularity || 0));
}
function titleUrl(item) {
  return "anime-premium-title.html?id=" + encodeURIComponent(item.id) + "&type=" + encodeURIComponent(item.media_type || "tv");
}
function card(item) {
  const title = titleOf(item);
  const poster = imageOf(item);
  const type = item.media_type === "movie" ? "FILM" : "SERIES";
  return '<a class="vap-title-card" href="' + escapeHtml(titleUrl(item)) + '" aria-label="Explore ' + escapeHtml(title) + '">' +
    '<span class="vap-poster-wrap">' + (poster ? '<img loading="lazy" decoding="async" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(title) + ' poster">' : '<span class="vap-poster-fallback">VIVID</span>') +
    '<span class="vap-card-type">' + type + '</span><span class="vap-card-play" aria-hidden="true">↗</span></span>' +
    '<span class="vap-card-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(yearOf(item) || "Anime") + ' · ★ ' + (Number(item.vote_average) ? Number(item.vote_average).toFixed(1) : "—") + '</small></span></a>';
}
function identityCard(item) {
  const title = titleOf(item);
  const poster = imageOf(item, "w500");
  const key = String(item.media_type || "tv") + ":" + String(item.id);
  let seed = 0;
  for (const char of key) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const maskId = "vap-identity-" + (++identityCardInstance);
  const path = IDENTITY_MASKS[seed % IDENTITY_MASKS.length];
  const type = item.media_type === "movie" ? "ANIME FILM" : "ANIME SERIES";
  return '<a class="vap-identity-card" href="' + escapeHtml(titleUrl(item)) + '" aria-label="Explore ' + escapeHtml(title) + '">' +
    '<span class="vap-identity-art">' +
      (poster ? '<svg class="vap-identity-svg" viewBox="0 0 240 320" aria-hidden="true"><defs><clipPath id="' + maskId + '"><path d="' + path + '"/></clipPath></defs><path d="' + path + '" fill="#2a203a"/><image href="' + escapeHtml(poster) + '" width="240" height="320" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + maskId + ')"/></svg><img class="vap-identity-mobile-poster" loading="lazy" decoding="async" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(title) + ' poster">' : '<span class="vap-identity-fallback">VIVID</span>') +
      '<span class="vap-identity-shade"></span><span class="vap-identity-stamp">VAP / ' + String((seed % 90) + 10) + '</span>' +
    '</span><span class="vap-identity-copy"><small>' + type + '</small><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(yearOf(item) || "Premium collection") + '</span></span></a>';
}
function renderShelf(container, items) {
  if (!container) return;
  container.innerHTML = items.length ? items.map(identityCard).join("") : '<p class="vap-inline-empty">No titles are available in this collection right now.</p>';
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
    return { shelf, items: sorted(result.items || [], shelf.sort).slice(0, 12) };
  });
  const results = await Promise.allSettled(jobs);
  const all = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    renderShelf($(result.value.shelf.id), result.value.items);
    all.push(...result.value.items);
  }
  const registered = setItems(all);
  const identityItems = unique(registered).slice(0, 9);
  const identityRail = $("vap-identities");
  if (identityRail) identityRail.innerHTML = identityItems.length ? identityItems.map(identityCard).join("") : '<p class="vap-inline-empty">Signature anime identities will appear here.</p>';
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
  setItems([item]);
}
async function searchAnime(query, page = 1) {
  const response = await tmdbApi.searchMulti(query, page);
  const raw = (response.results || []).filter(item =>
    ["movie", "tv"].includes(item.media_type) &&
    isAnimeMetadata(item) &&
    (state.type === "all" || item.media_type === state.type) &&
    (!state.year || yearOf(item) === state.year)
  );
  return {
    items: await filterAllowedTitles(raw.flatMap(item => normalizeResults([item], item.media_type))),
    totalPages: Math.min(500, Number(response.total_pages || 1))
  };
}
function updateStatus(message) {
  const node = $("vap-catalogue-status");
  if (node) node.textContent = message;
}
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
      result = await searchAnime(query, state.page);
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
    const markup = items.length ? items.map(identityCard).join("") : '<div class="vap-empty-state"><strong>No anime found</strong><span>Try a different title, year or filter.</span></div>';
    if (reset) $("vap-catalogue-grid").innerHTML = markup;
    else $("vap-catalogue-grid").insertAdjacentHTML("beforeend", markup);
    state.totalPages = Number(result.totalPages || 1);
    $("vap-load-more").hidden = state.page >= state.totalPages;
    updateStatus(query
      ? "Showing " + activeItems.length + " matching anime titles · page " + state.page + " of " + state.totalPages
      : "Showing page " + state.page + " of " + state.totalPages + (result.partial ? " · Some catalogue sources did not respond." : ""));
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
    state.type = button.dataset.vapCollection;
    document.querySelectorAll("[data-vap-type]").forEach(item => {
      const active = item.dataset.vapType === state.type;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    $("vap-catalogue").scrollIntoView({ behavior: "smooth", block: "start" });
    loadCatalogue(true);
  }));
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
  populateYears();
  $("vap-hero-open").addEventListener("click", () => {
    const [type, id] = $("vap-hero-open").dataset.vapTitle.split(":");
    if (id) window.location.href = "anime-premium-title.html?id=" + encodeURIComponent(id) + "&type=" + encodeURIComponent(type);
    else $("vap-catalogue").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  loadShelves().then(() => loadCatalogue(true)).catch(error => {
    console.warn("Vivid Anime Premium discovery initialization failed:", error);
    loadCatalogue(true);
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
