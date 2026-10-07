// Vivid Cinema title renderer baseline restored from the last known-good implementation.
import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { getRoute, buildWatchUrl } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { hasLibraryItem, startLibrarySync, toggleLibraryItem, upsertLibraryItem } from "./library.js";
import { getProviderCountry, setProviderCountry } from "./provider-region.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
let media = null;
let currentDetails = null;
const PROVIDER_COUNTRIES = [
  ["US", "United States"],
  ["GH", "Ghana"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["NG", "Nigeria"],
  ["ZA", "South Africa"],
  ["AU", "Australia"]
];

function formatRuntime(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? hours + "h " + mins + "m" : mins + "m";
}

function trailerVideos(details) {
  return (details.videos?.results || [])
    .filter((video) => video.site === "YouTube" && ["Trailer", "Teaser", "Clip", "Featurette"].includes(video.type))
    .filter((video) => video.official !== false)
    .slice(0, 8);
}

function getInitialCountry(details) {
  const stored = getProviderCountry();
  if (stored && details["watch/providers"]?.results?.[stored]) return stored;
  const locale = stored || getProviderCountry();
  if (locale && details["watch/providers"]?.results?.[locale]) return locale;
  return details["watch/providers"]?.results?.[locale] ? locale : details["watch/providers"]?.results?.US ? "US" : Object.keys(details["watch/providers"]?.results || {})[0] || "US";
}

function libraryItem() {
  return { id: media.id, media_type: media.media_type, title: media.title, year: media.year, poster_path: media.poster_path, backdrop_path: media.backdrop_path };
}

function renderLibraryActions() {
  const item = libraryItem();
  const favorite = hasLibraryItem("favorites", item);
  const watchLater = hasLibraryItem("watchLater", item);
  return '<div class="vivid-title-library-actions" aria-label="Library actions">' +
    '<button class="vivid-button vivid-button--secondary" type="button" id="library-favorite"><i class="bi bi-heart' + (favorite ? '-fill' : '') + '"></i> ' + (favorite ? "Favorited" : "Favorite") + '</button>' +
    '<button class="vivid-button vivid-button--secondary" type="button" id="library-watch-later"><i class="bi bi-clock' + (watchLater ? '-fill' : '') + '"></i> ' + (watchLater ? "Saved" : "Watch later") + '</button>' +
    '<a class="vivid-button vivid-button--ghost" href="library.html"><i class="bi bi-bookmark"></i> My Library</a></div>';
}

function wireLibraryActions() {
  const item = libraryItem();
  const favorite = $("library-favorite");
  const watchLater = $("library-watch-later");
  favorite?.addEventListener("click", () => {
    toggleLibraryItem("favorites", item);
    favorite.innerHTML = hasLibraryItem("favorites", item) ? '<i class="bi bi-heart-fill"></i> Favorited' : '<i class="bi bi-heart"></i> Favorite';
  });
  watchLater?.addEventListener("click", () => {
    toggleLibraryItem("watchLater", item);
    watchLater.innerHTML = hasLibraryItem("watchLater", item) ? '<i class="bi bi-clock-fill"></i> Saved' : '<i class="bi bi-clock"></i> Watch later';
  });
}

function renderError(message) {
  $("title-content").innerHTML = '<section class="vivid-title-error"><i class="bi bi-exclamation-circle"></i><h1>We couldn’t load this title.</h1><p>' + escapeHtml(message) + '</p><a class="vivid-button vivid-button--secondary" href="home.html">Back to browse</a></section>';
}

function renderTrailerSection(details) {
  const videos = trailerVideos(details);
  if (!videos.length) return "";
  return '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>VIDEO</span><h2>Trailers & clips</h2></div></div><div class="vivid-video-grid">' +
    videos.map((video, index) => '<button class="vivid-video-card" type="button" data-video-key="' + escapeHtml(video.key) + '" data-video-title="' + escapeHtml(video.name || "Trailer") + '"><div class="vivid-video-thumb"><img loading="lazy" src="https://i.ytimg.com/vi/' + encodeURIComponent(video.key) + '/hqdefault.jpg" alt=""><span><i class="bi bi-play-fill"></i></span></div><strong>' + escapeHtml(video.name || (index === 0 ? "Trailer" : "Video")) + '</strong><small>' + escapeHtml(video.type || "Video") + '</small></button>').join("") +
    '</div></section>';
}

function renderProviderGroups(details, countryCode) {
  const country = details["watch/providers"]?.results?.[countryCode];
  const availableCountries = details["watch/providers"]?.results || {};
  if (!country) {
    return '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>WHERE TO WATCH</span><h2>Provider availability</h2></div><label class="vivid-country-picker"><span>Country</span><select id="provider-country">' +
      PROVIDER_COUNTRIES.filter(([code]) => availableCountries[code]).map(([code, name]) => '<option value="' + code + '">' + name + '</option>').join("") +
      '</select></label></div><p class="vivid-muted">No provider listings are available for this country. Try another country.</p></section>';
  }

  const groups = [
    ["Stream", country.flatrate],
    ["Free", country.free],
    ["Rent", country.rent],
    ["Buy", country.buy]
  ].filter(([, items]) => Array.isArray(items) && items.length);

  const countryOptions = PROVIDER_COUNTRIES
    .filter(([code]) => availableCountries[code])
    .map(([code, name]) => '<option value="' + code + '"' + (code === countryCode ? " selected" : "") + ">" + name + "</option>")
    .join("");

  if (!groups.length) {
    return '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>WHERE TO WATCH</span><h2>Provider availability</h2></div><label class="vivid-country-picker"><span>Country</span><select id="provider-country">' + countryOptions + '</select></label></div><p class="vivid-muted">No streaming, rental or purchase listings are currently reported for this country.</p></section>';
  }

  return '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>WHERE TO WATCH</span><h2>Available through providers</h2></div><label class="vivid-country-picker"><span>Country</span><select id="provider-country">' + countryOptions + '</select></label></div><div class="vivid-provider-grid">' +
    groups.map(([label, items]) => '<div class="vivid-provider-group"><h3>' + label + '</h3><div>' + items.slice(0, 6).map((provider) => '<a href="' + escapeHtml(country.link || "#") + '" target="_blank" rel="noopener noreferrer" class="vivid-provider"><img loading="lazy" src="' + getImageUrl(provider.logo_path, "w92") + '" alt=""><span>' + escapeHtml(provider.provider_name) + '</span></a>').join("") + '</div></div>').join("") +
    '</div><p class="vivid-provider-note">Availability is supplied by TMDB and varies by country. Vivid Cinema does not host or provide titles.</p></section>';
}

function renderSeasons(details) {
  if (media?.media_type !== "tv" || !Array.isArray(details.seasons) || !details.seasons.length) return "";
  const seasons = details.seasons.filter((season) => season.season_number >= 0);
  return '<section class="vivid-title-section vivid-seasons"><div class="vivid-section-heading"><div><span>EPISODES</span><h2>Seasons & episodes</h2></div><label class="vivid-season-picker"><span class="vivid-sr-only">Choose season</span><select id="season-select">' +
    seasons.map((season) => '<option value="' + season.season_number + '">' + escapeHtml(season.name || ("Season " + season.season_number)) + '</option>').join("") +
    '</select></label></div><div id="episode-list" class="vivid-episode-list"><p class="vivid-muted">Loading episodes…</p></div></section>';
}

async function loadSeason(id, seasonNumber) {
  const container = $("episode-list");
  if (!container) return;
  container.innerHTML = '<p class="vivid-muted">Loading episodes…</p>';
  try {
    const data = await tmdbApi.tvSeason(id, seasonNumber);
    const episodes = data.episodes || [];
    container.innerHTML = episodes.length ? episodes.map((episode) => '<article class="vivid-episode"><div class="vivid-episode-thumb"><img loading="lazy" src="' + getImageUrl(episode.still_path, "w500") + '" alt="" onerror="this.style.visibility=\'hidden\'"></div><div class="vivid-episode-copy"><div class="vivid-episode-line"><strong>Episode ' + episode.episode_number + '</strong><span>★ ' + (episode.vote_average ? Number(episode.vote_average).toFixed(1) : "—") + '</span></div><h3>' + escapeHtml(episode.name || ("Episode " + episode.episode_number)) + '</h3><small>' + escapeHtml(episode.air_date || "Air date unavailable") + '</small><p>' + escapeHtml(episode.overview || "No episode synopsis is available.") + '</p><a class="vivid-button vivid-button--secondary vivid-episode-watch" href="' + escapeHtml(buildWatchUrl(media.id, "tv", seasonNumber, episode.episode_number)) + '"><i class="bi bi-play-fill"></i> Play episode</a></div></article>').join("") : '<p class="vivid-muted">No episodes are available for this season.</p>';
  } catch (error) {
    container.innerHTML = '<p class="vivid-muted">' + escapeHtml(getErrorMessage(error)) + '</p>';
  }
}

function wireSeasons(details) {
  if (media?.media_type !== "tv") return;
  const select = $("season-select");
  if (!select) return;
  select.addEventListener("change", () => loadSeason(media.id, select.value));
  loadSeason(media.id, select.value || details.seasons?.[0]?.season_number || 0);
}

function openTrailer(key, name) {
  let modal = $("trailer-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "trailer-modal";
    modal.className = "vivid-trailer-modal";
    modal.innerHTML = '<div class="vivid-trailer-dialog" role="dialog" aria-modal="true" aria-labelledby="trailer-modal-title"><div class="vivid-trailer-head"><h2 id="trailer-modal-title"></h2><button id="trailer-close" type="button" aria-label="Close trailer"><i class="bi bi-x-lg"></i></button></div><div class="vivid-trailer-frame"><iframe id="trailer-frame" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeTrailer(); });
    $("trailer-close").addEventListener("click", closeTrailer);
  }
  $("trailer-modal-title").textContent = name || "Trailer";
  $("trailer-frame").src = "https://www.youtube.com/embed/" + encodeURIComponent(key) + "?autoplay=1&rel=0";
  modal.classList.add("is-open");
  document.body.classList.add("vivid-modal-open");
  $("trailer-close").focus();
}

function closeTrailer() {
  const modal = $("trailer-modal");
  if (!modal) return;
  $("trailer-frame").src = "";
  modal.classList.remove("is-open");
  document.body.classList.remove("vivid-modal-open");
}

function wireTrailers() {
  document.querySelectorAll("[data-video-key]").forEach((button) => button.addEventListener("click", () => openTrailer(button.dataset.videoKey, button.dataset.videoTitle)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTrailer();
  }, { once: true });
}

function wireProviders(details) {
  const picker = $("provider-country");
  picker?.addEventListener("change", () => {
    setProviderCountry(picker.value);
    render(details);
  });
}
;