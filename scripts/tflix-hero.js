/* TFLIX-style trending billboard adapted for Vivid Cinema.
   Each featured title keeps its existing artwork, then plays its own TMDB-listed
   YouTube trailer muted/inline before the billboard advances. */
import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./media.js";

const ARTWORK_HOLD_MS = 2400;
const TRAILER_WINDOW_MS = 30000;
const NO_TRAILER_HOLD_MS = 8000;
const TRAILER_LOAD_FAILSAFE_MS = 40000;
const HERO_BACKDROP_SIZE = () => window.matchMedia("(max-width: 767px)").matches ? "w780" : "w1280";
const trailerCache = new Map();
const legacyPerformance = document.documentElement.classList.contains("vivid-performance-legacy");

let heroSlides = [];
let heroIndex = 0;
let heroTimer = null;
let artworkTimer = null;
let heroRunToken = 0;
let heroSelectionMade = false;

function matchPct(value) {
  const rating = Number(value || 0);
  return rating ? Math.min(99, Math.round(rating * 10)) : null;
}

function year(media) {
  return media?.year || media?.date?.slice(0, 4) || "—";
}

function rating(value) {
  return Number(value) ? Number(value).toFixed(1) : "—";
}

function clearPlaybackTimers() {
  if (heroTimer !== null) window.clearTimeout(heroTimer);
  if (artworkTimer !== null) window.clearTimeout(artworkTimer);
  heroTimer = null;
  artworkTimer = null;
}

function removeHeroVideos() {
  const hero = document.getElementById("hero");
  if (!hero) return;
  hero.querySelectorAll(".hero-trailer-layer").forEach((layer) => layer.remove());
}

function advanceHero() {
  if (heroSlides.length > 1) goToHero(heroIndex + 1);
  else activateCurrentHero();
}

function chooseTrailer(data) {
  const videos = (data?.results || []).filter((video) =>
    video?.site === "YouTube" &&
    typeof video.key === "string" &&
    /^[\w-]{6,}$/.test(video.key)
  );
  const priority = (video) => {
    const type = String(video.type || "").toLowerCase();
    return (video.official ? 0 : 10) +
      (type === "trailer" ? 0 : type === "teaser" ? 2 : type === "clip" ? 4 : 8) +
      (/en(-us)?/i.test(video.iso_639_1 || "") ? 0 : 1);
  };
  videos.sort((a, b) => priority(a) - priority(b));
  return videos[0] || null;
}

function getTrailer(item) {
  const type = item.media_type === "tv" ? "tv" : "movie";
  const cacheKey = type + ":" + String(item.id);
  if (!trailerCache.has(cacheKey)) {
    const request = (type === "tv" ? tmdbApi.tvVideos(item.id) : tmdbApi.movieVideos(item.id))
      .then(chooseTrailer)
      .catch((error) => {
        console.warn("Vivid hero trailer unavailable for " + cacheKey + ":", error);
        return null;
      });
    trailerCache.set(cacheKey, request);
  }
  return trailerCache.get(cacheKey);
}

function activateCurrentHero() {
  clearPlaybackTimers();
  removeHeroVideos();
  const token = ++heroRunToken;
  const item = heroSlides[heroIndex];
  if (!item || document.hidden) return;

  // Legacy PCs keep the cinematic artwork carousel but skip background
  // trailer lookups and remote iframe decoding while the user is browsing.
  if (legacyPerformance) {
    heroTimer = window.setTimeout(advanceHero, NO_TRAILER_HOLD_MS);
    return;
  }

  // Trailer autoplay is an explicit feature of this billboard. Reduced-motion
  // CSS still disables decorative movement, but must not silently disable video.

  // Start looking up the trailer while the artwork is still on screen, so the
  // video can begin promptly after the short artwork-first moment.
  const trailerPromise = getTrailer(item);
  artworkTimer = window.setTimeout(async () => {
    const trailer = await trailerPromise;
    if (token !== heroRunToken || document.hidden) return;

    if (!trailer) {
      // Some catalogue titles have no embeddable trailer; never show a blank hero.
      heroTimer = window.setTimeout(advanceHero, NO_TRAILER_HOLD_MS);
      return;
    }

    const slide = document.querySelectorAll("#hero .hero-slide")[heroIndex];
    if (!slide) return;
    const layer = document.createElement("div");
    layer.className = "hero-trailer-layer";
    layer.setAttribute("aria-hidden", "true");

    const iframe = document.createElement("iframe");
    iframe.className = "hero-trailer-frame";
    iframe.title = "Trailer for " + (item.title || "featured title");
    iframe.loading = "eager";
    iframe.allow = "autoplay; encrypted-media; picture-in-picture";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.tabIndex = -1;
    iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(trailer.key) +
      "?autoplay=1&mute=1&playsinline=1&controls=0&rel=0&modestbranding=1" +
      "&iv_load_policy=3&disablekb=1&fs=0&start=0";
    iframe.addEventListener("load", () => {
      if (token !== heroRunToken || document.hidden || !iframe.isConnected) return;
      layer.classList.add("is-ready");
      if (heroTimer !== null) window.clearTimeout(heroTimer);
      heroTimer = window.setTimeout(advanceHero, TRAILER_WINDOW_MS);
    }, { once: true });

    layer.append(iframe);
    // Keep the artwork visible beneath the video until the iframe has loaded.
    slide.insertBefore(layer, slide.querySelector(".hero-content"));
    heroTimer = window.setTimeout(() => {
      if (token === heroRunToken) advanceHero();
    }, TRAILER_LOAD_FAILSAFE_MS);
  }, ARTWORK_HOLD_MS);
}

function goToHero(index) {
  if (!heroSlides.length) return;
  const next = (index + heroSlides.length) % heroSlides.length;
  if (next === heroIndex) return;

  const hero = document.getElementById("hero");
  const slides = hero?.querySelectorAll(".hero-slide") || [];
  const dots = hero?.querySelectorAll(".hero-dot") || [];
  slides[heroIndex]?.classList.remove("active");
  dots[heroIndex]?.classList.remove("active");
  if (slides[heroIndex]) {
    slides[heroIndex].setAttribute("aria-hidden", "true");
    slides[heroIndex].inert = true;
  }

  heroIndex = next;
  slides[heroIndex]?.classList.add("active");
  dots[heroIndex]?.classList.add("active");
  if (slides[heroIndex]) {
    slides[heroIndex].setAttribute("aria-hidden", "false");
    slides[heroIndex].inert = false;
  }
  dots.forEach((dot, dotIndex) => dot.setAttribute("aria-pressed", String(dotIndex === heroIndex)));

  const bg = slides[heroIndex]?.querySelector(".hero-bg");
  if (bg) {
    bg.style.animation = "none";
    requestAnimationFrame(() => requestAnimationFrame(() => { bg.style.animation = ""; }));
  }

  notifyHeroChange();
  activateCurrentHero();
}

function createSlide(item, index) {
  const title = item.title || "Untitled";
  const type = item.media_type === "tv" ? "tv" : "movie";
  const match = matchPct(item.vote_average);
  const isMovie = type === "movie";
  const slide = document.createElement("article");
  slide.className = "hero-slide" + (index === 0 ? " active" : "");
  slide.setAttribute("aria-label", title);
  slide.setAttribute("aria-hidden", String(index !== 0));
  slide.inert = index !== 0;

  const backdrop = document.createElement("div");
  backdrop.className = "hero-bg";
  backdrop.style.backgroundImage = "url(\"" + getImageUrl(item.backdrop_path, HERO_BACKDROP_SIZE()) + "\")";
  backdrop.setAttribute("aria-hidden", "true");

  const shade = document.createElement("div");
  shade.className = "hero-trailer-shade";
  shade.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "hero-content";

  const badge = document.createElement("div");
  badge.className = "hero-badge";
  const trendingRank = Number(item.trending_rank || 0);
  badge.innerHTML = '<span class="bolt" aria-hidden="true">●</span> ' +
    (trendingRank > 0 ? "#" + trendingRank + " Trending Today" : "Featured on Vivid");

  const heading = document.createElement("h1");
  heading.className = "hero-title";
  heading.textContent = title;

  const meta = document.createElement("div");
  meta.className = "hero-meta";
  if (match) {
    const matchNode = document.createElement("span");
    matchNode.className = "match";
    matchNode.textContent = match + "% Match";
    meta.append(matchNode);
  }
  const yearNode = document.createElement("span");
  yearNode.textContent = year(item);
  const typeNode = document.createElement("span");
  typeNode.className = "chip";
  typeNode.textContent = isMovie ? "FILM" : "SERIES";
  const ratingNode = document.createElement("span");
  ratingNode.textContent = "★ " + rating(item.vote_average);
  meta.append(yearNode, typeNode, ratingNode);

  const overview = document.createElement("p");
  overview.className = "hero-overview";
  overview.textContent = item.overview || "No description available.";

  const actions = document.createElement("div");
  actions.className = "hero-actions";
  const play = document.createElement("a");
  play.className = "btn btn-primary hero-play";
  play.href = getMediaUrl(item);
  play.setAttribute("aria-label", "View details for " + title);
  play.innerHTML = '<svg width="22" height="22" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Play</span>';
  actions.append(play);

  content.append(badge, heading, meta, overview, actions);
  slide.append(backdrop, shade, content);
  return slide;
}

function renderHero(items) {
  const hero = document.getElementById("hero");
  if (!hero) return;
  clearPlaybackTimers();
  heroRunToken += 1;
  hero.replaceChildren();
  heroSlides = items;
  heroIndex = 0;

  items.forEach((item, index) => hero.append(createSlide(item, index)));

  if (items.length > 1) {
    const dots = document.createElement("div");
    dots.className = "hero-dots";
    dots.setAttribute("aria-label", "Choose trending title");
    items.forEach((item, index) => {
      const dot = document.createElement("button");
      dot.className = "hero-dot" + (index === 0 ? " active" : "");
      dot.type = "button";
      dot.setAttribute("aria-label", "Show " + (item.title || "trending title"));
      dot.setAttribute("aria-pressed", String(index === 0));
      dot.addEventListener("click", () => goToHero(index));
      dots.append(dot);
    });
    hero.append(dots);
  }

  hero.classList.toggle("empty", !items.length);
  notifyHeroChange();
  activateCurrentHero();
}

function notifyHeroChange() {
  const item = heroSlides[heroIndex] || null;
  const detail = item ? { id: String(item.id), media_type: item.media_type } : null;
  window.vividCinemaActiveHero = detail;
  window.dispatchEvent(new CustomEvent("vivid:hero-change", { detail }));
}

function selectHeroItem(item) {
  if (!item || item.id == null || !item.backdrop_path) return false;
  heroSelectionMade = true;
  const mediaType = item.media_type === "tv" ? "tv" : "movie";
  const existingIndex = heroSlides.findIndex((slide) =>
    String(slide.id) === String(item.id) && slide.media_type === mediaType
  );
  if (existingIndex >= 0) {
    goToHero(existingIndex);
    return true;
  }

  const selected = { ...item, media_type: mediaType };
  // A manually selected weekly feature is not assigned a false daily-trending rank.
  selected.trending_rank = null;
  heroSlides = [
    selected,
    ...heroSlides.filter((slide) =>
      !(String(slide.id) === String(selected.id) && slide.media_type === mediaType)
    )
  ].slice(0, 5);
  renderHero(heroSlides);
  return true;
}

window.vividCinemaSelectHero = selectHeroItem;

function getHeroItems(data, mediaType) {
  const eligible = (data?.results || []).filter((item) => {
    if (!item?.backdrop_path) return false;
    if (mediaType === "movie") return !item.media_type || item.media_type === "movie";
    return item.media_type === "movie" || item.media_type === "tv";
  });
  return normalizeResults(eligible, mediaType === "movie" ? "movie" : null)
    .filter((item) => item.backdrop_path)
    .slice(0, 5)
    .map((item, index) => ({ ...item, trending_rank: index + 1 }));
}

const HERO_CACHE_KEY = "vivid:home-hero:v1";
const HERO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const HERO_REQUEST_TIMEOUT_MS = 5000;

function readCachedHeroItems() {
  try {
    const entry = JSON.parse(localStorage.getItem(HERO_CACHE_KEY) || "null");
    const age = Date.now() - Number(entry?.savedAt || 0);
    if (!entry || !Number.isFinite(age) || age < 0 || age > HERO_CACHE_TTL_MS || !Array.isArray(entry.items)) {
      localStorage.removeItem(HERO_CACHE_KEY);
      return [];
    }
    return getHeroItems({ results: entry.items }, "all");
  } catch {
    return [];
  }
}

function saveCachedHeroItems(items) {
  try {
    localStorage.setItem(HERO_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: items.slice(0, 5) }));
  } catch {
    // Storage can be disabled or full; the live hero must still work.
  }
}

function preloadHeroArtwork(items) {
  if (!items[0]?.backdrop_path) return;
  const preload = new Image();
  preload.decoding = "async";
  preload.fetchPriority = "high";
  preload.src = getImageUrl(items[0].backdrop_path, HERO_BACKDROP_SIZE());
}

function loadMovieFallback() {
  // Do not make the static/cached hero wait for a second API request.
  void tmdbApi.trending("movie", "day", 1, { timeoutMs: HERO_REQUEST_TIMEOUT_MS })
    .then((data) => {
      const items = getHeroItems(data, "movie");
      if (!items.length) return;
      saveCachedHeroItems(items);
      if (heroSelectionMade) return;
      preloadHeroArtwork(items);
      renderHero(items);
    })
    .catch((error) => console.warn("Vivid movie-trending fallback unavailable:", error));
}

async function loadHero() {
  const hero = document.getElementById("hero");
  if (!hero) return;

  // Returning visitors get a validated, short-lived snapshot immediately.
  // First-time visitors see the static HTML fallback while TMDB responds.
  const cachedItems = readCachedHeroItems();
  if (cachedItems.length && !heroSelectionMade) {
    preloadHeroArtwork(cachedItems);
    renderHero(cachedItems);
  }

  try {
    const data = await tmdbApi.trending("all", "day", 1, { timeoutMs: HERO_REQUEST_TIMEOUT_MS });
    const items = getHeroItems(data, "all");
    if (!items.length) {
      loadMovieFallback();
      return;
    }
    saveCachedHeroItems(items);
    if (heroSelectionMade) return;
    preloadHeroArtwork(items);
    renderHero(items);
  } catch (error) {
    console.warn("Vivid daily trending unavailable; keeping the current hero:", error);
    loadMovieFallback();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearPlaybackTimers();
    heroRunToken += 1;
    removeHeroVideos();
  } else {
    activateCurrentHero();
  }
});
void loadHero();
