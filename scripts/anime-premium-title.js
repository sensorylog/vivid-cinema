import { tmdbApi } from "./tmdb.js";
import { getImageUrl, normalizeResults } from "./media.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const mediaType = params.get("type") === "movie" ? "movie" : "tv";
const rawId = params.get("id") || "";
const titleId = /^\d{1,12}$/.test(rawId) ? rawId : "";
let backdropSlides = [];
let activeBackdropLayer = 0;
let backdropIndex = 0;
let backdropTimer = null;
let backdropAdvancing = false;

function titleName(details) { return details.title || details.name || "Anime title"; }
function releaseYear(details) {
  const date = details.release_date || details.first_air_date || "";
  return date.slice(0, 4) || "Year unavailable";
}
function formatRuntime(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "";
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours ? hours + "h " + mins + "m" : mins + "m";
}
function titleUrl(item, type) {
  return "anime-premium-title.html?id=" + encodeURIComponent(item.id) + "&type=" + encodeURIComponent(type);
}
function renderFacts(details) {
  const facts = [
    ["FORMAT", mediaType === "movie" ? "Anime film" : "Anime series"],
    ["YEAR", releaseYear(details)],
    ["RATING", Number(details.vote_average) ? "★ " + Number(details.vote_average).toFixed(1) + " / 10" : "Not rated"]
  ];
  if (mediaType === "movie" && details.runtime) facts.push(["RUNTIME", formatRuntime(details.runtime)]);
  if (mediaType === "tv" && details.number_of_seasons) facts.push(["SEASONS", String(details.number_of_seasons)]);
  if (mediaType === "tv" && details.number_of_episodes) facts.push(["EPISODES", String(details.number_of_episodes)]);
  if (details.status) facts.push(["STATUS", details.status]);
  $("vap-title-facts").innerHTML = facts.map(([label, value]) =>
    '<div class="vap-title-fact"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>'
  ).join("");
}
function renderGenres(details) {
  $("vap-title-genres").innerHTML = (details.genres || []).map(genre =>
    '<span class="vap-title-genre">' + escapeHtml(genre.name) + '</span>'
  ).join("");
}
function renderCast(details) {
  const cast = (details.credits?.cast || []).filter(person => person.name).slice(0, 12);
  if (!cast.length) return;
  $("vap-title-cast").innerHTML = cast.map(person => {
    const photo = person.profile_path ? getImageUrl(person.profile_path, "w185") : "";
    return '<article class="vap-title-person">' +
      (photo ? '<img loading="lazy" decoding="async" src="' + escapeHtml(photo) + '" alt="' + escapeHtml(person.name) + '">' : '<div class="vap-title-person-placeholder" aria-hidden="true">V</div>') +
      '<div class="vap-title-person-copy"><strong>' + escapeHtml(person.name) + '</strong><small>' + escapeHtml(person.character || "Cast") + '</small></div></article>';
  }).join("");
  $("vap-title-cast-section").hidden = false;
}
function renderRelated(details) {
  const related = details.recommendations?.results?.length ? details.recommendations.results : details.similar?.results || [];
  const items = normalizeResults(related.filter(item => item.poster_path).slice(0, 12), mediaType);
  if (!items.length) return;
  $("vap-title-related").innerHTML = items.map(item => {
    const title = item.title || item.name || "Anime title";
    const poster = getImageUrl(item.poster_path, "w342");
    return '<a class="vap-title-related-card" href="' + escapeHtml(titleUrl(item, mediaType)) + '">' +
      '<span class="vap-title-related-poster">' + (poster ? '<img loading="lazy" decoding="async" src="' + escapeHtml(poster) + '" alt="' + escapeHtml(title) + ' poster">' : "") + '</span>' +
      '<strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml((item.release_date || item.first_air_date || "").slice(0, 4)) + '</small></a>';
  }).join("");
  $("vap-title-related-section").hidden = false;
}
function renderTrailer(details) {
  const videos = (details.videos?.results || []).filter(video =>
    video.site === "YouTube" && video.key && ["Trailer", "Teaser"].includes(video.type)
  );
  const official = videos.find(video => video.official === true) || videos[0];
  if (!official) return;
  const link = $("vap-title-trailer");
  link.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(official.key);
  link.hidden = false;
}
function imageSlides(details, images) {
  const candidates = [
    details.backdrop_path,
    ...(images.backdrops || []).sort((a,b) => Number(b.vote_average || 0) - Number(a.vote_average || 0)).map(image => image.file_path),
    ...(images.posters || []).slice(0, 2).map(image => image.file_path),
    details.poster_path
  ].filter(Boolean);
  return [...new Set(candidates)].slice(0, 8).map(path => getImageUrl(path, "w1280")).filter(Boolean);
}
function preloadImage(src) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });
}
function applyInitialBackdrop(src) {
  const layer = $("vap-title-backdrop-a");
  layer.style.backgroundImage = 'url("' + src.replace(/["\\]/g, "") + '")';
  layer.classList.add("is-active");
  activeBackdropLayer = 0;
  backdropIndex = 0;
}
async function advanceBackdrop() {
  if (backdropAdvancing || backdropSlides.length < 2) return;
  backdropAdvancing = true;
  try {
  for (let attempt = 0; attempt < backdropSlides.length; attempt++) {
    const nextIndex = (backdropIndex + 1 + attempt) % backdropSlides.length;
    const nextSrc = backdropSlides[nextIndex];
    if (nextSrc === backdropSlides[backdropIndex]) continue;
    const loaded = await preloadImage(nextSrc);
    if (!loaded) continue;
    const nextLayerIndex = activeBackdropLayer === 0 ? 1 : 0;
    const nextLayer = nextLayerIndex === 0 ? $("vap-title-backdrop-a") : $("vap-title-backdrop-b");
    const oldLayer = activeBackdropLayer === 0 ? $("vap-title-backdrop-a") : $("vap-title-backdrop-b");
    nextLayer.style.backgroundImage = 'url("' + nextSrc.replace(/["\\]/g, "") + '")';
    nextLayer.classList.add("is-active");
    oldLayer.classList.remove("is-active");
    activeBackdropLayer = nextLayerIndex;
    backdropIndex = nextIndex;
    void preloadImage(backdropSlides[(backdropIndex + 1) % backdropSlides.length]);
    return;
  }
  } finally {
    backdropAdvancing = false;
  }
}
function startBackdrop(slides) {
  backdropSlides = slides;
  if (!slides.length) return;
  applyInitialBackdrop(slides[0]);
  if (slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  void preloadImage(slides[1]);
  backdropTimer = window.setInterval(() => { void advanceBackdrop(); }, 8500);
}
function observeHeroScroll() {
  const hero = $("vap-title-hero");
  if (!hero || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) hero.classList.toggle("is-scrolled", entry.intersectionRatio < 0.25);
  }, { threshold: [0, 0.25, 0.5, 1] });
  observer.observe(hero);
}
function renderTitle(details) {
  const name = titleName(details);
  document.title = name + " · VIVID ANIME PREMIUM";
  $("vap-title-name").textContent = name;
  $("vap-title-meta").textContent = (mediaType === "movie" ? "ANIME FILM" : "ANIME SERIES") + " · " + releaseYear(details) + " · VIVID ANIME PREMIUM";
  $("vap-title-tagline").textContent = details.tagline || "";
  $("vap-title-overview").textContent = details.overview || "Explore the characters, setting and story behind this anime.";
  $("vap-title-description").textContent = details.overview || "A story from the Vivid Anime Premium collection.";
  renderFacts(details);
  renderGenres(details);
  renderCast(details);
  renderRelated(details);
  renderTrailer(details);
  observeHeroScroll();
}
async function loadTitle() {
  if (!titleId) throw new Error("This title link is invalid. Return to the Premium catalogue and choose an anime.");
  const getDetails = mediaType === "movie" ? tmdbApi.movieDetails : tmdbApi.tvDetails;
  const getImages = mediaType === "movie" ? tmdbApi.movieImages : tmdbApi.tvImages;
  const [detailsResult, imagesResult] = await Promise.allSettled([getDetails(titleId), getImages(titleId)]);
  if (detailsResult.status !== "fulfilled") throw detailsResult.reason || new Error("The anime title is unavailable.");
  const details = detailsResult.value;
  if (!details?.id) throw new Error("The anime title could not be found.");
  const images = imagesResult.status === "fulfilled" ? imagesResult.value || {} : {};
  renderTitle(details);
  startBackdrop(imageSlides(details, images));
}
function renderError(error) {
  const message = error?.message || "We couldn't load this anime title right now.";
  $("vap-title-content").innerHTML = '<section class="vap-title-error"><span class="vap-eyebrow">VIVID ANIME PREMIUM</span><h1>We couldn’t load this title.</h1><p>' + escapeHtml(message) + '</p><a class="vap-primary" href="anime-premium.html">Back to discovery <span aria-hidden="true">→</span></a></section>';
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => loadTitle().catch(renderError), { once: true });
} else {
  loadTitle().catch(renderError);
}
window.addEventListener("pagehide", () => { if (backdropTimer) window.clearInterval(backdropTimer); }, { once: true });
