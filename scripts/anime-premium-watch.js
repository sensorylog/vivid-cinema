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
let currentPlaybackSessionId = "";
let lastProgressSync = 0;
let progressSyncInFlight = false;
let pendingProgressSnapshot = null;
let activeProviderId = "";
let providerOptions = [];
let failedProviderIds = new Set();
let providerRequestId = 0;
let providerLoadTimer = null;
let playbackRequestId = 0;
let playbackExpiryTimer = null;
let baseAnimeIds = { aniListId: "", malId: "" };
let seasonAnimeIds = { aniListId: "", malId: "" };
let animeTrack = "sub";
let latestProviderProgress = null;

function disposePlayerTimers() {
  if (providerLoadTimer) window.clearTimeout(providerLoadTimer);
  providerLoadTimer = null;
  if (playbackExpiryTimer) window.clearTimeout(playbackExpiryTimer);
  playbackExpiryTimer = null;
}
function titleName(details) { return details.title || details.name || "Anime title"; }
function titleRoute() {
  return "anime-premium-title.html?id=" + encodeURIComponent(titleId) + "&type=" + encodeURIComponent(mediaType);
}
function watchRoute(season, episode) {
  const query = new URLSearchParams({ id: titleId, type: mediaType });
  if (mediaType === "tv") {
    query.set("season", String(season));
    query.set("episode", String(episode));
  }
  return "anime-premium-watch.html?" + query.toString();
}
function showGate(title, message, actionLabel = "Sign in to Vivid", actionHref = "auth.html?returnTo=anime-premium.html", retry = false) {
  disposePlayerTimers();
  currentPlaybackSessionId = "";
  activeProviderId = "";
  const frame = $("vap-player-frame");
  if (frame) {
    frame.src = "about:blank";
    frame.hidden = true;
  }
  $("vap-player-gate").hidden = false;
  $("vap-player-gate-title").textContent = title;
  $("vap-player-gate-copy").textContent = message;
  $("vap-player-signin").textContent = actionLabel + " →";
  $("vap-player-signin").href = actionHref;
  $("vap-player-retry").hidden = !retry;
  $("vap-server-next").hidden = true;
}
function setStatus(message) { $("vap-player-status").textContent = message; }
function renderEpisodes(episodes) {
  activeEpisodes = episodes || [];
  const grid = $("vap-episode-grid");
  if (!activeEpisodes.length) {
    grid.innerHTML = '<p class="vap-watch-empty">No episode metadata is available for this season.</p>';
    $("vap-previous-episode").disabled = true;
    $("vap-next-episode").disabled = true;
    return;
  }
  const requested = Number(params.get("episode") || 1);
  const found = activeEpisodes.findIndex(item => Number(item.episode_number) === requested);
  activeEpisodeIndex = found >= 0 ? found : 0;
  grid.innerHTML = activeEpisodes.map((episode, index) => {
    const name = episode.name || "Episode " + episode.episode_number;
    const runtime = episode.runtime ? Number(episode.runtime) + " min" : "Episode " + episode.episode_number;
    return '<button class="vap-episode-card' + (index === activeEpisodeIndex ? " is-active" : "") + '" type="button" data-vap-episode="' + index + '" aria-pressed="' + (index === activeEpisodeIndex) + '">' +
      '<span class="vap-episode-number">' + String(episode.episode_number || index + 1).padStart(2, "0") + '</span>' +
      '<span class="vap-episode-copy"><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(runtime) + '</small></span>' +
      '<i class="bi bi-play-circle vap-episode-play" aria-hidden="true"></i></button>';
  }).join("");
  grid.querySelectorAll("[data-vap-episode]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.vapEpisode);
      void selectEpisode(index, true);
    });
  });
  updateEpisodeControls();
}
function updateEpisodeControls() {
  const episode = activeEpisodes[activeEpisodeIndex];
  if (!episode) return;
  $("vap-current-episode").textContent = mediaType === "movie" ? "Feature film" : "S" + String(Number(params.get("season") || 1)).padStart(2, "0") + " · E" + String(episode.episode_number || activeEpisodeIndex + 1).padStart(2, "0") + " — " + (episode.name || "Episode");
  $("vap-previous-episode").disabled = activeEpisodeIndex <= 0;
  $("vap-next-episode").disabled = activeEpisodeIndex >= activeEpisodes.length - 1;
  $("vap-episode-grid").querySelectorAll("[data-vap-episode]").forEach(button => {
    const active = Number(button.dataset.vapEpisode) === activeEpisodeIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
async function requestPlayback(episode, excludedCandidates = failedPlaybackCandidates) {
  const requestId = ++playbackRequestId;
  if (!currentUser) {
    showGate("Sign in to continue", "A Vivid account is required before Premium playback can be checked. Sign in with the same account you use across Vivid Cinema.");
    setStatus("Sign in with your existing Vivid account to continue.");
    return;
  }
  showGate("Checking Premium access", "Vivid is verifying your account and requesting an authorised playback session.", "Open Vivid account", "account.html", true);
  setStatus("Checking your Premium access…");
  try {
    const token = await currentUser.getIdToken();
    if (requestId !== playbackRequestId) return;
    const response = await fetch("/api/anime-premium/playback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      cache: "no-store",
      body: JSON.stringify({
        mediaType,
        titleId,
        season: mediaType === "tv" ? Number(params.get("season") || 1) : null,
        episode: mediaType === "tv" ? Number(episode.episode_number || 1) : null,
        excludeCandidateIds: excludedCandidates.slice(0, 8)
      })
    });
    if (requestId !== playbackRequestId) return;
    if (response.status === 401) {
      showGate("Sign in required", "Your Vivid session needs to be refreshed before playback can start.");
      setStatus("Please sign in again.");
      return;
    }
    if (response.status === 403) {
      showGate("Premium membership required", "This title is protected. An active Vivid Anime Premium membership is required to request playback.", "Get Premium membership", "anime-premium-membership.html");
      setStatus("Your account does not currently have Premium playback access.");
      return;
    }
    if (response.status === 404 || response.status === 503) {
      showGate("Protected playback unavailable", "Vivid has not returned an authorised stream for this episode. No unverified third-party source will be substituted.", "Back to title", titleRoute(), true);
      setStatus("The protected playback service has not issued a stream for this episode.");
      return;
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.message || "The protected playback request could not be completed.");
    }
    const payload = await response.json();
    if (requestId !== playbackRequestId) return;
    const playback = payload?.playback;
    if (!playback?.url || !playback?.expiresAt || !playback?.sessionId) throw new Error("The playback service returned an incomplete session.");
    const expiresAt = Date.parse(playback.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("The playback service returned an invalid or expired session.");
    const streamUrl = new URL(playback.url, window.location.origin);
    if (streamUrl.protocol !== "https:" || streamUrl.username || streamUrl.password) throw new Error("The playback service returned an unsafe stream URL.");
    const mimeType = String(playback.mimeType || "");
    if (!["video/mp4", "application/vnd.apple.mpegurl", "application/x-mpegURL"].includes(mimeType)) throw new Error("The playback service returned an unsupported media format.");
    const video = $("vap-player");
    let deferredHlsPlayback = false;
    hlsRecoveryAttempts = 0;
    currentPlaybackSessionId = String(playback.sessionId);
    activePlaybackCandidateId = String(playback.candidateId || playback.provider || "");
    lastProgressSync = 0;
    video.hidden = false;
    $("vap-player-gate").hidden = true;
    if (mimeType === "video/mp4") {
      video.src = streamUrl.href;
      video.load();
    } else if (video.canPlayType(mimeType) || video.canPlayType("application/x-mpegURL")) {
      video.src = streamUrl.href;
      video.load();
    } else {
      let Hls;
      try { Hls = await loadHlsLibrary(); }
      catch {
        if (requestId !== playbackRequestId) return;
        fallbackToNextPlaybackServer("The HLS playback engine could not load. Trying another authorised server.");
        return;
      }
      if (requestId !== playbackRequestId) return;
      if (!Hls.isSupported()) {
        fallbackToNextPlaybackServer("This browser cannot use the HLS engine. Trying another authorised server.");
        return;
      }
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90, maxBufferLength: 30 });
      activeHls = hls;
      deferredHlsPlayback = true;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (activeHls !== hls || requestId !== playbackRequestId) return;
        video.play().catch(() => setStatus("Your episode is ready. Press play to begin."));
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal || activeHls !== hls) return;
        hlsRecoveryAttempts += 1;
        setStatus("The authorised stream encountered a playback error. Recovering…");
        if (hlsRecoveryAttempts > 2) {
          fallbackToNextPlaybackServer("The current authorised server could not recover.");
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else fallbackToNextPlaybackServer("The authorised stream could not continue.");
      });
      hls.loadSource(streamUrl.href);
      hls.attachMedia(video);
    }
    const expiresIn = expiresAt - Date.now();
    playbackExpiryTimer = window.setTimeout(() => {
      showGate("Playback session expired", "For your security, this playback session has expired. Request a fresh authorised session to continue.", "Back to title", titleRoute(), true);
      setStatus("Playback session expired.");
    }, Math.max(0, expiresIn));
    if (!deferredHlsPlayback) {
      try { await video.play(); } catch { setStatus("Your episode is ready. Press play to begin."); }
    }
    if (requestId === playbackRequestId) setStatus("Authorised playback session opened" + (playback.provider ? " · " + playback.provider : "") + ".");
  } catch (error) {
    if (requestId !== playbackRequestId) return;
    showGate("Playback could not start", error?.message || "Try again in a moment.", "Back to title", titleRoute(), true);
    setStatus(error?.message || "Playback could not start.");
    console.warn("Vivid Anime Premium playback request failed:", error);
  }
}
async function selectEpisode(index, request = false) {
  if (!activeEpisodes[index]) return;
  if (currentPlaybackSessionId) void syncPlaybackProgress(true);
  activeEpisodeIndex = index;
  failedPlaybackCandidates = [];
  activePlaybackCandidateId = "";
  const episode = activeEpisodes[index];
  const season = Number(params.get("season") || 1);
  history.replaceState({}, "", watchRoute(season, episode.episode_number || index + 1));
  updateEpisodeControls();
  showGate("Episode selected", "Choose play to request a protected playback session from Vivid. Stream URLs are never supplied by the browser.");
  setStatus("Selected " + (episode.name || "episode " + (episode.episode_number || index + 1)) + ".");
  if (request) await requestPlayback(episode);
}
async function loadSeason(seasonNumber) {
  const request = ++seasonRequest;
  failedPlaybackCandidates = [];
  activePlaybackCandidateId = "";
  if (currentPlaybackSessionId) void syncPlaybackProgress(true);
  playbackRequestId += 1;
  showGate("Loading season", "Choose an episode after the season list has loaded.");
  const season = Number(seasonNumber || 1);
  params.set("season", String(season));
  const episodeParam = Number(params.get("episode") || 1);
  const query = new URLSearchParams({ id: titleId, type: mediaType, season: String(season), episode: String(episodeParam) });
  history.replaceState({}, "", "anime-premium-watch.html?" + query.toString());
  $("vap-episode-grid").innerHTML = '<p class="vap-watch-loading">Loading episodes…</p>';
  try {
    const result = await tmdbApi.tvSeason(titleId, season);
    if (request !== seasonRequest) return;
    seasonDetails = result;
    renderEpisodes(result.episodes || []);
    const current = activeEpisodes[activeEpisodeIndex];
    if (current) {
      updateEpisodeControls();
      setStatus("Choose an episode to request protected playback.");
    }
  } catch (error) {
    if (request !== seasonRequest) return;
    $("vap-episode-grid").innerHTML = '<p class="vap-watch-empty">Episode details could not be loaded. Please try another season.</p>';
    setStatus("Could not load season " + season + ".");
  }
}
function bindSeasonPicker(details) {
  const seasons = (details.seasons || []).filter(season => Number(season.season_number) > 0);
  if (!seasons.length) {
    $("vap-season-picker-wrap").hidden = true;
    return;
  }
  const select = $("vap-season-picker");
  select.innerHTML = seasons.map(season =>
    '<option value="' + Number(season.season_number) + '">' + escapeHtml(season.name || "Season " + season.season_number) + '</option>'
  ).join("");
  const requested = Number(params.get("season") || 1);
  const selected = seasons.some(season => Number(season.season_number) === requested) ? requested : Number(seasons[0].season_number);
  select.value = String(selected);
  params.set("season", String(selected));
  select.addEventListener("change", () => {
    params.set("episode", "1");
    void loadSeason(select.value);
  });
  return selected;
}
async function loadWatchPage() {
  if (!titleId) throw new Error("This watch link is invalid. Return to the Premium catalogue and choose a title.");
  const getDetails = mediaType === "movie" ? tmdbApi.movieDetails : tmdbApi.tvDetails;
  titleDetails = await getDetails(titleId);
  if (!titleDetails?.id) throw new Error("This anime title could not be found.");
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
    renderEpisodes([{ episode_number: 1, name: name, overview: titleDetails.overview, runtime: titleDetails.runtime }]);
    return;
  }
  const season = bindSeasonPicker(titleDetails);
  if (season) await loadSeason(season);
  else $("vap-episode-grid").innerHTML = '<p class="vap-watch-empty">No seasons are listed for this anime.</p>';
}

async function syncPlaybackProgress(force = false) {
  const video = $("vap-player");
  if (!currentPlaybackSessionId || !currentUser || !Number.isFinite(video.duration) || video.duration <= 0 || video.currentTime <= 0) return;
  if (!force && Date.now() - lastProgressSync < 15000) return;
  pendingProgressSnapshot = {
    sessionId: currentPlaybackSessionId,
    user: currentUser,
    currentTime: video.currentTime,
    duration: video.duration,
    keepalive: force,
    retries: 0
  };
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
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          cache: "no-store",
          keepalive: snapshot.keepalive,
          body: JSON.stringify({
            sessionId: snapshot.sessionId,
            currentTime: snapshot.currentTime,
            duration: snapshot.duration
          })
        });
        if (!response.ok) throw new Error("Progress endpoint returned HTTP " + response.status);
      } catch (error) {
        if (!pendingProgressSnapshot && Number(snapshot.retries || 0) < 1) {
          pendingProgressSnapshot = { ...snapshot, retries: Number(snapshot.retries || 0) + 1 };
        }
        console.warn("Vivid Anime Premium playback progress could not be saved:", error);
      }
    }
  } finally {
    progressSyncInFlight = false;
  }
}

function fallbackToNextPlaybackServer(message) {
  if (!currentPlaybackSessionId || !activePlaybackCandidateId || failedPlaybackCandidates.length >= 8) return;
  failedPlaybackCandidates = [...new Set([...failedPlaybackCandidates, activePlaybackCandidateId])].slice(0, 8);
  const episode = activeEpisodes[activeEpisodeIndex];
  if (!episode) return;
  void syncPlaybackProgress(true);
  currentPlaybackSessionId = "";
  activePlaybackCandidateId = "";
  setStatus(message + " Trying the next authorised server…");
  void requestPlayback(episode, failedPlaybackCandidates);
}
function bindControls() {
  $("vap-previous-episode").addEventListener("click", () => { if (activeEpisodeIndex > 0) void selectEpisode(activeEpisodeIndex - 1, true); });
  $("vap-next-episode").addEventListener("click", () => { if (activeEpisodeIndex < activeEpisodes.length - 1) void selectEpisode(activeEpisodeIndex + 1, true); });
  $("vap-player").addEventListener("timeupdate", () => { void syncPlaybackProgress(false); });
  $("vap-player").addEventListener("pause", () => { void syncPlaybackProgress(true); });
  $("vap-player").addEventListener("ended", () => { void syncPlaybackProgress(true); });
  $("vap-player").addEventListener("error", () => {
    if (currentPlaybackSessionId && activePlaybackCandidateId) fallbackToNextPlaybackServer("This authorised server failed during playback.");
  });
  $("vap-player-retry").addEventListener("click", () => {
    const episode = activeEpisodes[activeEpisodeIndex];
    failedPlaybackCandidates = [];
    activePlaybackCandidateId = "";
    if (episode) void requestPlayback(episode, []);
  });
}
function bindAuth() {
  onAuthStateChanged(auth, user => {
    const nextUser = user && !user.isAnonymous ? user : null;
    if (currentUser?.uid && currentUser.uid !== nextUser?.uid) {
      playbackRequestId += 1;
      pendingProgressSnapshot = null;
      showGate("Vivid account changed", "Playback has stopped because the signed-in Vivid account changed. Sign in with the account that holds your Premium membership.");
      setStatus("Playback stopped after the Vivid account changed.");
    }
    currentUser = nextUser;
    if (!currentUser) {
      $("vap-player-signin").href = "auth.html?returnTo=anime-premium.html";
      $("vap-player-signin").textContent = "Sign in to Vivid →";
    } else {
      $("vap-player-signin").href = "account.html";
      $("vap-player-signin").textContent = "Open Vivid account →";
    }
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
  disposeHls();
});
bindControls();
bindAuth();
loadWatchPage().catch(renderError);
