import { validateAllowedHttpsUrl } from "../playback/direct-stream-validation.js";

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const VIDEO_MIME = /^video\/(?:mp4|webm|quicktime|ogg|x-matroska)$/i;

function assetIdFromUri(uri) {
  const match = /^opfs:\/\/vivid-cinema-downloads\/([a-zA-Z0-9_-]{1,128})$/.exec(String(uri || ""));
  return match?.[1] || null;
}

function validateJobId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new TypeError("Invalid download job ID.");
  return id;
}

/**
 * Browser direct-file adapter backed by the Origin Private File System (OPFS).
 * The injected resolver must return a direct-download URL from a source that
 * explicitly authorizes offline storage. HLS/DASH manifests are not accepted.
 */
export function createBrowserDownloadAdapter({
  resolve,
  allowedHosts = [],
  storage = globalThis.navigator?.storage,
  fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_MAX_BYTES
} = {}) {
  if (typeof resolve !== "function") throw new TypeError("An authorized direct-file resolver is required.");
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) throw new TypeError("At least one authorized download host is required.");
  if (typeof storage?.getDirectory !== "function") throw new Error("Origin Private File System storage is unavailable.");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const byteLimit = Number(maxBytes);
  if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) throw new TypeError("maxBytes must be a positive safe integer.");

  async function downloadsDirectory() {
    const root = await storage.getDirectory();
    return root.getDirectoryHandle("vivid-cinema-downloads", { create: true });
  }

  async function fileHandle(id, create = false) {
    const directory = await downloadsDirectory();
    return directory.getFileHandle(id + ".media", { create });
  }

  async function remove(id) {
    const directory = await downloadsDirectory();
    try {
      await directory.removeEntry(id + ".media");
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
    }
  }

  return Object.freeze({
    async download(job, { signal, onProgress = () => {} } = {}) {
      const id = validateJobId(job?.id);
      if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
      const source = await resolve(job);
      const url = validateAllowedHttpsUrl(source?.url, allowedHosts);
      if (!url) throw new Error("The download source URL is not HTTPS or its host is not authorized.");
      const response = await fetchImpl(url.href, {
        method: "GET",
        headers: source.headers || {},
        credentials: "omit",
        mode: "cors",
        redirect: "error",
        cache: "no-store",
        signal
      });
      if (!response?.ok || response.redirected) throw new Error("The authorized source did not return a direct file response.");
      const mimeType = String(response.headers?.get?.("content-type") || source.mimeType || "").split(";")[0].trim().toLowerCase();
      if (!VIDEO_MIME.test(mimeType)) throw new Error("Only direct video-file responses are supported by this browser adapter.");
      const declaredLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > byteLimit) throw new Error("The video file exceeds the configured download size limit.");
      if (!response.body?.getReader) throw new Error("The browser did not provide a readable download stream.");

      const handle = await fileHandle(id, true);
      const writer = await handle.createWritable({ keepExistingData: false });
      const reader = response.body.getReader();
      let bytesDownloaded = 0;
      try {
        while (true) {
          if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
          const { done, value } = await reader.read();
          if (done) break;
          bytesDownloaded += value.byteLength;
          if (bytesDownloaded > byteLimit) throw new Error("The video file exceeds the configured download size limit.");
          await writer.write(value);
          onProgress({ bytesDownloaded, totalBytes: Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null });
        }
        if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
        await writer.close();
      } catch (error) {
        try { await reader.cancel(error); } catch {}
        try { await writer.abort(error); } catch {}
        await remove(id);
        throw error;
      }
      return {
        uri: "opfs://vivid-cinema-downloads/" + id,
        mimeType,
        size: bytesDownloaded
      };
    },
    async removePartial(job) {
      await remove(validateJobId(job?.id));
    },
    async removeAsset(job) {
      const id = assetIdFromUri(job?.asset?.uri);
      if (id) await remove(id);
    },
    async getAssetFile(asset) {
      const id = assetIdFromUri(asset?.uri);
      if (!id) throw new TypeError("Invalid Vivid offline asset URI.");
      const handle = await fileHandle(id, false);
      return handle.getFile();
    },
    async getAssetUrl(asset) {
      const file = await this.getAssetFile(asset);
      return URL.createObjectURL(file);
    }
  });
}
