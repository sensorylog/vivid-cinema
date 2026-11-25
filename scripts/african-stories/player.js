import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { app, auth, ensureAppCheck } from "../firebase.js";
import {
  buildOfficialEmbed, fetchFilmFluxTrending, getOfficialSourceFallback,
  resolveInternetArchiveFile, validateAfricanPlaybackSource
} from "./providers.js";

const state = document.getElementById("african-player-state");
const frame = document.getElementById("african-player-frame");
const video = document.getElementById("african-player-video");
const title = document.getElementById("african-player-title");
const description = document.getElementById("african-player-description");
const sourceList = document.getElementById("african-player-sources");
const sourceLabel = document.getElementById("african-player-source-label");
const fallback = document.getElementById("african-player-fallback");
const filmFluxPanel = document.getElementById("african-filmflux-panel");
const filmFluxList = document.getElementById("african-filmflux-list");
const filmFluxStatus = document.getElementById("african-filmflux-status");
const params = new URLSearchParams(window.location.search);
const workId = params.get("work");
const versionId = params.get("version");
const mode = params.get("provider") || "";
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
let activeHls = null;
let activeSource = null;

video.addEventListener("error", () => {
  if (!video.hidden) {
    setState("Media playback failed", "This file could not be decoded or delivered by the browser. Use the archive item link to inspect other available formats.");
  }
});

function setState(heading, message, visible = true) {
  state.hidden = !visible;
  state.replaceChildren();
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

function clearPlayback() {
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }
  frame.hidden = true;
  frame.removeAttribute("src");
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
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return;
  fallback.href = parsed.toString();
  fallback.textContent = label;
  fallback.hidden = false;
}

function setEmbed(embed) {
  clearPlayback();
  frame.src = embed.url;
  frame.title = embed.title;
  frame.dataset.provider = embed.provider;
  frame.hidden = false;
  sourceLabel.textContent = embed.provider.toUpperCase() + " · Official platform player";
  setState("", "", false);
  setFallback(embed.url);
}

function loadScript(src, id) {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      const existing = document.getElementById(id);
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = "true"; resolve(); };
    script.onerror = () => reject(new Error("The media playback library could not be loaded."));
    document.head.append(script);
  });
}

async function playArchiveSource(source) {
  clearPlayback();
  setState("Checking archive file", "Vivid is verifying that the exact public file exists and is browser-playable.");
  const resolved = await resolveInternetArchiveFile(source);
  video.hidden = false;
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = resolved.url;
  video.load();
  sourceLabel.textContent = "INTERNET ARCHIVE · PUBLIC FILE";
  setState("", "", false);
  setFallback(resolved.itemUrl, "View the archive item and its rights information");
  if (resolved.mimeType === "application/vnd.apple.mpegurl" && !video.canPlayType(resolved.mimeType)) {
    await loadScript("https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js", "african-hls-runtime");
    if (!window.Hls?.isSupported()) throw new Error("This browser cannot play the archive HLS stream.");
    activeHls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
    activeHls.loadSource(resolved.url);
    activeHls.attachMedia(video);
    activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data?.fatal) setState("Archive stream interrupted", "The archive stream could not continue. Open the original archive item to check availability.");
    });
  }
}

async function playSource(source) {
  let item;
  try {
    item = validateAfricanPlaybackSource(source);
    activeSource = item;
    if (item.provider === "archive") {
      await playArchiveSource(item);
      return;
    }
    const embed = buildOfficialEmbed(item);
    setEmbed(embed);
    setFallback(getOfficialSourceFallback(item));
  } catch (error) {
    clearPlayback();
    setState("Source unavailable", error?.message || "This source could not be opened.");
  }
}

function renderSources(sources) {
  sourceList.replaceChildren();
  const enabled = sources.filter(source => source && source.enabled === true);
  enabled.forEach((source, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "african-source-button";
    button.textContent = (source.label || source.provider.toUpperCase()) + (index === 0 ? " · Primary" : "");
    button.addEventListener("click", () => playSource(source));
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
  movies.forEach((movie, index) => {
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
        filmFluxPanel.hidden = false;
        const source = {
          sourceId: "filmflux-" + index,
          provider: "youtube",
          videoId: movie.youtubeId,
          enabled: true,
          label: movie.title
        };
        try {
          setEmbed(buildOfficialEmbed(source));
          setFallback("https://www.youtube.com/watch?v=" + movie.youtubeId);
        } catch (error) {
          setState("Video unavailable", error.message);
        }
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
  description.textContent = "Trending Nollywood and African film leads indexed by FilmFlux. Select a title to open its original YouTube player.";
  setState("Loading discovery feed", "Fetching FilmFlux's public trending catalogue.");
  try {
    const movies = await fetchFilmFluxTrending();
    renderFilmFluxCards(movies);
    filmFluxStatus.textContent = "FilmFlux discovery · " + movies.length + " titles returned · Playback uses original YouTube uploads.";
    setState("", "", false);
  } catch (error) {
    filmFluxStatus.textContent = "FilmFlux feed unavailable.";
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
    setEmbed({ provider: "partner", url: url.toString(), origin: url.origin, title: "Licensed African Stories partner stream" });
    sourceLabel.textContent = "LICENSED PARTNER STREAM";
    window.setTimeout(() => {
      clearPlayback();
      setState("Partner session expired", "Request a new session to continue watching.");
    }, Math.max(0, expiresAt - Date.now()));
  } catch (error) {
    setState("Partner playback unavailable", error?.message || "The licensed partner session could not be opened.");
  }
}

if (mode === "filmflux") {
  loadFilmFlux();
} else if (mode === "partner") {
  if (!workId || !versionId) setState("Edition not specified", "A licensed partner session requires an exact work and edition.");
  else onAuthStateChanged(auth, requestPartnerSession);
} else {
  loadCatalogueEdition();
}

window.addEventListener("pagehide", clearPlayback, { once: true });
