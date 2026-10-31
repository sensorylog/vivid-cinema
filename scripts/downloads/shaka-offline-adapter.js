import { validateAllowedHttpsUrl } from "../playback/direct-stream-validation.js";

const SHAKA_SCRIPT = "https://cdn.jsdelivr.net/npm/shaka-player@4.16.12/dist/shaka-player.compiled.js";
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
let shakaPromise = null;

export function ensureShakaLibrary({ documentRef = globalThis.document, scriptUrl = SHAKA_SCRIPT } = {}) {
  if (globalThis.shaka?.Player && globalThis.shaka?.offline?.Storage) return Promise.resolve(globalThis.shaka);
  if (shakaPromise) return shakaPromise;
  if (!documentRef?.createElement || !documentRef.head) return Promise.reject(new Error("Shaka offline playback is unavailable in this environment."));
  shakaPromise = new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.crossOrigin = "anonymous";
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (globalThis.shaka?.Player && globalThis.shaka?.offline?.Storage) resolve(globalThis.shaka);
      else { shakaPromise = null; reject(new Error("Shaka loaded without its offline storage API.")); }
    };
    const onError = () => {
      cleanup();
      shakaPromise = null;
      reject(new Error("Unable to load the Shaka offline media engine."));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    documentRef.head.appendChild(script);
  });
  return shakaPromise;
}

function qualityHeight(value) {
  const match = /(?:^|\D)(2160|1440|1080|720|576|480|360|240)p?(?:\D|$)/i.exec(String(value || ""));
  return match ? Number(match[1]) : 1080;
}

function chooseOfflineTracks(tracks, quality) {
  const variants = tracks.filter(track => track.type === "variant" && track.height > 0);
  if (!variants.length) return tracks.filter(track => track.type === "variant");
  const target = qualityHeight(quality);
  const below = variants.filter(track => track.height <= target);
  const pool = below.length ? below : variants;
  const selected = pool.sort((a, b) => {
    const heightDiff = (b.height || 0) - (a.height || 0);
    return heightDiff || (b.bandwidth || 0) - (a.bandwidth || 0);
  })[0];
  return [selected, ...tracks.filter(track => track.type === "text")];
}

function safeHeaders(headers) {
  const result = {};
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return result;
  for (const [key, value] of Object.entries(headers)) {
    if (!/^(accept|authorization|x-[a-z0-9-]+)$/i.test(key)) continue;
    if (typeof value === "string" && value.length <= 4096) result[key] = value;
  }
  return result;
}

/**
 * Shaka-backed offline adapter for authorized, non-DRM HLS/DASH VOD.
 * Shaka owns segmented storage in IndexedDB; Vivid owns job metadata and UI.
 */
export function createShakaOfflineAdapter({
  resolve,
  video,
  allowedHosts = [],
  shakaLoader = ensureShakaLibrary,
  ownerId = "guest",
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => Date.now()
} = {}) {
  if (typeof resolve !== "function") throw new TypeError("An authorized media resolver is required.");
  if (!video) throw new TypeError("A video element is required.");
  if (!Array.isArray(allowedHosts) || !allowedHosts.length) throw new TypeError("At least one authorized media host is required.");
  if (!Number.isSafeInteger(Number(maxBytes)) || Number(maxBytes) <= 0) throw new TypeError("maxBytes must be a positive safe integer.");

  let shaka = null;
  let player = null;
  let storage = null;
  let activeOperation = null;
  let activeJobId = null;

  async function ready() {
    if (storage && player) return;
    shaka = await shakaLoader();
    shaka.polyfill?.installAll?.();
    if (!shaka.Player.isBrowserSupported()) throw new Error("This browser does not support Shaka offline media storage.");
    player = new shaka.Player(video);
    storage = new shaka.offline.Storage(player);
  }

  function validateSource(source) {
    const hosts = Array.isArray(source?.allowedHosts) && source.allowedHosts.length ? source.allowedHosts : allowedHosts;
    const url = validateAllowedHttpsUrl(source?.url, hosts);
    if (!url) throw new Error("The media manifest is not HTTPS or its host is not authorized.");
    const type = String(source?.type || "").toLowerCase();
    if (!["hls", "dash"].includes(type)) throw new Error("Shaka offline storage accepts HLS or DASH VOD manifests only.");
    return { url, hosts, headers: safeHeaders(source.headers), type };
  }

  function installNetworkGuards(source) {
    const engine = player.getNetworkingEngine?.();
    if (!engine?.registerRequestFilter) return;
    if (player.__vividNetworkFilter) engine.unregisterRequestFilter?.(player.__vividNetworkFilter);
    const filter = (_type, request) => {
      const urls = Array.isArray(request.uris) ? request.uris : [];
      for (const raw of urls) {
        const checked = validateAllowedHttpsUrl(raw, source.hosts);
        if (!checked) throw new Error("A media segment points outside the authorized host allowlist.");
      }
      request.allowCrossSiteCredentials = false;
      request.headers = { ...(request.headers || {}), ...source.headers };
    };
    player.__vividNetworkFilter = filter;
    engine.registerRequestFilter(filter);
  }

  return Object.freeze({
    async download(job, { signal, onProgress = () => {} } = {}) {
      if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
      await ready();
      const source = validateSource(await resolve(job, { signal }));
      installNetworkGuards(source);
      let estimated = Math.max(0, Number(source.size) || 0);
      storage.configure({
        offline: {
          trackSelectionCallback: tracks => chooseOfflineTracks(tracks, job.quality),
          downloadSizeCallback: size => {
            if (Number.isFinite(Number(size)) && Number(size) > 0) estimated = Number(size);
            return estimated <= Number(maxBytes);
          },
          progressCallback: (_content, progress) => {
            const total = estimated || null;
            onProgress({ progress: Math.min(100, Math.max(0, Number(progress) * 100)), bytesDownloaded: total ? Math.floor(total * progress) : 0, totalBytes: total });
          },
          usePersistentLicense: true
        }
      });
      const operation = storage.store(source.url.href, {
        vividJobId: String(job.id),
        title: String(job.media?.title || "Vivid offline media"),
        mediaType: String(job.media?.media_type || ""),
        season: job.media?.season ?? null,
        episode: job.media?.episode ?? null,
        quality: String(job.quality || "Auto"),
        ownerId: String(ownerId || "guest"),
        savedAt: now()
      }, source.type === "hls" ? "application/x-mpegURL" : "application/dash+xml");
      activeOperation = operation;
      activeJobId = String(job.id);
      const abort = () => { try { operation.abort(); } catch {} };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const stored = await operation.promise;
        if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
        return { uri: stored.offlineUri, mimeType: "application/x-shaka-offline", size: estimated || null };
      } finally {
        signal?.removeEventListener("abort", abort);
        if (activeOperation === operation) activeOperation = null;
        if (activeJobId === String(job.id)) activeJobId = null;
      }
    },
    async removePartial(job) {
      if (!storage) return;
      if (activeJobId === String(job?.id)) {
        try { activeOperation?.abort(); } catch {}
      }
      const items = await storage.list();
      const match = items.find(item => String(item.appMetadata?.vividJobId || "") === String(job?.id || "") && String(item.appMetadata?.ownerId || "guest") === String(ownerId || "guest"));
      if (match) await storage.remove(match.offlineUri);
    },
    async removeAsset(job) {
      if (!storage || !job?.asset?.uri) return;
      await storage.remove(job.asset.uri);
    },
    async playAsset(asset) {
      await ready();
      if (typeof asset?.uri !== "string" || !/^offline:[a-zA-Z0-9_./-]+$/.test(asset.uri)) {
        throw new TypeError("Invalid Shaka offline asset reference.");
      }
      await player.load(asset.uri);
    },
    async stopAsset() {
      if (player) await player.unload();
    },
    async destroy() {
      try { activeOperation?.abort(); } catch {}
      try { await storage?.destroy?.(); } catch {}
      try { await player?.destroy?.(); } catch {}
      storage = null;
      player = null;
      shaka = null;
    }
  });
}
