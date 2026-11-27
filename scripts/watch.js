import { tmdbApi } from "./tmdb.js";
import { resolveAndroidPlayerBackAction } from "./android-navigation.js";
import { resolveAnimeIds } from "./playback/anime-id-resolver.js";
import { isFreeAnimePreviewRoute } from "./anime-free-policy.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { buildTitleUrl, buildWatchUrl, getRoute } from "./routes.js";
import { escapeHtml } from "./utils.js";
import { getLocalLibrary, saveLocalLibrary, upsertLibraryItem, startLibrarySync } from "./library.js";
import { getPlaybackProgress, savePlaybackProgress, flushPlaybackProgress, completePlaybackProgress, startPlaybackSync } from "./recommendations.js";
import { VIVID_CONFIG } from "./config.js";
import { recordBehavior, startIntelligenceSync } from "./intelligence.js";
import { playDirectStream, resolveDirectStream, stopDirectStream } from "./playback/player-engine.js";
import { buildCustomEmbedUrl, getCustomPlaybackServer } from "./playback/playback-servers.js";
import { mountWatchRoomPlayerLayout } from "./watch-room-player-layout.js";
import { buildVidapiEmbedUrl, buildVidsrcEmbedUrl, buildVidlinkEmbedUrl, buildVidplusEmbedUrl, buildVidkingEmbedUrl, buildEmbedWaveUrl, buildVidFastUrl, buildEzVidApiUrl, buildEmbedApiStreamUrl, buildMoviesApiUrl } from "./playback/playback-urls.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
let isWatchRoomCinemaMode = route.params.get("roomMode") === "1" && Boolean(route.params.get("roomId"));
if (isWatchRoomCinemaMode) {
  document.body.classList.add("vivid-watch-room-mode");
  document.getElementById("wr-screening-player-host")?.removeAttribute("hidden");
}
const VIDAPI_ORIGINS = new Set([new URL(VIVID_CONFIG.api.vidapiEmbedBaseUrl).origin, "https://vidapi.ru", "https://vidapi.me", "https://vidapi.to", "https://vidapi.bz", "https://vidapi.tw"]);
const VIDLINK_ORIGINS = new Set(["https://vidlink.pro", "https://www.vidlink.pro"]);
const VIDPLUS_ORIGINS = new Set(["https://player.vidplus.to", "https://vidplus.to", "https://www.vidplus.to"]);
const VIDKING_ORIGINS = new Set(["https://www.vidking.net", "https://vidking.net"]);
const VIDSRC_ORIGINS = new Set(["https://vidsrc.sh", "https://vidsrc.cc", "https://vidsrc2.ru"]);
const MOVIESAPI_ORIGINS = new Set(["https://moviesapi.to", "https://www.moviesapi.to"]);
try { VIDSRC_ORIGINS.add(new URL(VIVID_CONFIG.api.vidsrcEmbedBaseUrl || "https://vidsrc.sh").origin); } catch { /* Keep the known HTTPS provider allowlist. */ }
let media = null;
let details = null;
let watchRoomScreeningValidated = false;
let roomOpenPlayerWindow = null;
let roomPlayerLayout = null;
let roomPlayerSlot = null;
let pendingRoomPlayerSelection = null;
let currentParams = null;
let lastHistorySyncAt = 0;
let persistDirectProgress = null;
let activeSource = "vidapi";
const sourceAttempted = new Set();
let primaryHealthy = false;
let fallbackTimer = null;
let fallbackPromptDismissTimer = null;
let directLoadGeneration = 0;
let imdbId = "";
let tmdbId = "";
let aniListId = "";
let malId = "";
const PRIMARY_FALLBACK_MS = 11000;
const ANIME_FALLBACK_MS = 11000;
const SOURCE_PREFERENCES_KEY = "vivid:playback-source-preferences:v3";
const MAX_REMEMBERED_SOURCES = 100;

function readSourcePreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(SOURCE_PREFERENCES_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function sourcePreferenceKey() {
  const type = media?.media_type || currentParams?.type || "movie";
  const id = media?.id || currentParams?.id;
  return id == null ? "" : String(type) + ":" + String(id);
}

function getRememberedSource() {
  if (isAnimePlayback()) return null;
  const key = sourcePreferenceKey();
  const source = key ? readSourcePreferences()[key]?.source : null;
  return ["vidapi", "vidsrc", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi"].includes(source) && sourceAvailable(source)
    ? source
    : null;
}

function rememberSuccessfulSource(source) {
  if (isAnimePlayback() || !media?.id || !["vidapi", "vidsrc", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi"].includes(source)) return;
  const key = sourcePreferenceKey();
  if (!key) return;
  try {
    const preferences = readSourcePreferences();
    preferences[key] = { source, updatedAt: Date.now() };
    const recent = Object.entries(preferences)
      .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
      .slice(0, MAX_REMEMBERED_SOURCES);
    localStorage.setItem(SOURCE_PREFERENCES_KEY, JSON.stringify(Object.fromEntries(recent)));
  } catch {
    // Playback must continue even when browser storage is unavailable or full.
  }
}

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


function isLikelyAnime() {
  const genres = Array.isArray(details?.genres) ? details.genres : [];
  const isAnimation = genres.some(g => Number(g?.id) === 16 || String(g?.name || "").toLowerCase() === "animation");
  return isAnimation && String(details?.original_language || "").toLowerCase() === "ja";
}

function fallbackDelayMs() {
  return isLikelyAnime() ? ANIME_FALLBACK_MS : PRIMARY_FALLBACK_MS;
}

function hasFallbackId() {
  return Boolean(tmdbId || imdbId || /^tt\d+$/i.test(String(currentParams?.id || "")));
}

function hasTmdbId() {
  return Boolean(tmdbId || /^\d+$/.test(String(currentParams?.id || "")));
}

function isAnimePlayback() {
  return route.params.get("anime") === "1";
}

function sourceAvailable(source) {
  if (["archive", "commons", "loc"].includes(source)) return !isAnimePlayback() && currentParams?.type === "movie";
  if (typeof source === "string" && source.startsWith("custom:")) return false;
  if (source === "direct") return false;
  if (isAnimePlayback()) return source === "vidapi" && hasFallbackId();
  if (source === "vidapi" || source === "vidsrc" || source === "vidfast" || source === "embedapistream" || source === "moviesapi") return hasFallbackId();
  if (source === "embedwave" || source === "ezvidapi") return hasTmdbId();
  return false;
}

function getNextSource(source) {
  if (isAnimePlayback() || source === "archive") return null;
  const order = ["vidapi", "vidsrc", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi"];
  const index = order.indexOf(source);
  const candidates = [...order.slice(index + 1), ...order.slice(0, Math.max(0, index))];
  return candidates.find(candidate => !sourceAttempted.has(candidate) && sourceAvailable(candidate)) || null;
}

function getSourceLabel(source) {
  if (typeof source === "string" && source.startsWith("custom:")) return (getCustomPlaybackServer(source.slice(7))?.name || "Custom server") + " · external embed";
  if (source === "direct") return "Authorized direct stream · HLS/DASH";
  if (source === "archive") return "Internet Archive · declared public-domain / CC source";
  if (source === "commons") return "Wikimedia Commons · open-license video";
  if (source === "loc") return "Library of Congress · National Screening Room";
  if (source === "vidsrc") return "VidSrc alternate source";
  if (source === "vidlink") return "VidLink alternate source";
  if (source === "vidplus") return "VidPlus alternate source";
  if (source === "vidking") return "VidKing alternate source · resume seeking may be unavailable";
  if (source === "embedwave") return "EmbedWave alternate source";
  if (source === "vidfast") return "VidFast.to alternate source";
  if (source === "ezvidapi") return "ezvidapi alternate source";
  if (source === "embedapistream") return "Embed API Stream alternate source";
  if (source === "moviesapi") return "MoviesAPI.to alternate source";
  return "VidAPI primary source";
}

function showArchiveFallback() {
  if (isAnimePlayback() || currentParams?.type !== "movie") return false;
  const root = $("vivid-archive-search");
  if (!root) return false;
  root.hidden = false;
  if (root.dataset.archiveMounted === "true") {
    root.dispatchEvent(new CustomEvent("vivid:archive-catalog-select", { detail: { source: activeSource } }));
    return true;
  }
  void import("./playback/archive-film-fallback.js").then(({ mountArchiveFilmSearch }) => {
    if (!root.isConnected || isAnimePlayback() || currentParams?.type !== "movie") return;
    mountArchiveFilmSearch({
      root,
      title: media?.title || "",
      year: String(media?.release_date || "").slice(0, 4),
      initialSource: activeSource,
      onPlay: item => {
        const provider = ["archive", "commons", "loc"].includes(item?.provider) ? item.provider : "archive";
        if (provider === "archive" && !/^[a-z0-9._-]{1,180}$/i.test(String(item?.identifier || ""))) return;
        const directUrl = provider === "archive" ? "" : (typeof item?.videoUrl === "string" && /^https:\/\//i.test(item.videoUrl) ? item.videoUrl : "");
        if (provider !== "archive" && !directUrl) return;
        const player = $("vidapi-player");
        const directPlayer = $("vivid-direct-player");
        if (!player) return;
        activeSource = provider;
        sourceAttempted.add(provider);
        primaryHealthy = false;
        clearFallbackTimer();
        if (provider === "archive") {
          if (directPlayer) { directPlayer.pause(); directPlayer.removeAttribute("src"); directPlayer.hidden = true; }
          player.src = item.embedUrl || ("https://archive.org/embed/" + encodeURIComponent(item.identifier) + "?autoplay=1");
          player.hidden = false;
        } else {
          player.src = "";
          player.hidden = true;
          if (!directPlayer) return;
          directPlayer.src = directUrl;
          directPlayer.hidden = false;
          directPlayer.load();
          directPlayer.play().catch(() => {
            const playbackStatus = $("player-status");
            if (playbackStatus) { playbackStatus.textContent = "This source returned a video file, but this browser could not start playback. Try another source or open the original record."; playbackStatus.classList.add("is-warning"); playbackStatus.hidden = false; }
          });
        }
        const status = $("player-status");
        if (status) {
          status.textContent = "Opening " + String(item.title || "archive film") + " · " + String(item.license || "declared rights") + ". Check the linked original record for source terms.";
          status.classList.remove("is-warning");
          status.hidden = false;
        }
        const sourceLabel = $("player-source-label");
        if (sourceLabel) sourceLabel.textContent = getSourceLabel(provider);
        updateSourceLabel();
      }
    });
  }).catch(error => console.warn("Vivid Archive Cinema could not initialize:", error));
  return true;
}

function triggerFallback(reason = "source_error") {
  if (!currentParams || (isAnimePlayback() && !(aniListId || malId || hasFallbackId()))) return false;
  const nextSource = getNextSource(activeSource);
  if (!nextSource) {
    const status = $("player-status");
    if (status) {
      status.textContent = "Vivid's available streaming servers could not play this movie. Checking the classic-film archive as a last resort…";
      status.classList.add("is-warning");
      status.hidden = false;
    }
    showArchiveFallback();
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

function showFallbackPrompt(source) {
  if (activeSource !== source) return;
  const status = $("player-status");
  const nextButton = $("player-try-next");
  const label = getSourceLabel(source);
  if (fallbackPromptDismissTimer) {
    clearTimeout(fallbackPromptDismissTimer);
    fallbackPromptDismissTimer = null;
  }
  if (status) {
    status.textContent = label + " is taking longer than expected. It may still start; we will not switch servers unless you choose to.";
    status.classList.add("is-warning");
    status.hidden = false;
  }
  if (nextButton) nextButton.hidden = !getNextSource(source);
  // Keep the manual server-switch option visible briefly, then clear the stale warning.
  fallbackPromptDismissTimer = window.setTimeout(() => {
    fallbackPromptDismissTimer = null;
    if (activeSource !== source) return;
    if (status) status.hidden = true;
    if (nextButton) nextButton.hidden = true;
  }, 5000);
}

function updateSourceLabel() {
  const count = document.querySelector(".vivid-server-count");
  if (count) count.textContent = isAnimePlayback() ? "1 preview source" : "10 sources";
  const label = document.getElementById("player-source-label");
  if (label) label.textContent = getSourceLabel(activeSource);
  document.querySelectorAll("[data-server-state]").forEach(node => {
    const source = node.getAttribute("data-server-state");
    node.textContent = source === "archive" ? "Browse" : source === activeSource ? (primaryHealthy ? "Playing" : "Connecting") : (sourceAvailable(source) ? "Ready to try" : "Unavailable");
  });
  document.querySelectorAll("[data-player-source]").forEach(button => {
    const source = button.getAttribute("data-player-source");
    button.classList.toggle("is-active", source === activeSource);
    button.hidden = isAnimePlayback() ? source !== "vidapi" : !["vidapi", "vidsrc", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi", "archive", "commons", "loc"].includes(source);
    button.disabled = !sourceAvailable(source);
    button.setAttribute("aria-pressed", source === activeSource ? "true" : "false");
  });
}

function setPlayerSource(source, params, startAt = 0) {
  const player = $("vidapi-player");
  const directPlayer = $("vivid-direct-player");
  if (!player || !params) return;
  clearFallbackTimer();
  const tryNextButton = $("player-try-next");
  if (tryNextButton) tryNextButton.hidden = true;
  const customServer = typeof source === "string" && source.startsWith("custom:") ? getCustomPlaybackServer(source.slice(7)) : null;
  if ((!["vidapi", "vidsrc", "vidlink", "vidplus", "vidking", "direct", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi"].includes(source) && !customServer) || !sourceAvailable(source)) return;
  if (activeSource === "direct" && source !== "direct") {
    persistDirectProgress?.();
    void flushPlaybackProgress(progressKey());
  }
  activeSource = source;
  window.dispatchEvent(new CustomEvent("vivid:player-source-changed", { detail: { source } }));
  window.dispatchEvent(new CustomEvent("vivid:player-adapter-selected", { detail: { playerId: "player1", providerId: source } }));
  player.closest(".vivid-player-frame")?.classList.toggle("is-embedwave", source === "embedwave");
  sourceAttempted.add(source);
  const status = $("player-status");
  status?.classList.remove("is-compact");

  if (source !== "direct") {
    directLoadGeneration += 1;
    stopDirectStream(directPlayer);
    if (directPlayer) directPlayer.hidden = true;
    player.hidden = false;
  } else {
    if (!directPlayer) return;
    player.src = "";
    player.hidden = true;
    directPlayer.hidden = false;
    primaryHealthy = false;
    const requestGeneration = ++directLoadGeneration;
    if (status) {
      status.textContent = "Connecting to the authorized direct stream…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    resolveDirectStream(media, params).then(stream => {
      if (requestGeneration !== directLoadGeneration || activeSource !== "direct") return null;
      if (!stream) throw new Error("No authorized direct stream is available for this title.");
      return playDirectStream(directPlayer, stream, {
        startAt,
        onError: error => {
          if (requestGeneration !== directLoadGeneration || activeSource !== "direct") return;
          console.warn("Vivid direct-stream playback error:", error);
          triggerFallback("direct_stream_error");
        },
        onDiagnostics: sample => {
          if (route.params.get("playbackDebug") === "1") {
            console.info("[Vivid playback diagnostics]", sample);
          }
        }
      });
    }).then(result => {
      if (!result || requestGeneration !== directLoadGeneration || activeSource !== "direct") return;
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        if (primaryHealthy || activeSource !== "direct") return;
        showFallbackPrompt("direct");
      }, 25000);
    }).catch(error => {
      if (requestGeneration !== directLoadGeneration || activeSource !== "direct") return;
      if (status) {
        status.textContent = error?.message || "The authorized direct stream could not be started.";
        status.classList.add("is-warning");
        status.hidden = false;
      }
      if (!triggerFallback("direct_stream_error")) showFallbackPrompt("direct");
    });
    updateSourceLabel();
    return;
  }

  if (customServer) {
    primaryHealthy = false;
    let customUrl;
    try {
      customUrl = buildCustomEmbedUrl(customServer, {
        type: params.type,
        tmdbId: tmdbId || params.id,
        imdbId,
        title: media?.title || "",
        season: params.season,
        episode: params.episode
      });
    } catch (error) {
      player.src = "";
      if (status) {
        status.textContent = error instanceof Error ? error.message : "This custom server URL is invalid.";
        status.classList.add("is-warning");
        status.hidden = false;
      }
      updateSourceLabel();
      return;
    }
    player.src = "";
    player.src = customUrl;
    if (status) {
      status.textContent = "Opening " + customServer.name + ". Playback controls and status are managed by that server.";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    window.setTimeout(() => {
      if (activeSource === source && status?.isConnected) status.hidden = true;
    }, 3500);
    updateSourceLabel();
    return;
  }

  if (source === "vidlink") {
    if (route.params.get("anime") === "1" ? !malId : !hasFallbackId()) return;
    primaryHealthy = false;
    const vidlinkUrl = buildVidlinkEmbedUrl(params, { tmdbId, malId, anime: isAnimePlayback(), startAt });
    if (!vidlinkUrl) return;
    player.src = vidlinkUrl;
    if (status) {
      status.textContent = "Loading VidLink alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== "vidlink") return;
      if (isAnimePlayback()) triggerFallback("anime_source_timeout");
      else showFallbackPrompt("vidlink");
    }, isAnimePlayback() ? 12000 : 25000);
  } else if (source === "vidsrc") {
    if (!hasFallbackId()) return;
    primaryHealthy = false;
    player.src = buildVidsrcEmbedUrl(params, { tmdbId, imdbId, startAt });
    if (status) {
      status.textContent = "Loading VidSrc alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== "vidsrc") return;
      if (isAnimePlayback()) triggerFallback("anime_source_timeout");
      else showFallbackPrompt("vidsrc");
    }, isAnimePlayback() ? 12000 : 25000);
  } else if (source === "vidplus") {
    if (route.params.get("anime") === "1" ? !aniListId : !hasFallbackId()) return;
    primaryHealthy = false;
    const vidplusUrl = buildVidplusEmbedUrl(params, { tmdbId, aniListId, anime: isAnimePlayback(), startAt });
    if (!vidplusUrl) return;
    player.src = vidplusUrl;
    if (status) {
      status.textContent = "Loading VidPlus alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== "vidplus") return;
      if (isAnimePlayback()) triggerFallback("anime_source_timeout");
      else showFallbackPrompt("vidplus");
    }, isAnimePlayback() ? 12000 : 25000);
  } else if (["embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi"].includes(source)) {
    if (isAnimePlayback()) return;
    primaryHealthy = false;
    const builders = { embedwave: buildEmbedWaveUrl, vidfast: buildVidFastUrl, ezvidapi: buildEzVidApiUrl, embedapistream: buildEmbedApiStreamUrl, moviesapi: buildMoviesApiUrl };
    const embedUrl = builders[source](params, { tmdbId, imdbId, startAt });
    if (!embedUrl) return;
    player.src = embedUrl;
    if (status) {
      status.textContent = "Loading " + getSourceLabel(source) + "… The embedded player reports its own playback state.";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== source) return;
      showFallbackPrompt(source);
    }, 25000);
  } else if (source === "vidking") {
    if (isAnimePlayback() || !hasFallbackId()) return;
    primaryHealthy = false;
    player.src = buildVidkingEmbedUrl(params, { tmdbId, startAt });
    if (status) {
      status.textContent = "Loading VidKing alternate source… Resume seeking may not be supported by this provider.";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== "vidking") return;
      showFallbackPrompt("vidking");
    }, 25000);
  } else {
    primaryHealthy = false;
    player.src = buildVidapiEmbedUrl(params, { startAt });
    if (status) {
      status.textContent = Number(startAt) > 5 ? "Resuming where you left off…" : "Preparing playback…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    if (hasFallbackId()) {
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        if (primaryHealthy || activeSource !== "vidapi") return;
        if (isAnimePlayback()) triggerFallback("anime_source_timeout");
        else showFallbackPrompt("vidapi");
      }, isAnimePlayback() ? 12000 : 25000);
    }
  }
  updateSourceLabel();
}

document.addEventListener("vivid:watch-room-closing", event => {
  const closingRoomId = String(event.detail?.roomId || "");
  const params = new URLSearchParams(window.location.search);
  if (!isWatchRoomCinemaMode || !closingRoomId || closingRoomId !== params.get("roomId")) return;
  document.querySelectorAll("#player-overlay iframe, #vivid-tflix-player iframe").forEach(frame => { frame.src = "about:blank"; });
  roomPlayerLayout?.destroy();
  roomPlayerLayout = null;
  roomPlayerSlot?.remove();
  roomPlayerSlot = null;
  document.querySelector(".vivid-wr-player-details")?.remove();
  const overlay = $("player-overlay");
  if (overlay) {
    overlay.classList.remove("is-minimized", "is-floating");
    overlay.hidden = true;
  }
  const secondary = $("vivid-tflix-player");
  if (secondary) {
    secondary.classList.remove("is-minimized");
    secondary.hidden = true;
    secondary.dataset.roomActive = "false";
  }
  $("watch-content")?.replaceChildren();
  const host = $("wr-screening-player-host");
  if (host) host.hidden = true;
  document.body.classList.remove("vivid-watch-room-mode", "vivid-watch-room-player-minimized", "vivid-player-open");
  document.body.style.removeProperty("--vivid-room-art");
  const target = new URL("watch-rooms.html", window.location.href);
  window.history.replaceState({}, "", target);
  route.url = target;
  route.params = target.searchParams;
  isWatchRoomCinemaMode = false;
  watchRoomScreeningValidated = false;
  roomOpenPlayerWindow = null;
  pendingRoomPlayerSelection = null;
  currentParams = null;
  media = null;
  details = null;
  sourceAttempted.clear();
  primaryHealthy = false;
  if (fallbackTimer) window.clearTimeout(fallbackTimer);
  if (fallbackPromptDismissTimer) window.clearTimeout(fallbackPromptDismissTimer);
  fallbackTimer = null;
  fallbackPromptDismissTimer = null;
  document.title = "Watch Rooms · Vivid Cinema";
});

document.addEventListener("vivid:watch-room-screening-validated", event => {
  if (!isWatchRoomCinemaMode) return;
  const screening = event.detail?.activeScreening;
  const params = new URLSearchParams(window.location.search);
  if (event.detail?.roomId !== params.get("roomId") ||
      String(screening?.sessionId || "") !== String(params.get("sessionId") || "") ||
      String(screening?.contentId || "") !== String(params.get("id") || "") ||
      watchRoomScreeningValidated) return;
  watchRoomScreeningValidated = true;
  if (currentParams) roomOpenPlayerWindow?.();
  if (pendingRoomPlayerSelection) {
    const selection = pendingRoomPlayerSelection;
    pendingRoomPlayerSelection = null;
    window.dispatchEvent(new CustomEvent("vivid:watch-room-apply-selection", { detail: selection }));
  }
});

document.addEventListener("vivid:watch-room-screening-focus", event => {
  if (isWatchRoomCinemaMode && watchRoomScreeningValidated &&
      event.detail?.roomId === new URLSearchParams(window.location.search).get("roomId")) {
    roomOpenPlayerWindow?.();
  }
});

document.addEventListener("vivid:watch-room-screening-navigate", event => {
  const detail = event.detail || {};
  const params = new URLSearchParams(window.location.search);
  if (!detail.roomId || detail.roomId !== params.get("roomId") ||
      params.get("roomMode") !== "1" || !params.get("id")) return;
  route.params = params;
  route.url = new URL(window.location.href);
  isWatchRoomCinemaMode = true;
  document.body.classList.add("vivid-watch-room-mode");
  document.getElementById("wr-screening-player-host")?.removeAttribute("hidden");
  watchRoomScreeningValidated = false;
  pendingRoomPlayerSelection = null;
  currentParams = null;
  media = null;
  details = null;
  imdbId = "";
  tmdbId = "";
  aniListId = "";
  malId = "";
  activeSource = "vidapi";
  sourceAttempted.clear();
  primaryHealthy = false;
  if (fallbackTimer) window.clearTimeout(fallbackTimer);
  if (fallbackPromptDismissTimer) window.clearTimeout(fallbackPromptDismissTimer);
  fallbackTimer = null;
  fallbackPromptDismissTimer = null;
  void load().catch(error => {
    console.error("Vivid Watch Room screening could not initialize:", error);
    const status = $("player-status");
    if (status) {
      status.textContent = "The screening could not initialize. Your room and voice connection are still active; try opening the screening again.";
      status.classList.add("is-warning");
      status.hidden = false;
    }
  });
});

window.addEventListener("vivid:watch-room-apply-selection", event => {
  const selection = event.detail || {};
  if (!["player1", "player2"].includes(selection.playerId)) return;
  if (isWatchRoomCinemaMode && (!watchRoomScreeningValidated || !currentParams)) {
    pendingRoomPlayerSelection = selection;
    return;
  }
  if (!currentParams) return;
  const secondaryRoot = $("vivid-tflix-player");
  const primaryOverlay = $("player-overlay");
  const primaryFrame = $("vidapi-player");
  if (selection.playerId === "player2") {
    if (roomPlayerSlot) { roomPlayerSlot.hidden = false; roomPlayerSlot.dataset.activePlayer = "secondary"; }
    roomPlayerLayout?.setActive(true);
    if (primaryOverlay) primaryOverlay.hidden = true;
    if (primaryFrame) primaryFrame.src = "about:blank";
    if (secondaryRoot) {
      secondaryRoot.dataset.roomActive = "true";
      secondaryRoot.hidden = false;
      secondaryRoot.classList.remove("is-minimized");
      const secondaryMinimize = secondaryRoot.querySelector("#vivid-tflix-minimize");
      if (secondaryMinimize) {
        secondaryMinimize.setAttribute("aria-label", "Minimize screening player");
        secondaryMinimize.innerHTML = '<i class="bi bi-dash-lg" aria-hidden="true"></i>';
      }
    }
    return;
  }
  if (primaryFrame?.src && !primaryFrame.src.endsWith("about:blank")) primaryFrame.src = "about:blank";
  if (secondaryRoot) {
    secondaryRoot.dataset.roomActive = "false";
    secondaryRoot.hidden = true;
    secondaryRoot.classList.remove("is-minimized");
    const secondaryMinimize = secondaryRoot.querySelector("#vivid-tflix-minimize");
    if (secondaryMinimize) {
      secondaryMinimize.setAttribute("aria-label", "Minimize screening player");
      secondaryMinimize.innerHTML = '<i class="bi bi-dash-lg" aria-hidden="true"></i>';
    }
  }
  if (primaryOverlay) {
    if (roomPlayerSlot) { roomPlayerSlot.hidden = false; roomPlayerSlot.dataset.activePlayer = "primary"; }
    roomPlayerLayout?.setActive(true);
    primaryOverlay.classList.remove("is-minimized", "is-floating");
    primaryOverlay.hidden = false;
    const closeButton = $("player-close");
    if (closeButton) closeButton.hidden = isWatchRoomCinemaMode;
  }
  const position = Math.max(0, Number(selection.position) || 0);
  setPlayerSource(selection.providerId, currentParams, position);
  if (isWatchRoomCinemaMode) roomPlayerLayout?.focus();
  else $("player-overlay")?.scrollIntoView({ block: "center", behavior: "smooth" });
});


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

function playerInfoMarkup() {
  const isTv = currentParams?.type === "tv";
  const episode = isTv ? details?.episode : null;
  const title = episode?.name || media?.title || media?.name || "Now playing";
  const synopsis = episode?.overview || media?.overview || details?.overview || "";
  const year = String(episode?.air_date || media?.release_date || media?.first_air_date || "").slice(0, 4);
  const runtime = Number(episode?.runtime || details?.runtime || details?.episode_run_time?.[0] || 0);
  // TV episode scores stay episode-specific; never silently substitute the series score.
  const rating = Number(isTv && episode ? episode.vote_average : media?.vote_average || details?.vote_average || 0);
  const voteCount = Number(isTv && episode ? episode.vote_count : media?.vote_count || details?.vote_count || 0);
  const genres = (details?.genres || []).map(genre => genre.name).filter(Boolean).slice(0, 4);
  const ratingLabel = rating > 0
    ? '<span class="vivid-player-rating"><i class="bi bi-star-fill" aria-hidden="true"></i><strong>' + rating.toFixed(1) + '</strong><small>TMDB</small></span>'
    : '<span class="vivid-player-rating vivid-player-rating--empty">Not yet rated</span>';
  const runtimeLabel = runtime > 0
    ? (isTv ? runtime + " min episode" : Math.floor(runtime / 60) + "h " + String(runtime % 60).padStart(2, "0") + "m")
    : "";
  const episodeLabel = isTv
    ? "S" + String(currentParams?.season ?? 1).padStart(2, "0") + " · E" + String(currentParams?.episode ?? 1).padStart(2, "0")
    : "";
  const meta = [year, episodeLabel, runtimeLabel].filter(Boolean);
  const metaMarkup = meta.map(value => '<span class="vivid-player-meta-item">' + escapeHtml(value) + '</span>').join("");
  const genreMarkup = genres.map(genre => '<span class="vivid-player-genre">' + escapeHtml(genre) + '</span>').join("");
  const cast = [
    ...(Array.isArray(episode?.guest_stars) ? episode.guest_stars : []),
    ...(Array.isArray(details?.credits?.cast) ? details.credits.cast : [])
  ].filter((person, index, list) => person?.name && list.findIndex(item => String(item.id) === String(person.id)) === index).slice(0, 8);
  const castMarkup = cast.map(person =>
    '<article class="vivid-player-cast-card">' +
      (person.profile_path
        ? '<img src="' + escapeHtml(getImageUrl(person.profile_path, "w185")) + '" alt="" loading="lazy" decoding="async">'
        : '<span class="vivid-player-cast-placeholder" aria-hidden="true"><i class="bi bi-person-fill"></i></span>') +
      '<span><strong>' + escapeHtml(person.name) + '</strong><small>' + escapeHtml(person.character || "") + '</small></span>' +
    '</article>'
  ).join("");

  // Select a data-backed detail per title. The seeded choice stays stable
  // through metadata refreshes and never invents filming or trivia claims.
  const facts = [];
  const originalTitle = String(media?.original_title || media?.original_name || "");
  const displayTitle = String(media?.title || media?.name || "");
  if (originalTitle && displayTitle && originalTitle.toLocaleLowerCase() !== displayTitle.toLocaleLowerCase()) {
    facts.push("Its original title is “" + originalTitle + "”.");
  }
  const companies = (details?.production_companies || []).map(item => item?.name).filter(Boolean);
  if (companies.length) facts.push("Production credit: " + companies.slice(0, 2).join(" and ") + ".");
  const countries = (details?.production_countries || []).map(item => item?.name).filter(Boolean);
  if (countries.length > 1) facts.push("The production is credited to " + countries.slice(0, 3).join(", ") + ".");
  const languages = (details?.spoken_languages || []).map(item => item?.english_name || item?.name).filter(Boolean);
  if (languages.length > 1) facts.push("The title lists " + languages.length + " spoken languages: " + languages.slice(0, 3).join(", ") + ".");
  else if (languages.length === 1) facts.push("The title lists " + languages[0] + " as its spoken language.");
  if (isTv) {
    const creators = (details?.created_by || []).map(item => item?.name).filter(Boolean);
    if (creators.length) facts.push("Created by " + creators.slice(0, 2).join(" and ") + ".");
    const seasons = Number(details?.number_of_seasons || 0);
    const episodes = Number(details?.number_of_episodes || 0);
    if (seasons > 0 && episodes > 0) facts.push("The series spans " + seasons + " seasons and " + episodes.toLocaleString() + " episodes.");
    const networks = (details?.networks || []).map(item => item?.name).filter(Boolean);
    if (networks.length) facts.push("Network credit: " + networks.slice(0, 2).join(" and ") + ".");
  }
  const seed = String(media?.id || displayTitle || "vivid").split("").reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const fact = facts.length ? facts[seed % facts.length] : "";
  const factMarkup = fact
    ? '<aside class="vivid-player-fact" aria-label="A detail about this title"><span class="vivid-player-fact-kicker"><i class="bi bi-stars" aria-hidden="true"></i> A LITTLE DETAIL</span><p>' + escapeHtml(fact) + '</p><small>From TMDB title credits and metadata</small></aside>'
    : "";

  return '<section class="vivid-player-info" aria-label="Now playing information">' +
    '<div class="vivid-player-info-copy vivid-player-info-hero">' +
      '<span class="vivid-player-info-eyebrow"><i class="bi bi-soundwave" aria-hidden="true"></i> NOW SCREENING</span>' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<div class="vivid-player-info-meta vivid-player-info-topline">' + metaMarkup + ratingLabel +
        (voteCount > 0 ? '<span class="vivid-player-vote-count">' + voteCount.toLocaleString() + ' ratings</span>' : '') +
      '</div>' +
      (genreMarkup ? '<div class="vivid-player-genre-list" aria-label="Genres">' + genreMarkup + '</div>' : '') +
      (synopsis ? '<p class="vivid-player-synopsis">' + escapeHtml(synopsis) + '</p>' : '<p class="vivid-player-synopsis vivid-player-synopsis--empty">Title details are not available right now.</p>') +
    '</div>' +
    factMarkup +
    (castMarkup ? '<div class="vivid-player-cast"><div class="vivid-player-section-heading"><h4>Featuring</h4><span>CAST &amp; CHARACTERS</span></div><div class="vivid-player-cast-rail">' + castMarkup + '</div></div>' : '') +
  '</section>';
}

function recommendationCards() {
  const items = normalizeResults(details?.recommendations?.results || [], media?.media_type).slice(0, 10);
  const fallback = normalizeResults(details?.similar?.results || [], media?.media_type).slice(0, 10);
  const list = items.length ? items : fallback;
  return list.length
    ? list.map(item =>
        '<a class="vivid-watch-rec-card vivid-card--poster" href="' + escapeHtml(getMediaUrl(item)) + '">' +
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

function mountSecondaryPlayer(params, title, detailsSnapshot = details) {
  const root = $("vivid-tflix-player");
  if (!root) return;

  if (isAnimePlayback()) {
    const animeParams = { ...params, anime: true };
    void import("./playback/anime-secondary-player.js")
      .then(({ mountAnimeSecondaryPlayer }) => {
        if (!root.isConnected) return;
        mountAnimeSecondaryPlayer({
          root,
          params: animeParams,
          media,
          title,
          aniListId,
          malId
        });
      })
      .catch(error => console.warn("Vivid anime secondary player could not initialize:", error));
    return;
  }

  void import("./playback/tflix-secondary-player.js")
    .then(({ mountTflixSecondaryPlayer }) => {
      if (!root.isConnected) return;
      mountTflixSecondaryPlayer({
        root,
        params,
        media,
        details: detailsSnapshot,
        title,
        isAnime: false
      });
      if (isWatchRoomCinemaMode && root.dataset.roomActive !== "true") {
        root.hidden = true;
      }
    })
    .catch(error => console.warn("Vivid secondary player could not initialize:", error));
}


function episodeNavigationMarkup(params) {
  if (params?.type !== "tv" || !media?.id) return "";
  const seasons = (Array.isArray(details?.seasons) ? details.seasons : [])
    .filter(season => Number(season?.season_number) > 0 && Number(season?.episode_count) > 0)
    .sort((a, b) => Number(a.season_number) - Number(b.season_number));
  const currentSeason = seasons.find(season => Number(season.season_number) === Number(params.season));
  if (!currentSeason) return "";

  const currentEpisode = Math.max(1, Number(params.episode) || 1);
  const previousSeason = seasons.filter(season => Number(season.season_number) < Number(params.season)).at(-1);
  const nextSeason = seasons.find(season => Number(season.season_number) > Number(params.season));
  const previous = currentEpisode > 1
    ? { season: Number(params.season), episode: currentEpisode - 1 }
    : previousSeason
      ? { season: Number(previousSeason.season_number), episode: Number(previousSeason.episode_count) }
      : null;
  const next = currentEpisode < Number(currentSeason.episode_count)
    ? { season: Number(params.season), episode: currentEpisode + 1 }
    : nextSeason
      ? { season: Number(nextSeason.season_number), episode: 1 }
      : null;
  const link = (target, direction, icon) => {
    if (!target) return '<span class="vivid-episode-nav-item is-disabled" aria-disabled="true"><i class="bi ' + icon + '" aria-hidden="true"></i><span><small>' + direction + '</small><strong>' + (direction === "Previous episode" ? "Beginning of series" : "Season complete") + '</strong></span></span>';
    const href = buildWatchUrl(media.id, "tv", target.season, target.episode) + (isAnimePlayback() ? "&anime=1" : "");
    const label = "S" + String(target.season).padStart(2, "0") + " · E" + String(target.episode).padStart(2, "0");
    return '<a class="vivid-episode-nav-item" href="' + escapeHtml(href) + '"><i class="bi ' + icon + '" aria-hidden="true"></i><span><small>' + direction + '</small><strong>' + label + '</strong></span></a>';
  };
  return '<div class="vivid-episode-nav-heading"><span>YOUR SERIES</span><strong>Episode navigation</strong></div><div class="vivid-episode-nav-links">' +
    link(previous, "Previous episode", "bi-skip-start-fill") +
    link(next, "Next episode", "bi-skip-end-fill") +
    '</div>';
}

function renderShell(params) {
  if (isWatchRoomCinemaMode) {
    roomPlayerSlot?.querySelectorAll("iframe").forEach(frame => { frame.src = "about:blank"; });
    const previousDirectVideo = roomPlayerSlot?.querySelector("video");
    if (previousDirectVideo) stopDirectStream(previousDirectVideo);
    roomPlayerLayout?.destroy();
    roomPlayerLayout = null;
    roomPlayerSlot?.remove();
    roomPlayerSlot = null;
    document.querySelector(".vivid-wr-player-details")?.remove();
  }
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
      '</div><div class="vivid-watch-actions"><button type="button" id="watch-open-player" class="vivid-watch-play" aria-label="Play ' + escapeHtml(episodeTitle || title) + '"><i class="bi bi-play-fill" aria-hidden="true"></i><span>Play</span></button><a class="vivid-watch-details" href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '"><i class="bi bi-info-circle" aria-hidden="true"></i><span>Details</span></a></div></div></section>' +
    '<div id="player-overlay" class="vivid-player-overlay vivid-player-inline" role="presentation"><section class="vivid-player-dialog" role="region" aria-labelledby="player-dialog-title">' +
      '<header class="vivid-player-dialog-head"><div class="vivid-player-dialog-heading"><span class="vivid-player-live-dot" aria-hidden="true"></span><div><span class="vivid-player-dialog-eyebrow">' + (isWatchRoomCinemaMode ? "VIVID CINEMA · PRIVATE SCREENING" : "VIVID CINEMA · PLAYER 1") + '</span><h2 id="player-dialog-title">' + escapeHtml(episodeTitle || title) + '</h2><span id="player-source-label" class="vivid-player-current-source">Choose a player to begin</span></div></div><div class="vivid-player-dialog-actions"><button type="button" id="player-server-menu" class="vivid-player-switch vivid-server-menu" aria-controls="player-server-panel" aria-expanded="false"><i class="bi bi-hdd-network" aria-hidden="true"></i> Servers <i class="bi bi-arrow-down" aria-hidden="true"></i></button><button type="button" id="player-return-inline" class="vivid-player-switch" aria-label="Return to cinema stage" title="Return to cinema stage" hidden><i class="bi bi-arrow-up-left-square" aria-hidden="true"></i></button><button type="button" id="player-fullscreen" class="vivid-player-switch vivid-player-fullscreen" aria-label="Enter fullscreen" title="Fullscreen" aria-pressed="false"><i class="bi bi-arrows-fullscreen" aria-hidden="true"></i></button><button type="button" id="player-close" class="vivid-player-close" aria-label="Close player"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></header>' +
      '<div class="vivid-player-layout"><div class="vivid-player-main"><div class="vivid-player-frame"><div id="player-status" class="vivid-player-status" role="status" aria-live="polite">' + (resumeAt > 5 ? "Ready to resume when you choose a player." : "Choose a player to begin playback.") + '</div><button type="button" id="player-try-next" class="vivid-player-try-next" hidden>Try next server</button><iframe id="vidapi-player" title="' + escapeHtml(title) + ' player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write" allowfullscreen referrerpolicy="origin" loading="eager"></iframe><video id="vivid-direct-player" title="' + escapeHtml(title) + ' direct stream player" controls playsinline preload="metadata" hidden></video></div><footer class="vivid-player-dialog-foot"><span><i class="bi bi-keyboard" aria-hidden="true"></i> Press Esc to close</span><a href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '">Title details</a></footer></div>' +
      '<aside id="player-server-panel" class="vivid-server-panel" aria-label="Vivid Cinema playback servers" hidden><div class="vivid-server-panel-heading"><div><strong>Playback servers</strong><span>Choose a source</span></div><span class="vivid-server-count">10 sources</span></div><div id="vivid-archive-search" class="vivid-archive-search-host"></div>' +
      '<button type="button" class="vivid-player-source" data-player-source="vidapi" aria-pressed="true"><span class="vivid-server-dot"></span><span><strong>VidAPI</strong><small>Primary server · may require domain approval</small></span><span class="vivid-server-state" data-server-state="vidapi">Ready</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="vidsrc" aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidSrc</strong><small>Alternate streaming source · anime ID fallback</small></span><span class="vivid-server-state" data-server-state="vidsrc">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="vidlink" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidLink</strong><small>Alternate streaming source</small></span><span class="vivid-server-state" data-server-state="vidlink">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="embedwave" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>EmbedWave</strong><small>Alternate embed · multi-server player</small></span><span class="vivid-server-state" data-server-state="embedwave">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="vidfast" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidFast.to</strong><small>Alternate movie/TV embed</small></span><span class="vivid-server-state" data-server-state="vidfast">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="ezvidapi" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>ezvidapi</strong><small>TMDB embed · upstream availability varies</small></span><span class="vivid-server-state" data-server-state="ezvidapi">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="embedapistream" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>Embed API Stream</strong><small>Alternate movie/TV embed</small></span><span class="vivid-server-state" data-server-state="embedapistream">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="moviesapi" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>MoviesAPI.to</strong><small>Alternate movie/TV embed</small></span><span class="vivid-server-state" data-server-state="moviesapi">Available</span></button>' +
      '<button type="button" class="vivid-player-source vivid-archive-source" data-player-source="archive" aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>Internet Archive</strong><small>Classic-film catalogue · choose a title to play</small></span><span class="vivid-server-state" data-server-state="archive">Browse</span></button>' +
      '<button type="button" class="vivid-player-source vivid-archive-source" data-player-source="commons" aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>Wikimedia Commons</strong><small>Direct open-license video files</small></span><span class="vivid-server-state" data-server-state="commons">Browse</span></button>' +
      '<button type="button" class="vivid-player-source vivid-archive-source" data-player-source="loc" aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>Library of Congress</strong><small>National Screening Room · MP4 films</small></span><span class="vivid-server-state" data-server-state="loc">Browse</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="vidplus" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidPlus</strong><small>Additional source · support varies</small></span><span class="vivid-server-state" data-server-state="vidplus">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="vidking" hidden aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidKing</strong><small>Extra source · resume seeking may vary</small></span><span class="vivid-server-state" data-server-state="vidking">Available</span></button>' +
      '<button type="button" class="vivid-player-source" data-player-source="direct" hidden aria-pressed="false" hidden><span class="vivid-server-dot"></span><span><strong>Direct stream</strong><small>Authorized HLS/DASH · adaptive quality</small></span><span class="vivid-server-state" data-server-state="direct">Unavailable</span></button>' +
      '<p>Choose another source if playback does not start. Archive Cinema searches Internet Archive listings with declared public-domain or commercial Creative Commons rights; uploader declarations are not independently verified.</p></aside></div>' + playerInfoMarkup() + '</section></div>' +
    '<section id="vivid-tflix-player" class="vivid-tflix-player" aria-label="Additional streaming player"></section>' +
    '<section id="watch-episode-navigation" class="vivid-episode-navigation" aria-label="TV episode navigation">' + episodeNavigationMarkup(params) + '</section>' +
    '<section class="vivid-watch-recommendations"><div class="vivid-section-heading"><div><span>MORE TO DISCOVER</span><h2>You might also like</h2></div></div><div id="watch-recommendations" class="vivid-watch-rec-rail">' + recommendationCards() + '</div></section>';

  if (isWatchRoomCinemaMode) {
    const stage = $("wr-cinema-stage");
    const host = $("wr-screening-player-host");
    const watchContentForRoom = $("watch-content");
    const overlayForRoom = $("player-overlay");
    const secondaryForRoom = $("vivid-tflix-player");
    const playerInfoForRoom = overlayForRoom?.querySelector(".vivid-player-info");
    if (stage && host && overlayForRoom) {
      const slot = document.createElement("div");
      slot.id = "wr-cinema-player-slot";
      slot.className = "vivid-wr-player-slot";
      slot.hidden = true;
      slot.dataset.activePlayer = "primary";
      slot.setAttribute("role", "region");
      slot.setAttribute("aria-label", "Shared cinema player");
      overlayForRoom.hidden = true;
      overlayForRoom.classList.remove("is-minimized", "is-floating");
      slot.append(overlayForRoom);
      if (secondaryForRoom) {
        secondaryForRoom.hidden = true;
        secondaryForRoom.classList.remove("is-minimized");
        slot.append(secondaryForRoom);
      }
      const detailsPanel = document.createElement("div");
      detailsPanel.className = "vivid-wr-player-details";
      if (playerInfoForRoom) detailsPanel.append(playerInfoForRoom);
      const wordmark = stage.querySelector(".vivid-wr-cinema-stage__wordmark");
      stage.insertBefore(slot, wordmark);
      if (playerInfoForRoom) stage.insertBefore(detailsPanel, wordmark);
      watchContentForRoom?.replaceChildren();
      host.hidden = true;
      roomPlayerSlot = slot;
      roomPlayerLayout = mountWatchRoomPlayerLayout({ slot, overlay: overlayForRoom });
    }
  }

  if (isAnimePlayback()) $("vivid-tflix-player")?.remove();
  else mountSecondaryPlayer(params, episodeTitle || title);
  window.dispatchEvent(new CustomEvent("vivid:player-adapter-ready", { detail: { playerId: "player1" } }));

  const player = $("vidapi-player");
  const directPlayer = $("vivid-direct-player");
  const status = $("player-status");
  const tryNextButton = $("player-try-next");
  // Keep provider warnings outside the iframe area so they never cover a playing stream.
  const playerFrame = status?.parentElement;
  if (playerFrame?.classList.contains("vivid-player-frame") && playerFrame.parentElement?.classList.contains("vivid-player-main")) {
    playerFrame.insertAdjacentElement("afterend", status);
    if (tryNextButton) status.insertAdjacentElement("afterend", tryNextButton);
  }
  const overlay = $("player-overlay");
  if (isWatchRoomCinemaMode && media?.backdrop_path) {
    document.body.style.setProperty("--vivid-room-art", "url(\"" + getImageUrl(media.backdrop_path, "w1280") + "\")");
  }
  if (isWatchRoomCinemaMode && overlay) overlay.hidden = true;
  // Keep the Watch Room player inline; the lobby remains the only room surface.
  const openPlayer = $("watch-open-player");
  const closePlayer = $("player-close");
  const fullscreenButton = $("player-fullscreen");
  const returnInlineButton = $("player-return-inline");
  returnInlineButton?.addEventListener("click", () => roomPlayerLayout?.focus());
  const playerDialog = overlay?.querySelector(".vivid-player-dialog");
  if (isWatchRoomCinemaMode && closePlayer) closePlayer.hidden = true;
  const serverMenu = $("player-server-menu");
  const serverPanel = $("player-server-panel");
  if (serverMenu && serverPanel) {
    const picker = document.createElement("div");
    picker.className = "vivid-server-picker";
    serverMenu.parentNode.insertBefore(picker, serverMenu);
    picker.append(serverMenu, serverPanel);
    serverPanel.hidden = true;
    const archiveRoot = $("vivid-archive-search");
    if (archiveRoot) archiveRoot.hidden = true;
    serverMenu.setAttribute("aria-expanded", "false");
  }
  const positionServerPanel = () => {
    if (!serverMenu || !serverPanel || serverPanel.hidden) return;
    const rect = serverMenu.getBoundingClientRect();
    const gutter = 12;
    const maxWidth = Math.min(340, window.innerWidth - gutter * 2);
    const maxHeight = Math.min(window.innerHeight * 0.58, 420);
    let top = rect.bottom + 9;
    let right = Math.max(gutter, window.innerWidth - rect.right);
    if (rect.right - maxWidth < gutter) right = gutter;
    const spaceBelow = window.innerHeight - top - gutter;
    const spaceAbove = rect.top - gutter;
    let height = Math.min(maxHeight, Math.max(160, spaceBelow));
    if (spaceBelow < 180 && spaceAbove > spaceBelow) {
      height = Math.min(maxHeight, Math.max(160, spaceAbove - 9));
      top = Math.max(gutter, rect.top - 9 - height);
    }
    serverPanel.style.top = Math.round(top) + "px";
    serverPanel.style.right = Math.round(right) + "px";
    serverPanel.style.left = "auto";
    serverPanel.style.bottom = "auto";
    serverPanel.style.width = Math.round(maxWidth) + "px";
    serverPanel.style.maxHeight = Math.round(height) + "px";
  };
  const closeServerMenu = () => {
    if (!serverMenu || !serverPanel) return;
    serverPanel.hidden = true;
    serverMenu.setAttribute("aria-expanded", "false");
    serverPanel.style.top = "";
    serverPanel.style.right = "";
    serverPanel.style.width = "";
    serverPanel.style.maxHeight = "";
  };
  const toggleServerMenu = () => {
    if (!serverMenu || !serverPanel) return;
    const open = serverPanel.hidden;
    serverPanel.hidden = !open;
    serverMenu.setAttribute("aria-expanded", String(open));
    if (open) {
      positionServerPanel();
      serverPanel.scrollTop = 0;
    }
  };
  let playerHasOpened = false;
  const openPlayerWindow = () => {
    if (!overlay) return;
    const restoringMiniPlayer = !isWatchRoomCinemaMode && overlay.classList.contains("is-minimized") && playerHasOpened;
    overlay.classList.remove("is-minimized");
    document.body.classList.remove("vivid-watch-room-player-minimized");
    if (closePlayer) closePlayer.hidden = isWatchRoomCinemaMode;
    if (isWatchRoomCinemaMode && roomPlayerSlot) {
      roomPlayerSlot.hidden = false;
      roomPlayerLayout?.setActive(true);
    }
    if (!isWatchRoomCinemaMode || roomPlayerSlot?.dataset.activePlayer !== "secondary") overlay.hidden = false;
    if (!isWatchRoomCinemaMode && !overlay.classList.contains("vivid-player-inline")) document.body.classList.add("vivid-player-open");
    if (openPlayer) openPlayer.setAttribute("aria-expanded", "true");
    if (isWatchRoomCinemaMode && playerHasOpened) {
      roomPlayerLayout?.focus();
      return;
    }
    if (restoringMiniPlayer) {
      closePlayer?.focus({ preventScroll: true });
      return;
    }
    const saved = getPlaybackProgress(progressKey());
    const startAt = Number(saved?.progress || route.params.get("startAt") || resumeAt || 0);
    const rememberedSource = !playerHasOpened ? getRememberedSource() : null;
    playerHasOpened = true;
    sourceAttempted.clear();
    const initialSource = isAnimePlayback()
      ? (aniListId ? "vidplus" : malId ? "vidlink" : hasFallbackId() ? "vidsrc" : "")
      : (rememberedSource || activeSource || "vidapi");
    if (initialSource) {
      setPlayerSource(initialSource, params, startAt);
    } else if (status) {
      status.textContent = "This title could not be matched to an anime player. Try another title or return to the anime catalogue.";
      status.classList.add("is-warning");
      status.hidden = false;
    }
    if (isWatchRoomCinemaMode) roomPlayerLayout?.focus();
    else closePlayer?.focus({ preventScroll: true });
  };
  roomOpenPlayerWindow = openPlayerWindow;
  const closePlayerWindow = () => {
    if (!overlay) return;
    if (document.fullscreenElement && playerDialog?.contains(document.fullscreenElement)) {
      void document.exitFullscreen?.().catch(() => {});
    }
    if (isWatchRoomCinemaMode) return;
    clearFallbackTimer();
    overlay.hidden = true;
    if (!overlay.classList.contains("vivid-player-inline")) document.body.classList.remove("vivid-player-open");
    if (openPlayer) openPlayer.setAttribute("aria-expanded", "false");
    directLoadGeneration += 1;
    // Closing the cinema window can happen between throttled timeupdate saves.
    persistDirectProgress?.();
    void flushPlaybackProgress(progressKey());
    stopDirectStream(directPlayer);
    if (directPlayer) directPlayer.hidden = true;
    if (player) { player.src = ""; player.hidden = false; }
    if (tryNextButton) tryNextButton.hidden = true;
    primaryHealthy = false;
    openPlayer?.focus({ preventScroll: true });
  };
  const syncFullscreenButton = () => {
    const active = Boolean((document.fullscreenElement && playerDialog?.contains(document.fullscreenElement)) || overlay?.classList.contains("vivid-player-fullscreen-fallback"));
    fullscreenButton?.setAttribute("aria-pressed", String(active));
    fullscreenButton?.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
    fullscreenButton?.setAttribute("title", active ? "Exit fullscreen" : "Fullscreen");
    if (fullscreenButton) fullscreenButton.innerHTML = active
      ? '<i class="bi bi-fullscreen-exit" aria-hidden="true"></i>'
      : '<i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>';
    if (!active) {
      try { screen.orientation?.unlock?.(); } catch {}
    }
  };
  const togglePlayerFullscreen = async () => {
    if (!playerDialog) return;
    if (!document.fullscreenElement && overlay?.classList.contains("vivid-player-fullscreen-fallback")) {
      overlay.classList.remove("vivid-player-fullscreen-fallback");
      syncFullscreenButton();
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        return;
      }
      if (typeof playerDialog.requestFullscreen === "function") {
        overlay?.classList.remove("vivid-player-fullscreen-fallback");
        await playerDialog.requestFullscreen();
        const androidNative = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.getPlatform?.() === "android";
        if (androidNative) {
          try { await screen.orientation?.lock?.("landscape"); } catch {}
        }
      } else {
        overlay?.classList.add("vivid-player-fullscreen-fallback");
      }
    } catch (error) {
      console.warn("Vivid player fullscreen is unavailable:", error);
      overlay?.classList.add("vivid-player-fullscreen-fallback");
    }
    syncFullscreenButton();
  };
  fullscreenButton?.addEventListener("click", () => { void togglePlayerFullscreen(); });
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  window.addEventListener("vivid:android-back", () => {
    const action = resolveAndroidPlayerBackAction({
      fullscreen: Boolean(document.fullscreenElement && playerDialog?.contains(document.fullscreenElement)),
      fallbackFullscreen: Boolean(overlay?.classList.contains("vivid-player-fullscreen-fallback"))
    });
    if (action === "exit-fullscreen") {
      if (document.fullscreenElement && playerDialog?.contains(document.fullscreenElement)) {
        void document.exitFullscreen?.().catch(error => {
          console.warn("Vivid could not exit Android player fullscreen:", error);
        });
      } else {
        overlay?.classList.remove("vivid-player-fullscreen-fallback");
        syncFullscreenButton();
      }
      return;
    }
    closePlayerWindow();
  });
  openPlayer?.addEventListener("click", openPlayerWindow);
  // Do not open or start either player until the viewer chooses one.
  closePlayer?.addEventListener("click", closePlayerWindow);
  tryNextButton?.addEventListener("click", () => {
    const next = getNextSource(activeSource);
    if (!next) return showFallbackPrompt(activeSource);
    sourceAttempted.add(activeSource);
    setPlayerSource(next, currentParams, Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || resumeAt || 0));
  });
  if (!isWatchRoomCinemaMode) overlay?.addEventListener("click", event => {
    if (event.target === overlay) closePlayerWindow();
  });
  serverMenu?.addEventListener("click", toggleServerMenu);
  serverPanel?.addEventListener("click", event => {
    if (event.target.closest("[data-player-source]")) closeServerMenu();
  });
  serverPanel?.addEventListener("touchmove", event => {
    if (!serverPanel.hidden) event.stopPropagation();
  }, { passive: true });
  const repositionOpenServerMenu = () => {
    if (serverPanel && !serverPanel.hidden) positionServerPanel();
  };
  window.addEventListener("resize", repositionOpenServerMenu);
  window.addEventListener("scroll", repositionOpenServerMenu, { passive: true, capture: true });
  document.addEventListener("click", event => {
    if (!serverPanel || serverPanel.hidden) return;
    const t = event.target;
    if (serverMenu?.contains(t) || serverPanel.contains(t)) return;
    closeServerMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && serverPanel && !serverPanel.hidden) {
      closeServerMenu();
      serverMenu?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Escape" && !isWatchRoomCinemaMode && overlay && !overlay.hidden) {
      closePlayerWindow();
    }
  });
  if (directPlayer) {
    let lastDirectProgressSaveAt = 0;
    const saveDirectProgress = (completed = false, force = false) => {
      if (activeSource !== "direct" || !media || !currentParams) return;
      const progress = Math.max(0, Number(directPlayer.currentTime) || 0);
      const duration = Math.max(0, Number(directPlayer.duration) || 0);
      if (progress <= 0 && !completed) return;
      const now = Date.now();
      if (!completed && !force && now - lastDirectProgressSaveAt < 8000) return;
      lastDirectProgressSaveAt = now;
      const season = currentParams.type === "tv" ? currentParams.season : undefined;
      const episode = currentParams.type === "tv" ? currentParams.episode : undefined;
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
      if (completed) {
        recordBehavior("watch_completed", media, { duration, season, episode });
        upsertLibraryItem("history", { ...historyItem(), completion: 100, completedAt: now, updatedAt: now });
        completePlaybackProgress(progressKey(), {
          duration, season, episode,
          title: media.title, media_type: media.media_type, id: media.id
        });
      }
    };
    persistDirectProgress = () => saveDirectProgress(false, true);
    directPlayer.addEventListener("playing", () => {
      if (!["direct", "commons", "loc"].includes(activeSource)) return;
      primaryHealthy = true;
      if (activeSource === "direct") rememberSuccessfulSource("direct");
      clearFallbackTimer();
      const currentStatus = $("player-status");
      if (currentStatus) currentStatus.hidden = true;
      updateSourceLabel();
    });
    directPlayer.addEventListener("timeupdate", () => saveDirectProgress(false));
    directPlayer.addEventListener("pause", () => saveDirectProgress(false));
    directPlayer.addEventListener("ended", () => saveDirectProgress(true));
    directPlayer.addEventListener("error", () => {
      if (activeSource === "direct") triggerFallback("direct_video_error");
      else if (activeSource === "commons" || activeSource === "loc") {
        const currentStatus = $("player-status");
        if (currentStatus) {
          currentStatus.textContent = "This archive video could not be played by this browser. Try another result or catalogue.";
          currentStatus.classList.add("is-warning");
          currentStatus.hidden = false;
        }
      }
    });
  }

  if (player) {
    player.addEventListener("load", () => {
      // Embedded providers often do not send playback events back to the parent page.
      // Once their player document loads, remove Vivid's overlay so it cannot cover a
      // stream that has already started. Real playback errors/timeouts can show it again.
      if (!player.src || player.src === "about:blank") return;
      status?.classList.remove("is-compact");
      if (status && !status.classList.contains("is-warning")) status.hidden = true;
      window.dispatchEvent(new CustomEvent("vivid:player-frame-loaded", { detail: { playerId: "player1", providerId: activeSource } }));
    });
    player.addEventListener("error", () => {
      triggerFallback("iframe_error");
    });
    // Start in the focused cinema window; users can reopen it after closing.
    serverPanel?.addEventListener("click", event => {
      const button = event.target.closest("[data-player-source]");
      if (!button || button.disabled || !serverPanel.contains(button)) return;
      const source = button.getAttribute("data-player-source");
      if ((!["vidapi", "vidsrc", "vidlink", "vidplus", "vidking", "direct", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi", "archive", "commons", "loc"].includes(source) && !(source?.startsWith("custom:"))) || !sourceAvailable(source)) return;
      sourceAttempted.clear();
      if (["archive", "commons", "loc"].includes(source)) {
        activeSource = source;
        primaryHealthy = false;
        clearFallbackTimer();
        showArchiveFallback();
        updateSourceLabel();
        return;
      }
      const latestProgress = Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || resumeAt || 0);
      setPlayerSource(source, params, latestProgress);
    });
    if (isAnimePlayback()) {
      if (status) status.textContent = "Matching this title to an anime player…";
      updateSourceLabel();
    } else {
      // Keep the source chosen by openPlayerWindow (including a remembered server).
      // Resetting activeSource here would make the iframe and event/fallback state disagree.
      updateSourceLabel();
    };
  }
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
  const poster = document.querySelector(".vivid-watch-artwork img");
  if (poster) {
    poster.onerror = () => { poster.onerror = null; poster.src = "icons/vivid-icon.svg"; };
    poster.src = getImageUrl(media.poster_path, "w500");
  }
  const backdrop = $("watch-backdrop");
  if (backdrop) backdrop.style.setProperty("--watch-backdrop", "url('" + getImageUrl(media.backdrop_path || media.poster_path, media.backdrop_path ? "w1280" : "w780") + "')");
  if (isWatchRoomCinemaMode && (media.backdrop_path || media.poster_path)) {
    document.body.style.setProperty("--vivid-room-art", "url(\"" + getImageUrl(media.backdrop_path || media.poster_path, media.backdrop_path ? "w1280" : "w780") + "\")");
  }
  const player = $("vidapi-player");
  if (player) player.title = title + " player";
  const episodeNavigation = $("watch-episode-navigation");
  if (episodeNavigation) episodeNavigation.innerHTML = episodeNavigationMarkup(params);
  const recommendations = $("watch-recommendations");
  if (recommendations) recommendations.innerHTML = recommendationCards();
  // The panel is first rendered with the loading shell; refresh it when TMDB data arrives.
  const playerInfo = document.querySelector(".vivid-player-info");
  if (playerInfo) playerInfo.outerHTML = playerInfoMarkup();
  document.title = (episodeTitle ? episodeTitle + " · " : "") + title + " · Vivid Cinema";
}

function handlePlayerEvent(event) {
  const player = $("vidapi-player");
  if (!player || event.source !== player.contentWindow) return;
  const isVidapi = VIDAPI_ORIGINS.has(event.origin);
  const isFallback = VIDSRC_ORIGINS.has(event.origin);
  const isVidLink = VIDLINK_ORIGINS.has(event.origin);
  const isVidPlus = VIDPLUS_ORIGINS.has(event.origin);
  const isVidKing = VIDKING_ORIGINS.has(event.origin);
  const isMoviesApi = MOVIESAPI_ORIGINS.has(event.origin);
  if (!isVidapi && !isFallback && !isVidLink && !isVidPlus && !isVidKing && !isMoviesApi) return;
  const originMatchesActiveSource =
    (activeSource === "vidapi" && isVidapi) ||
    (activeSource === "vidsrc" && isFallback) ||
    (activeSource === "vidlink" && isVidLink) ||
    (activeSource === "vidplus" && isVidPlus) ||
    (activeSource === "vidking" && isVidKing) ||
    (activeSource === "moviesapi" && isMoviesApi);
  // Ignore delayed messages from a previous iframe document after the user switches source.
  if (!originMatchesActiveSource) return;
  let payload = event.data;
  // Some provider builds post JSON strings instead of structured-clone objects.
  // Normalize the payload before validation so supported providers can report health/progress.
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return; }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  if (isMoviesApi && payload.source === "moviesapi-player") {
    payload = { type: "PLAYER_EVENT", data: { ...payload, player_status: payload.event, player_progress: payload.currentTime, player_duration: payload.duration } };
  }

  // Opt-in, sanitized telemetry for provider messages. Never log full payloads or URLs.
  if (route.params.get("playbackDebug") === "1") {
    const debugData = payload.data && typeof payload.data === "object" ? payload.data : payload;
    const debugEvent = String(debugData.event || debugData.player_status || debugData.status || payload.type || "").slice(0, 48);
    if (/(buffer|wait|stall|error|fail|load|play|ready|canplay|pause)/i.test(debugEvent)) {
      console.info("[Vivid iframe diagnostics]", { source: activeSource, origin: event.origin, type: String(payload.type || "").slice(0, 32), event: debugEvent });
    }
  }

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

  if (looksLikeFailure && ["vidapi", "vidsrc", "vidlink", "vidplus", "vidking", "moviesapi"].includes(activeSource)) {
    triggerFallback((isVidapi ? "vidapi_" : activeSource + "_") + (numericCode || statusValue || "error"));
    return;
  }

  if (!payload.data) return;
  // VidAPI has a formal PLAYER_EVENT contract; fallbacks may expose simpler
  // playback messages. Only treat explicit playback/progress signals as healthy.
  const explicitStatus = /^(play|playing|pause|paused|timeupdate|progress|seeked|ended|completed|loadedmetadata|canplay|ready|started)$/i.test(statusValue);
  const isPlaybackSignal =
    payload.type === "PLAYER_EVENT" ||
    explicitStatus ||
    Number(eventData.player_progress) > 0 ||
    Number(eventData.currentTime) > 0;
  if (!isPlaybackSignal) return;
  const data = payload.data;
  if (isVidKing) {
    const eventName = String(data.event || "").toLowerCase();
    const mediaType = String(data.mediaType || "").toLowerCase();
    const sourceId = String(data.id ?? "").trim();
    const expectedId = String(tmdbId || media?.id || "");
    if (payload.type !== "PLAYER_EVENT" || !/^(play|pause|seeked|ended|timeupdate)$/i.test(eventName)) return;
    if (mediaType !== String(media?.media_type || "").toLowerCase()) return;
    if (!sourceId || sourceId !== expectedId) return;
    if (currentParams?.type === "tv") {
      if (data.season != null && Number(data.season) !== Number(currentParams.season)) return;
      if (data.episode != null && Number(data.episode) !== Number(currentParams.episode)) return;
    }
    primaryHealthy = true;
    rememberSuccessfulSource(activeSource);
    clearFallbackTimer();
    updateSourceLabel();
    const status = $("player-status");
    if (status) status.hidden = true;
    const progress = Math.max(0, Number(data.currentTime) || 0);
    const duration = Math.max(0, Number(data.duration) || 0);
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
    if (/^(ended|completed)$/i.test(eventName)) {
      recordBehavior("watch_completed", media, { duration, season, episode });
      upsertLibraryItem("history", { ...historyItem(), completion: 100, completedAt: Date.now(), updatedAt: Date.now() });
      completePlaybackProgress(progressKey(), {
        duration, season, episode,
        title: media.title, media_type: media.media_type, id: media.id
      });
    }
    return;
  }
  if (isVidLink) {
    const vidlinkEvent = String(data.event || "").toLowerCase();
    const vidlinkMediaType = String(data.mediaType || "").toLowerCase();
    const vidlinkId = String(data.tmdbId || data.mtmdbId || data.tmdb || "").trim();
    if (payload.type !== "PLAYER_EVENT" || !/^(play|pause|seeked|ended|timeupdate)$/i.test(vidlinkEvent)) return;
    if (!vidlinkMediaType || vidlinkMediaType !== String(media?.media_type || "").toLowerCase()) return;
    if (vidlinkId && vidlinkId !== String(tmdbId || media?.id || "")) return;
    if (currentParams?.type === "tv") {
      if (data.season != null && Number(data.season) !== Number(currentParams.season)) return;
      if (data.episode != null && Number(data.episode) !== Number(currentParams.episode)) return;
    }
    primaryHealthy = true;
    rememberSuccessfulSource(activeSource);
    clearFallbackTimer();
    updateSourceLabel();
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
    if (/^(ended|completed)$/i.test(vidlinkEvent)) {
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
  const expectedTmdbId = String(tmdbId || media?.id || "");
  if (info.tmdb != null && expectedTmdbId && String(info.tmdb) !== expectedTmdbId) return;
  if (info.imdb && imdbId && String(info.imdb) !== String(imdbId)) return;
  if (currentParams?.type === "tv") {
    if (info.season != null && Number(info.season) !== Number(currentParams.season)) return;
    if (info.episode != null && Number(info.episode) !== Number(currentParams.episode)) return;
  }
  if (activeSource === "vidsrc" && event.origin === "https://vidsrc.sh") {
    const providerStatus = String(data.player_status || "").toLowerCase();
    if (["play", "playing", "pause", "paused", "seeked", "timeupdate", "progress", "completed", "ended", "ready", "canplay", "loadedmetadata"].includes(providerStatus)) {
      const normalizedStatus = ["completed", "ended"].includes(providerStatus) ? "ended"
         : ["paused", "pause"].includes(providerStatus) ? "paused"
        : ["playing", "play"].includes(providerStatus) ? "playing"
        : providerStatus;
      window.dispatchEvent(new CustomEvent("vivid:provider-playback", { detail: {
        provider: "vidsrc", origin: event.origin, event: providerStatus, eventType: providerStatus,
        status: normalizedStatus,
        position: Number(data.player_progress) || 0, duration: Number(data.player_duration) || 0,
        contentId: String(currentParams?.id || info.tmdb || info.imdb || ""),
        mediaType: String(info.mediaType || currentParams?.type || "movie"),
        season: info.season ?? currentParams?.season, episode: info.episode ?? currentParams?.episode
      } }));
    }
  }

  // A validated playback/progress event means the active embed is alive.
  primaryHealthy = true;
  rememberSuccessfulSource(activeSource);
  clearFallbackTimer();
  updateSourceLabel();
  const status = $("player-status");
  if (status) status.hidden = true;
  if ($("player-try-next")) $("player-try-next").hidden = true;
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
  tmdbId = /^\d+$/.test(String(currentParams.id || "")) ? String(currentParams.id) : "";
  if (isAnimePlayback() && !isFreeAnimePreviewRoute({ id: currentParams.id, type: currentParams.type, season: currentParams.season, episode: currentParams.episode })) {
    const query = new URLSearchParams({ id: String(currentParams.id || ""), type: currentParams.type });
    window.location.replace("anime-premium-title.html?" + query.toString());
    return;
  }
  if (!currentParams.id) {
    $("watch-content").innerHTML = '<section class="vivid-watch-error"><i class="bi bi-exclamation-circle"></i><h1>Playback link is incomplete.</h1><p>Choose a title from Vivid Cinema and start playback again.</p><a class="vivid-button vivid-button--secondary" href="home.html">Browse titles</a></section>';
    return;
  }
  media = normalizeMedia({ id: currentParams.id, overview: "", title: currentParams.type === "tv" ? "Loading episode…" : "Loading movie…", poster_path: "", backdrop_path: "" }, currentParams.type);
  renderShell(currentParams);
  if (isWatchRoomCinemaMode && watchRoomScreeningValidated) roomOpenPlayerWindow?.();
  try {
    details = currentParams.type === "tv" ? await tmdbApi.tvDetails(currentParams.id) : await tmdbApi.movieDetails(currentParams.id);
    media = normalizeMedia(details, currentParams.type);
    if (isLikelyAnime() && !isAnimePlayback()) {
      const query = new URLSearchParams({ id: String(currentParams.id), type: currentParams.type });
      window.location.replace("anime-premium-title.html?" + query.toString());
      return;
    }
    imdbId = resolveImdbId(details) || (/^tt\d+$/i.test(String(currentParams.id || "")) ? String(currentParams.id) : "");
    tmdbId = /^\d+$/.test(String(currentParams.id || "")) ? String(currentParams.id) : String(details?.id || "");
    // Render the TMDB title artwork and metadata immediately. Episode-specific
    // details can refine it after the season request completes.
    hydrateWatchDetails(currentParams);

    // Anime catalog lookups are optional: skip them for ordinary movies/TV and
    // never let a provider timeout prevent the watch page from rendering.
    const animeIdsPromise = (isAnimePlayback() || isLikelyAnime())
      ? resolveAnimeIds(media?.title || details?.name || details?.title || "").catch(error => {
          console.warn("Vivid anime ID lookup unavailable:", error);
          return { aniListId: "", malId: "" };
        })
      : Promise.resolve({ aniListId: "", malId: "" });

    if (isAnimePlayback()) {
      const status = $("player-status");
      if (status) {
        status.textContent = "Matching this title to an anime player…";
        status.hidden = false;
      }
    }

    if (currentParams.type === "tv") {
      details.episode = await tmdbApi.tvSeason(currentParams.id, currentParams.season)
        .then(season => (season.episodes || []).find(ep => Number(ep.episode_number) === Number(currentParams.episode)) || null)
        .catch(() => null);
    }
    // Re-render episode-specific text/artwork if the season request supplied it.
    hydrateWatchDetails(currentParams);

    const animeIds = await animeIdsPromise;
    aniListId = animeIds.aniListId;
    malId = animeIds.malId;
    updateSourceLabel();
    if (isAnimePlayback()) {
      // Do not load a third-party iframe until the viewer explicitly opens the player.
      const status = $("player-status");
      if (status) {
        status.textContent = aniListId || malId
          ? "Anime player ready. Select Watch now to begin."
          : "Matching this title to an anime player…";
        status.hidden = false;
      }
      updateSourceLabel();
    }
    // Re-mount Player 2 after TMDB metadata arrives so its season and episode
    // selectors use the actual series seasons, not the early loading shell.
    if (!isAnimePlayback()) mountSecondaryPlayer(currentParams, details.episode?.name || media.title || media.name, details);
    void loadWatchRecommendations(currentParams);
    // Metadata arrived after shell — re-arm
    // the primary timer if the player is still waiting.
    updateSourceLabel();
  } catch (error) {
    console.warn("Vivid metadata unavailable on the watch page:", error);
    const overviewNode = $("watch-overview");
    if (overviewNode) overviewNode.textContent = "Playback is ready. Title information is temporarily unavailable.";
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentParams?.id) {
    persistDirectProgress?.();
    void flushPlaybackProgress(progressKey());
  }
});

window.addEventListener("pagehide", () => {
  if (!currentParams?.id) return;
  persistDirectProgress?.();
  void flushPlaybackProgress(progressKey());
});

document.addEventListener("DOMContentLoaded", () => {
  void startLibrarySync().catch(() => {});
  void startIntelligenceSync().catch(() => {});
  void startPlaybackSync().catch(() => {});
  void load().catch(error => {
    console.error("Vivid watch page failed to initialize:", error);
    const content = $("watch-content");
    if (!content) return;
    const status = $("player-status");
    if (status) {
      status.textContent = "Playback could not initialize. Please reload the page or choose another server.";
      status.classList.add("is-warning");
      status.hidden = false;
      return;
    }
    content.innerHTML = '<section class="vivid-watch-error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><h1>Watch page could not load.</h1><p>Something interrupted this title’s playback page. Please try again.</p><a class="vivid-button vivid-button--secondary" href="home.html">Browse titles</a></section>';
  });
});


// A profile switch invalidates the current playback context. Leave the player
// immediately so no later progress/completion callback can write into the new profile.
if (typeof window !== "undefined") {
  window.addEventListener("vivid:profile-changed", () => {
    try { window.location.replace("home.html"); } catch {}
  });
}
