import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { app, auth, ensureAppCheck } from "../firebase.js";
import {
  AFRICAN_PROVIDER_CAPABILITIES, buildOfficialEmbed, fetchFilmFluxTrending,
  getOfficialSourceFallback, resolveInternetArchiveFile, validateAfricanPlaybackSource
} from "./providers.js";

const byId = id => document.getElementById(id);
const state = byId("african-player-state");
const frame = byId("african-player-frame");
const video = byId("african-player-video");
const title = byId("african-player-title");
const description = byId("african-player-description");
const sourceList = byId("african-player-sources");
const sourceLabel = byId("african-player-source-label");
const fallback = byId("african-player-fallback");
const filmFluxPanel = byId("african-filmflux-panel");
const filmFluxList = byId("african-filmflux-list");
const filmFluxStatus = byId("african-filmflux-status");
const controls = byId("african-player-controls");
const playButton = byId("african-control-play");
const progress = byId("african-control-progress");
const currentTime = byId("african-control-current");
const durationTime = byId("african-control-duration");
const muteButton = byId("african-control-mute");
const fullscreenButton = byId("african-control-fullscreen");
const params = new URLSearchParams(window.location.search);
const workId = params.get("work");
const versionId = params.get("version");
const mode = params.get("provider") || "";
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
let activeHls = null;
let activeController = null;
let activeSource = null;
let progressTimer = null;
let sourceGeneration = 0;
let lastDuration = 0;

function setState(heading, message, visible = true) {
  state.hidden = !visible;
  state.replaceChildren();
  if (!visible) return;
  const mark = document.createElement("span");
  mark.className = "african-state-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "◇";
  const h2 = document.createElement("h2");
  h2.textContent = heading;
  const p = document.createElement("p");
  p.textContent = message;
  state.append(mark, h2, p);
}

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? [hours, String(minutes).padStart(2, "0"), String(rest).padStart(2, "0")].join(":") :
    [minutes, String(rest).padStart(2, "0")].join(":");
}

function setControlsVisible(visible) {
  controls.hidden = !visible;
  if (!visible) {
    if (progressTimer) window.clearInterval(progressTimer);
    progressTimer = null;
    activeController = null;
    lastDuration = 0;
    progress.value = "0";
    currentTime.textContent = "0:00";
    durationTime.textContent = "0:00";
    playButton.textContent = "Play";
  }
}

function updateProgress(position, duration, playing) {
  const current = Math.max(0, Number(position) || 0);
  const total = Math.max(0, Number(duration) || 0);
  if (total > 0) lastDuration = total;
  const full = total || lastDuration;
  progress.max = "1000";
  progress.value = full > 0 ? String(Math.min(1000, Math.round(current / full * 1000))) : "0";
  currentTime.textContent = formatTime(current);
  durationTime.textContent = formatTime(full);
  playButton.textContent = playing ? "Pause" : "Play";
}

function attachController(controller) {
  activeController = controller;
  setControlsVisible(true);
  if (progressTimer) window.clearInterval(progressTimer);
  progressTimer = window.setInterval(async () => {
    if (!activeController) return;
    try {
      const [position, duration] = await Promise.all([
        activeController.getCurrentTime(), activeController.getDuration()
      ]);
      updateProgress(position, duration, activeController.isPlaying ? await activeController.isPlaying() : undefined);
    } catch {}
  }, 1000);
}

function clearPlayback() {
  sourceGeneration += 1;
  if (progressTimer) window.clearInterval(progressTimer);
  progressTimer = null;
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }
  if (activeController?.destroy) {
    try { activeController.destroy(); } catch {}
  }
  activeController = null;
  setControlsVisible(false);
  frame.hidden = true;
  frame.removeAttribute("src");
  frame.removeAttribute("data-provider");
  video.pause();
  video.hidden = true;
  video.removeAttribute("src");
  video.load();
  fallback.hidden = true;
  fallback.removeAttribute("href");
  sourceLabel.textContent = "";
}

function setFallback(url, label = "Open the original source") {
  if (!url) return;
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.protocol !== "https:") return;
  fallback.href = parsed.toString();
  fallback.textContent = label;
  fallback.hidden = false;
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("The provider player SDK could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = "true"; resolve(); };
    script.onerror = () => reject(new Error("The provider player SDK could not be loaded."));
    document.head.append(script);
  });
}

async function loadYouTubeApi() {
  if (window.YT?.Player) return;
  const ready = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { previous?.(); } finally { resolve(); }
    };
    window.setTimeout(() => reject(new Error("YouTube player controls did not initialize.")), 12000);
  });
  await loadScript("https://www.youtube.com/iframe_api", "african-youtube-iframe-api");
  if (!window.YT?.Player) await ready;
}

function attachYouTubeController(generation) {
  return loadYouTubeApi().then(() => new Promise((resolve, reject) => {
    if (generation !== sourceGeneration || frame.hidden) return resolve();
    let settled = false;
    const player = new window.YT.Player(frame, {
      events: {
        onReady: event => {
          if (generation !== sourceGeneration) { event.target.destroy(); return; }
          settled = true;
          attachController({
            play: () => event.target.playVideo(),
            pause: () => event.target.pauseVideo(),
            seek: seconds => event.target.seekTo(seconds, true),
            getCurrentTime: () => event.target.getCurrentTime(),
            getDuration: () => event.target.getDuration(),
            isPlaying: () => event.target.getPlayerState() === window.YT.PlayerState.PLAYING,
            isMuted: () => event.target.isMuted(),
            setMuted: muted => muted ? event.target.mute() : event.target.unMute(),
            destroy: () => event.target.destroy()
          });
          resolve();
        },
        onStateChange: event => {
          if (generation !== sourceGeneration) return;
          const playing = event.data === window.YT.PlayerState.PLAYING;
          updateProgress(event.target.getCurrentTime(), event.target.getDuration(), playing);
          if (event.data === window.YT.PlayerState.ENDED) updateProgress(event.target.getDuration(), event.target.getDuration(), false);
        },
        onError: event => {
          const messages = {
            2: "YouTube rejected the video ID or embed parameters.",
            5: "This video cannot be played in the embedded HTML5 player.",
            100: "The video is unavailable, private or removed.",
            101: "The video owner does not allow embedded playback.",
            150: "The video owner does not allow embedded playback.",
            153: "YouTube could not verify the embedding client. Open the original source."
          };
          setState("YouTube source unavailable", messages[event.data] || "YouTube could not play this upload. Try its official watch page.");
          if (!settled) { settled = true; reject(new Error(messages[event.data] || "YouTube playback failed.")); }
        }
      }
    });
    window.setTimeout(() => {
      if (!settled && generation === sourceGeneration) {
        // Keep the official iframe usable even if its API handshake is blocked.
        resolve();
      }
    }, 12000);
    if (!player) reject(new Error("YouTube player could not be initialized."));
  }));
}

async function attachVimeoController(generation) {
  await loadScript("https://player.vimeo.com/api/player.js", "african-vimeo-player-sdk");
  if (generation !== sourceGeneration || frame.hidden || !window.Vimeo?.Player) return;
  const player = new window.Vimeo.Player(frame);
  await player.ready();
  if (generation !== sourceGeneration) { player.destroy(); return; }
  attachController({
    play: () => player.play(),
    pause: () => player.pause(),
    seek: seconds => player.setCurrentTime(seconds),
    getCurrentTime: () => player.getCurrentTime(),
    getDuration: () => player.getDuration(),
    isPlaying: async () => (await player.getPaused()) === false,
    isMuted: async () => (await player.getVolume()) === 0,
    setMuted: async muted => player.setVolume(muted ? 0 : 1),
    destroy: () => player.destroy()
  });
  player.on("timeupdate", event => updateProgress(event.seconds, event.duration, true));
  player.on("play", () => { playButton.textContent = "Pause"; });
  player.on("pause", () => { playButton.textContent = "Play"; });
  player.on("ended", () => updateProgress(lastDuration, lastDuration, false));
  player.on("error", () => setState("Vimeo source unavailable", "The video may be private or restricted to approved embedding domains. Open the creator's official page."));
}

async function attachPeerTubeController(generation) {
  await loadScript("https://unpkg.com/@peertube/embed-api/build/player.min.js", "african-peertube-player-sdk");
  if (generation !== sourceGeneration || frame.hidden || typeof window.PeerTubePlayer !== "function") return;
  const player = new window.PeerTubePlayer(frame);
  await player.ready;
  if (generation !== sourceGeneration) return;
  attachController({
    play: () => player.play(),
    pause: () => player.pause(),
    seek: seconds => player.seek(seconds),
    getCurrentTime: () => player.getCurrentTime(),
    getDuration: async () => lastDuration,
    isPlaying: async () => await player.isPlaying?.() ?? false,
    isMuted: async () => (await player.getVolume()) === 0,
    setMuted: muted => player.setVolume(muted ? 0 : 1)
  });
  player.addEventListener("playbackStatusUpdate", status => {
    const duration = Number(status?.duration) || lastDuration;
    updateProgress(status?.position, duration, status?.playbackState === "playing");
  });
  player.addEventListener("playbackStatusChange", status => {
    if (status?.playbackState) playButton.textContent = status.playbackState === "playing" ? "Pause" : "Play";
  });
}

async function playArchiveSource(source, generation) {
  setState("Checking archive file", "Verifying the exact public file, format and declared rights basis.");
  const resolved = await resolveInternetArchiveFile(source);
  if (generation !== sourceGeneration) return;
  video.hidden = false;
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  if (resolved.mimeType === "application/vnd.apple.mpegurl") {
    if (video.canPlayType(resolved.mimeType)) {
      video.src = resolved.url;
    } else {
      await loadScript("https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js", "african-hls-runtime");
      if (generation !== sourceGeneration) return;
      if (!window.Hls?.isSupported()) throw new Error("This browser cannot play the archive HLS stream.");
      activeHls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
      activeHls.loadSource(resolved.url);
      activeHls.attachMedia(video);
      activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) setState("Archive stream interrupted", "The archive stream could not continue. Open the original item to check availability.");
      });
    }
  } else {
    video.src = resolved.url;
  }
  video.load();
  sourceLabel.textContent = "INTERNET ARCHIVE · PUBLIC FILE";
  setState("", "", false);
  setFallback(resolved.itemUrl, "View archive item and rights information");
}

async function playSource(source) {
  clearPlayback();
  const generation = sourceGeneration;
  try {
    const item = validateAfricanPlaybackSource(source);
    activeSource = item;
    const capability = AFRICAN_PROVIDER_CAPABILITIES[item.provider];
    sourceLabel.textContent = item.provider.toUpperCase() + (capability.type === "public_file" ? " · PUBLIC FILE" : " · OFFICIAL PLAYER");
    if (item.provider === "archive") {
      await playArchiveSource(item, generation);
      return;
    }
    const embed = buildOfficialEmbed(item);
    frame.src = embed.url;
    frame.title = embed.title;
    frame.dataset.provider = embed.provider;
    frame.hidden = false;
    setState("", "", false);
    setFallback(getOfficialSourceFallback(item));
    if (item.provider === "youtube") await attachYouTubeController(generation);
    else if (item.provider === "vimeo") await attachVimeoController(generation);
    else if (item.provider === "peertube") await attachPeerTubeController(generation);
  } catch (error) {
    if (generation !== sourceGeneration) return;
    console.warn("African Stories provider initialization failed:", itemProvider(source), error?.message);
    if (!frame.hidden) {
      setState("Provider controls unavailable", "The official platform player may still work using its built-in controls. Use the original-source link if it does not load.");
    } else {
      clearPlayback();
      setState("Source unavailable", error?.message || "This source could not be opened.");
    }
  }
}

function itemProvider(source) {
  return typeof source?.provider === "string" ? source.provider : "unknown";
}

function renderSources(sources) {
  sourceList.replaceChildren();
  const enabled = sources.filter(source => source && source.enabled === true);
  enabled.forEach((source, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "african-source-button";
    button.textContent = (source.label || source.provider.toUpperCase()) + (index === 0 ? " · Primary" : "");
    button.setAttribute("aria-pressed", index === 0 ? "true" : "false");
    button.addEventListener("click", () => {
      for (const sibling of sourceList.querySelectorAll("button")) sibling.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-pressed", "true");
      playSource(source);
    });
    sourceList.append(button);
  });
  sourceList.hidden = enabled.length < 2;
  if (enabled.length) playSource(enabled[0]);
  return enabled.length;
}

async function loadCatalogueEdition() {
  if (!workId || !versionId) {
    setState("Edition not specified", "Open this player from an African Stories title page with an exact edition selected.");
    return;
  }
  setState("Loading African Stories edition", "Checking the published catalogue and its source records.");
  try {
    const snapshot = await getDoc(doc(db, "africanWorksPublic", workId));
    if (!snapshot.exists()) throw new Error("This title is not in the published African Stories catalogue.");
    const work = snapshot.data();
    const version = Array.isArray(work.versions) ? work.versions.find(item => item.versionId === versionId) : null;
    if (!version) throw new Error("The selected edition is not published for this title.");
    title.textContent = work.title || "African Stories";
    description.textContent = work.synopsis || "Choose an available source for this edition.";
    const sources = Array.isArray(version.playbackSources) ? version.playbackSources : [];
    const count = renderSources(sources);
    if (!count && work.officialExternalUrl) {
      const link = document.createElement("a");
      link.href = work.officialExternalUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "african-external-watch";
      link.textContent = "Watch at the official source";
      sourceList.replaceChildren(link);
      sourceList.hidden = false;
      clearPlayback();
      setState("Official viewing route", "This title is available through its published external source. Playback remains on that platform.");
      setFallback(work.officialExternalUrl);
    } else if (!count) {
      setState("No playable source published", "This edition has an archive or catalogue record, but no verified public playback source has been published yet.");
    }
  } catch (error) {
    console.warn("African Stories catalogue lookup failed:", error?.message);
    setState("Edition unavailable", error?.message || "The published edition could not be loaded.");
  }
}

function renderFilmFluxCards(movies) {
  filmFluxList.replaceChildren();
  movies.forEach(movie => {
    const card = document.createElement("article");
    card.className = "african-filmflux-card";
    if (movie.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = movie.thumbnailUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      card.append(image);
    }
    const body = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = movie.title;
    const meta = document.createElement("p");
    meta.textContent = [movie.channel, movie.duration].filter(Boolean).join(" · ") || "African film discovery";
    const actions = document.createElement("div");
    actions.className = "african-filmflux-actions";
    if (movie.youtubeId) {
      const play = document.createElement("button");
      play.type = "button";
      play.className = "african-source-button";
      play.textContent = "Play official YouTube upload";
      play.addEventListener("click", () => {
        title.textContent = movie.title;
        description.textContent = "Discovered through FilmFlux. Playback is delivered by the original YouTube platform player.";
        sourceList.hidden = true;
        const source = {
          sourceId: "filmflux-" + movie.youtubeId,
          provider: "youtube",
          videoId: movie.youtubeId,
          enabled: true,
          label: movie.title
        };
        playSource(source);
      });
      actions.append(play);
    } else {
      const unavailable = document.createElement("span");
      unavailable.textContent = "No verified YouTube video ID";
      actions.append(unavailable);
    }
    const more = document.createElement("a");
    more.href = movie.filmUrl;
    more.target = "_blank";
    more.rel = "noopener noreferrer";
    more.textContent = "FilmFlux details";
    actions.append(more);
    body.append(heading, meta, actions);
    card.append(body);
    filmFluxList.append(card);
  });
}

async function loadFilmFlux() {
  filmFluxPanel.hidden = false;
  title.textContent = "African film discovery";
  description.textContent = "Trending African film leads indexed by FilmFlux. Select a title to open its original YouTube player.";
  setState("Loading discovery feed", "Fetching FilmFlux's public trending catalogue.");
  try {
    const movies = await fetchFilmFluxTrending();
    renderFilmFluxCards(movies);
    filmFluxStatus.textContent = "FilmFlux discovery · " + movies.length + " titles returned · playback uses original YouTube uploads.";
    setState("", "", false);
  } catch (error) {
    filmFluxStatus.textContent = "FilmFlux feed unavailable. Its external catalogue remains available from the official platform.";
    setState("Discovery feed unavailable", error?.message || "Try again later.");
  }
}

async function requestPartnerSession(user) {
  if (!user) {
    setState("Sign-in required", "Sign in to Vivid Cinema to request this licensed partner stream.");
    return;
  }
  try {
    await ensureAppCheck();
    const createSession = httpsCallable(functions, "createAfricanPlaybackSession");
    const result = await createSession({ workId, versionId });
    const expiresAt = Number(result.data?.expiresAt);
    const playback = result.data?.playback;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 5 * 60 * 1000 ||
        playback?.type !== "iframe" || typeof playback.url !== "string" || typeof playback.origin !== "string") {
      throw new Error("The partner playback service returned an invalid session.");
    }
    const url = new URL(playback.url);
    if (url.protocol !== "https:" || url.origin !== playback.origin || url.username || url.password) throw new Error("The partner session failed origin validation.");
    clearPlayback();
    frame.src = url.toString();
    frame.title = "Licensed African Stories partner stream";
    frame.dataset.provider = "partner";
    frame.hidden = false;
    sourceLabel.textContent = "LICENSED PARTNER STREAM";
    setState("", "", false);
    window.setTimeout(() => {
      clearPlayback();
      setState("Partner session expired", "Request a new session to continue watching.");
    }, Math.max(0, expiresAt - Date.now()));
  } catch (error) {
    setState("Partner playback unavailable", error?.message || "The licensed partner session could not be opened.");
  }
}

playButton.addEventListener("click", async () => {
  if (!activeController) return;
  try {
    if (await activeController.isPlaying?.()) await activeController.pause();
    else await activeController.play();
  } catch (error) {
    console.warn("African player control failed:", error?.message);
  }
});

progress.addEventListener("change", async () => {
  if (!activeController || !lastDuration) return;
  const target = Number(progress.value) / 1000 * lastDuration;
  try { await activeController.seek(target); } catch {}
});

muteButton.addEventListener("click", async () => {
  if (!activeController?.setMuted) return;
  try {
    const muted = await activeController.isMuted();
    await activeController.setMuted(!muted);
    muteButton.textContent = muted ? "Mute" : "Unmute";
  } catch {}
});

fullscreenButton.addEventListener("click", async () => {
  try {
    const target = frame.hidden ? video : frame;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await (target.requestFullscreen?.() || target.parentElement.requestFullscreen());
  } catch {}
});

video.addEventListener("error", () => {
  if (!video.hidden && video.error) {
    const messages = {
      1: "Playback was interrupted.",
      2: "The archive file could not be downloaded. Check the original archive item.",
      3: "The browser could not decode this file.",
      4: "This file format or codec is not supported by this browser."
    };
    setState("Archive media unavailable", messages[video.error.code] || "This file could not be played. Open the archive item to inspect other formats.");
  }
});

if (mode === "filmflux") {
  loadFilmFlux();
} else if (mode === "partner") {
  if (!workId || !versionId) setState("Edition not specified", "A licensed partner session requires an exact work and edition.");
  else onAuthStateChanged(auth, requestPartnerSession);
} else {
  loadCatalogueEdition();
}

window.addEventListener("pagehide", clearPlayback, { once: true });
