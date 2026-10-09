import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { buildTitleUrl, getRoute } from "./routes.js";
import { escapeHtml } from "./utils.js";
import { getLocalLibrary, saveLocalLibrary, upsertLibraryItem, startLibrarySync } from "./library.js";
import { getPlaybackProgress, savePlaybackProgress, flushPlaybackProgress, completePlaybackProgress, startPlaybackSync } from "./recommendations.js";
import { VIVID_CONFIG } from "./config.js";
import { recordBehavior, startIntelligenceSync } from "./intelligence.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
const VIDAPI_ORIGINS = new Set([new URL(VIVID_CONFIG.api.vidapiEmbedBaseUrl).origin, "https://vidapi.ru"]);
const VIDLINK_ORIGIN = "https://vidlink.pro";
const VIDPLUS_ORIGIN = "https://player.vidplus.to";
const VIDSRC_ORIGIN = (() => {
  try { return new URL(VIVID_CONFIG.api.vidsrcEmbedBaseUrl || "https://vidsrc.cc").origin; }
  catch { return "https://vidsrc.cc"; }
})();
let media = null;
let details = null;
let currentParams = null;
let lastHistorySyncAt = 0;
let activeSource = "vidapi";
const sourceAttempted = new Set();
let primaryHealthy = false;
let fallbackTimer = null;
let imdbId = "";
let tmdbId = "";
let aniListId = "";
let malId = "";
const PRIMARY_FALLBACK_MS = 15000;
const ANIME_FALLBACK_MS = 9000;

function getParams() {
  const id = route.params.get("id");
  const type = route.params.get("type") === "tv" ? "tv" : "movie";
  const season = Math.max(0, Number.parseInt(route.params.get("season") || "1", 10) || 1);
  const episode = Math.max(1, Number.parseInt(route.params.get("episode") || "1", 10) || 1);
  return { id, type, season, episode };
}

function progressKey() {
  return media ? media.media_type + ":" + media.id + (media.media_type === "tv" && currentParams ? ":" + currentParams.season + ":" + currentParams.episode : "") : "";
}

function resolveImdbId(source) {
  if (!source) return "";
  const raw = source.external_ids?.imdb_id || source.imdb_id || source.external_ids?.imdb || "";
  const id = String(raw || "").trim();
  return /^tt\d+$/i.test(id) ? id : "";
}

function buildVidapiEmbedUrl(params, startAt = 0) {
  const base = String(VIVID_CONFIG.api.vidapiEmbedBaseUrl || "").replace(/\/+$/, "");
  const query = new URLSearchParams({ autoplay: "1", controls: "1", overlay: "1" });
  if (Number(startAt) > 5) query.set("resumeAt", String(Math.floor(Number(startAt))));
  return params.type === "tv"
    ? base + "/embed/tv/" + encodeURIComponent(params.id) + "/" + params.season + "/" + params.episode + "?" + query
    : base + "/embed/movie/" + encodeURIComponent(params.id) + "?" + query;
}

function buildVidlinkEmbedUrl(params) {
  const base = String(VIVID_CONFIG.api.vidlinkEmbedBaseUrl || "https://vidlink.pro").replace(/\/+$/, "");
  if (route.params.get("anime") === "1") {
    if (!malId) return "";
    return base + "/anime/" + encodeURIComponent(malId) + "/" + params.episode + "/sub?fallback=true";
  }
  const id = encodeURIComponent(tmdbId || imdbId || params.id);
  return params.type === "tv"
    ? base + "/tv/" + id + "/" + params.season + "/" + params.episode
    : base + "/movie/" + id;
}

function buildVidsrcEmbedUrl(params) {
  const base = String(VIVID_CONFIG.api.vidsrcEmbedBaseUrl || "https://vidsrc.sh").replace(/\/+$/, "");
  // VidSrc accepts numeric TMDB IDs, so the fallback stays fully TMDB-based.
  const id = encodeURIComponent(tmdbId || imdbId);
  if (params.type === "tv") {
    return base + "/embed/tv/" + id + "/" + params.season + "/" + params.episode;
  }
  return base + "/embed/movie/" + id;
}

function buildVidplusEmbedUrl(params) {
  const base = String(VIVID_CONFIG.api.vidplusEmbedBaseUrl || "https://player.vidplus.to").replace(/\/+$/, "");
  if (route.params.get("anime") === "1") {
    if (!aniListId) return "";
    return base + "/embed/anime/" + encodeURIComponent(aniListId) + "/" + params.episode + "?dub=false";
  }
  const id = encodeURIComponent(tmdbId || params.id);
  return params.type === "tv"
    ? base + "/embed/tv/" + id + "/" + params.season + "/" + params.episode
    : base + "/embed/movie/" + id;
}

async function resolveAnimeIds(title) {
  if (route.params.get("anime") !== "1" || !title) return { aniListId: "", malId: "" };
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "query($search:String!){Media(search:$search,type:ANIME){id idMal title{romaji english native}}}",
        variables: { search: title }
      })
    });
    if (!response.ok) return { aniListId: "", malId: "" };
    const data = await response.json();
    const media = data?.data?.Media;
    return {
      aniListId: String(media?.id || ""),
      malId: String(media?.idMal || "")
    };
  } catch {
    return { aniListId: "", malId: "" };
  }
}

function isLikelyAnime() {
  const genres = Array.isArray(details?.genres) ? details.genres : [];
  const isAnimation = genres.some(g => Number(g?.id) === 16 || String(g?.name || "").toLowerCase() === "animation");
  return currentParams?.type === "tv" && (isAnimation && String(details?.original_language || "").toLowerCase() === "ja");
}

function fallbackDelayMs() {
  return isLikelyAnime() ? ANIME_FALLBACK_MS : PRIMARY_FALLBACK_MS;
}

function hasFallbackId() {
  return Boolean(tmdbId || imdbId);
}

function isAnimePlayback() {
  return route.params.get("anime") === "1";
}

function sourceAvailable(source) {
  if (isAnimePlayback()) {
    if (source === "vidplus") return Boolean(aniListId);
    if (source === "vidlink") return Boolean(malId);
    return false;
  }
  if (source === "vidapi") return true;
  return hasFallbackId();
}

function getNextSource(source) {
  const order = isAnimePlayback()
    ? ["vidplus", "vidlink"]
    : ["vidapi", "vidsrc", "vidlink", "vidplus"];
  const index = order.indexOf(source);
  const candidates = isAnimePlayback() ? order.filter(candidate => candidate !== source) : order.slice(index + 1);
  return candidates.find(candidate => !sourceAttempted.has(candidate) && sourceAvailable(candidate)) || null;
}

function getSourceLabel(source) {
  if (source === "vidsrc") return "VidSrc alternate source";
  if (source === "vidlink") return "VidLink alternate source";
  if (source === "vidplus") return "VidPlus alternate source";
  return "Powered by VidAPI";
}

function triggerFallback(reason = "source_error") {
  if (!currentParams || (isAnimePlayback() ? !(aniListId || malId) : !hasFallbackId())) return false;
  const nextSource = getNextSource(activeSource);
  if (!nextSource) {
    const status = $("player-status");
    if (status) {
      status.textContent = "This title could not start on the available players. Choose another source or try again later.";
      status.classList.add("is-warning");
      status.hidden = false;
    }
    return false;
  }

  clearFallbackTimer();
  const status = $("player-status");
  if (status) {
    status.textContent = "Primary source unavailable — trying alternate…";
    status.classList.add("is-warning");
    status.hidden = false;
  }

  console.warn("Vivid playback fallback:", activeSource, "→", nextSource, reason);
  setPlayerSource(nextSource, currentParams, Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || 0));
  return true;
}

function clearFallbackTimer() {
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

function updateSourceLabel() {
  const label = document.getElementById("player-source-label");
  if (label) label.textContent = getSourceLabel(activeSource);
  document.querySelectorAll("[data-player-source]").forEach(button => {
    const source = button.getAttribute("data-player-source");
    button.classList.toggle("is-active", source === activeSource);
    button.hidden = isAnimePlayback() && !["vidplus", "vidlink"].includes(source);
    button.disabled = !sourceAvailable(source);
    button.setAttribute("aria-pressed", source === activeSource ? "true" : "false");
  });
}

function setPlayerSource(source, params, startAt = 0) {
  const player = $("vidapi-player");
  if (!player || !params) return;
  clearFallbackTimer();
  if (!["vidapi", "vidsrc", "vidlink", "vidplus"].includes(source) || !sourceAvailable(source)) return;
  activeSource = source;
  sourceAttempted.add(source);
  const status = $("player-status");

  if (source === "vidlink") {
    if (route.params.get("anime") === "1" ? !malId : !hasFallbackId()) return;
    primaryHealthy = false;
    const vidlinkUrl = buildVidlinkEmbedUrl(params);
    if (!vidlinkUrl) return;
    player.src = vidlinkUrl;
    if (status) {
      status.textContent = "Loading VidLink alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      if (primaryHealthy || activeSource !== "vidlink") return;
      const next = getNextSource(activeSource);
      if (next) setPlayerSource(next, currentParams, Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || 0));
      else {
        const currentStatus = $("player-status");
        if (currentStatus) {
          currentStatus.textContent = "No other player sources are available for this title. Try selecting a source again later.";
          currentStatus.classList.add("is-warning");
          currentStatus.hidden = false;
        }
      }
    }, PRIMARY_FALLBACK_MS);
  } else if (source === "vidsrc") {
    if (!hasFallbackId()) return;
    primaryHealthy = false;
    player.src = buildVidsrcEmbedUrl(params);
    if (status) {
      status.textContent = "Loading VidSrc alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      if (primaryHealthy || activeSource !== "vidsrc") return;
      const next = getNextSource(activeSource);
      if (next) setPlayerSource(next, currentParams, Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || 0));
      else {
        const currentStatus = $("player-status");
        if (currentStatus) {
          currentStatus.textContent = "No other player sources are available for this title. Try selecting a source again later.";
          currentStatus.classList.add("is-warning");
          currentStatus.hidden = false;
        }
      }
    }, PRIMARY_FALLBACK_MS);
  } else if (source === "vidplus") {
    if (route.params.get("anime") === "1" ? !aniListId : !hasFallbackId()) return;
    primaryHealthy = false;
    const vidplusUrl = buildVidplusEmbedUrl(params);
    if (!vidplusUrl) return;
    player.src = vidplusUrl;
    if (status) {
      status.textContent = "Loading VidPlus alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      if (primaryHealthy || activeSource !== "vidplus") return;
      const next = getNextSource(activeSource);
      if (next) setPlayerSource(next, currentParams, Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || 0));
      else {
        const currentStatus = $("player-status");
        if (currentStatus) {
          currentStatus.textContent = "No other player sources are available for this title. Try selecting a source again later.";
          currentStatus.classList.add("is-warning");
          currentStatus.hidden = false;
        }
      }
    }, PRIMARY_FALLBACK_MS);
  } else {
    primaryHealthy = false;
    player.src = buildVidapiEmbedUrl(params, startAt);
    if (status) {
      status.textContent = Number(startAt) > 5 ? "Resuming where you left off…" : "Preparing playback…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    if (hasFallbackId()) {
      fallbackTimer = window.setTimeout(() => {
        if (primaryHealthy || activeSource !== "vidapi") return;
        triggerFallback("primary_timeout");
      }, fallbackDelayMs());
    }
  }
  updateSourceLabel();
}
function historyItem(extra = {}) {
  return {
    id: media.id,
    media_type: media.media_type,
    title: media.title,
    year: media.year,
    poster_path: media.poster_path,
    backdrop_path: media.backdrop_path,
    ...extra
  };
}

function recordHistory() {
  if (!media || !media.title || /^Loading\b/.test(media.title)) return;
  const library = getLocalLibrary();
  const existing = (library.history || []).find(
    item => item.media_type === media.media_type && String(item.id) === String(media.id)
  );
  upsertLibraryItem("history", historyItem({
    startedAt: Number(existing?.startedAt) || Date.now(),
    lastWatchedAt: Date.now(),
    watchedSeconds: Number(existing?.watchedSeconds) || 0,
    completion: Number(existing?.completion) || 0
  }));
}

function recordWatchActivity(progress, duration) {
  if (!media || progress <= 0) return;
  const library = getLocalLibrary();
  const existing = (library.history || []).find(
    item => item.media_type === media.media_type && String(item.id) === String(media.id)
  );
  const percentage = duration > 0 ? Math.min(100, (progress / duration) * 100) : Number(existing?.completion) || 0;
  const now = Date.now();
  const item = historyItem({
    startedAt: Number(existing?.startedAt) || now,
    lastWatchedAt: now,
    watchedSeconds: Math.max(Number(existing?.watchedSeconds) || 0, progress),
    completion: Math.max(Number(existing?.completion) || 0, percentage),
    updatedAt: now
  });
  saveLocalLibrary({
    ...library,
    history: [item, ...(library.history || []).filter(entry => entry !== existing)]
  });
  if (now - lastHistorySyncAt >= 30000) {
    lastHistorySyncAt = now;
    // upsertLibraryItem already performs the normal local-first/cloud sync path.
    upsertLibraryItem("history", item);
  }
}

function recommendationCards() {
  const items = normalizeResults(details?.recommendations?.results || [], media?.media_type).slice(0, 10);
  const fallback = normalizeResults(details?.similar?.results || [], media?.media_type).slice(0, 10);
  const list = items.length ? items : fallback;
  return list.length
    ? list.map(item =>
        '<a class="vivid-watch-rec-card" href="' + escapeHtml(getMediaUrl(item)) + '">' +
          '<img loading="lazy" src="' + getImageUrl(item.poster_path, "w342") + '" alt="' + escapeHtml(item.title) + '">' +
          '<strong>' + escapeHtml(item.title) + '</strong>' +
          '<small>★ ' + (item.vote_average ? item.vote_average.toFixed(1) : "—") + '</small>' +
        '</a>'
      ).join("")
    : '<p class="vivid-muted">More recommendations will appear as you explore Vivid.</p>';
}

async function loadWatchRecommendations(params) {
  const rail = $("watch-recommendations");
  if (!rail || !media || !params?.id) return;

  const hasResults = () =>
    (details?.recommendations?.results || []).length > 0 ||
    (details?.similar?.results || []).length > 0;

  if (!hasResults()) {
    try {
      const recommendations = params.type === "tv"
        ? await tmdbApi.tvRecommendations(params.id)
        : await tmdbApi.movieRecommendations(params.id);
      if ((recommendations?.results || []).length) {
        details.recommendations = recommendations;
      } else {
        const similar = params.type === "tv"
          ? await tmdbApi.tvSimilar(params.id)
          : await tmdbApi.movieSimilar(params.id);
        if ((similar?.results || []).length) details.similar = similar;
      }
    } catch (error) {
      console.warn("Vivid watch recommendations unavailable:", error);
    }
  }

  if (rail.isConnected) rail.innerHTML = recommendationCards();
}

function renderShell(params) {
  const isTv = params.type === "tv";
  const title = media.title || "Vivid Cinema";
  const episodeTitle = isTv && details?.episode ? details.episode.name : "";
  const saved = getPlaybackProgress(progressKey());
  const resumeAt = Number(saved?.progress || route.params.get("startAt") || 0);

  document.title = (episodeTitle ? episodeTitle + " · " : "") + title + " · Vivid Cinema";
  $("watch-content").innerHTML =
    '<section class="vivid-watch-hero"><div id="watch-backdrop" class="vivid-watch-backdrop" style="--watch-backdrop:url(\'' + getImageUrl(media.backdrop_path, "w1280") + '\')"></div>' +
      '<div class="vivid-watch-head"><div class="vivid-watch-artwork"><img src="' + getImageUrl(media.poster_path, "w342") + '" alt="' + escapeHtml(title) + ' poster" loading="eager" decoding="async"></div><div class="vivid-watch-copy"><span id="watch-kicker" class="vivid-watch-kicker">' + (isAnimePlayback() ? (isTv ? "ANIME · SEASON " + params.season + " · EPISODE " + params.episode : "ANIME FILM") : isTv ? "TV · SEASON " + params.season + " · EPISODE " + params.episode : "MOVIE") + '</span>' +
        '<h1 id="watch-title">' + escapeHtml(episodeTitle || title) + '</h1><p id="watch-overview">' + escapeHtml(isTv && details?.episode?.overview ? details.episode.overview : media.overview || "") + '</p>' +
      '</div><a class="vivid-button vivid-button--secondary" href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '"><i class="bi bi-info-circle"></i> Details</a></div></section>' +
    '<section class="vivid-player-section" aria-label="Video player"><div class="vivid-player-frame">' +
      '<div id="player-status" class="vivid-player-status" role="status" aria-live="polite">' + (resumeAt > 5 ? "Resuming where you left off…" : "Preparing playback…") + '</div>' +
      '<iframe id="vidapi-player" title="' + escapeHtml(title) + ' player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write" allowfullscreen referrerpolicy="origin" loading="eager"></iframe>' +
    '</div><div class="vivid-player-bar"><div class="vivid-player-source-group" role="group" aria-label="Choose player source"><span class="vivid-player-source-caption"><i class="bi bi-broadcast-pin"></i> PLAYER</span><button type="button" class="vivid-player-source" data-player-source="vidapi" aria-pressed="true">VidAPI</button><button type="button" class="vivid-player-source" data-player-source="vidsrc" aria-pressed="false">VidSrc</button><button type="button" class="vivid-player-source" data-player-source="vidlink" aria-pressed="false">VidLink</button><button type="button" class="vivid-player-source" data-player-source="vidplus" aria-pressed="false">VidPlus</button></div><div class="vivid-player-bar-actions"><span id="player-source-label">Powered by VidAPI</span><a href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '">Back to title</a></div></div></section>' +
    (isTv ? '<section class="vivid-watch-note"><i class="bi bi-collection-play"></i><div><strong>Episode playback</strong><span>Use the episode list on the title page to switch seasons and episodes.</span></div></section>' : "") +
    '<section class="vivid-watch-recommendations"><div class="vivid-section-heading"><div><span>AFTER WATCHING</span><h2>More like this</h2></div></div><div id="watch-recommendations" class="vivid-watch-rec-rail">' + recommendationCards() + '</div></section>';

  const player = $("vidapi-player");
  const status = $("player-status");
  if (player) {
    player.addEventListener("load", () => {
      // A cross-origin iframe load only proves the document loaded; it does not prove
      // that the VidAPI player found a playable source. PLAYER_EVENT is the health signal.
      window.setTimeout(() => {
        if (status && status.isConnected && activeSource === "vidapi" && primaryHealthy && !status.classList.contains("is-warning")) {
          status.hidden = true;
        }
      }, 450);
    });
    player.addEventListener("error", () => {
      triggerFallback("iframe_error");
    });
    // Start on VidAPI. Users can explicitly choose any alternate source below;\n    // automatic fallback only moves forward from a failed provider.
    if (isAnimePlayback()) {
      if (status) status.textContent = "Matching this title to an anime player…";
      updateSourceLabel();
    } else {
      sourceAttempted.clear();
      setPlayerSource("vidapi", params, resumeAt);
    }
    document.querySelectorAll("[data-player-source]").forEach(button => {
      button.addEventListener("click", () => {
        const source = button.getAttribute("data-player-source");
        if (!["vidapi", "vidsrc", "vidlink", "vidplus"].includes(source) || !sourceAvailable(source)) return;
        sourceAttempted.clear();
        setPlayerSource(source, params, resumeAt);
      });
    });
  }
  window.setTimeout(() => {
    const current = $("player-status");
    if (!isAnimePlayback() && current && current.isConnected && !current.hidden && activeSource === "vidapi" && !primaryHealthy) {
      current.textContent = "Playback is taking longer than expected. The player is still loading.";
      current.classList.add("is-warning");
    }
  }, fallbackDelayMs() + 2500);
  recordHistory();
  recordBehavior("watch_started", media, { season: params.season, episode: params.episode, resumeAt });
}

function hydrateWatchDetails(params) {
  if (!media) return;
  const isTv = params.type === "tv";
  const episodeTitle = isTv && details?.episode ? details.episode.name : "";
  const title = media.title || "Vivid Cinema";
  $("watch-title")?.replaceChildren(document.createTextNode(episodeTitle || title));
  $("watch-overview")?.replaceChildren(document.createTextNode(isTv && details?.episode?.overview ? details.episode.overview : media.overview || ""));
  const kicker = $("watch-kicker");
  if (kicker) kicker.textContent = isAnimePlayback() ? (isTv ? "ANIME · SEASON " + params.season + " · EPISODE " + params.episode : "ANIME FILM") : isTv ? "TV · SEASON " + params.season + " · EPISODE " + params.episode : "MOVIE";
  const backdrop = $("watch-backdrop");
  if (backdrop) backdrop.style.setProperty("--watch-backdrop", "url('" + getImageUrl(media.backdrop_path, "w1280") + "')");
  const player = $("vidapi-player");
  if (player) player.title = title + " player";
  const recommendations = $("watch-recommendations");
  if (recommendations) recommendations.innerHTML = recommendationCards();
  document.title = (episodeTitle ? episodeTitle + " · " : "") + title + " · Vivid Cinema";
}

function handlePlayerEvent(event) {
  const player = $("vidapi-player");
  if (!player || event.source !== player.contentWindow) return;
  const isVidapi = VIDAPI_ORIGINS.has(event.origin);
  const isFallback = event.origin === VIDSRC_ORIGIN;
  const isVidLink = event.origin === VIDLINK_ORIGIN;
  const isVidPlus = event.origin === VIDPLUS_ORIGIN;
  if (!isVidapi && !isFallback && !isVidLink && !isVidPlus) return;
  const payload = event.data;
  if (!payload || typeof payload !== "object") return;

  // VidAPI can report provider/player failures through postMessage. Catch common
  // status/code/error shapes before treating any PLAYER_EVENT as a healthy player.
  const eventData = payload.data || payload;
  const statusValue = String(eventData.player_status || eventData.status || eventData.event || "").toLowerCase();
  const errorValue = String(eventData.error || eventData.error_code || eventData.code || eventData.message || "").toLowerCase();
  const numericCode = Number(eventData.status_code ?? eventData.http_status ?? eventData.httpStatus ?? eventData.statusCode);
  const looksLikeFailure =
    (Number.isFinite(numericCode) && numericCode >= 400) ||
    /(^|\D)(404|403|500|502|503)(\D|$)/.test(errorValue) ||
    /(error|failed|failure|not.?found|unavailable|offline|load.?failed|source.?failed)/.test(statusValue + " " + errorValue);

  if (looksLikeFailure && (activeSource === "vidapi" || activeSource === "vidsrc" || activeSource === "vidlink" || activeSource === "vidplus")) {
    triggerFallback((isVidapi ? "vidapi_" : activeSource + "_") + (numericCode || statusValue || "error"));
    return;
  }

  if (!payload.data) return;
  // VidAPI has a formal PLAYER_EVENT contract; fallbacks may expose simpler
  // playback messages. Only treat explicit playback/progress signals as healthy.
  const isPlaybackSignal =
    isVidLink ||
    isVidPlus ||
    payload.type === "PLAYER_EVENT" ||
    /^(play|playing|timeupdate|progress|loadedmetadata|canplay|ready|started)$/i.test(statusValue) ||
    Number(eventData.player_progress) > 0;
  if (!isPlaybackSignal) return;
  const data = payload.data;
  if (isVidLink) {
    const vidlinkMediaType = String(data.mediaType || "").toLowerCase();
    const vidlinkId = String(data.tmdbId || data.tmdb || "").trim();
    if (vidlinkMediaType && vidlinkMediaType !== String(media?.media_type || "").toLowerCase()) return;
    if (vidlinkId && vidlinkId !== String(media?.id || "")) return;
    primaryHealthy = true;
    clearFallbackTimer();
    const status = $("player-status");
    if (status) status.hidden = true;
    const progress = Number(data.currentTime) || 0;
    const duration = Number(data.duration) || 0;
    const season = data.season ?? currentParams?.season;
    const episode = data.episode ?? currentParams?.episode;
    if (progress > 0) {
      savePlaybackProgress(progressKey(), {
        progress, duration, season, episode,
        title: media.title, media_type: media.media_type, id: media.id
      });
      recordWatchActivity(progress, duration);
      recordBehavior("playback_progress", media, {
        progress, duration,
        percentage: duration ? Math.round(progress / duration * 100) : 0,
        season, episode
      });
    }
    if (/^(ended|completed)$/i.test(String(data.event || ""))) {
      recordBehavior("watch_completed", media, { duration, season, episode });
      upsertLibraryItem("history", { ...historyItem(), completion: 100, completedAt: Date.now(), updatedAt: Date.now() });
      completePlaybackProgress(progressKey(), {
        duration, season, episode,
        title: media.title, media_type: media.media_type, id: media.id
      });
    }
    return;
  }
  const info = data.player_info || {};
  // Validate the event before marking the source healthy. Cross-origin players can
  // emit generic events, and an unrelated/late event must never suppress fallback.
  if (String(info.mediaType || "") !== String(media?.media_type || "")) return;
  if (isVidapi && info.tmdb != null && String(info.tmdb) !== String(media?.id)) return;
  if (currentParams?.type === "tv") {
    if (info.season != null && Number(info.season) !== Number(currentParams.season)) return;
    if (info.episode != null && Number(info.episode) !== Number(currentParams.episode)) return;
  }
  // A validated playback/progress event means the active embed is alive.
  primaryHealthy = true;
  clearFallbackTimer();
  const status = $("player-status");
  if (status) status.hidden = true;
  const progress = Number(data.player_progress) || 0;
  const duration = Number(data.player_duration) || 0;
  if (progress > 0) {
    savePlaybackProgress(progressKey(), {
      progress, duration,
      season: info.season ?? currentParams?.season,
      episode: info.episode ?? currentParams?.episode,
      title: media.title, media_type: media.media_type, id: media.id
    });
    recordWatchActivity(progress, duration);
    recordBehavior("playback_progress", media, {
      progress, duration,
      percentage: duration ? Math.round(progress / duration * 100) : 0,
      season: info.season ?? currentParams?.season,
      episode: info.episode ?? currentParams?.episode
    });
  }
  if (data.player_status === "completed") {
    recordBehavior("watch_completed", media, { duration, season: info.season ?? currentParams?.season, episode: info.episode ?? currentParams?.episode });
    upsertLibraryItem("history", { ...historyItem(), completion: 100, completedAt: Date.now(), updatedAt: Date.now() });
    completePlaybackProgress(progressKey(), {
      duration, season: info.season ?? currentParams?.season, episode: info.episode ?? currentParams?.episode,
      title: media.title, media_type: media.media_type, id: media.id
    });
    // Stay on the current player after completion. Next-episode navigation is explicit only.
  }
}

window.addEventListener("message", handlePlayerEvent);

async function load() {
  currentParams = getParams();
  if (!currentParams.id) {
    $("watch-content").innerHTML = '<section class="vivid-watch-error"><i class="bi bi-exclamation-circle"></i><h1>Playback link is incomplete.</h1><p>Choose a title from Vivid Cinema and start playback again.</p><a class="vivid-button vivid-button--secondary" href="home.html">Browse titles</a></section>';
    return;
  }
  media = normalizeMedia({ id: currentParams.id, overview: "", title: currentParams.type === "tv" ? "Loading episode…" : "Loading movie…", poster_path: "", backdrop_path: "" }, currentParams.type);
  renderShell(currentParams);
  try {
    details = currentParams.type === "tv" ? await tmdbApi.tvDetails(currentParams.id) : await tmdbApi.movieDetails(currentParams.id);
    media = normalizeMedia(details, currentParams.type);
    imdbId = resolveImdbId(details);
    tmdbId = /^\d+$/.test(String(currentParams.id || "")) ? String(currentParams.id) : String(details?.id || "");
    const animeIds = await resolveAnimeIds(media?.title || details?.name || details?.title || "");
    aniListId = animeIds.aniListId;
    malId = animeIds.malId;
    updateSourceLabel();
    if (isAnimePlayback()) {
      const saved = getPlaybackProgress(progressKey());
      const resumeAt = Number(saved?.progress || route.params.get("startAt") || 0);
      sourceAttempted.clear();
      const firstAnimeSource = aniListId ? "vidplus" : malId ? "vidlink" : "";
      if (firstAnimeSource) {
        setPlayerSource(firstAnimeSource, currentParams, resumeAt);
      } else {
        const status = $("player-status");
        if (status) {
          status.textContent = "This title could not be matched to an anime player. Try another title or return to the anime catalogue.";
          status.classList.add("is-warning");
          status.hidden = false;
        }
      }
    }
    if (currentParams.type === "tv") {
      details.episode = await tmdbApi.tvSeason(currentParams.id, currentParams.season)
        .then(season => (season.episodes || []).find(ep => Number(ep.episode_number) === Number(currentParams.episode)) || null)
        .catch(() => null);
    }
    hydrateWatchDetails(currentParams);
    void loadWatchRecommendations(currentParams);
    // Metadata arrived after shell — re-arm
    // the primary timer if the player is still waiting.
    updateSourceLabel();
    if (!isAnimePlayback() && hasFallbackId() && activeSource === "vidapi" && !primaryHealthy && !fallbackTimer) {
      const saved = getPlaybackProgress(progressKey());
      const resumeAt = Number(saved?.progress || route.params.get("startAt") || 0);
      fallbackTimer = window.setTimeout(() => {
        if (primaryHealthy || activeSource !== "vidapi") return;
        triggerFallback("primary_timeout_after_metadata");
      }, fallbackDelayMs());
    }
  } catch (error) {
    console.warn("Vivid metadata unavailable while playback is active:", error);
    const overviewNode = $("watch-overview");
    if (overviewNode) overviewNode.textContent = "Playback is ready. Title information is temporarily unavailable.";
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentParams?.id) void flushPlaybackProgress(progressKey());
});

document.addEventListener("DOMContentLoaded", () => {
  void startLibrarySync().catch(() => {});
  void startIntelligenceSync().catch(() => {});
  void startPlaybackSync().catch(() => {});
  load();
});
