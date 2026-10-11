import { VIVID_CONFIG } from "./config.js";
import { inferAuthorizedStreamType, normalizeAllowedHosts, validateAllowedHttpsUrl } from "./direct-stream-validation.js";

// Unified playback engine for authorized, first-party direct stream integrations.
// This module deliberately has no default catalog or stream endpoint: a trusted
// integration must register a resolver and its hosts must be allowlisted in config.js.

const HLS_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js";
const SHAKA_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/shaka-player@5.2.12/dist/shaka-player.compiled.js";
let activeHls = null;
let activeShaka = null;
let activeVideo = null;
let directPlaybackGeneration = 0;
const scriptLoads = new Map();

function allowedHosts() {
  return normalizeAllowedHosts(VIVID_CONFIG.api.directStreamHosts);
}

export function hasDirectStreamIntegration() {
  return typeof window.VIVID_DIRECT_STREAM_RESOLVER === "function" && allowedHosts().length > 0;
}

export function validateDirectStreamUrl(value) {
  return validateAllowedHttpsUrl(value, allowedHosts());
}

function inferStreamType(url, declaredType) {
  return inferAuthorizedStreamType(url, declaredType);

function inferStreamType(url, declaredType) {
  const type = String(declaredType || "").toLowerCase();
  if (["hls", "dash", "file"].includes(type)) return type;
  const pathname = url.pathname.toLowerCase();
  if (pathname.endsWith(".m3u8")) return "hls";
  if (pathname.endsWith(".mpd")) return "dash";
  if (/\.(mp4|m4v|webm|mov|ogv)$/.test(pathname)) return "file";
  return "";
}

export async function resolveDirectStream(media, params) {
  if (!hasDirectStreamIntegration()) return null;
  const resolver = window.VIVID_DIRECT_STREAM_RESOLVER;
  const candidate = await resolver({
    media: {
      id: String(media?.id || ""),
      media_type: String(media?.media_type || ""),
      title: String(media?.title || "")
    },
    episode: params?.type === "tv"
      ? { season: Number(params.season), episode: Number(params.episode) }
      : null
  });
  if (!candidate || typeof candidate !== "object") return null;
  const url = validateDirectStreamUrl(candidate.url);
  if (!url) throw new Error("The direct stream URL is not HTTPS or its host is not allowlisted.");
  const type = inferStreamType(url, candidate.type);
  if (!type) throw new Error("The authorized stream format is not recognized. Use HLS, DASH, or a supported video file.");
  return { url: url.href, type };
}

function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (scriptLoads.has(url)) return scriptLoads.get(url);
  const promise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[data-vivid-player-library="' + url + '"]');
    if (!script) {
      script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.dataset.vividPlayerLibrary = url;
      script.crossOrigin = "anonymous";
    }
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (window[globalName]) resolve(window[globalName]);
      else reject(new Error("Playback library loaded without its expected API."));
    };
    const onError = () => {
      cleanup();
      script.remove();
      reject(new Error("Unable to load the playback library. Check the connection and content-security policy."));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!script.isConnected) document.head.appendChild(script);
    // A script inserted by another app component may already have finished loading.
    if (window[globalName]) {
      cleanup();
      resolve(window[globalName]);
    }
  });
  scriptLoads.set(url, promise);
  promise.catch(() => scriptLoads.delete(url));
  return promise;
}

function disposeActiveStream(video) {
  if (activeHls) {
    try { activeHls.destroy(); } catch {}
    activeHls = null;
  }
  let destroyPromise = Promise.resolve();
  if (activeShaka) {
    const player = activeShaka;
    activeShaka = null;
    destroyPromise = Promise.resolve(player.destroy()).catch(() => {});
  }
  const target = video || activeVideo;
  if (target) {
    try { target.pause(); } catch {}
    target.removeAttribute("src");
    target.querySelectorAll("source, track").forEach(node => node.remove());
    try { target.load(); } catch {}
  }
  if (!video || activeVideo === video) activeVideo = null;
  return destroyPromise;
}

export function stopDirectStream(video) {
  directPlaybackGeneration += 1;
  return disposeActiveStream(video);
}

export async function playDirectStream(video, stream, { startAt = 0, onError = () => {} } = {}) {
  if (!(video instanceof HTMLVideoElement)) throw new Error("A video element is required.");
  const url = validateDirectStreamUrl(stream?.url);
  if (!url) throw new Error("Direct stream URL failed the host allowlist check.");
  const type = inferStreamType(url, stream?.type);
  if (!type) throw new Error("Unsupported direct stream format.");

  const requestGeneration = ++directPlaybackGeneration;
  await disposeActiveStream(video);
  if (requestGeneration !== directPlaybackGeneration) throw new Error("Playback request was superseded.");
  activeVideo = video;
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.crossOrigin = "anonymous";
  video.autoplay = true;

  const seekToResumePoint = () => {
    const time = Number(startAt);
    if (Number.isFinite(time) && time > 5 && Number.isFinite(video.duration) && video.duration > time) {
      try { video.currentTime = time; } catch {}
    }
  };

  if (type === "file") {
    video.addEventListener("loadedmetadata", seekToResumePoint, { once: true });
    video.src = url.href;
    video.load();
    return { type, destroy: () => stopDirectStream(video) };
  }

  if (type === "hls") {
    let Hls;
    try {
      Hls = await loadScript(HLS_LIBRARY_URL, "Hls");
    } catch (error) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.addEventListener("loadedmetadata", seekToResumePoint, { once: true });
        video.src = url.href;
        video.load();
        return { type, native: true, destroy: () => stopDirectStream(video) };
      }
      throw error;
    }
    if (activeVideo !== video || requestGeneration !== directPlaybackGeneration) throw new Error("Playback request was superseded.");
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        fetchSetup: (context, initParams) => {
          if (!validateDirectStreamUrl(context.url)) throw new Error("HLS resource host is not allowlisted.");
          // Fetch-based HLS requests fail closed on redirects so an allowlisted URL cannot silently redirect to another host.\n          return new Request(context.url, { ...initParams, redirect: "error" });
        },
        xhrSetup: (_xhr, requestUrl) => {
          if (!validateDirectStreamUrl(requestUrl)) throw new Error("HLS resource host is not allowlisted.");
        }
      });
      activeHls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal || activeHls !== hls) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else onError(new Error("The HLS stream failed with a fatal playback error."));
      });
      video.addEventListener("loadedmetadata", seekToResumePoint, { once: true });
      hls.loadSource(url.href);
      hls.attachMedia(video);
      return { type, engine: "hls.js", destroy: () => stopDirectStream(video) };
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.addEventListener("loadedmetadata", seekToResumePoint, { once: true });
      video.src = url.href;
      video.load();
      return { type, native: true, destroy: () => stopDirectStream(video) };
    }
    throw new Error("This browser cannot play HLS streams.");
  }

  const shaka = await loadScript(SHAKA_LIBRARY_URL, "shaka");
  if (activeVideo !== video) throw new Error("Playback request was superseded.");
  shaka.polyfill?.installAll?.();
  if (!shaka.Player.isBrowserSupported()) throw new Error("This browser does not support DASH playback.");
  const player = new shaka.Player();
  activeShaka = player;
  await player.attach(video);
  if (activeVideo !== video || activeShaka !== player || requestGeneration !== directPlaybackGeneration) {
    await player.destroy();
    throw new Error("Playback request was superseded.");
  }
  player.configure({
    abr: { enabled: true },
    streaming: { bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 30 }
  });
  player.getNetworkingEngine()?.registerRequestFilter((_requestType, request) => {
    if (!Array.isArray(request?.uris) || !request.uris.length) throw new Error("DASH request has no resource URL.");
    for (const uri of request.uris) {
      if (!validateDirectStreamUrl(uri)) throw new Error("DASH resource host is not allowlisted.");
    }
  });
  player.addEventListener("error", event => {
    if (activeShaka === player) onError(new Error(event?.detail?.message || "The DASH stream failed to play."));
  });
  await player.load(url.href, Number(startAt) > 5 ? Number(startAt) : undefined);
  if (activeVideo !== video || activeShaka !== player || requestGeneration !== directPlaybackGeneration) {
    await player.destroy().catch(() => {});
    throw new Error("Playback request was superseded.");
  }
  return { type, engine: "shaka", destroy: () => stopDirectStream(video) };
}
