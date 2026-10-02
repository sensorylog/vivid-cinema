import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { getRoute, buildWatchUrl } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { hasLibraryItem, startLibrarySync, toggleLibraryItem, upsertLibraryItem } from "./library.js";
import { getExternalProviderLink } from "./external-providers.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
let media = null;
let currentDetails = null;
let trailerTrigger = null;
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
  const stored = localStorage.getItem("vivid:provider-country");
  if (stored && details["watch/providers"]?.results?.[stored]) return stored;
  const locale = (navigator.language || "").split("-")[1]?.toUpperCase();
  if (locale && details["watch/providers"]?.results?.[locale]) return locale;
  return details["watch/providers"]?.results?.US ? "US" : Object.keys(details["watch/providers"]?.results || {})[0] || "US";
}

function libraryItem() {
  return { id: media.id, media_type: media.media_type, title: media.title, year: media.year, poster_path: media.poster_path, backdrop_path: media.backdrop_path };
}

function renderLibraryActions() {
  const item = libraryItem();
  const favorite = hasLibraryItem("favorites", item);
  const watchLater = hasLibraryItem("watchLater", item);
  const externalLink = getExternalProviderLink(media);
  return '<div class="vivid-title-library-actions" aria-label="Library actions">' +
    '<button class="vivid-button vivid-button--secondary" type="button" id="library-favorite"><i class="bi bi-heart' + (favorite ? '-fill' : '') + '"></i> ' + (favorite ? "Favorited" : "Favorite") + '</button>' +
    '<button class="vivid-button vivid-button--secondary" type="button" id="library-watch-later"><i class="bi bi-clock' + (watchLater ? '-fill' : '') + '"></i> ' + (watchLater ? "Saved" : "Watch later") + '</button>' +
    '<a class="vivid-button vivid-button--ghost" href="library.html"><i class="bi bi-bookmark"></i> My Library</a>' +
    (externalLink ? '<a class="vivid-button vivid-button--secondary" href="' + escapeHtml(externalLink) + '" target="_blank" rel="noopener noreferrer" aria-label="Download this title"><i class="bi bi-download"></i> Download</a>' : "") +
    '</div>';
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
  trailerTrigger = document.activeElement;
  $("trailer-modal-title").textContent = name || "Trailer";
  const params = new URLSearchParams({ autoplay:"1", rel:"0", playsinline:"1", enablejsapi:"1", origin:window.location.origin });
  $("trailer-frame").src = "https://www.youtube.com/embed/" + encodeURIComponent(key) + "?" + params.toString();
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
  if(trailerTrigger && typeof trailerTrigger.focus==="function") trailerTrigger.focus();
  trailerTrigger=null;
}

function wireTrailers() {
  document.querySelectorAll("[data-video-key]").forEach((button) => button.addEventListener("click", () => openTrailer(button.dataset.videoKey, button.dataset.videoTitle)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTrailer();
  }, { once: true });
}

function wireProviders(details) {
  const select = $("provider-country");
  if (!select) return;
  select.addEventListener("change", () => {
    localStorage.setItem("vivid:provider-country", select.value);
    renderProviderOnly(details, select.value);
  });
}

function renderProviderOnly(details, countryCode) {
  const current = $("provider-country")?.closest(".vivid-title-section");
  if (!current) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderProviderGroups(details, countryCode);
  current.replaceWith(wrapper.firstElementChild);
  wireProviders(details);
}

function renderRecommendationCards(items){
  return items.length
    ? items.map((item)=>'<a class="vivid-similar-card" href="'+escapeHtml(getMediaUrl(item))+'"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(item.title)+'"><span>'+escapeHtml(item.title)+'</span><small>★ '+(item.vote_average?item.vote_average.toFixed(1):"—")+'</small></a>').join("")
    : '<p class="vivid-muted">No recommendations available yet.</p>';
}

function renderFacts(details) {
  const facts = [
    ["Release", details.release_date || details.first_air_date || ""],
    ["Status", details.status || ""],
    ["Original language", details.original_language ? String(details.original_language).toUpperCase() : ""],
    ["Runtime", media?.media_type === "movie" ? formatRuntime(details.runtime) : (details.number_of_episodes ? details.number_of_episodes + " episodes" : "")],
    ["Seasons", media?.media_type === "tv" && details.number_of_seasons ? String(details.number_of_seasons) : ""],
    ["Episodes", media?.media_type === "tv" && details.number_of_episodes ? String(details.number_of_episodes) : ""]
  ].filter(([, value]) => value);
  if (!facts.length) return "";
  return '<section class="vivid-title-section vivid-title-facts"><div class="vivid-section-heading"><div><span>DETAILS</span><h2>At a glance</h2></div></div><div class="vivid-facts-grid">' +
    facts.map(([label,value]) => '<div class="vivid-fact"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join("") +
    '</div></section>';
}

function renderStorySection(details, cast) {
  const crew = details.credits?.crew || [];
  const directors = crew.filter((person) => person.job === "Director").map((person) => person.name).filter(Boolean).slice(0, 4);
  const writers = crew.filter((person) => ["Writer", "Screenplay", "Story", "Creator"].includes(person.job)).map((person) => person.name).filter(Boolean).slice(0, 5);
  const creators = (details.created_by || []).map((person) => person.name).filter(Boolean).slice(0, 4);
  const leadCast = cast.slice(0, 6);
  return '<section class="vivid-title-section vivid-title-story"><div class="vivid-story-grid"><div><div class="vivid-section-heading"><div><span>THE STORY</span><h2>About this title</h2></div></div><p class="vivid-story-overview">' + escapeHtml(media.overview || "No synopsis is available for this title yet.") + '</p></div><div class="vivid-credit-panel">' +
    (directors.length ? '<div><span>Director</span><strong>' + escapeHtml(directors.join(", ")) + '</strong></div>' : '') +
    (creators.length ? '<div><span>Created by</span><strong>' + escapeHtml(creators.join(", ")) + '</strong></div>' : '') +
    (writers.length ? '<div><span>Writing</span><strong>' + escapeHtml(writers.join(", ")) + '</strong></div>' : '') +
    (leadCast.length ? '<div><span>Starring</span><strong>' + escapeHtml(leadCast.map((person) => person.name).join(", ")) + '</strong></div>' : '') +
    '</div></div></section>';
}

function render(details) {
  currentDetails=details;
  media=normalizeMedia(details,route.params.get("type")==="tv"?"tv":"movie");
  const title=media.title;
  const year=media.year||"—";
  const rating=media.vote_average?media.vote_average.toFixed(1):"—";
  const runtime=media.media_type==="tv"
    ? (details.number_of_seasons?details.number_of_seasons+" season"+(details.number_of_seasons===1?"":"s"):"")
    : formatRuntime(details.runtime);
  const genreItems=details.genres||[];
  const genres=genreItems.map((genre)=>'<a href="discover.html?genre='+encodeURIComponent(genre.id)+'&type='+encodeURIComponent(media.media_type)+'">'+escapeHtml(genre.name)+'</a>').join("");
  const cast=(details.credits?.cast||[]).filter((person)=>person.name).slice(0,20);
  const videos=trailerVideos(details);
  const firstTrailer=videos[0];
  const recommendations=normalizeResults(details.recommendations?.results||[],media.media_type).slice(0,12);
  const similar=normalizeResults(details.similar?.results||[],media.media_type).slice(0,12);
  const related=recommendations.length?recommendations:similar;

  document.title=title+" · Vivid Cinema";
  const country=getInitialCountry(details);
  $("title-content").innerHTML=
    '<section class="vivid-title-backdrop" style="--title-backdrop:url('+JSON.stringify(getImageUrl(media.backdrop_path,"w1280"))+')"><div class="vivid-title-backdrop-overlay"></div><div class="vivid-title-backdrop-label">'+(media.media_type==="tv"?"SERIES":"FEATURE")+'</div></section>'+
    '<section class="vivid-title-info"><div class="vivid-title-info-inner">'+
      '<div class="vivid-title-poster"><img src="'+getImageUrl(media.poster_path,"w500")+'" alt="'+escapeHtml(title)+' poster"></div>'+
      '<div class="vivid-title-copy"><span class="vivid-title-kicker">'+(media.media_type==="tv"?"TV SERIES":"MOVIE")+'</span><h1>'+escapeHtml(title)+'</h1>'+
      '<div class="vivid-title-meta"><span>'+escapeHtml(year)+'</span>'+(runtime?'<i></i><span>'+escapeHtml(runtime)+'</span>':"")+'<i></i><span>★ '+rating+'</span></div>'+
      '<div class="vivid-title-genres">'+genres+'</div><p>'+escapeHtml(media.overview||"No synopsis is available for this title yet.")+'</p>'+
      '<div class="vivid-title-actions"><a class="vivid-button vivid-button--primary" href="'+escapeHtml(buildWatchUrl(media.id,media.media_type,media.media_type==="tv"?(details.seasons?.find((season)=>season.episode_count>0&&season.season_number>=0)?.season_number??1):null,media.media_type==="tv"?1:null))+'"><i class="bi bi-play-fill"></i> Watch now</a>'+(firstTrailer?'<button class="vivid-button vivid-button--secondary" id="hero-trailer" type="button"><i class="bi bi-play-circle"></i> Watch trailer</button>':"")+'<a class="vivid-button vivid-button--ghost" href="home.html"><i class="bi bi-arrow-left"></i> Browse more</a></div></div>'+
    '</div></section>'+
    renderLibraryActions()+
    renderFacts(details)+
    renderStorySection(details, cast)+
    '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>CAST & CREW</span><h2>People in the story</h2></div></div><div class="vivid-cast-grid">'+
      (cast.length?cast.map((person)=>'<article class="vivid-cast"><img loading="lazy" src="'+getImageUrl(person.profile_path,"w185")+'" alt="'+escapeHtml(person.name)+'"><strong>'+escapeHtml(person.name)+'</strong><small>'+escapeHtml(person.character||"Cast")+'</small></article>').join(""):'<p class="vivid-muted">Cast information is unavailable.</p>')+
    '</div></section>'+renderTrailerSection(details)+renderSeasons(details)+renderProviderGroups(details,country)+
    '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>RECOMMENDED</span><h2>More like this</h2></div></div><div class="vivid-similar" id="recommendation-rail">'+renderRecommendationCards(related)+'</div></section>';

  upsertLibraryItem("history",libraryItem());
  wireSeasons(details);wireProviders(details);wireTrailers();wireLibraryActions();
  if(firstTrailer)$("hero-trailer").addEventListener("click",()=>openTrailer(firstTrailer.key,firstTrailer.name||"Trailer"));
}

async function init() {
  const id = route.params.get("id");
  const type = route.params.get("type") === "tv" ? "tv" : "movie";
  if (!id) return renderError("This title link is missing its media ID.");
  try {
    // Paint the title page from the lightweight metadata endpoint first. This avoids
    // making the first screen wait for credits, videos, providers and recommendations.
    const basic = type === "tv" ? await tmdbApi.tvDetailsBasic(id) : await tmdbApi.movieDetailsBasic(id);
    render(basic);
    // Enrich the page in the background without blocking the first meaningful paint.
    void (async () => {
      try {
        const enriched = type === "tv" ? await tmdbApi.tvDetails(id) : await tmdbApi.movieDetails(id);
        render(enriched);
      } catch (error) {
        console.warn("Vivid title enrichment unavailable:", error);
      }
    })();
  } catch (error) {
    renderError(getErrorMessage(error));
  }
}

function refreshLibraryActions() {
  if (!media) return;
  const current = document.querySelector(".vivid-title-library-actions");
  if (!current) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderLibraryActions();
  current.replaceWith(wrapper.firstElementChild);
  wireLibraryActions();
}

document.addEventListener("DOMContentLoaded", () => {
  // Title rendering must never wait on Firebase Auth/Firestore.
  // Library synchronization continues in the background so a slow or unavailable
  // auth session cannot leave the title page stuck on its loading state.
  init();
  void startLibrarySync()
    .then(() => refreshLibraryActions())
    .catch((error) => console.warn("Vivid library sync unavailable:", error));
});