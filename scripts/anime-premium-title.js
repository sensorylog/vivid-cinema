import { tmdbApi } from "./tmdb.js";
import { isTitleAllowed, renderParentalBlock } from "./parental-controls.js";
import { getImageUrl, normalizeResults } from "./media.js";
import { escapeHtml } from "./utils.js";
import { isAnimeMetadata } from "./anime-eligibility.js";

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
let activeTitleDetails = null;
let activeVividUser = null;
let premiumMembershipActive = false;
let titleAccessRequest = 0;
let libraryApi = { hasLibraryItem: () => false, toggleLibraryItem: () => ({}) };
let animeLibraryApi = { markAnimeCompleted: () => {}, unmarkAnimeCompleted: () => {}, addAnimeFavorite: () => {}, removeAnimeFavorite: () => {} };

function setMemberActionsVisible(visible) {
  document.querySelectorAll("[data-vap-member-action]").forEach(button => { button.hidden = !visible; });
}


async function syncTitleAccess(user) {
  const requestId = ++titleAccessRequest;
  activeVividUser = user && !user.isAnonymous ? user : null;
  premiumMembershipActive = false;
  let emailVerificationRequired = false;
  if (activeVividUser) {
    try {
      const token = await activeVividUser.getIdToken(true);
      const response = await fetch("/api/anime-premium/membership", { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
      if (requestId !== titleAccessRequest || activeVividUser?.uid !== user.uid) return;
      if (response.status === 403 && activeVividUser.emailVerified !== true) emailVerificationRequired = true;
      if (response.ok) {
        const payload = await response.json();
        premiumMembershipActive = payload?.membership?.active === true;
      }
    } catch (error) {
      if (requestId !== titleAccessRequest) return;
      console.warn("Vivid Anime Premium membership status could not be checked:", error);
    }
  }
  if (requestId !== titleAccessRequest) return;
  setMemberActionsVisible(premiumMembershipActive);
  const primary = $("vap-title-account");
  const watch = $("vap-title-watch");
  const membership = $("vap-title-membership");
  if (!primary) return;
  if (activeVividUser && emailVerificationRequired) {
    primary.textContent = "Verify your email →";
    primary.href = "verify-email.html?returnTo=" + encodeURIComponent("anime-premium-title.html" + window.location.search);
    if (watch) watch.hidden = true;
    if (membership) membership.hidden = true;
    return;
  }
  if (!activeVividUser) {
    primary.textContent = "Sign in & subscribe →";
    primary.href = "auth.html?returnTo=" + encodeURIComponent("anime-premium-title.html" + window.location.search);
    if (watch) watch.hidden = true;
    if (membership) membership.hidden = true;
    return;
  }
  if (premiumMembershipActive) {
    primary.textContent = "Watch with Premium →";
    primary.href = watch?.href || "anime-premium.html";
    if (watch) watch.hidden = true;
    if (membership) membership.hidden = true;
  } else {
    primary.textContent = "Subscribe to Vivid Anime Premium →";
    primary.href = "anime-premium-membership.html";
    if (watch) watch.hidden = true;
    if (membership) membership.hidden = true;
  }
}
// Firebase and library startup must never block public title metadata.
async function initializeOptionalAccountFeatures() {
  try {
    const [firebaseModule, authSdk, libraryModule, animeLibraryModule] = await Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
      import("./library.js"),
      import("./anime-library.js")
    ]);
    libraryApi = libraryModule;
    animeLibraryApi = animeLibraryModule;
    if (activeTitleDetails) {
      updateFavoriteButton(activeTitleDetails);
      updateCompletedButton(activeTitleDetails);
      updateStarButton(activeTitleDetails);
    }
    authSdk.onAuthStateChanged(firebaseModule.auth, user => { void syncTitleAccess(user); }, error => {
      console.warn("Vivid Anime Premium account status could not be resolved:", error);
      void syncTitleAccess(null);
    });
  } catch (error) {
    console.warn("Vivid Anime Premium account/library features are temporarily unavailable:", error);
    void syncTitleAccess(null);
  }
}
void initializeOptionalAccountFeatures();

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
  const items = normalizeResults(related.filter(item => item.poster_path && isAnimeMetadata(item)).slice(0, 12), mediaType);
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
  const official = videos.find(video => video.official === true);
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
  if (backdropTimer) {
    window.clearInterval(backdropTimer);
    backdropTimer = null;
  }
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
function libraryTitleItem(details) {
  return {
    id: String(details.id),
    media_type: mediaType,
    title: titleName(details),
    year: releaseYear(details) === "Year unavailable" ? "" : releaseYear(details),
    poster_path: details.poster_path || "",
    backdrop_path: details.backdrop_path || "",
    isAnime: true
  };
}

function updateStarButton(details) {
  const button = $("vap-title-star");
  if (!button) return;
  const item = libraryTitleItem(details);
  const saved = libraryApi.hasLibraryItem("favorites", item);
  button.setAttribute("aria-pressed", String(saved));
  button.classList.toggle("is-saved", saved);
  button.innerHTML = saved
    ? '<i class="bi bi-star-fill" aria-hidden="true"></i> Favourite'
    : '<i class="bi bi-star" aria-hidden="true"></i> Add to favourites';
  button.onclick = () => {
    if (libraryApi.hasLibraryItem("favorites", item)) animeLibraryApi.removeAnimeFavorite(item.id, mediaType);
    else animeLibraryApi.addAnimeFavorite(item);
    updateStarButton(details);
  };
}

function updateCompletedButton(details) {
  const button = $("vap-title-completed");
  if (!button) return;
  const item = libraryTitleItem(details);
  const saved = libraryApi.hasLibraryItem("completed", item);
  button.setAttribute("aria-pressed", String(saved));
  button.classList.toggle("is-saved", saved);
  button.innerHTML = saved
    ? '<i class="bi bi-check-circle-fill" aria-hidden="true"></i> Completed'
    : '<i class="bi bi-check-circle" aria-hidden="true"></i> Mark as completed';
  button.onclick = () => {
    if (libraryApi.hasLibraryItem("completed", item)) animeLibraryApi.unmarkAnimeCompleted(item.id, mediaType);
    else animeLibraryApi.markAnimeCompleted(item);
    updateCompletedButton(details);
  };
}

function updateFavoriteButton(details) {
  const button = $("vap-title-favorite");
  if (!button) return;
  const item = libraryTitleItem(details);
  const saved = libraryApi.hasLibraryItem("watchLater", item);
  button.setAttribute("aria-pressed", String(saved));
  button.classList.toggle("is-saved", saved);
  button.innerHTML = saved
    ? '<i class="bi bi-bookmark-check" aria-hidden="true"></i> Added to My List'
    : '<i class="bi bi-bookmark-plus" aria-hidden="true"></i> Add to My List';
  button.onclick = () => {
    const next = libraryApi.toggleLibraryItem("watchLater", item);
    const isSaved = (next.watchLater || []).some(entry =>
      String(entry.id) === item.id && (entry.media_type || entry.mediaType || "movie") === mediaType
    );
    button.setAttribute("aria-pressed", String(isSaved));
    button.classList.toggle("is-saved", isSaved);
    button.innerHTML = isSaved
      ? '<i class="bi bi-bookmark-check" aria-hidden="true"></i> Added to My List'
      : '<i class="bi bi-bookmark-plus" aria-hidden="true"></i> Add to My List';
    button.dispatchEvent(new CustomEvent("vap:my-list-changed", {
      bubbles: true,
      detail: { id: item.id, type: mediaType, saved: isSaved }
    }));
  };
}

window.addEventListener("vivid:library-changed", () => {
  const name = $("vap-title-name")?.textContent;
  if (!name || !activeTitleDetails) return;
  updateFavoriteButton(activeTitleDetails);
  updateCompletedButton(activeTitleDetails);
  updateStarButton(activeTitleDetails);
});

function renderTitle(details) {
  activeTitleDetails = details;
  const name = titleName(details);
  document.title = name + " · VIVID ANIME PREMIUM";
  const canonicalUrl = new URL("anime-premium-title.html", window.location.origin);
  canonicalUrl.searchParams.set("id", String(details.id));
  canonicalUrl.searchParams.set("type", mediaType);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = canonicalUrl.toString();
  const description = String(details.overview || "Explore the story, characters and world behind " + name + " on Vivid Anime Premium.").replace(/\s+/g, " ").trim().slice(0, 160);
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) descriptionMeta.content = description;
  const socialTitle = document.querySelector('meta[property="og:title"]');
  if (socialTitle) socialTitle.content = document.title;
  const socialDescription = document.querySelector('meta[property="og:description"]');
  if (socialDescription) socialDescription.content = description;
  const socialUrl = document.querySelector('meta[property="og:url"]');
  if (socialUrl) socialUrl.content = canonicalUrl.toString();
  $("vap-title-name").textContent = name;
  const watchParams = new URLSearchParams({ id: String(details.id), type: mediaType });
  if (mediaType === "tv") { watchParams.set("season", "1"); watchParams.set("episode", "1"); }
  $("vap-title-watch").href = "anime-premium-watch.html?" + watchParams.toString();
  $("vap-title-watch").hidden = true;
  void syncTitleAccess(activeVividUser);
  $("vap-title-meta").textContent = (mediaType === "movie" ? "ANIME FILM" : "ANIME SERIES") + " · " + releaseYear(details) + " · VIVID ANIME PREMIUM";
  $("vap-title-tagline").textContent = details.tagline || "";
  $("vap-title-overview").textContent = details.overview || "Explore the characters, setting and story behind this anime.";
  $("vap-title-description").textContent = details.overview || "A story from the Vivid Anime Premium collection.";
  updateFavoriteButton(details);
  updateCompletedButton(details);
  updateStarButton(details);
  renderFacts(details);
  renderGenres(details);
  renderCast(details);
  renderRelated(details);
  renderTrailer(details);
  observeHeroScroll();
}
async function loadTitle() {
  if (!titleId) throw new Error("This title link is invalid. Return to the Premium catalogue and choose an anime.");

  // Fetch the small, authoritative record first. The old append_to_response
  // request bundled credits, videos, recommendations and provider data into
  // one response; a slow optional section could prevent the whole page rendering.
  const getDetails = mediaType === "movie" ? tmdbApi.movieDetailsBasic : tmdbApi.tvDetailsBasic;
  const details = await getDetails(titleId);
  if (!details?.id) throw new Error("The anime title could not be found.");
  if (!await isTitleAllowed({ ...details, id: titleId, media_type: mediaType })) { renderParentalBlock(document.getElementById("anime-premium-title-content"), details?.name || details?.title || "This title"); return; }
  if (!isAnimeMetadata(details)) throw new Error("This title is not listed as Japanese animation in the Vivid Anime Premium catalogue.");

  // Render the title as soon as its core metadata is available.
  renderTitle(details);
  // Show the title's own artwork immediately; gallery images are progressive enhancement.
  startBackdrop(imageSlides(details, {}));
  const getImages = mediaType === "movie" ? tmdbApi.movieImages : tmdbApi.tvImages;
  const getCredits = mediaType === "movie" ? tmdbApi.movieCredits : tmdbApi.tvCredits;
  const getVideos = mediaType === "movie" ? tmdbApi.movieVideos : tmdbApi.tvVideos;
  const getRecommendations = mediaType === "movie" ? tmdbApi.movieRecommendations : tmdbApi.tvRecommendations;
  const [imagesResult, creditsResult, videosResult, recommendationsResult] = await Promise.allSettled([
    getImages(titleId), getCredits(titleId), getVideos(titleId), getRecommendations(titleId)
  ]);

  const images = imagesResult.status === "fulfilled" ? imagesResult.value || {} : {};
  if (creditsResult.status === "fulfilled") details.credits = creditsResult.value || {};
  if (videosResult.status === "fulfilled") details.videos = videosResult.value || {};
  if (recommendationsResult.status === "fulfilled") details.recommendations = recommendationsResult.value || {};

  // Optional metadata enriches the already-visible page; it never gates it.
  renderCast(details);
  renderRelated(details);
  renderTrailer(details);
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
