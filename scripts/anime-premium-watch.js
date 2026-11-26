import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { tmdbApi } from "./tmdb.js";
import { getImageUrl } from "./media.js";
import { escapeHtml } from "./utils.js";
import { resolveAnimeIds } from "./playback/anime-id-resolver.js";
import { resolveAnimePremiumProviderOptions } from "./playback/anime-premium-providers.js";

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
let animeTrack = "sub";
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
    (provider.available ? "" : " disabled") +
    ' aria-pressed="' + String(provider.id === activeProviderId) + '">' +
    '<span class="vap-server-option-copy"><strong>' + escapeHtml(provider.label) + '</strong><small>' +
    escapeHtml(provider.available ? provider.note : (mediaType === "movie" ? "Episode-only provider" : "No matching catalogue ID")) +
    '</small></span><span class="vap-server-option-state">' +
    (provider.available ? (provider.id === activeProviderId ? "Selected" : "Ready") : "Unavailable") +
    '</span></button>'
  ).join("");
  list.querySelectorAll("[data-vap-server]").forEach(button => button.addEventListener("click", () => activateProvider(button.dataset.vapServer)));
  $("vap-server-count").textContent = providerOptions.filter(item => item.available).length + " available";
}
function activateProvider(providerId) {
  const provider = providerOptions.find(item => item.id === providerId && item.available);
  if (!provider || !currentPlaybackSessionId) return false;
  const frame = $("vap-player-frame");
  if (activeProviderId && activeProviderId !== provider.id) void syncPlaybackProgress(true);
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
      setStatus(provider.label + " player loaded. If the episode does not start, switch to another server.");
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
    if (provider.events) {
      fallbackToNextPlaybackServer(provider.label + " did not report playback readiness.");
      return;
    }
    setStatus(provider.label + " has not confirmed playback yet. If the video is stuck, try the next server.");
    $("vap-server-next").hidden = providerOptions.filter(item => item.available && item.id !== provider.id).length === 0;
  }, 18000);
  return true;
}
function fallbackToNextPlaybackServer(message) {
  if (!currentPlaybackSessionId) return;
  if (activeProviderId) failedProviderIds.add(activeProviderId);
  const next = providerOptions.find(item => item.available && !failedProviderIds.has(item.id));
  if (!next) {
    setStatus(message + " No other available server remains. Choose a server above to retry.");
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
  void syncPlaybackProgress(force);
}
function handleProviderMessage(event) {
  const provider = providerOptions.find(item => item.id === activeProviderId);
  const frame = $("vap-player-frame");
  if (!provider || !frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== provider.origin) return;
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
      setStatus("Playing with AniXo · " + animeTrack.toUpperCase());
      if (Number.isFinite(Number(data.duration))) updateProviderProgress(data.currentTime ?? data.time, data.duration);
    }
    if (data.type === "aniembed:play") {
      if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
      providerLoadTimer = null;
      setStatus("Playing with AniXo · " + animeTrack.toUpperCase());
      if (Number.isFinite(Number(data.duration))) updateProviderProgress(data.currentTime, data.duration);
    } else if (data.type === "aniembed:ended") {
      if (Number.isFinite(Number(data.duration))) updateProviderProgress(data.duration, data.duration, true);
    } else if (data.type === "aniembed:error") fallbackToNextPlaybackServer("AniXo reported a playback error.");
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
    const token = await currentUser.getIdToken();
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
    providerOptions = resolveAnimePremiumProviderOptions({
      mediaType, tmdbId: titleId, aniListId: seasonAnimeIds.aniListId, malId: seasonAnimeIds.malId,
      season: seasonNumber, episode: episodeNumber + offset, track: animeTrack
    });
    renderServerOptions();
    const first = providerOptions.find(item => item.available);
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
      const resolvedSeasonIds = await resolveAnimeIds(titleName(titleDetails) + " " + seasonLabel).catch(() => ({ aniListId: "", malId: "" }));
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
  baseAnimeIds = await resolveAnimeIds(titleName(titleDetails)).catch(() => ({ aniListId: "", malId: "" }));
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
    animeTrack = nextTrack;
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
  onAuthStateChanged(auth, user => {
    const nextUser = user && !user.isAnonymous ? user : null;
    if (currentUser?.uid && currentUser.uid !== nextUser?.uid) {
      void syncPlaybackProgress(true);
      playbackRequestId += 1;
      latestProviderProgress = null;
      showGate("Vivid account changed", "Playback has stopped because the signed-in Vivid account changed. Sign in with the account that holds your Premium membership.");
      setStatus("Playback stopped after the Vivid account changed.");
    }
    currentUser = nextUser;
    $("vap-player-signin").href = currentUser ? "account.html" : "auth.html?returnTo=anime-premium.html";
    $("vap-player-signin").textContent = currentUser ? "Open Vivid account →" : "Sign in to Vivid →";
  }, error => {
    currentUser = null;
    console.warn("Vivid Anime Premium auth state unavailable:", error);
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
