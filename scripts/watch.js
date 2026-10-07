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
let animeProvider = route.params.get("anime") === "1";

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

function buildYenimeWebUrl(params) {
  const base = "https://yenime.net/anime/" + encodeURIComponent(malId || "");
  return base;
}

function buildYenimeEmbedUrl(params, startAt = 0) {
  const base = String(VIVID_CONFIG.api.yenimeEmbedBaseUrl || "").replace(/\/+$/, "");
  if (!malId) return "";
  const query = new URLSearchParams({ autoplay: "true" });
  if (Number(startAt) > 5) query.set("startAt", String(Math.floor(Number(startAt))));
  // Yenime's episode route is the same embed API for both series and films.
  // Movies use the base MAL-ID player; TV uses the episode-specific route.
  return params.type === "tv"
    ? base + "/embed/" + encodeURIComponent(malId) + "/" + params.episode + "?" + query.toString()
    : base + "/embed/" + encodeURIComponent(malId) + "?" + query.toString();
}

function normalizeAnimeTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function animeTitleCandidates() {
  const aliases = [];
  const alternative = details?.alternative_titles;
  if (Array.isArray(alternative)) aliases.push(...alternative);
  if (alternative && typeof alternative === "object") {
    for (const key of ["results", "titles", "en", "ja"]) {
      if (Array.isArray(alternative[key])) aliases.push(...alternative[key]);
      else if (typeof alternative[key] === "string") aliases.push(alternative[key]);
    }
  }
  return [...new Set([
    details?.title,
    details?.name,
    details?.original_title,
    details?.original_name,
    ...aliases.map(value => typeof value === "object" ? (value.title || value.name || value.iso_3166_1) : value),
    media?.title
  ].map(value => String(value || "").trim()).filter(value => value.length >= 2))];
}

function extractAnimeMapItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "results", "items", "anime", "titles"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [payload];
}

function extractMalId(value) {
  const candidates = [
    value?.mal_id,
    value?.malId,
    value?.mal?.id,
    ...(Array.isArray(value?.mal_id) ? value.mal_id : []),
    ...(Array.isArray(value?.mal_ids) ? value.mal_ids : [])
  ];
  return candidates.map(item => String(item || "").trim()).find(item => /^\\d+$/.test(item)) || "";
}

async function resolveAnimeMalId() {
  if (!details || !animeProvider) return "";

  const tmdbNumericId = String(tmdbId || currentParams?.id || "").trim();
  const mediaType = currentParams?.type === "tv" ? "tv" : "movie";
  const year = Number(
    details.release_date?.slice(0, 4) ||
    details.first_air_date?.slice(0, 4)
  ) || 0;
  const titles = animeTitleCandidates().slice(0, 8);
  const animapBase = String(
    VIVID_CONFIG.api.animapBaseUrl || "https://animap.id"
  ).replace(/\\/+$/, "");

  // Fastest/most reliable title match: AniMap's documented search endpoint.
  // It returns mapped MAL IDs directly and ranks exact title matches first.
  for (const title of titles) {
    try {
      const query = title + (year ? " " + year : "");
      const response = await fetch(
        animapBase + "/api/search?" + new URLSearchParams({
          q: query,
          limit: "25"
        }).toString(),
        {
          headers: { Accept: "application/json" },
          cache: "no-store"
        }
      );

      if (!response.ok) continue;

      const payload = await response.json();
      const results = extractAnimeMapItems(payload);

      const wanted = normalizeAnimeTitle(title);
      const ranked = results
        .filter(item => extractMalId(item))
        .map(item => {
          const names = Array.isArray(item.titles)
            ? item.titles.map(normalizeAnimeTitle).filter(Boolean)
            : [];
          const itemYear = Number(item.year) || 0;
          const exact = names.includes(wanted);
          const contains = names.some(name =>
            name && (wanted.includes(name) || name.includes(wanted))
          );
          const yearMatch = !year || !itemYear || Math.abs(itemYear - year) <= 2;
          const exactYear = Boolean(year && itemYear === year);

          return {
            item,
            score:
              (exact ? 1000 : contains ? 400 : 0) +
              (exactYear ? 250 : yearMatch ? 100 : 0)
          };
        })
        .sort((a, b) => b.score - a.score);

      const best = ranked[0];
      const bestMalId = extractMalId(best?.item);
      if (bestMalId) return bestMalId;
    } catch (_) {}
  }

  // Deterministic TMDB -> MAL mapping for titles not found by title search.
  if (/^\\d+$/.test(tmdbNumericId)) {
    try {
      const response = await fetch(
        animapBase + "/api/map/tmdb/" + encodeURIComponent(tmdbNumericId),
        {
          headers: { Accept: "application/json" },
          cache: "no-store"
        }
      );

      if (response.ok) {
        const payload = await response.json();
        const entry = Array.isArray(payload) ? payload[0] : payload;
        const refs = Array.isArray(entry?.tmdb_id) ? entry.tmdb_id : [];
        const namespaceMatches = refs.length === 0 || refs.some(
          ref =>
            String(ref?.id) === tmdbNumericId &&
            String(ref?.type || "").toLowerCase() === mediaType
        );

        if (namespaceMatches) {
          const candidates = [
            ...(Array.isArray(entry?.mal_id) ? entry.mal_id : [entry?.mal_id]),
            ...(Array.isArray(entry?.mal_ids) ? entry.mal_ids : [])
          ].map(value => String(value || "").trim()).filter(value => /^\\d+$/.test(value));

          if (candidates.length) return candidates[0];
        }
      }
    } catch (_) {}
  }

  // Last fallback: Jikan title search, with generous title/year/type matching.
  const jikanBase = String(
    VIVID_CONFIG.api.jikanBaseUrl || "https://api.jikan.moe/v4"
  ).replace(/\\/+$/, "");

  for (const title of titles) {
    try {
      const response = await fetch(
        jikanBase + "/anime?" + new URLSearchParams({
          q: title,
          limit: "10",
          sfw: "true"
        }).toString(),
        {
          headers: { Accept: "application/json" },
          cache: "no-store"
        }
      );

      if (!response.ok) continue;

      const results = (await response.json())?.data || [];
      const wanted = normalizeAnimeTitle(title);
      const ranked = results
        .filter(item => item?.mal_id)
        .map(item => {
          const names = [
            item.title,
            item.title_english,
            item.title_japanese,
            ...(item.title_synonyms || [])
          ].map(normalizeAnimeTitle).filter(Boolean);
          const itemYear = Number(item.year || item.aired?.from?.slice(0, 4)) || 0;
          const type = String(item.type || "").toLowerCase();
          const typeMatch = mediaType === "movie"
            ? type === "movie"
            : ["tv", "ona", "ova", "special"].includes(type);
          const exact = names.includes(wanted);
          const contains = names.some(name =>
            name && (wanted.includes(name) || name.includes(wanted))
          );
          const yearMatch = !year || !itemYear || Math.abs(itemYear - year) <= 2;

          return {
            item,
            score:
              (exact ? 1000 : contains ? 400 : 0) +
              (typeMatch ? 100 : 0) +
              (year && itemYear === year ? 100 : yearMatch ? 50 : 0)
          };
        })
        .sort((a, b) => b.score - a.score)[0];

      if (ranked?.item?.mal_id) return String(ranked.item.mal_id);
    } catch (_) {}
  }

  return "";
}

function buildVidsrcEmbedUrl(params) {
  const base = String(VIVID_CONFIG.api.vidsrcEmbedBaseUrl || "https://vidsrc.to").replace(/\/+$/, "");
  // VidSrc accepts numeric TMDB IDs, so the fallback stays fully TMDB-based.
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
    status.textContent = "Source unavailable — switching to alternate…";
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
    const canSwitch = animeProvider ? false : (hasFallbackId() || Boolean(malId));
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
      const statusNode = $("player-status");
      if (statusNode) {
        statusNode.textContent = "Yenime could not build the anime player for this title.";
        statusNode.classList.add("is-warning");
        statusNode.hidden = false;
      }
      activeSource = "yenime";
      updateSourceLabel();
      return;
    }
    player.src = url;
    if (status) {
      status.textContent = "Loading anime source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      if (activeSource !== "yenime") return;
      const statusNode = $("player-status");
      if (statusNode) {
        statusNode.textContent = "Yenime is taking longer than expected. Anime playback stays on Yenime.";
        statusNode.classList.add("is-warning");
        statusNode.hidden = false;
      }
    }, YENIME_FALLBACK_MS);
  } else if (source === "vidsrc") {
    if (!hasFallbackId()) return;
    player.src = buildVidsrcEmbedUrl(params);
    if (status) {
      status.textContent = "Loading alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
  } else {
    primaryHealthy = false;
    player.src = buildVidapiEmbedUrl(params, startAt);
    if (status) {
      status.textContent = Number(startAt) > 5 ? "Resuming where you left off…" : "Preparing playback…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    // Auto-fallback only when we have the title ID and primary never signals health.
    if (hasFallbackId()) {
      fallbackTimer = window.setTimeout(() => {
        if (primaryHealthy || activeSource !== "vidapi") return;
        triggerVidsrcFallback("primary_timeout");
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

function renderShell(params) {
  const isTv = params.type === "tv";
  const title = media.title || "Vivid Cinema";
  const episodeTitle = isTv && details?.episode ? details.episode.name : "";
  const saved = getPlaybackProgress(progressKey());
  const resumeAt = Number(saved?.progress || route.params.get("startAt") || 0);

  document.title = (episodeTitle ? episodeTitle + " · " : "") + title + " · Vivid Cinema";
  $("watch-content").innerHTML =
    '<section class="vivid-watch-hero"><div id="watch-backdrop" class="vivid-watch-backdrop" style="--watch-backdrop:url(\'' + getImageUrl(media.backdrop_path, "w1280") + '\')"></div>' +
      '<div class="vivid-watch-head"><div><span id="watch-kicker" class="vivid-watch-kicker">' + (isTv ? "TV · SEASON " + params.season + " · EPISODE " + params.episode : "MOVIE") + '</span>' +
        '<h1 id="watch-title">' + escapeHtml(episodeTitle || title) + '</h1><p id="watch-overview">' + escapeHtml(isTv && details?.episode?.overview ? details.episode.overview : media.overview || "") + '</p>' +
      '</div><a class="vivid-button vivid-button--secondary" href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '"><i class="bi bi-info-circle"></i> Details</a></div></section>' +
    '<section class="vivid-player-section" aria-label="Video player"><div class="vivid-player-frame">' +
      '<div id="player-status" class="vivid-player-status" role="status" aria-live="polite">' + (resumeAt > 5 ? "Resuming where you left off…" : "Preparing playback…") + '</div>' +
      '<div id="yenime-fallback" class="vivid-player-fallback" hidden><span>Player not loading?</span><a id="yenime-fallback-link" class="vivid-button vivid-button--secondary" target="_blank" rel="noopener noreferrer">Open Yenime</a></div>' +
      '<iframe id="vidapi-player" title="' + escapeHtml(title) + ' player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write; web-share" allowfullscreen referrerpolicy="origin" loading="eager"></iframe>' +
    '</div><div class="vivid-player-bar"><div><i class="bi bi-shield-check"></i><span id="player-source-label">Powered by VidAPI</span></div><div class="vivid-player-bar-actions"><button type="button" id="player-switch-source" class="vivid-player-switch" hidden>Try alternate source</button><a href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '">Back to title</a></div></div></section>' +
    (isTv ? '<section class="vivid-watch-note"><i class="bi bi-collection-play"></i><div><strong>Episode playback</strong><span>Use the episode list on the title page to switch seasons and episodes.</span></div></section>' : "") +
    '<section class="vivid-watch-recommendations"><div class="vivid-section-heading"><div><span>AFTER WATCHING</span><h2>More like this</h2></div></div><div id="watch-recommendations" class="vivid-watch-rec-rail">' + recommendationCards() + '</div></section>';

  const player = $("vidapi-player");
  const status = $("player-status");
  const yenimeFallback = $("yenime-fallback");
  const yenimeFallbackLink = $("yenime-fallback-link");
  if (player) {
    player.addEventListener("load", () => {
      // A loaded cross-origin player document is enough to remove our page-level
      // loading banner for alternate providers. VidAPI remains special: its iframe
      // can load while the actual media source is still unavailable, so PLAYER_EVENT
      // continues to be the health signal used for VidAPI fallback.
      if (activeSource === "yenime" || activeSource === "vidsrc") {
        clearFallbackTimer();
        window.setTimeout(() => {
          if (status && status.isConnected && (activeSource === "yenime" || activeSource === "vidsrc")) {
            status.hidden = true;
          }
        }, 500);
        return;
      }
      // A cross-origin iframe load only proves the document loaded; VidAPI still
      // needs a matching PLAYER_EVENT before its fallback watchdog is cancelled.
      window.setTimeout(() => {
        if (status && status.isConnected && activeSource === "vidapi" && primaryHealthy && !status.classList.contains("is-warning")) {
          status.hidden = true;
        }
      }, 450);
    });
    player.addEventListener("error", () => {
      if (activeSource === "vidapi") triggerVidsrcFallback("iframe_error");
      else if (activeSource === "yenime") {
        const statusNode = $("player-status");
        if (statusNode) {
          statusNode.textContent = "Yenime could not load this anime episode.";
          statusNode.classList.add("is-warning");
          statusNode.hidden = false;
        }
      }
    });
    // Metadata is loaded asynchronously. Start with the existing VidAPI path so
    // non-anime playback is unchanged, then switch to Yenime when anime + MAL resolve.
    if (animeProvider) {
      activeSource = "yenime";
      if (yenimeFallback) yenimeFallback.hidden = false;
      updateSourceLabel();
    } else {
      if (yenimeFallback) yenimeFallback.hidden = true;
      setPlayerSource("vidapi", params, resumeAt);
    }
    const switchBtn = $("player-switch-source");
    if (yenimeFallbackLink) {
      yenimeFallbackLink.href = buildYenimeWebUrl(params);
    }
    if (switchBtn) {
      switchBtn.addEventListener("click", () => {
        let next = "vidapi";
        if (activeSource === "vidapi") {
          next = animeProvider && malId ? "yenime" : hasFallbackId() ? "vidsrc" : "vidapi";
        } else if (activeSource === "yenime") {
          next = "yenime";
        } else {
          next = animeProvider ? "yenime" : "vidapi";
        }
        setPlayerSource(next, params, resumeAt);
      });
    }
  }
  window.setTimeout(() => {
    const current = $("player-status");
    if (current && current.isConnected && !current.hidden && activeSource === "vidapi" && !primaryHealthy) {
      current.textContent = "Playback is taking longer than expected. The player is still loading.";
      current.classList.add("is-warning");
    }
  }, fallbackDelayMs() + 1000);
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
  if (kicker) kicker.textContent = isTv ? "TV · SEASON " + params.season + " · EPISODE " + params.episode : "MOVIE";
  const backdrop = $("watch-backdrop");
  if (backdrop) backdrop.style.setProperty("--watch-backdrop", "url('" + getImageUrl(media.backdrop_path, "w1280") + "')");
  const player = $("vidapi-player");
  if (player) player.title = title + " player";
  const recommendations = $("watch-recommendations");
  if (recommendations) recommendations.innerHTML = recommendationCards();
  document.title = (episodeTitle ? episodeTitle + " · " : "") + title + " · Vivid Cinema";
}

async function prepareNextEpisode(params) {
  if (params.type !== "tv") return null;
  try {
    const season = await tmdbApi.tvSeason(params.id, params.season);
    const current = Number(params.episode);
    const next = (season.episodes || []).find(ep => Number(ep.episode_number) === current + 1);
    if (next) return { season: params.season, episode: current + 1, title: next.name };
    const seasons = (details?.seasons || []).filter(s => Number(s.season_number) > Number(params.season) && Number(s.episode_count) > 0);
    if (seasons[0]) return { season: Number(seasons[0].season_number), episode: 1, title: "Episode 1" };
  } catch (_) {}
  return null;
}

function handlePlayerEvent(event) {
  if (!VIDAPI_ORIGINS.has(event.origin)) return;
  const payload = event.data;
  if (!payload || typeof payload !== "object") return;
  if (activeSource !== "vidapi") return;

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

  if (looksLikeFailure && activeSource === "vidapi") {
    triggerVidsrcFallback("vidapi_" + (numericCode || statusValue || "error"));
    return;
  }

  if (payload.type !== "PLAYER_EVENT" || !payload.data) return;
  const data = payload.data;
  const info = data.player_info || {};
  if (String(info.mediaType || "") !== String(media?.media_type || "")) return;
  if (info.tmdb != null && String(info.tmdb) !== String(media?.id)) return;
  if (currentParams?.type === "tv") {
    if (info.season != null && Number(info.season) !== Number(currentParams.season)) return;
    if (info.episode != null && Number(info.episode) !== Number(currentParams.episode)) return;
  }
  // Only a matching player event proves that the current VidAPI source is healthy.
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
    if (media.media_type === "tv" && nextEpisode) {
      const target = buildWatchUrl(media.id, "tv", nextEpisode.season, nextEpisode.episode);
      window.setTimeout(() => { window.location.href = target; }, 1200);
    }
  }
}

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  const player = $("vidapi-player");
  if (!player || !currentParams) return;

  // Returning from an external ad/redirect can restore the page from iOS/WebKit's
  // back-forward cache while the embedded document is still in the ad's visual
  // state. Recreate only the iframe document, preserving the Vivid page and using
  // the latest saved progress when the provider supports resume.
  const saved = getPlaybackProgress(progressKey());
  const resumeAt = Number(saved?.progress || 0);
  const source = activeSource;
  if (source === "yenime" && !malId) return;
  window.setTimeout(() => {
    if (!player.isConnected || !currentParams) return;
    setPlayerSource(source, currentParams, resumeAt);
  }, 80);
});

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
    animeProvider = animeProvider || isLikelyAnime();
    if (animeProvider) malId = await resolveAnimeMalId();
    if (currentParams.type === "tv") {
      details.episode = await tmdbApi.tvSeason(currentParams.id, currentParams.season)
        .then(season => (season.episodes || []).find(ep => Number(ep.episode_number) === Number(currentParams.episode)) || null)
        .catch(() => null);
      nextEpisode = await prepareNextEpisode(currentParams);
    }
    hydrateWatchDetails(currentParams);
    // Metadata arrived after shell. Anime must actually enter Yenime now;
    // otherwise the initial VidAPI iframe would keep running and Yenime would never be used.
    if (animeProvider) {
      const saved = getPlaybackProgress(progressKey());
      const resumeAt = Number(saved?.progress || route.params.get("startAt") || 0);
      if (malId) {
        if (yenimeFallbackLink) yenimeFallbackLink.href = buildYenimeWebUrl(currentParams);
        if (yenimeFallback) yenimeFallback.hidden = false;
        setPlayerSource("yenime", currentParams, resumeAt);
      } else {
        const player = $("vidapi-player");
        if (player) player.src = "";
        const status = $("player-status");
        if (status) {
          status.textContent = "Yenime could not match this anime to a MAL ID.";
          status.classList.add("is-warning");
          status.hidden = false;
        }
        activeSource = "yenime";
        updateSourceLabel();
      }
    } else if (hasFallbackId() && activeSource === "vidapi" && !primaryHealthy && !fallbackTimer) {
      const saved = getPlaybackProgress(progressKey());
      const resumeAt = Number(saved?.progress || route.params.get("startAt") || 0);
      fallbackTimer = window.setTimeout(() => {
        if (primaryHealthy || activeSource !== "vidapi") return;
        triggerVidsrcFallback("primary_timeout_after_metadata");
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
