import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { getRoute } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
let media = null;

function formatRuntime(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? hours + "h " + mins + "m" : mins + "m";
}

function trailer(details) {
  const videos = details.videos?.results || [];
  return videos.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official !== false)
    || videos.find((v) => v.site === "YouTube" && (v.type === "Teaser" || v.type === "Clip"));
}

function renderError(message) {
  $("title-content").innerHTML = '<section class="vivid-title-error"><i class="bi bi-exclamation-circle"></i><h1>We couldn’t load this title.</h1><p>' + escapeHtml(message) + '</p><a class="vivid-button vivid-button--secondary" href="home.html">Back to browse</a></section>';
}

function renderProviderGroups(details) {
  const country = details["watch/providers"]?.results?.US || details["watch/providers"]?.results?.GH;
  if (!country) return "";
  const groups = [
    ["Stream", country.flatrate],
    ["Rent", country.rent],
    ["Buy", country.buy]
  ].filter(([,items]) => Array.isArray(items) && items.length);
  if (!groups.length) return "";
  return '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>WHERE TO WATCH</span><h2>Available through providers</h2></div></div><div class="vivid-provider-grid">' +
    groups.map(([label,items]) => '<div class="vivid-provider-group"><h3>' + label + '</h3><div>' + items.slice(0,6).map(p => '<a href="' + escapeHtml(p.provider_id ? (country.link || "#") : "#") + '" target="_blank" rel="noopener noreferrer" class="vivid-provider"><img src="' + getImageUrl(p.logo_path,"w92") + '" alt=""><span>' + escapeHtml(p.provider_name) + '</span></a>').join("") + '</div></div>').join("") +
    '</div><p class="vivid-provider-note">Provider availability varies by country. Vivid Cinema does not host or provide the title.</p></section>';
}

function renderSeasons(details) {
  if (media?.media_type !== "tv" || !Array.isArray(details.seasons) || !details.seasons.length) return "";
  const seasons = details.seasons.filter(s => s.season_number >= 0);
  return '<section class="vivid-title-section vivid-seasons"><div class="vivid-section-heading"><div><span>EPISODES</span><h2>Seasons & episodes</h2></div><label class="vivid-season-picker"><span class="vivid-sr-only">Choose season</span><select id="season-select">' + seasons.map(s => '<option value="' + s.season_number + '">' + escapeHtml(s.name || ("Season " + s.season_number)) + '</option>').join("") + '</select></label></div><div id="episode-list" class="vivid-episode-list"><p class="vivid-muted">Loading episodes…</p></div></section>';
}

async function loadSeason(id, seasonNumber) {
  const container = $("episode-list");
  if (!container) return;
  container.innerHTML = '<p class="vivid-muted">Loading episodes…</p>';
  try {
    const data = await tmdbApi.tvSeason(id, seasonNumber);
    const episodes = data.episodes || [];
    container.innerHTML = episodes.length ? episodes.map(ep => '<article class="vivid-episode"><div class="vivid-episode-thumb"><img loading="lazy" src="' + getImageUrl(ep.still_path,"w500") + '" alt="" onerror="this.style.visibility=\'hidden\'"></div><div class="vivid-episode-copy"><div class="vivid-episode-line"><strong>Episode ' + ep.episode_number + '</strong><span>★ ' + (ep.vote_average ? Number(ep.vote_average).toFixed(1) : "—") + '</span></div><h3>' + escapeHtml(ep.name || ("Episode " + ep.episode_number)) + '</h3><small>' + escapeHtml(ep.air_date || "Air date unavailable") + '</small><p>' + escapeHtml(ep.overview || "No episode synopsis is available.") + '</p></div></article>').join("") : '<p class="vivid-muted">No episodes are available for this season.</p>';
  } catch (error) {
    container.innerHTML = '<p class="vivid-muted">' + escapeHtml(getErrorMessage(error)) + '</p>';
  }
}

function wireSeasons(details) {
  if (media?.media_type !== "tv") return;
  const select = $("season-select");
  if (!select) return;
  const id = media.id;
  select.addEventListener("change", () => loadSeason(id, select.value));
  loadSeason(id, select.value || details.seasons?.[0]?.season_number || 0);
}

function render(details) {
  media = normalizeMedia(details, route.params.get("type") === "tv" ? "tv" : "movie");
  const title = media.title;
  const year = media.year || "—";
  const rating = media.vote_average ? media.vote_average.toFixed(1) : "—";
  const runtime = route.params.get("type") === "tv" ? (details.number_of_seasons ? details.number_of_seasons + " season" + (details.number_of_seasons === 1 ? "" : "s") : "") : formatRuntime(details.runtime);
  const genres = (details.genres || []).map(g => '<span>' + escapeHtml(g.name) + '</span>').join("");
  const cast = (details.credits?.cast || []).slice(0,8);
  const key = trailer(details);
  document.title = title + " · Vivid Cinema";
  $("title-content").innerHTML =
    '<section class="vivid-title-hero" style="--title-backdrop:url(' + JSON.stringify(getImageUrl(media.backdrop_path,"w1280")) + ')">' +
      '<div class="vivid-title-hero-overlay"></div><div class="vivid-title-hero-inner">' +
      '<div class="vivid-title-poster"><img src="' + getImageUrl(media.poster_path,"w500") + '" alt="' + escapeHtml(title) + ' poster"></div>' +
      '<div class="vivid-title-copy"><span class="vivid-title-kicker">' + (media.media_type === "tv" ? "TV SERIES" : "MOVIE") + '</span><h1>' + escapeHtml(title) + '</h1>' +
      '<div class="vivid-title-meta"><span>' + year + '</span>' + (runtime ? '<i></i><span>' + escapeHtml(runtime) + '</span>' : '') + '<i></i><span>★ ' + rating + '</span></div>' +
      '<div class="vivid-title-genres">' + genres + '</div><p>' + escapeHtml(media.overview || "No synopsis is available for this title yet.") + '</p>' +
      '<div class="vivid-title-actions">' + (key ? '<a class="vivid-button vivid-button--primary" href="https://www.youtube.com/watch?v=' + encodeURIComponent(key.key) + '" target="_blank" rel="noopener noreferrer"><i class="bi bi-play-fill"></i> Watch trailer</a>' : '') + '<a class="vivid-button vivid-button--secondary" href="home.html"><i class="bi bi-arrow-left"></i> Browse more</a></div>' +
      '</div></div></section>' +
    '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>CAST</span><h2>People in the story</h2></div></div><div class="vivid-cast-grid">' +
      (cast.length ? cast.map(person => '<article class="vivid-cast"><img src="' + getImageUrl(person.profile_path,"w185") + '" alt="' + escapeHtml(person.name) + '"><strong>' + escapeHtml(person.name) + '</strong><small>' + escapeHtml(person.character || "Cast") + '</small></article>').join("") : '<p class="vivid-muted">Cast information is unavailable.</p>') +
    '</div></section>' + renderSeasons(details) + renderProviderGroups(details) +
    '<section class="vivid-title-section"><div class="vivid-section-heading"><div><span>YOU MAY ALSO LIKE</span><h2>Similar titles</h2></div></div><div class="vivid-similar" id="similar-rail"></div></section>';
  const similar = normalizeResults(details.similar?.results || [], media.media_type).slice(0,8);
  wireSeasons(details);
  $("similar-rail").innerHTML = similar.length ? similar.map(item => '<a class="vivid-similar-card" href="' + getMediaUrl(item) + '"><img src="' + getImageUrl(item.poster_path,"w342") + '" alt="' + escapeHtml(item.title) + '"><span>' + escapeHtml(item.title) + '</span><small>★ ' + (item.vote_average ? item.vote_average.toFixed(1) : "—") + '</small></a>').join("") : '<p class="vivid-muted">No similar titles available.</p>';
}

async function init() {
  const id = route.params.get("id");
  const type = route.params.get("type") === "tv" ? "tv" : "movie";
  if (!id) return renderError("This title link is missing its media ID.");
  try {
    const details = type === "tv" ? await tmdbApi.tvDetails(id) : await tmdbApi.movieDetails(id);
    render(details);
  } catch (error) {
    renderError(getErrorMessage(error));
  }
}
document.addEventListener("DOMContentLoaded", init);
