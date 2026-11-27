import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { tmdbApi } from "./tmdb.js";
import { isTitleAllowed, renderParentalBlock } from "./parental-controls.js";
import { getImageUrl } from "./media.js";
import { escapeHtml } from "./utils.js";
import { isAnimeMetadata } from "./anime-eligibility.js";
import { resolveAnimeIds } from "./playback/anime-id-resolver.js";
import { resolveAnimePremiumProviderOptions } from "./playback/anime-premium-providers.js";
import { getLocalLibrary, upsertLibraryItem } from "./library.js";
import { savePlaybackProgress, completePlaybackProgress, flushPlaybackProgress } from "./recommendations.js";
import { getAnimeLibraryPreferences, saveAnimeLibraryPreferences, syncAnimePreferencesForUser, markAnimeCompleted } from "./anime-library.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const mediaType = params.get("type") === "movie" ? "movie" : "tv";
const rawId = params.get("id") || "";
const titleId = /^\d{1,12}$/.test(rawId) ? rawId : "";
let currentUser = null;
let titleDetails = null;
let seasonDetails = null;
let activeEpisodes = [];
let activeEpisodeIndex = 0;
let seasonRequest = 0;
let playbackRequestId = 0;
let providerRequestId = 0;
let currentPlaybackSessionId = "";
let playbackExpiryTimer = null;
let providerLoadTimer = null;
let activeProviderId = "";
let providerOptions = [];
let failedProviderIds = new Set();
let baseAnimeIds = { aniListId: "", malId: "" };
let seasonAnimeIds = { aniListId: "", malId: "" };
let animeIdPromise = Promise.resolve(baseAnimeIds);
let animeTrack = getAnimeLibraryPreferences().track;
let lastHistorySyncAt = 0;
let lastCompletedEpisodeKey = "";
let activeProviderEpisodeNumber = 1;
let latestProviderProgress = null;
let lastProgressSync = 0;
let progressSyncInFlight = false;
let pendingProgressSnapshot = null;

function titleName(details) { return details?.title || details?.name || "Anime title"; }
function titleRoute() { return "anime-premium-title.html?id=" + encodeURIComponent(titleId) + "&type=" + encodeURIComponent(mediaType); }
function watchRoute(season, episode) {
  const query = new URLSearchParams({ id: titleId, type: mediaType });
  if (mediaType === "tv") { query.set("season", String(season)); query.set("episode", String(episode)); }
  return "anime-premium-watch.html?" + query.toString();
}
function setStatus(message) { $("vap-player-status").textContent = message; }
function disposePlayer() {
  if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
  if (playbackExpiryTimer) window.clearTimeout(playbackExpiryTimer);
  providerLoadTimer = null;
  playbackExpiryTimer = null;
  providerRequestId += 1;
  const frame = $("vap-player-frame");
  if (frame) { frame.onload = null; frame.onerror = null; frame.src = "about:blank"; frame.hidden = true; }
}
function showGate(title, message, actionLabel = "Sign in to Vivid", actionHref = "auth.html?returnTo=anime-premium.html", retry = false) {
  disposePlayer();
  currentPlaybackSessionId = "";
  activeProviderId = "";
  $("vap-player-gate").hidden = false;
  $("vap-player-gate-title").textContent = title;
  $("vap-player-gate-copy").textContent = message;
  $("vap-player-signin").textContent = actionLabel + " →";
  $("vap-player-signin").href = actionHref;
  $("vap-player-retry").hidden = !retry;
  $("vap-server-next").hidden = true;
}
function updateEpisodeControls() {
  const episode = activeEpisodes[activeEpisodeIndex];
  if (!episode) {
    $("vap-previous-episode").disabled = true;
    $("vap-next-episode").disabled = true;
    return;
  }
  const season = Number(params.get("season") || 1);
  $("vap-current-episode").textContent = mediaType === "movie"
    ? "Feature film"
    : "S" + String(season).padStart(2, "0") + " · E" + String(Number(episode.episode_number || activeEpisodeIndex + 1)).padStart(2, "0") + " — " + (episode.name || "Episode");
  $("vap-previous-episode").disabled = activeEpisodeIndex <= 0;
  $("vap-next-episode").disabled = activeEpisodeIndex >= activeEpisodes.length - 1;
  $("vap-episode-grid").querySelectorAll("[data-vap-episode]").forEach(button => {
    const active = Number(button.dataset.vapEpisode) === activeEpisodeIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function renderEpisodes(episodes) {
  activeEpisodes = Array.isArray(episodes) ? episodes : [];
  const grid = $("vap-episode-grid");
  if (!activeEpisodes.length) {
    grid.innerHTML = '<p class="vap-watch-empty">No episode metadata is available for this season.</p>';
    updateEpisodeControls();
    return;
  }
  const requested = Number(params.get("episode") || 1);
  const found = activeEpisodes.findIndex(item => Number(item.episode_number) === requested);
  activeEpisodeIndex = found >= 0 ? found : 0;
  grid.innerHTML = activeEpisodes.map((episode, index) => {
    const number = Number(episode.episode_number || index + 1);
    const name = episode.name || "Episode " + number;
    const runtime = episode.runtime ? Number(episode.runtime) + " min" : "Episode " + number;
    return '<button class="vap-episode-card' + (index === activeEpisodeIndex ? " is-active" : "") + '" type="button" data-vap-episode="' + index + '" aria-pressed="' + (index === activeEpisodeIndex) + '">' +
      '<span class="vap-episode-number">' + String(number).padStart(2, "0") + '</span>' +
      '<span class="vap-episode-copy"><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(runtime) + '</small></span>' +
      '<i class="bi bi-play-circle vap-episode-play" aria-hidden="true"></i></button>';
  }).join("");
  grid.querySelectorAll("[data-vap-episode]").forEach(button => {
    button.addEventListener("click", () => void selectEpisode(Number(button.dataset.vapEpisode), true));
  });
  updateEpisodeControls();
}
function renderServerOptions() {
  const list = $("vap-server-list");
  list.innerHTML = providerOptions.map(provider =>
    '<button class="vap-server-option" type="button" data-vap-server="' + provider.id + '"' +
    ' aria-pressed="' + String(provider.id === activeProviderId) + '">' +
    '<span class="vap-server-option-copy"><strong>' + escapeHtml(provider.label) + '</strong><small>Anime stream · ' + escapeHtml(animeTrack.toUpperCase()) + '</small></span>' +
    '<span class="vap-server-option-state">' +
    (provider.id === activeProviderId ? "Selected" : failedProviderIds.has(provider.id) ? "Failed · retry" : "Ready to try") +
    '</span></button>'
  ).join("");
  list.querySelectorAll("[data-vap-server]").forEach(button => button.addEventListener("click", () => activateProvider(button.dataset.vapServer)));
  $("vap-server-count").textContent = providerOptions.length + (providerOptions.length === 1 ? " server option" : " server options");
}
function activateProvider(providerId) {
  const provider = providerOptions.find(item => item.id === providerId && item.available);
  if (!provider || !currentPlaybackSessionId) return false;
  const frame = $("vap-player-frame");
  if (activeProviderId && activeProviderId !== provider.id) void syncPlaybackProgress(true);
  failedProviderIds.delete(provider.id);
  const generation = ++providerRequestId;
  if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
  providerLoadTimer = null;
  activeProviderId = provider.id;
  renderServerOptions();
  $("vap-player-gate").hidden = true;
  frame.hidden = false;
  frame.src = "about:blank";
  frame.referrerPolicy = provider.id === "embedwave" ? "no-referrer" : "origin";
  frame.title = titleName(titleDetails) + " · " + provider.label;
  frame.onload = () => {
    if (generation === providerRequestId && activeProviderId === provider.id) {
      setStatus(provider.label + " page opened. Playback is not confirmed yet; switch servers if the episode does not start.");
    }
  };
  frame.onerror = () => {
    if (generation === providerRequestId && activeProviderId === provider.id) fallbackToNextPlaybackServer(provider.label + " could not load.");
  };
  frame.src = provider.url;
  $("vap-server-next").hidden = providerOptions.filter(item => item.available && item.id !== provider.id).length === 0;
  setStatus("Opening " + provider.label + " · " + animeTrack.toUpperCase() + "…");
  providerLoadTimer = window.setTimeout(() => {
    if (generation !== providerRequestId || activeProviderId !== provider.id) return;
    setStatus(provider.label + " has not confirmed playback. The player may still be loading; use the next server if it remains stuck.");
    $("vap-server-next").hidden = providerOptions.filter(item => item.available && item.id !== provider.id).length === 0;
  }, 18000);
  return true;
}
function fallbackToNextPlaybackServer(message) {
  if (!currentPlaybackSessionId) return;
  if (activeProviderId) failedProviderIds.add(activeProviderId);
  const next = providerOptions.find(item => item.available && !failedProviderIds.has(item.id));
  if (!next) {
    activeProviderId = "";
    setStatus(message + " No other available server remains. Choose a failed server above to retry.");
    $("vap-server-next").hidden = true;
    renderServerOptions();
    return;
  }
  setStatus(message + " Trying " + next.label + "…");
  activateProvider(next.id);
}
function updateProviderProgress(position, duration, force = false) {
  const currentTime = Number(position), total = Number(duration);
  if (!Number.isFinite(currentTime) || !Number.isFinite(total) || total <= 0 || currentTime < 0 || currentTime > total + 5) return;
  latestProviderProgress = { currentTime: Math.min(currentTime, total), duration: total };
  const season = mediaType === "tv" ? Math.max(0, Number(params.get("season") || 1)) : null;
  const episode = mediaType === "tv" ? Math.max(1, Number(activeEpisodes[activeEpisodeIndex]?.episode_number || params.get("episode") || 1)) : null;
  const contentId = mediaType === "tv" ? `tv:${titleId}:${season}:${episode}` : `movie:${titleId}`;
  const progressData = { id: titleId, media_type: mediaType, season, episode, title: titleName(titleDetails), progress: Math.min(currentTime, total), duration: total, isAnime: true };
  savePlaybackProgress(contentId, progressData);
  recordAnimeHistory(currentTime, total);
  if (force && currentTime >= total - 5 && lastCompletedEpisodeKey !== contentId) {
    lastCompletedEpisodeKey = contentId;
    completePlaybackProgress(contentId, progressData);
    if (mediaType === "movie") markAnimeCompleted({ id: titleId, media_type: mediaType, title: titleName(titleDetails), poster_path: titleDetails?.poster_path || "", backdrop_path: titleDetails?.backdrop_path || "" });
    else if (getAnimeLibraryPreferences().autoplayNextEpisode && activeEpisodeIndex + 1 < activeEpisodes.length) {
      const nextIndex = activeEpisodeIndex + 1;
      window.setTimeout(() => { if (currentPlaybackSessionId) void selectEpisode(nextIndex, true); }, 1100);
    }
  }
  void syncPlaybackProgress(force);
}
function handleProviderMessage(event) {
  const provider = providerOptions.find(item => item.id === activeProviderId);
  const frame = $("vap-player-frame");
  let expectedOrigin = "";
  try { expectedOrigin = new URL(provider?.url || "").origin; } catch { return; }
  if (!provider || !frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== expectedOrigin) return;
  let data = event.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return; }
  }
  if (!data || typeof data !== "object") return;
  if (provider.id === "anilink" && typeof data.type === "string" && data.type.startsWith("anilink-player:")) {
    const type = data.type.slice("anilink-player:".length), payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    if (["ready", "play", "progress"].includes(type)) {
      if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
      providerLoadTimer = null;
      setStatus("Playing with AniLink · " + animeTrack.toUpperCase());
    }
    if (type === "progress") updateProviderProgress(payload.position ?? payload.currentTime, payload.duration);
    if (type === "ended") updateProviderProgress(payload.position ?? payload.duration, payload.duration, true);
    if (type === "error") fallbackToNextPlaybackServer("AniLink reported a playback error.");
    return;
  }
  if (provider.id === "vidrift" && typeof data.type === "string" && data.type.startsWith("vidrift:")) {
    if (data.type === "vidrift:progress") {
      if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
      providerLoadTimer = null;
      updateProviderProgress(data.currentTime, data.duration);
      setStatus("Playing with VidRift · " + animeTrack.toUpperCase());
    } else if (data.type === "vidrift:ended") {
      if (Number.isFinite(Number(data.duration))) updateProviderProgress(data.duration, data.duration, true);
    } else if (data.type === "vidrift:wont-play") {
      fallbackToNextPlaybackServer("VidRift could not find a playable source.");
    }
    return;
  }
  if (provider.id === "anixo") {
    if (["aniembed:ready", "aniembed:play", "aniembed:progress", "aniembed:timeupdate"].includes(data.type)) {
      if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
      providerLoadTimer = null;
      setStatus(data.type === "aniembed:ready"
        ? provider.label + " is ready. Press play in the player."
        : "Playing · " + animeTrack.toUpperCase());
      if (Number.isFinite(Number(data.duration))) updateProviderProgress(data.currentTime ?? data.time, data.duration);
    } else if (data.type === "aniembed:ended") {
      if (Number.isFinite(Number(data.duration))) updateProviderProgress(data.duration, data.duration, true);
    } else if (data.type === "aniembed:error") {
      fallbackToNextPlaybackServer("AniXo reported a playback error.");
    }
    return;
  }
  if (["megaplay", "megaplay-legacy", "megavid", "megaflix"].includes(provider.id)) {
    let message = data;
    if (typeof message === "string") {
      try { message = JSON.parse(message); } catch { return; }
    }
    if (message.type === "watching-log") {
      updateProviderProgress(message.currentTime, message.duration);
      if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
      providerLoadTimer = null;
      setStatus("Playing with " + provider.label + " · " + animeTrack.toUpperCase());
      return;
    }
    const eventName = String(message.event || message.type || "").toLowerCase();
    const channel = String(message.channel || "").toLowerCase();
    if (["time", "timeupdate", "progress"].includes(eventName) && (!channel || ["megacloud", "megaplay"].includes(channel))) {
      if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
      providerLoadTimer = null;
      updateProviderProgress(message.currentTime ?? message.time ?? message.position, message.duration ?? message.total);
      setStatus("Playing with " + provider.label + " · " + animeTrack.toUpperCase());
    } else if (["complete", "ended"].includes(eventName)) {
      const total = Number(message.duration ?? message.total);
      if (Number.isFinite(total) && total > 0) updateProviderProgress(total, total, true);
    } else if (["error", "failed"].includes(eventName)) {
      fallbackToNextPlaybackServer(provider.label + " reported a playback error.");
    }
    return;
  }
  if (["vidapi", "vidsrc", "vidlink", "vidplus"].includes(provider.id)) {
    const payload = data;
    const eventData = payload.data && typeof payload.data === "object" ? payload.data : payload;
    const status = String(eventData.player_status || eventData.status || eventData.event || "").toLowerCase();
    const error = String(eventData.error || eventData.error_code || eventData.code || eventData.message || "").toLowerCase();
    const numericCode = Number(eventData.status_code ?? eventData.http_status ?? eventData.httpStatus ?? eventData.statusCode);
    const failed = (Number.isFinite(numericCode) && numericCode >= 400) ||
      /(^|\\D)(404|403|500|502|503)(\\D|$)/.test(error) ||
      /(error|failed|failure|not.?found|unavailable|offline|load.?failed|source.?failed)/.test(status + " " + error);
    if (failed) {
      fallbackToNextPlaybackServer(provider.label + " reported a playback error.");
      return;
    }
    const eventName = String(eventData.event || eventData.player_status || "").toLowerCase();
    const info = eventData.player_info && typeof eventData.player_info === "object" ? eventData.player_info : {};
    const eventMediaType = String(eventData.mediaType || info.mediaType || "").toLowerCase();
    if (eventMediaType && ![mediaType, "anime"].includes(eventMediaType)) return;
    const eventTmdbId = String(eventData.tmdbId || eventData.tmdb || info.tmdb || "").trim();
    if (eventTmdbId && eventTmdbId !== titleId) return;
    if (mediaType === "tv") {
      if (provider.kind === "tmdb") {
        if (eventData.season != null && Number(eventData.season) !== Number(params.get("season") || 1)) return;
        if (eventData.episode != null && Number(eventData.episode) !== Number(activeEpisodes[activeEpisodeIndex]?.episode_number || 1)) return;
      } else if (eventData.episode != null &&
        ![Number(activeEpisodes[activeEpisodeIndex]?.episode_number || 1), activeProviderEpisodeNumber].includes(Number(eventData.episode))) return;
    }
    const progress = Number(eventData.currentTime ?? eventData.player_progress ?? eventData.time) || 0;
    const duration = Number(eventData.duration ?? eventData.player_duration ?? eventData.total) || 0;
    const healthy = payload.type === "PLAYER_EVENT" ||
      /^(play|playing|pause|paused|timeupdate|progress|seeked|ended|completed|loadedmetadata|canplay|ready|started)$/.test(status) ||
      progress > 0;
    if (!healthy) return;
    if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
    providerLoadTimer = null;
    const confirmedPlaying = /^(play|playing|timeupdate|progress|seeked|started)$/.test(eventName) || progress > 0;
    setStatus(confirmedPlaying
      ? "Playing · " + animeTrack.toUpperCase()
      : provider.label + " is ready. Press play in the player.");
    if (progress > 0 && duration > 0) updateProviderProgress(progress, duration);
    if (/^(ended|completed)$/.test(eventName) && duration > 0) updateProviderProgress(duration, duration, true);
  }
}
async function requestPlayback(episode) {
  const requestId = ++playbackRequestId;
  if (!currentUser) {
    showGate("Sign in to continue", "A Vivid account is required before Premium playback can be checked. Sign in with the same account you use across Vivid Cinema.");
    setStatus("Sign in with your existing Vivid account to continue.");
    return;
  }
  showGate("Checking Premium access", "Vivid is verifying your account before opening the anime servers.", "Open Vivid account", "account.html", true);
  setStatus("Checking your Premium access…");
  try {
    if (mediaType === "tv") await animeIdPromise;
    const token = await currentUser.getIdToken(true);
    if (requestId !== playbackRequestId) return;
    const response = await fetch("/api/anime-premium/playback", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      cache: "no-store",
      body: JSON.stringify({ mediaType, titleId, season: mediaType === "tv" ? Number(params.get("season") || 1) : null, episode: mediaType === "tv" ? Number(episode.episode_number || 1) : null })
    });
    if (requestId !== playbackRequestId) return;
    if (response.status === 401) {
      showGate("Sign in required", "Your Vivid session needs to be refreshed before playback can start.");
      setStatus("Please sign in again."); return;
    }
    if (response.status === 403) {
      showGate("Premium membership required", "An active Vivid Anime Premium membership is required to open these servers.", "Get Premium membership", "anime-premium-membership.html");
      setStatus("Your account does not currently have Premium playback access."); return;
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.message || "The Premium playback check could not be completed.");
    }
    const payload = await response.json();
    if (requestId !== playbackRequestId) return;
    const playback = payload?.playback;
    if (!playback?.sessionId || !playback?.expiresAt || playback.providerMode !== "vivid-third-party-embeds") throw new Error("Vivid returned an incomplete Premium playback session.");
    const expiresAt = Date.parse(playback.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("The Premium playback session is invalid or expired.");
    currentPlaybackSessionId = String(playback.sessionId);
    failedProviderIds = new Set();
    latestProviderProgress = null;
    const episodeNumber = Number(episode.episode_number || 1), seasonNumber = Number(params.get("season") || 1);
    const offset = seasonNumber > 1 && seasonAnimeIds.aniListId === baseAnimeIds.aniListId && seasonAnimeIds.malId === baseAnimeIds.malId
      ? (titleDetails.seasons || []).filter(item => Number(item.season_number) > 0 && Number(item.season_number) < seasonNumber).reduce((sum, item) => sum + Number(item.episode_count || 0), 0)
      : 0;
    activeProviderEpisodeNumber = episodeNumber + offset;
    providerOptions = resolveAnimePremiumProviderOptions({
      mediaType, tmdbId: titleId, aniListId: seasonAnimeIds.aniListId, malId: seasonAnimeIds.malId,
      season: seasonNumber, episode: activeProviderEpisodeNumber, track: animeTrack
    }).filter(item => item.available).map((item, index) => ({ ...item, label: "Server " + (index + 1) }));
    renderServerOptions();
    const preferredPlayer = getAnimeLibraryPreferences().preferredPlayer;
    const first = providerOptions.find(item => item.available && preferredPlayer !== "auto" && item.id === preferredPlayer)
      || providerOptions.find(item => item.available);
    if (!first) {
      showGate("No compatible server found", "Vivid could not match this anime to any available provider catalogue. Try again later or choose another title.", "Back to title", titleRoute(), true);
      return;
    }
    playbackExpiryTimer = window.setTimeout(() => {
      void syncPlaybackProgress(true);
      showGate("Playback session expired", "Your Premium playback session has expired. Request a fresh session to continue.", "Back to title", titleRoute(), true);
      setStatus("Playback session expired.");
    }, Math.max(0, expiresAt - Date.now()));
    activateProvider(first.id);
  } catch (error) {
    if (requestId !== playbackRequestId) return;
    showGate("Playback could not start", error?.message || "Vivid could not verify Premium playback. Please try again.", "Try again", titleRoute(), true);
    setStatus("Premium playback could not be opened.");
  }
}
function recordAnimeHistory(progress, duration) {
  if (!titleDetails || !Number.isFinite(Number(progress)) || Number(progress) <= 0) return;
  const library = getLocalLibrary();
  const existing = (library.history || []).find(item => item.isAnime === true && item.media_type === mediaType && String(item.id) === titleId);
  const now = Date.now();
  const completion = duration > 0 ? Math.min(100, Number(progress) / Number(duration) * 100) : Number(existing?.completion) || 0;
  const item = {
    id: titleId, media_type: mediaType, title: titleName(titleDetails),
    year: String(titleDetails.release_date || titleDetails.first_air_date || "").slice(0, 4),
    poster_path: titleDetails.poster_path || "", backdrop_path: titleDetails.backdrop_path || "",
    isAnime: true, startedAt: Number(existing?.startedAt) || now, lastWatchedAt: now,
    watchedSeconds: Math.max(Number(existing?.watchedSeconds) || 0, Number(progress)),
    completion: Math.max(Number(existing?.completion) || 0, completion), updatedAt: now
  };
  if (!existing || now - lastHistorySyncAt >= 30000) {
    lastHistorySyncAt = now;
    upsertLibraryItem("history", item);
  }
}
async function syncPlaybackProgress(force = false) {
  if (!currentPlaybackSessionId || !currentUser || !latestProviderProgress) return;
  if (!force && Date.now() - lastProgressSync < 15000) return;
  pendingProgressSnapshot = { sessionId: currentPlaybackSessionId, user: currentUser,
    currentTime: latestProviderProgress.currentTime, duration: latestProviderProgress.duration, keepalive: force, retries: 0 };
  if (progressSyncInFlight) return;
  progressSyncInFlight = true;
  try {
    while (pendingProgressSnapshot) {
      const snapshot = pendingProgressSnapshot;
      pendingProgressSnapshot = null;
      lastProgressSync = Date.now();
      try {
        const token = await snapshot.user.getIdToken();
        const response = await fetch("/api/anime-premium/progress", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          cache: "no-store", keepalive: snapshot.keepalive,
          body: JSON.stringify({ sessionId: snapshot.sessionId, currentTime: snapshot.currentTime, duration: snapshot.duration })
        });
        if (!response.ok) throw new Error("Progress endpoint returned HTTP " + response.status);
      } catch (error) {
        if (!pendingProgressSnapshot && Number(snapshot.retries || 0) < 1) pendingProgressSnapshot = { ...snapshot, retries: Number(snapshot.retries || 0) + 1 };
        console.warn("Vivid Anime Premium playback progress could not be saved:", error);
      }
    }
  } finally { progressSyncInFlight = false; }
}
async function selectEpisode(index, request = false) {
  if (!activeEpisodes[index]) return;
  if (currentPlaybackSessionId) void syncPlaybackProgress(true);
  activeEpisodeIndex = index;
  failedProviderIds = new Set();
  activeProviderId = "";
  const episode = activeEpisodes[index];
  const season = Number(params.get("season") || 1);
  history.replaceState({}, "", watchRoute(season, episode.episode_number || index + 1));
  updateEpisodeControls();
  showGate("Episode selected", "Choose an episode to request Premium playback from Vivid's anime servers.");
  setStatus("Selected " + (episode.name || "episode " + (episode.episode_number || index + 1)) + ".");
  if (request) await requestPlayback(episode);
}
async function loadSeason(seasonNumber) {
  const request = ++seasonRequest;
  if (currentPlaybackSessionId) void syncPlaybackProgress(true);
  playbackRequestId += 1;
  showGate("Loading season", "Choose an episode after the season list has loaded.");
  const season = Number(seasonNumber || 1);
  params.set("season", String(season));
  const episodeParam = Number(params.get("episode") || 1);
  history.replaceState({}, "", watchRoute(season, episodeParam));
  $("vap-episode-grid").innerHTML = '<p class="vap-watch-loading">Loading episodes…</p>';
  try {
    const result = await tmdbApi.tvSeason(titleId, season);
    if (request !== seasonRequest) return;
    seasonDetails = result;
    if (season > 1) {
      const seasonLabel = result.name && !/^season\s+\d+$/i.test(result.name) ? result.name : "season " + season;
      const [baseIds, resolvedSeasonIds] = await Promise.all([
        animeIdPromise,
        resolveAnimeIds(titleName(titleDetails) + " " + seasonLabel).catch(() => ({ aniListId: "", malId: "" }))
      ]);
      baseAnimeIds = baseIds || baseAnimeIds;
      if (request !== seasonRequest) return;
      seasonAnimeIds = { aniListId: resolvedSeasonIds.aniListId || baseAnimeIds.aniListId, malId: resolvedSeasonIds.malId || baseAnimeIds.malId };
    } else seasonAnimeIds = { ...baseAnimeIds };
    renderEpisodes(result.episodes || []);
    const current = activeEpisodes[activeEpisodeIndex];
    if (current) { updateEpisodeControls(); setStatus("Choose an episode to start playback."); }
  } catch (error) {
    if (request !== seasonRequest) return;
    $("vap-episode-grid").innerHTML = '<p class="vap-watch-empty">Episode details could not be loaded. Please try another season.</p>';
    setStatus("Could not load season " + season + ".");
  }
}
function bindSeasonPicker(details) {
  const seasons = (details.seasons || []).filter(season => Number(season.season_number) > 0);
  if (!seasons.length) { $("vap-season-picker-wrap").hidden = true; return; }
  const select = $("vap-season-picker");
  select.innerHTML = seasons.map(season => '<option value="' + Number(season.season_number) + '">' + escapeHtml(season.name || "Season " + season.season_number) + '</option>').join("");
  const requested = Number(params.get("season") || 1);
  const selected = seasons.some(season => Number(season.season_number) === requested) ? requested : Number(seasons[0].season_number);
  select.value = String(selected);
  params.set("season", String(selected));
  select.addEventListener("change", () => { params.set("episode", "1"); void loadSeason(select.value); });
  return selected;
}
async function loadWatchPage() {
  if (!titleId) throw new Error("This watch link is invalid. Return to the Premium catalogue and choose a title.");
  const getDetails = mediaType === "movie" ? tmdbApi.movieDetails : tmdbApi.tvDetails;
  titleDetails = await getDetails(titleId);
  if (!titleDetails?.id) throw new Error("This anime title could not be found.");
  if (!await isTitleAllowed({ ...titleDetails, id: titleId, media_type: mediaType })) { renderParentalBlock(document.getElementById("vap-watch-content"), titleName(titleDetails)); return; }
  if (!isAnimeMetadata(titleDetails)) throw new Error("This title is not listed as Japanese animation in the Vivid Anime Premium catalogue.");
  animeIdPromise = resolveAnimeIds(titleName(titleDetails)).then(ids => {
    baseAnimeIds = ids || { aniListId: "", malId: "" };
    if (mediaType === "tv" && Number(params.get("season") || 1) === 1) seasonAnimeIds = { ...baseAnimeIds };
    return baseAnimeIds;
  }).catch(() => baseAnimeIds);
  seasonAnimeIds = { ...baseAnimeIds };
  const name = titleName(titleDetails);
  document.title = "Watch " + name + " · VIVID ANIME PREMIUM";
  $("vap-watch-title").textContent = name;
  $("vap-watch-subtitle").textContent = mediaType === "movie" ? "Anime film · " + (titleDetails.release_date || "").slice(0, 4) : "Anime series · " + (titleDetails.first_air_date || "").slice(0, 4);
  $("vap-watch-title-link").href = titleRoute();
  if (titleDetails.backdrop_path) {
    const image = getImageUrl(titleDetails.backdrop_path, "w1280");
    $("vap-player-stage").style.backgroundImage = 'linear-gradient(0deg,rgba(8,7,13,.72),rgba(8,7,13,.72)),url("' + image.replace(/["\\]/g, "") + '")';
    $("vap-player-stage").style.backgroundSize = "cover";
    $("vap-player-stage").style.backgroundPosition = "center";
  }
  if (mediaType === "movie") {
    $("vap-season-picker-wrap").hidden = true;
    $("vap-audio-track").hidden = true;
    renderEpisodes([{ episode_number: 1, name: "Feature film", runtime: titleDetails.runtime }]);
  } else {
    const selected = bindSeasonPicker(titleDetails) || 1;
    await loadSeason(selected);
  }
  setStatus("Select an episode to choose a Premium streaming server.");
}
function bindControls() {
  $("vap-previous-episode").addEventListener("click", () => { if (activeEpisodeIndex > 0) void selectEpisode(activeEpisodeIndex - 1, true); });
  $("vap-next-episode").addEventListener("click", () => { if (activeEpisodeIndex < activeEpisodes.length - 1) void selectEpisode(activeEpisodeIndex + 1, true); });
  $("vap-player-retry").addEventListener("click", () => {
    const episode = activeEpisodes[activeEpisodeIndex];
    if (episode) void requestPlayback(episode);
  });
  $("vap-server-next").addEventListener("click", () => fallbackToNextPlaybackServer("Switching from " + (activeProviderId || "the current server") + "."));
  $("vap-audio-track").addEventListener("click", event => {
    const button = event.target.closest("[data-vap-track]");
    if (!button) return;
    const nextTrack = button.dataset.vapTrack === "dub" ? "dub" : "sub";
    if (nextTrack === animeTrack) return;
    animeTrack = saveAnimeLibraryPreferences({ track: nextTrack }).track;
    $("vap-audio-track").querySelectorAll("[data-vap-track]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.vapTrack === animeTrack)));
    const episode = activeEpisodes[activeEpisodeIndex];
    if (currentPlaybackSessionId && episode) {
      void syncPlaybackProgress(true);
      currentPlaybackSessionId = "";
      void requestPlayback(episode);
    }
  });
  window.addEventListener("message", handleProviderMessage);
}
function bindAuth() {
  onAuthStateChanged(auth, async user => {
    const nextUser = user && !user.isAnonymous ? user : null;
    if (currentUser?.uid && currentUser.uid !== nextUser?.uid) {
      void syncPlaybackProgress(true);
      playbackRequestId += 1;
      latestProviderProgress = null;
      showGate("Vivid account changed", "Playback has stopped because the signed-in Vivid account changed. Sign in with the account that holds your Premium membership.");
      setStatus("Playback stopped after the Vivid account changed.");
    }
    currentUser = nextUser;
    if (currentUser) {
      void syncAnimePreferencesForUser(currentUser).then(preferences => {
        if (currentUser?.uid !== user?.uid) return;
        animeTrack = preferences.track;
        $("vap-audio-track")?.querySelectorAll("[data-vap-track]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.vapTrack === animeTrack)));
      }).catch(error => console.warn("Vivid Anime Premium preferences could not sync:", error));
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/anime-premium/membership", { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
        const payload = response.ok ? await response.json() : null;
        if (currentUser !== nextUser) return;
        if (response.status === 403 && currentUser.emailVerified !== true) {
          const returnTo = "anime-premium-watch.html" + window.location.search;
          showGate("Verify your Vivid email", "Verify your account email before opening Premium playback.", "Verify email", "verify-email.html?returnTo=" + encodeURIComponent(returnTo));
        } else if (payload?.membership?.active === true) {
          showGate("Premium access confirmed", "Your Vivid Anime Premium membership is active. Select an episode to start watching.", "Open Vivid account", "account.html");
        } else {
          showGate("Premium membership required", "You are signed in to Vivid. Subscribe to Anime Premium to unlock this title and its episodes.", "Subscribe to Vivid Anime Premium", "anime-premium-membership.html");
        }
      } catch (error) {
        console.warn("Premium membership status could not be checked:", error);
        showGate("Checking your Premium access", "We could not confirm your membership just now. Try again in a moment.", "Retry membership check", "anime-premium-membership.html", true);
      }
      $("vap-player-signin").href = "account.html";
      $("vap-player-signin").textContent = "Open Vivid account →";
    } else {
      const returnTo = "anime-premium-watch.html" + window.location.search;
      showGate("Sign in to continue", "Sign in with your existing Vivid account. If you do not have Premium yet, you can subscribe after signing in.", "Sign in & subscribe", "auth.html?returnTo=" + encodeURIComponent(returnTo));
      $("vap-player-signin").href = "auth.html?returnTo=" + encodeURIComponent(returnTo);
      $("vap-player-signin").textContent = "Sign in & subscribe →";
    }
  }, error => {
    currentUser = null;
    console.warn("Vivid Anime Premium auth state unavailable:", error);
    showGate("Sign in to continue", "We could not confirm your Vivid account session. Please sign in again.", "Sign in & subscribe", "auth.html?returnTo=" + encodeURIComponent("anime-premium-watch.html" + window.location.search));
  });
}

function renderError(error) {
  $("vap-watch-content").innerHTML = '<section class="vap-title-error"><span class="vap-eyebrow">VIVID ANIME PREMIUM</span><h1>We couldn’t open this episode.</h1><p>' + escapeHtml(error?.message || "Please return to the Premium catalogue and choose a title.") + '</p><a class="vap-primary" href="anime-premium.html">Back to discovery <span aria-hidden="true">→</span></a></section>';
}
window.addEventListener("pagehide", () => {
  if (currentPlaybackSessionId) void syncPlaybackProgress(true);
  playbackRequestId += 1;
  disposePlayer();
});
bindControls();
bindAuth();
loadWatchPage().catch(renderError);


// A profile switch invalidates the current premium-anime playback context.
if (typeof window !== "undefined") {
  window.addEventListener("vivid:profile-changed", () => {
    try { window.location.replace("home.html"); } catch {}
  });
}
