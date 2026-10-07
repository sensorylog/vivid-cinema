// Vivid Cinema title renderer baseline restored from the last known-good implementation.
import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { getRoute, buildWatchUrl } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { hasLibraryItem, startLibrarySync, toggleLibraryItem, upsertLibraryItem } from "./library.js";
import { getProviderCountry, setProviderCountry } from "./provider-region.js";
import { getLatestPlaybackProgress } from "./recommendations.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
let media = null;
let currentDetails = null;
let trailerKeydownBound = false;
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
  return details["watch/providers"]?.results?.US ? "US" : Object.keys(details["watch/providers"]?.results || {})[0] || stored || "US";
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
  if (trailerKeydownBound) return;
  trailerKeydownBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTrailer();
  });
}

function wireProviders(details) {
  const select = $("provider-country");
  if (!select) return;
  select.addEventListener("change", () => {
    setProviderCountry(select.value);
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


function formatAppleRuntime(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "";
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (!hours) return mins + " min";
  return hours + " hr" + (mins ? " " + mins + " min" : "");
}

function languageName(details, code) {
  const match = (details?.spoken_languages || []).find((item) => String(item?.iso_639_1 || "").toLowerCase() === String(code || "").toLowerCase());
  return match?.english_name || match?.name || code || "";
}

function getCertification(details, preferredCountry = "US", externalCertification = "") {
  if (externalCertification) return externalCertification;
  const code = String(preferredCountry || "US").toUpperCase();
  if (details?.content_ratings?.results) {
    const exact = details.content_ratings.results.find((item) => item.iso_3166_1 === code && item.rating);
    const us = details.content_ratings.results.find((item) => item.iso_3166_1 === "US" && item.rating);
    return exact?.rating || us?.rating || "";
  }
  return "";
}

function getMovieRatingDetails(details, preferredCountry = "US", releaseData = null) {
  const releases = Array.isArray(releaseData?.results) ? releaseData.results : [];
  const countryCode = String(preferredCountry || "US").toUpperCase();
  const groups = [
    releases.find((item) => item.iso_3166_1 === countryCode),
    releases.find((item) => item.iso_3166_1 === "US")
  ].filter(Boolean);
  for (const group of groups) {
    const release = (group.release_dates || []).find((item) => item.certification);
    if (release?.certification) return {
      rating: String(release.certification),
      note: String(release.note || "").trim()
    };
  }
  return { rating: "", note: "" };
}

function getMovieCertification(details, preferredCountry = "US", releaseData = null) {
  return getMovieRatingDetails(details, preferredCountry, releaseData).rating;
}

function renderCapabilityBadges(details, certification) {
  const score = Number(details?.vote_average || 0);
  const scoreBadge = score > 0 ? '<span class="vivid-title-capability vivid-title-capability--score"><strong>' + Math.round(score * 10) + '%</strong></span>' : "";
  const ratingBadge = certification ? '<span class="vivid-title-capability"><strong>' + escapeHtml(certification) + '</strong></span>' : "";
  const formats = details?.vivid_formats || {};
  const badges = [
    formats.quality === "4K" ? '<span class="vivid-title-capability"><strong>4K</strong></span>' : "",
    formats.dolbyVision ? '<span class="vivid-title-capability vivid-title-capability--icon"><i class="bi bi-circle-fill" aria-hidden="true"></i><strong>Dolby Vision</strong></span>' : "",
    formats.dolbyAtmos ? '<span class="vivid-title-capability vivid-title-capability--icon"><i class="bi bi-circle-fill" aria-hidden="true"></i><strong>Dolby Atmos</strong></span>' : "",
    formats.cc ? '<span class="vivid-title-capability"><strong>CC</strong></span>' : "",
    formats.sdh ? '<span class="vivid-title-capability"><strong>SDH</strong></span>' : "",
    formats.ad ? '<span class="vivid-title-capability"><strong>AD</strong></span>' : ""
  ].join("");
  return '<div class="vivid-title-capabilities" aria-label="Title formats and accessibility">' + scoreBadge + ratingBadge + badges + '</div>';
}

function renderInformation(details, countryCode, externalCertification = "", externalCertificationNote = "") {
  const isTv = media?.media_type === "tv";
  const releaseYear = String(details?.release_date || details?.first_air_date || "").slice(0, 4) || media?.year || "";
  const studio = details?.production_companies?.[0]?.name || "";
  const runtime = isTv
    ? (details?.episode_run_time?.[0] ? formatAppleRuntime(details.episode_run_time[0]) + " per episode" : "")
    : formatAppleRuntime(details?.runtime);
  const certification = isTv
    ? getCertification(details, countryCode, externalCertification)
    : getMovieCertification(details, countryCode, externalCertification);
  const origins = (details?.production_countries || []).map((item) => item?.name).filter(Boolean);
  const originalAudio = languageName(details, details?.original_language);
  const audioLanguages = (details?.spoken_languages || []).map((item) => item?.english_name || item?.name).filter(Boolean);
  const uniqueAudio = [...new Set(audioLanguages)];
  const copyright = details?.vivid_rights || "";
  const infoRows = [
    studio ? '<div class="vivid-title-information-row"><dt>Studio</dt><dd>' + escapeHtml(studio) + '</dd></div>' : "",
    releaseYear ? '<div class="vivid-title-information-row"><dt>Released</dt><dd>' + escapeHtml(releaseYear) + '</dd></div>' : "",
    runtime ? '<div class="vivid-title-information-row"><dt>Run Time</dt><dd>' + escapeHtml(runtime) + '</dd></div>' : "",
    certification ? '<div class="vivid-title-information-row"><dt>Rated</dt><dd>' + escapeHtml(certification) + (externalCertificationNote ? '<span class="vivid-title-rating-note">' + escapeHtml(externalCertificationNote) + '</span>' : "") + '</dd></div>' : "",
    origins.length ? '<div class="vivid-title-information-row"><dt>Regions of Origin</dt><dd>' + escapeHtml(origins.join(", ")) + '</dd></div>' : "",
    copyright ? '<div class="vivid-title-information-row"><dt>Rights</dt><dd>' + escapeHtml(copyright) + '</dd></div>' : ""
  ].join("");
  const languageBlock = [
    originalAudio ? '<div class="vivid-title-language-row"><span>Original Audio</span><strong>' + escapeHtml(originalAudio) + '</strong></div>' : "",
    uniqueAudio.length ? '<div class="vivid-title-language-row"><span>Audio</span><strong>' + escapeHtml(uniqueAudio.join(", ")) + '</strong></div>' : "",
    '<div class="vivid-title-language-row"><span>Subtitles</span><strong>Provider languages vary</strong></div>'
  ].join("");
  return '<section class="vivid-title-section vivid-title-information" aria-labelledby="title-information-heading">' +
    '<div class="vivid-title-information-header"><div><span>INFORMATION</span><h2 id="title-information-heading">Information</h2></div>' + renderCapabilityBadges(details, certification) + '</div>' +
    '<div class="vivid-title-information-grid"><dl>' + infoRows + '</dl><div class="vivid-title-languages"><h3>Languages</h3>' + languageBlock + '</div></div>' +
    '</section>';
}

function renderRecommendationCards(items){
  return items.length
    ? items.map((item)=>'<a class="vivid-similar-card" href="'+escapeHtml(getMediaUrl(item))+'"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(item.title)+'"><span>'+escapeHtml(item.title)+'</span><small>★ '+(item.vote_average?item.vote_average.toFixed(1):"—")+'</small></a>').join("")
    : '<p class="vivid-muted">No recommendations available yet.</p>';
}

function isAnimeTitle(details) { return (details?.genres || []).some(g => Number(g?.id) === 16) && String(details?.original_language || "").toLowerCase() === "ja"; }

function render(details, externalCertification = "", externalCertificationNote = "") {
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
  const backdropPath=media.backdrop_path || media.poster_path || "";
  const backdropUrl=media.backdrop_path ? getImageUrl(backdropPath,"w1280") : getImageUrl(backdropPath,"w780");
  const firstSeason=media.media_type==="tv"?(details.seasons?.find((season)=>season.episode_count>0&&season.season_number>=0)?.season_number??1):null;
  const progressKey=media.media_type+":"+media.id;
  const savedProgress=getLatestPlaybackProgress(media.media_type,media.id);
  const resumeSeason=media.media_type==="tv"?Number(savedProgress?.season||firstSeason||1):null;
  const resumeEpisode=media.media_type==="tv"?Number(savedProgress?.episode||1):null;
  const hasResume=Number(savedProgress?.progress||0)>5;
  const titleWatchUrl=buildWatchUrl(media.id,media.media_type,resumeSeason,resumeEpisode,hasResume?savedProgress.progress:null)+(isAnimeTitle(details)?"&anime=1":"");

  document.title=title+" · Vivid Cinema";
  const country=getInitialCountry(details);
  $("title-content").innerHTML=
    '<section class="vivid-title-backdrop"><img class="vivid-title-backdrop-image" src="'+escapeHtml(backdropUrl)+'" alt="" aria-hidden="true" loading="eager" decoding="async" onerror="this.remove()"><div class="vivid-title-backdrop-overlay"></div><div class="vivid-title-backdrop-label">'+(media.media_type==="tv"?"SERIES":"FEATURE")+'</div></section>'+
    '<section class="vivid-title-info"><div class="vivid-title-info-inner">'+
      '<div class="vivid-title-poster"><img src="'+getImageUrl(media.poster_path,"w500")+'" alt="'+escapeHtml(title)+' poster"></div>'+
      '<div class="vivid-title-copy"><span class="vivid-title-kicker">'+(media.media_type==="tv"?"TV SERIES":"MOVIE")+'</span><h1>'+escapeHtml(title)+'</h1>'+
      '<div class="vivid-title-meta"><span>'+escapeHtml(year)+'</span>'+(runtime?'<i></i><span>'+escapeHtml(runtime)+'</span>':"")+'<i></i><span>★ '+rating+'</span></div>'+
      '<div class="vivid-title-genres">'+genres+'</div><p>'+escapeHtml(media.overview||"No synopsis is available for this title yet.")+'</p>'+
      '<div class="vivid-title-actions"><a class="vivid-button vivid-button--primary" href="'+escapeHtml(titleWatchUrl)+'"><i class="bi bi-play-fill"></i> '+(hasResume?"Resume":"Watch now")+'</a>'+(firstTrailer?'<button class="vivid-button vivid-button--secondary" id="hero-trailer" type="button"><i class="bi bi-play-circle"></i> Watch trailer</button>':"")+'<a class="vivid-button vivid-button--ghost" href="home.html"><i class="bi bi-arrow-left"></i> Browse more</a></div>'+renderLibraryActions()+'</div></div>'+
    '</div></section>'+
    renderInformation(details, country, externalCertification, externalCertificationNote)+
    renderTrailerSection(details)+
    '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>CAST</span><h2>People in the story</h2></div></div><div class="vivid-cast-grid">'+
      (cast.length?cast.map((person)=>'<a class="vivid-cast" href="title.html?person='+encodeURIComponent(person.id)+'"><img loading="lazy" src="'+getImageUrl(person.profile_path,"w185")+'" alt="'+escapeHtml(person.name)+'"><strong>'+escapeHtml(person.name)+'</strong><small>'+escapeHtml(person.character||"Cast")+'</small></a>').join(""):'<p class="vivid-muted">Cast information is unavailable.</p>')+
    '</div></section>'+renderSeasons(details)+renderProviderGroups(details,country)+
    '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>RECOMMENDED</span><h2>More like this</h2></div></div><div class="vivid-similar" id="recommendation-rail">'+renderRecommendationCards(related)+'</div></section>';

  upsertLibraryItem("history",libraryItem());
  wireSeasons(details);wireProviders(details);wireTrailers();wireLibraryActions();
  if(firstTrailer)$("hero-trailer").addEventListener("click",()=>openTrailer(firstTrailer.key,firstTrailer.name||"Trailer"));
}

function renderPersonPage(person) {
  const credits = Array.isArray(person?.combined_credits?.cast) ? person.combined_credits.cast
    .filter((item) => item?.id && (item?.title || item?.name))
    .sort((a,b) => (Number(b.popularity)||0) - (Number(a.popularity)||0))
    .slice(0,24) : [];
  const known = Array.isArray(person?.combined_credits?.crew) ? person.combined_credits.crew
    .filter((item) => item?.id && (item?.title || item?.name))
    .sort((a,b) => (Number(b.popularity)||0) - (Number(a.popularity)||0))
    .slice(0,8) : [];
  const creditsHtml = credits.map((item) => {
    const type = item.media_type === "tv" ? "tv" : "movie";
    const name = item.title || item.name || "Untitled";
    const year = String(item.release_date || item.first_air_date || "").slice(0,4);
    return '<a class="vivid-card" href="title.html?id='+encodeURIComponent(item.id)+'&type='+type+'"><div class="vivid-card-media"><img loading="lazy" src="'+getImageUrl(item.poster_path,"w342")+'" alt="'+escapeHtml(name)+'"></div><div class="vivid-card-info"><strong class="vivid-card-title">'+escapeHtml(name)+'</strong><small class="vivid-card-sub">'+escapeHtml(year)+'</small></div></a>';
  }).join("");
  const bio = String(person?.biography || "").trim();
  const jobs = known.map((item) => escapeHtml(item.job || item.department || "Crew")).filter(Boolean).slice(0,4).join(" · ");
  $("title-content").innerHTML =
    '<section class="vivid-person-hero"><div class="vivid-person-photo"><img src="'+getImageUrl(person.profile_path,"w342")+'" alt="'+escapeHtml(person.name||"Person")+'"></div><div class="vivid-person-copy"><span>CAST & CREW</span><h1>'+escapeHtml(person.name||"Person")+'</h1><p>'+escapeHtml(person.known_for_department||"Actor")+(jobs ? " · "+jobs : "")+'</p></div></section>'+
    (bio ? '<section class="vivid-title-section vivid-person-bio"><div class="vivid-section-heading"><div><span>BIOGRAPHY</span><h2>About '+escapeHtml(person.name||"them")+'</h2></div></div><p>'+escapeHtml(bio)+'</p></section>' : '')+
    '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>ON VIVID</span><h2>Known for</h2></div></div><div class="vivid-cast-grid vivid-person-grid">'+(creditsHtml || '<p class="vivid-muted">No credits available.</p>')+'</div></section>';
}

async function init() {
  const personId = route.params.get("person");
  if (personId) {
    try {
      const person = await tmdbApi.personDetails(personId);
      renderPersonPage(person);
    } catch (error) {
      renderError(getErrorMessage(error));
    }
    return;
  }
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
        const [enriched, certificationData] = await Promise.all([
          type === "tv" ? tmdbApi.tvDetails(id) : tmdbApi.movieDetails(id),
          type === "tv" ? tmdbApi.tvContentRatings(id) : tmdbApi.movieReleaseDates(id)
        ]);
        const preferredCountry = getProviderCountry();
        const ratingDetails = type === "tv"
          ? { rating: getCertification(enriched, preferredCountry), note: "" }
          : getMovieRatingDetails(enriched, preferredCountry, certificationData);
        render(enriched, ratingDetails.rating, ratingDetails.note);
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