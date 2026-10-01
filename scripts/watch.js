import { tmdbApi } from "./tmdb.js";
import { getImageUrl, normalizeMedia } from "./media.js";
import { buildTitleUrl, getRoute } from "./routes.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { upsertLibraryItem, startLibrarySync } from "./library.js";
import { VIVID_CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
let media = null;
let details = null;

function getParams() {
  const id = route.params.get("id");
  const type = route.params.get("type") === "tv" ? "tv" : "movie";
  const season = Math.max(0, Number.parseInt(route.params.get("season") || "1", 10) || 1);
  const episode = Math.max(1, Number.parseInt(route.params.get("episode") || "1", 10) || 1);
  return { id, type, season, episode };
}

function buildEmbedUrl({ id, type, season, episode }) {
  const base = String(VIVID_CONFIG.vidapiEmbedBaseUrl || "").replace(/\/+$/, "");
  if (type === "tv") return base + "/embed/tv/" + encodeURIComponent(id) + "/" + season + "/" + episode;
  return base + "/embed/movie/" + encodeURIComponent(id);
}

function recordHistory() {
  if (!media) return;
  upsertLibraryItem("history", {
    id: media.id,
    media_type: media.media_type,
    title: media.title,
    year: media.year,
    poster_path: media.poster_path,
    backdrop_path: media.backdrop_path
  });
}

function renderShell(params) {
  const isTv = params.type === "tv";
  const title = media.title;
  const episodeTitle = isTv && details?.episode ? details.episode.name : "";
  document.title = (episodeTitle ? episodeTitle + " · " : "") + title + " · Vivid Cinema";
  $("watch-content").innerHTML = `
    <section class="vivid-watch-hero">
      <div class="vivid-watch-backdrop" style="--watch-backdrop:url('${getImageUrl(media.backdrop_path, "w1280")}')"></div>
      <div class="vivid-watch-head">
        <div>
          <span class="vivid-watch-kicker">${isTv ? "TV · SEASON " + params.season + " · EPISODE " + params.episode : "MOVIE"}</span>
          <h1>${escapeHtml(episodeTitle || title)}</h1>
          <p>${escapeHtml(isTv && details?.episode?.overview ? details.episode.overview : media.overview || "")}</p>
        </div>
        <a class="vivid-button vivid-button--secondary" href="${escapeHtml(buildTitleUrl(media.id, media.media_type))}"><i class="bi bi-info-circle"></i> Details</a>
      </div>
    </section>
    <section class="vivid-player-section" aria-label="Video player">
      <div class="vivid-player-frame">
        <iframe id="vidapi-player" title="${escapeHtml(title)} player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="origin" loading="eager"></iframe>
      </div>
      <div class="vivid-player-bar">
        <div><i class="bi bi-shield-check"></i><span>Powered by VidAPI</span></div>
        <a href="${escapeHtml(buildTitleUrl(media.id, media.media_type))}">Back to title</a>
      </div>
    </section>
    ${isTv ? '<section class="vivid-watch-note"><i class="bi bi-collection-play"></i><div><strong>Episode playback</strong><span>Use the episode list on the title page to switch seasons and episodes.</span></div></section>' : ""}
  `;
  $("vidapi-player").src = buildEmbedUrl(params);
  recordHistory();
}

async function load() {
  const params = getParams();
  if (!params.id) {
    $("watch-content").innerHTML = '<section class="vivid-watch-error"><i class="bi bi-exclamation-circle"></i><h1>Playback link is incomplete.</h1><p>Choose a title from Vivid Cinema and start playback again.</p><a class="vivid-button vivid-button--secondary" href="home.html">Browse titles</a></section>';
    return;
  }
  try {
    details = params.type === "tv"
      ? await tmdbApi.tvDetails(params.id)
      : await tmdbApi.movieDetails(params.id);
    media = normalizeMedia(details, params.type);
    if (params.type === "tv") {
      try {
        details.episode = await tmdbApi.tvSeason(params.id, params.season).then((season) => season.episodes?.find((episode) => episode.episode_number === params.episode) || null);
      } catch (_) {
        details.episode = null;
      }
    }
    renderShell(params);
  } catch (error) {
    $("watch-content").innerHTML = '<section class="vivid-watch-error"><i class="bi bi-exclamation-circle"></i><h1>We couldn’t prepare playback.</h1><p>' + escapeHtml(getErrorMessage(error)) + '</p><a class="vivid-button vivid-button--secondary" href="home.html">Back to browse</a></section>';
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await startLibrarySync();
  load();
});
