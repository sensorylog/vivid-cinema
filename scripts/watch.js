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
const PRIMARY_FALLBACK_MS = 11000;
const ANIME_FALLBACK_MS = 11000;

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

function buildVidlinkEmbedUrl(params, startAt = 0) {
  const base = String(VIVID_CONFIG.api.vidlinkEmbedBaseUrl || "https://vidlink.pro").replace(/\/+$/, "");
  const query = new URLSearchParams({ primaryColor: "e50914", secondaryColor: "1b1b1b", iconColor: "ffffff", title: "false", poster: "false" });
  if (Number(startAt) > 5) query.set("startAt", String(Math.floor(Number(startAt))));
  if (route.params.get("anime") === "1") {
    if (!malId) return "";
    query.set("fallback", "true");
    return base + "/anime/" + encodeURIComponent(malId) + "/" + params.episode + "/sub?" + query;
  }
  const id = encodeURIComponent(tmdbId || imdbId || params.id);
  const path = params.type === "tv"
    ? "/tv/" + id + "/" + params.season + "/" + params.episode
    : "/movie/" + id;
  return base + path + "?" + query;
}

function buildVidsrcEmbedUrl(params, startAt = 0) {
  const base = String(VIVID_CONFIG.api.vidsrcEmbedBaseUrl || "https://vidsrc.sh").replace(/\/+$/, "");
  const id = encodeURIComponent(tmdbId || imdbId);
  const path = params.type === "tv"
    ? "/embed/tv/" + id + "/" + params.season + "/" + params.episode
    : "/embed/movie/" + id;
  const query = new URLSearchParams({ ds_lang: "en" });
  if (Number(startAt) > 5) query.set("startAt", String(Math.floor(Number(startAt))));
  return base + path + "?" + query;
}

function buildVidplusEmbedUrl(params, startAt = 0) {
  const base = String(VIVID_CONFIG.api.vidplusEmbedBaseUrl || "https://player.vidplus.to").replace(/\/+$/, "");
  const query = new URLSearchParams({ autoplay: "false", primarycolor: "e50914", secondarycolor: "171717", iconcolor: "ffffff" });
  if (Number(startAt) > 5) query.set("startAt", String(Math.floor(Number(startAt))));
  if (route.params.get("anime") === "1") {
    if (!aniListId) return "";
    query.set("dub", "false");
    return base + "/embed/anime/" + encodeURIComponent(aniListId) + "/" + params.episode + "?" + query;
  }
  const id = encodeURIComponent(tmdbId || params.id);
  const path = params.type === "tv"
    ? "/embed/tv/" + id + "/" + params.season + "/" + params.episode
    : "/embed/movie/" + id;
  return base + path + "?" + query;
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
  // Keep VidPlus manual-only until its playback coverage is verified.
  const order = isAnimePlayback()
    ? ["vidlink"]
    : ["vidapi", "vidsrc", "vidlink"];
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

function showFallbackPrompt(source) {
  if (activeSource !== source) return;
  const status = $("player-status");
  const nextButton = $("player-try-next");
  const label = source === "vidplus" ? "VidPlus" : source === "vidlink" ? "VidLink" : source === "vidsrc" ? "VidSrc" : "VidAPI";
  if (status) {
    status.textContent = label + " is taking longer than expected. It may still start; we will not switch servers unless you choose to.";
    status.classList.add("is-warning");
    status.hidden = false;
  }
  if (nextButton) nextButton.hidden = !getNextSource(source);
}

function updateSourceLabel() {
  const label = document.getElementById("player-source-label");
  if (label) label.textContent = getSourceLabel(activeSource);
  document.querySelectorAll("[data-server-state]").forEach(node => {
    const source = node.getAttribute("data-server-state");
    node.textContent = source === activeSource ? (primaryHealthy ? "Playing" : "Connecting") : (sourceAvailable(source) ? "Ready to try" : "Unavailable");
  });
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
  const tryNextButton = $("player-try-next");
  if (tryNextButton) tryNextButton.hidden = true;
  if (!["vidapi", "vidsrc", "vidlink", "vidplus"].includes(source) || !sourceAvailable(source)) return;
  activeSource = source;
  sourceAttempted.add(source);
  const status = $("player-status");

  if (source === "vidlink") {
    if (route.params.get("anime") === "1" ? !malId : !hasFallbackId()) return;
    primaryHealthy = false;
    const vidlinkUrl = buildVidlinkEmbedUrl(params);
    if (!vidlinkUrl) return;
    player.src = buildVidlinkEmbedUrl(params, startAt);
    if (status) {
      status.textContent = "Loading VidLink alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== "vidlink") return;
      showFallbackPrompt("vidlink");
    }, 25000);
  } else if (source === "vidsrc") {
    if (!hasFallbackId()) return;
    primaryHealthy = false;
    player.src = buildVidsrcEmbedUrl(params, startAt);
    if (status) {
      status.textContent = "Loading VidSrc alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== "vidsrc") return;
      showFallbackPrompt("vidsrc");
    }, 25000);
  } else if (source === "vidplus") {
    if (route.params.get("anime") === "1" ? !aniListId : !hasFallbackId()) return;
    primaryHealthy = false;
    const vidplusUrl = buildVidplusEmbedUrl(params);
    if (!vidplusUrl) return;
    player.src = buildVidplusEmbedUrl(params, startAt);
    if (status) {
      status.textContent = "Loading VidPlus alternate source…";
      status.classList.remove("is-warning");
      status.hidden = false;
    }
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      if (primaryHealthy || activeSource !== "vidplus") return;
      showFallbackPrompt("vidplus");
    }, 25000);
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
        fallbackTimer = null;
        if (primaryHealthy || activeSource !== "vidapi") return;
        showFallbackPrompt("vidapi");
      }, 25000);
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
      '<div class="vivid-watch-head"><div class="vivid-watch-artwork"><img src="' + getImageUrl(media.poster_path, "w342") + '" alt="' + escapeHtml(title) + ' poster" loading="eager" decoding="async" onerror="this.onerror=null;this.src=&quot;icons/vivid-icon.svg&quot;"></div><div class="vivid-watch-copy"><span id="watch-kicker" class="vivid-watch-kicker">' + (isAnimePlayback() ? (isTv ? "ANIME · SEASON " + params.season + " · EPISODE " + params.episode : "ANIME FILM") : isTv ? "TV · SEASON " + params.season + " · EPISODE " + params.episode : "MOVIE") + '</span>' +
        '<h1 id="watch-title">' + escapeHtml(episodeTitle || title) + '</h1><p id="watch-overview">' + escapeHtml(isTv && details?.episode?.overview ? details.episode.overview : media.overview || "") + '</p>' +
      '</div><a class="vivid-button vivid-button--secondary" href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '"><i class="bi bi-info-circle"></i> Details</a></div></section>' +
    '<section class="vivid-player-launch" aria-label="Start watching"><div class="vivid-player-launch-card"><div class="vivid-player-launch-copy"><span class="vivid-watch-kicker">YOUR SCREENING ROOM</span><strong>Ready when you are.</strong><span>Open the player in its own cinema window. Close it any time without leaving this page.</span></div><button type="button" id="watch-open-player" class="vivid-player-open"><i class="bi bi-play-fill" aria-hidden="true"></i><span>Watch now</span></button></div><div class="vivid-player-launch-foot"><span><i class="bi bi-shield-check" aria-hidden="true"></i> Choose a server if playback stalls</span><a href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '">Title details <i class="bi bi-arrow-up-right" aria-hidden="true"></i></a></div></section>' +
    '<div id="player-overlay" hidden class="vivid-player-overlay" role="presentation"><section class="vivid-player-dialog" role="dialog" aria-modal="true" aria-labelledby="player-dialog-title"><header class="vivid-player-dialog-head"><div class="vivid-player-dialog-heading"><span class="vivid-player-live-dot" aria-hidden="true"></span><div><span class="vivid-player-dialog-eyebrow">VIVID CINEMA · NOW PLAYING</span><h2 id="player-dialog-title">' + escapeHtml(episodeTitle || title) + '</h2><span id="player-source-label" class="vivid-player-current-source">Connecting to a server…</span></div></div><div class="vivid-player-dialog-actions"><div class="vivid-server-picker"><button type="button" id="player-server-menu" class="vivid-player-switch vivid-server-menu" aria-expanded="false" aria-controls="player-server-panel"><i class="bi bi-hdd-network" aria-hidden="true"></i> Servers <i class="bi bi-chevron-down" aria-hidden="true"></i></button><div id="player-server-panel" class="vivid-server-panel" hidden><div class="vivid-server-panel-heading"><strong>Available servers</strong><span>Tap to switch</span></div><button type="button" class="vivid-player-source" data-player-source="vidapi" aria-pressed="true"><span class="vivid-server-dot"></span><span><strong>VidAPI</strong><small>Primary server</small></span><span class="vivid-server-state" data-server-state="vidapi">Ready</span></button><button type="button" class="vivid-player-source" data-player-source="vidsrc" aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidSrc</strong><small>Alternate server</small></span><span class="vivid-server-state" data-server-state="vidsrc">Available</span></button><button type="button" class="vivid-player-source" data-player-source="vidlink" aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidLink</strong><small>Alternate server</small></span><span class="vivid-server-state" data-server-state="vidlink">Available</span></button><button type="button" class="vivid-player-source" data-player-source="vidplus" aria-pressed="false"><span class="vivid-server-dot"></span><span><strong>VidPlus</strong><small>Experimental · manual selection</small></span><span class="vivid-server-state" data-server-state="vidplus">Available</span></button><p>Servers depend on title availability and provider uptime.</p></div></div><button type="button" id="player-close" class="vivid-player-close" aria-label="Close player"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></header><div class="vivid-player-frame"><div id="player-status" class="vivid-player-status" role="status" aria-live="polite">' + (resumeAt > 5 ? "Resuming where you left off…" : "Preparing playback…") + '</div><button type="button" id="player-try-next" class="vivid-player-try-next" hidden>Try next server</button><iframe id="vidapi-player" title="' + escapeHtml(title) + ' player" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write" allowfullscreen referrerpolicy="origin" loading="eager"></iframe></div><footer class="vivid-player-dialog-foot"><span><i class="bi bi-lightning-charge" aria-hidden="true"></i> You control when the server changes</span><a href="' + escapeHtml(buildTitleUrl(media.id, media.media_type)) + '">Title details</a></footer></section></div>' +
    (isTv ? '<section class="vivid-watch-note"><i class="bi bi-collection-play"></i><div><strong>Episode playback</strong><span>Use the episode list on the title page to switch seasons and episodes.</span></div></section>' : "") +
    '<section class="vivid-watch-recommendations"><div class="vivid-section-heading"><div><span>AFTER WATCHING</span><h2>More like this</h2></div></div><div id="watch-recommendations" class="vivid-watch-rec-rail">' + recommendationCards() + '</div></section>';

  const player = $("vidapi-player");
  const status = $("player-status");
  const tryNextButton = $("player-try-next");
  const overlay = $("player-overlay");
  // Keep the page interactive until the viewer opens the cinema window.
  const openPlayer = $("watch-open-player");
  const closePlayer = $("player-close");
  const serverMenu = $("player-server-menu");
  const serverPanel = $("player-server-panel");
  const setServerMenuOpen = open => {
    if (!serverMenu || !serverPanel) return;
    serverMenu.setAttribute("aria-expanded", open ? "true" : "false");
    serverPanel.hidden = !open;
  };
  const openPlayerWindow = () => {
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add("vivid-player-open");
    if (openPlayer) openPlayer.setAttribute("aria-expanded", "true");
    const saved = getPlaybackProgress(progressKey());
    const startAt = Number(saved?.progress || route.params.get("startAt") || resumeAt || 0);
    sourceAttempted.clear();
    setPlayerSource(activeSource || "vidapi", params, startAt);
    closePlayer?.focus({ preventScroll: true });
  };
  const closePlayerWindow = () => {
    if (!overlay) return;
    clearFallbackTimer();
    overlay.hidden = true;
    document.body.classList.remove("vivid-player-open");
    if (openPlayer) openPlayer.setAttribute("aria-expanded", "false");
    setServerMenuOpen(false);
    if (player) player.src = "";
    if (tryNextButton) tryNextButton.hidden = true;
    primaryHealthy = false;
    openPlayer?.focus({ preventScroll: true });
  };
  openPlayer?.addEventListener("click", openPlayerWindow);
  closePlayer?.addEventListener("click", closePlayerWindow);
  tryNextButton?.addEventListener("click", () => {
    const next = getNextSource(activeSource);
    if (!next) return showFallbackPrompt(activeSource);
    sourceAttempted.add(activeSource);
    setPlayerSource(next, currentParams, Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || resumeAt || 0));
  });
  overlay?.addEventListener("click", event => {
    if (event.target === overlay) closePlayerWindow();
  });
  serverMenu?.addEventListener("click", () => setServerMenuOpen(serverMenu.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && overlay && !overlay.hidden) {
      if (serverPanel && !serverPanel.hidden) setServerMenuOpen(false);
      else closePlayerWindow();
    }
  });
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
    // Start in the focused cinema window; users can reopen it after closing.
    document.querySelectorAll("[data-player-source]").forEach(button => {
      button.addEventListener("click", () => {
        const source = button.getAttribute("data-player-source");
        if (!["vidapi", "vidsrc", "vidlink", "vidplus"].includes(source) || !sourceAvailable(source)) return;
        sourceAttempted.clear();
        setServerMenuOpen(false);
        const latestProgress = Number(getPlaybackProgress(progressKey())?.progress || route.params.get("startAt") || resumeAt || 0);
        setPlayerSource(source, params, latestProgress);
      });
    });
    if (isAnimePlayback()) {
      if (status) status.textContent = "Matching this title to an anime player…";
      updateSourceLabel();
    } else {
      // Do not load an external stream until the viewer explicitly opens the player.
      sourceAttempted.clear();
      activeSource = "vidapi";
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
  const originMatchesActiveSource =
    (activeSource === "vidapi" && isVidapi) ||
    (activeSource === "vidsrc" && isFallback) ||
    (activeSource === "vidlink" && isVidLink) ||
    (activeSource === "vidplus" && isVidPlus);
  // Ignore delayed messages from a previous iframe document after the user switches source.
  if (!originMatchesActiveSource) return;
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
  const explicitStatus = /^(play|playing|pause|paused|timeupdate|progress|seeked|ended|completed|loadedmetadata|canplay|ready|started)$/i.test(statusValue);
  const isPlaybackSignal =
    payload.type === "PLAYER_EVENT" ||
    explicitStatus ||
    Number(eventData.player_progress) > 0 ||
    Number(eventData.currentTime) > 0;
  if (!isPlaybackSignal) return;
  const data = payload.data;
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
  // A validated playback/progress event means the active embed is alive.
  primaryHealthy = true;
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
        fallbackTimer = null;
        if (primaryHealthy || activeSource !== "vidapi") return;
        showFallbackPrompt("vidapi");
      }, 25000);
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
