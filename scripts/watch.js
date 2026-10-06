import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia, normalizeResults } from "./media.js";
import { buildTitleUrl, buildWatchUrl, getRoute } from "./routes.js";
import { escapeHtml } from "./utils.js";
import { getLocalLibrary, saveLocalLibrary, upsertLibraryItem, startLibrarySync } from "./library.js";
import { getPlaybackProgress, savePlaybackProgress, flushPlaybackProgress, completePlaybackProgress, startPlaybackSync } from "./recommendations.js";
import { VIVID_CONFIG } from "./config.js";
import { recordBehavior, startIntelligenceSync } from "./intelligence.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
const VIDAPI_ORIGINS = new Set([new URL(VIVID_CONFIG.api.vidapiEmbedBaseUrl).origin, "https://vidapi.ru"]);
const VIDSRC_ORIGIN = (() => {
  try { return new URL(VIVID_CONFIG.api.vidsrcEmbedBaseUrl || "https://vidsrc.to").origin; }
  catch { return "https://vidsrc.to"; }
})();
let media = null;
let details = null;
let currentParams = null;
let nextEpisode = null;
let lastHistorySyncAt = 0;
let activeSource = "vidapi";
let primaryHealthy = false;
let fallbackTimer = null;
let imdbId = "";
let tmdbId = "";
const PRIMARY_FALLBACK_MS = 5000;
const YENIME_FALLBACK_MS = 3500;
let malId = "";
let animeProvider = false;

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

function buildYenimeEmbedUrl(params, startAt = 0) {
  const base = String(VIVID_CONFIG.api.yenimeEmbedBaseUrl || "").replace(/\/+$/, "");
  if (!malId) return "";
  const query = new URLSearchParams({ autoplay: "true" });
  if (Number(startAt) > 5) query.set("startAt", String(Math.floor(Number(startAt))));
  return params.type === "tv"
    ? base + "/embed/" + encodeURIComponent(malId) + "/" + params.episode + "?" + query
    : base + "/embed/" + encodeURIComponent(malId) + "?" + query;
}

function normalizeAnimeTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u201C\u201D"'\u2019]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function animeTitleCandidates() {
  return [...new Set([
    details?.title, details?.name, details?.original_title, details?.original_name, media?.title
  ].map(value => String(value || "").trim()).filter(Boolean))];
}

async function resolveAnimeMalId() {
  if (!details || !animeProvider) return "";
  let base = String(VIVID_CONFIG.api.jikanBaseUrl || "https://api.jikan.moe/v4");
  while (base.endsWith("/")) base = base.slice(0, -1);
  const year = Number(details.release_date?.slice(0, 4) || details.first_air_date?.slice(0, 4)) || 0;
  for (const title of animeTitleCandidates().slice(0, 3)) {
    try {
      const response = await fetch(base + "/anime?" + new URLSearchParams({
        q: title, type: currentParams?.type === "movie" ? "movie" : "tv", limit: "5", sfw: "true"
      }), { headers: { Accept: "application/json" }, cache: "force-cache" });
      if (!response.ok) continue;
      const results = (await response.json())?.data || [];
      const wanted = normalizeAnimeTitle(title);
      const exact = results
        .map(item => {
          const names = [item.title, item.title_english, item.title_japanese, ...(item.title_synonyms || [])]
            .map(normalizeAnimeTitle).filter(Boolean);
          const itemYear = Number(item.year || item.aired?.from?.slice(0, 4)) || 0;
          const titleMatch = names.includes(wanted);
          const yearMatch = !year || !itemYear || Math.abs(itemYear - year) <= 1;
          const score = titleMatch ? 100 : names.some(name => name && (wanted.includes(name) || name.includes(wanted))) ? 50 : 0;
          return { item, score: score + (yearMatch ? 10 : 0) };
        })
        .filter(candidate => candidate.score >= (year ? 110 : 100))
        .sort((a, b) => b.score - a.score)[0]?.item;
      if (exact?.mal_id) return String(exact.mal_id);
    } catch (_) {}
  }
  return "";
}

function buildVidsrcEmbedUrl(params) {
  const base = String(VIVID_CONFIG.api.vidsrcEmbedBaseUrl || "https://vidsrc.to").replace(/\/+$/, "");
  const id = encodeURIComponent(tmdbId || imdbId);
  if (params.type === "tv") {
    return base + "/embed/tv/" + id + "/" + params.season + "/" + params.episode;
  }
  return base + "/embed/movie/" + id;
}

function isLikelyAnime() {
  const genres = Array.isArray(details?.genres) ? details.genres : [];
  const isAnimation = genres.some(g => Number(g?.id) === 16 || String(g?.name || "").toLowerCase() === "animation");
  const originalLanguage = String(details?.original_language || "").toLowerCase();
  return isAnimation && originalLanguage === "ja";
}

function fallbackDelayMs() {
  return PRIMARY_FALLBACK_MS;
}

function hasFallbackId() {
  return Boolean(tmdbId || imdbId);
}

function triggerVidsrcFallback(reason = "primary_error") {
  if (activeSource === "vidsrc" || !currentParams || !hasFallbackId()) return false;
  clearFallbackTimer();
  const status = $("player-status");
  if (status) {
    status.textContent = "Source unavailable \u2014 switching to alternate\u2026";
    status.classList.add("is-warning");
    status.hidden = false;
  }
  console.warn("Vivid playback fallback:", reason);
  setPlayerSource("vidsrc", currentParams, Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || 0));
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
  if (label) label.textContent = activeSource === "yenime" ? "Powered by Yenime" : activeSource === "vidsrc" ? "Alternate source" : "Powered by VidAPI";
  const switchBtn = document.getElementById("player-switch-source");
  if (switchBtn) {
    const canSwitch = hasFallbackId() || Boolean(malId);
    switchBtn.hidden = !canSwitch;
    if (activeSource === "vidsrc") switchBtn.textContent = "Try primary source";
    else if (activeSource === "yenime") switchBtn.textContent = hasFallbackId() ? "Try alternate source" : "Try VidAPI";
    else switchBtn.textContent = "Try alternate source";
  }
}

function setPlayerSource(source, params, startAt = 0) {
  const player = $("vidapi-player");
  if (!player || !params) return;
  clearFallbackTimer();
  activeSource = source;
  const status = $("player-status");
  if (source === "yenime") {
    const url = buildYenimeEmbedUrl(params, startAt);
    if (!url) {
      setPlayerSource("vidapi", params, startAt);
      return;
    }
    player.src = url;
    if (status) {
      status.textContent = "Loading anime source\u2026";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      if (activeSource !== "yenime") return;
      if (hasFallbackId()) triggerVidsrcFallback("yenime_timeout");
      else setPlayerSource("vidapi", params, startAt);
    }, YENIME_FALLBACK_MS);
  } else if (source === "vidsrc") {
    if (!hasFallbackId()) return;
    player.src = buildVidsrcEmbedUrl(params);
    if (status) {
      status.textContent = "Loading alternate source\u2026";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
  } else {
    primaryHealthy = false;
    player.src = buildVidapiEmbedUrl(params, startAt);
    if (status) {
      status.textContent = Number(startAt) > 5 ? "Resuming where you left off\u2026" : "Preparing playback\u2026";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    if (hasFallbackId()) {
      fallbackTimer = window.setTimeout(() => {
        if (primaryHealthy || activeSource !== "vidapi") return;
        triggerVidsrcFallback("primary_timeout");
      }, fallbackDelayMs());
    }
  }
  updateSourceLabel();
}
