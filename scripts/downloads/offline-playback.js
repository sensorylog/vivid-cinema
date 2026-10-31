const LOCAL_ASSET_URI = /^(?:(?:opfs|opfs-hls):\/\/vivid-cinema-downloads\/[a-zA-Z0-9_-]{1,128}|offline:[a-zA-Z0-9_./-]+)$/;
const HLS_MIME = "application/vnd.apple.mpegurl";
const HLS_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js";
let hlsLibraryPromise = null;

function loadHlsLibrary() {
  if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
  if (hlsLibraryPromise) return hlsLibraryPromise;
  if (typeof document === "undefined") return Promise.reject(new Error("The offline HLS playback library is unavailable."));
  hlsLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = HLS_LIBRARY_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (globalThis.Hls) resolve(globalThis.Hls);
      else { hlsLibraryPromise = null; reject(new Error("The HLS playback library loaded without its API.")); }
    };
    const onError = () => {
      cleanup();
      hlsLibraryPromise = null;
      reject(new Error("Unable to load the offline HLS playback library."));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  });
  return hlsLibraryPromise;
}

export function ensureOfflineHlsLibrary() { return loadHlsLibrary(); }

export function createOfflinePlaybackController({ adapter, video } = {}) {
  if (typeof adapter?.getAssetUrl !== "function") {
    throw new TypeError("An offline asset adapter is required.");
  }
  if (!video || typeof video.load !== "function" || typeof video.pause !== "function") {
    throw new TypeError("A video element is required.");
  }

  let activeUrl = null;
  let activeAsset = null;
  let activeHls = null;
  let generation = 0;

  function revokeAsset(asset, url) {
    if (asset?.uri?.startsWith("opfs-hls://") && typeof adapter.revokeAssetUrl === "function") {
      adapter.revokeAssetUrl(asset);
    } else if (url) {
      URL.revokeObjectURL(url);
    }
  }

  async function stop() {
    generation += 1;
    if (activeHls) {
      try { activeHls.destroy(); } catch {}
      activeHls = null;
    }
    try { video.pause(); } catch {}
    video.removeAttribute?.("src");
    try { video.load(); } catch {}
    const previousUrl = activeUrl;
    const previousAsset = activeAsset;
    activeUrl = null;
    activeAsset = null;
    if (previousAsset?.uri?.startsWith("offline:")) {
      try { await adapter.stopAsset?.(); } catch {}
    }
    revokeAsset(previousAsset, previousUrl);
  }

  async function play(asset, { startAt = 0 } = {}) {
    if (!asset || typeof asset.uri !== "string" || !LOCAL_ASSET_URI.test(asset.uri)) {
      throw new TypeError("The selected item is not a supported local offline asset.");
    }
    const request = ++generation;
    if (asset.uri.startsWith("offline:") && typeof adapter.playAsset === "function") {
      await adapter.playAsset(asset, { startAt });
      if (request !== generation) return false;
      activeAsset = asset;
      activeUrl = null;
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      return true;
    }
    const nextUrl = await adapter.getAssetUrl(asset);
    if (request !== generation) {
      revokeAsset(asset, nextUrl);
      return false;
    }
    if (typeof nextUrl !== "string" || !nextUrl.startsWith("blob:")) {
      throw new TypeError("The offline adapter did not return a local object URL.");
    }

    const previousUrl = activeUrl;
    const previousAsset = activeAsset;
    if (activeHls) {
      try { activeHls.destroy(); } catch {}
      activeHls = null;
    }
    activeUrl = nextUrl;
    activeAsset = asset;
    revokeAsset(previousAsset, previousUrl);

    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";

    const isHls = asset.mimeType === HLS_MIME || asset.uri.startsWith("opfs-hls://");
    if (isHls) {
      let Hls = null;
      try { Hls = await loadHlsLibrary(); } catch { /* Native HLS may still be available. */ }
      if (request !== generation) {
        revokeAsset(asset, nextUrl);
        return false;
      }
      if (Hls?.isSupported?.()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          fetchSetup: (context, initParams) => {
            if (!String(context.url || "").startsWith("blob:")) {
              throw new Error("Offline HLS playback refused a non-local media resource.");
            }
            return new Request(context.url, initParams);
          }
        });
        activeHls = hls;
        hls.attachMedia(video);
        hls.loadSource(nextUrl);
      } else if (video.canPlayType?.(HLS_MIME) || video.canPlayType?.("application/x-mpegURL")) {
        video.src = nextUrl;
        video.load();
      } else {
        revokeAsset(asset, nextUrl);
        activeUrl = null;
        activeAsset = null;
        throw new Error("This browser cannot play the saved HLS asset offline.");
      }
    } else {
      video.src = nextUrl;
      video.load();
    }

    const resumeAt = Number(startAt);
    if (Number.isFinite(resumeAt) && resumeAt > 0) {
      const seek = () => {
        if (request !== generation) return;
        if (Number.isFinite(video.duration) && video.duration > resumeAt) {
          try { video.currentTime = resumeAt; } catch {}
        }
      };
      video.addEventListener("loadedmetadata", seek, { once: true });
    }
    return true;
  }

  return Object.freeze({ play, stop });
}
