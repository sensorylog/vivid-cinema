/* TFLIX-style trending billboard adapted for Vivid Cinema.
   Source reference: https://github.com/TomasTNunes/tflix/blob/main/index.html */
import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./media.js";
let heroSlides = [];
let heroIndex = 0;
let heroTimer = null;

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

function stopHeroTimer() {
  if (heroTimer !== null) window.clearInterval(heroTimer);
  heroTimer = null;
}

function startHeroTimer() {
  stopHeroTimer();
  if (heroSlides.length < 2 || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  heroTimer = window.setInterval(() => goToHero(heroIndex + 1), 8000);
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
  dots.forEach((dot, index) => dot.setAttribute("aria-pressed", String(index === heroIndex)));
  notifyHeroChange();

  const bg = slides[heroIndex]?.querySelector(".hero-bg");
  if (bg) {
    bg.style.animation = "none";
    requestAnimationFrame(() => requestAnimationFrame(() => { bg.style.animation = ""; }));
  }
  startHeroTimer();
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
  backdrop.style.backgroundImage = "url(\"" + getImageUrl(item.backdrop_path, "original") + "\")";
  backdrop.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "hero-content";

  const badge = document.createElement("div");
  badge.className = "hero-badge";
  badge.innerHTML = '<span class="bolt" aria-hidden="true">●</span> #' + (index + 1) + ' Trending Today';

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
  slide.append(backdrop, content);
  return slide;
}

function renderHero(items) {
  const hero = document.getElementById("hero");
  if (!hero) return;
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
  if (items[0]?.backdrop_path) {
    const preload = new Image();
    preload.decoding = "async";
    preload.fetchPriority = "high";
    preload.src = getImageUrl(items[0].backdrop_path, "original");
  }
  startHeroTimer();
}

function notifyHeroChange() {
  const item = heroSlides[heroIndex] || null;
  const detail = item ? { id: String(item.id), media_type: item.media_type } : null;
  window.vividCinemaActiveHero = detail;
  window.dispatchEvent(new CustomEvent("vivid:hero-change", { detail }));
}

function selectHeroItem(item) {
  if (!item || item.id == null || !item.backdrop_path) return false;
  const mediaType = item.media_type === "tv" ? "tv" : "movie";
  const existingIndex = heroSlides.findIndex((slide) =>
    String(slide.id) === String(item.id) && slide.media_type === mediaType
  );
  if (existingIndex >= 0) {
    goToHero(existingIndex);
    return true;
  }

  const selected = { ...item, media_type: mediaType };
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
    .slice(0, 5);
}

async function loadHero() {
  const hero = document.getElementById("hero");
  if (!hero) return;

  try {
    let data;
    let mediaType = "all";
    try {
      data = await tmdbApi.trending("all", "day", 1, { cache: false });
    } catch (error) {
      console.warn("Vivid daily trending (all) unavailable; falling back to movies:", error);
      mediaType = "movie";
      data = await tmdbApi.trending("movie", "day", 1, { cache: false });
    }

    let items = getHeroItems(data, mediaType);
    if (!items.length && mediaType === "all") {
      // Keep the billboard useful if the mixed trending feed has no usable backdrops.
      mediaType = "movie";
      data = await tmdbApi.trending("movie", "day", 1, { cache: false });
      items = getHeroItems(data, mediaType);
    }
    renderHero(items);
  } catch (error) {
    console.warn("Vivid trending hero unavailable:", error);
    stopHeroTimer();
    hero.classList.add("empty");
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopHeroTimer();
  else startHeroTimer();
});
void loadHero();
