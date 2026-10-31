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
 * The injected resolver returns a direct media URL. HLS/DASH manifests are handled
 * by the HLS adapter; this adapter stores progressive video bytes in OPFS.
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
      const source = await resolve(job, { signal });
      const sourceHosts = Array.isArray(source?.allowedHosts) && source.allowedHosts.length ? source.allowedHosts : allowedHosts;
      const url = validateAllowedHttpsUrl(source?.url, sourceHosts);
      if (!url) throw new Error("The download source URL is not HTTPS or is outside the resolver host allowlist.");
      const handle = await fileHandle(id, true);
      let existingSize = 0;
      try { existingSize = (await handle.getFile()).size || 0; } catch {}
      if (existingSize > byteLimit) { await remove(id); existingSize = 0; }
      const requestHeaders = new Headers(source.headers || {});
      if (existingSize > 0) requestHeaders.set("Range", "bytes=" + existingSize + "-");
      const response = await fetchImpl(url.href, {
        method: "GET",
        headers: requestHeaders,
        credentials: "omit",
        mode: "cors",
        redirect: "error",
        cache: "no-store",
        signal
      });
      if (response?.status === 416 && existingSize > 0) {
        const complete = /^bytes \\*\\/(\\d+)$/i.exec(String(response.headers?.get?.("content-range") || ""));
        if (complete && Number(complete[1]) === existingSize) return { uri: "opfs://vivid-cinema-downloads/" + id, mimeType: source.mimeType || "video/mp4", size: existingSize };
      }
      if (!response?.ok || response.redirected) throw new Error("The authorized source did not return a direct file response.");
      const responseMime = String(response.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
      const declaredMime = String(source.mimeType || "").split(";")[0].trim().toLowerCase();
      if (responseMime && !VIDEO_MIME.test(responseMime) && !["application/octet-stream", "binary/octet-stream"].includes(responseMime)) {
        throw new Error("The source response is not a video file.");
      }
      const mimeType = VIDEO_MIME.test(responseMime) ? responseMime : declaredMime;
      if (!VIDEO_MIME.test(mimeType)) throw new Error("Only direct video-file responses are supported by this browser adapter.");
      let appendOffset = existingSize;
      const contentRange = String(response.headers?.get?.("content-range") || "");
      if (response.status === 206) {
        const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange);
        if (!match || Number(match[1]) !== existingSize) throw new Error("The source returned an invalid byte range; restart this download.");
      } else if (response.status === 200) {
        appendOffset = 0;
      } else {
        throw new Error("The source did not accept the requested download range.");
      }
      const rangeTotal = response.status === 206 && /\/(\d+)$/.exec(contentRange);
      const declaredLength = Number(response.headers?.get?.("content-length"));
      const totalBytes = rangeTotal ? Number(rangeTotal[1])
        : Number.isFinite(declaredLength) && declaredLength > 0 ? appendOffset + declaredLength : null;
      if (totalBytes && totalBytes > byteLimit) throw new Error("The video file exceeds the configured download size limit.");
      if (!response.body?.getReader) throw new Error("The browser did not provide a readable download stream.");

      const writer = await handle.createWritable({ keepExistingData: appendOffset > 0 });
      if (appendOffset > 0) await writer.seek(appendOffset);
      const reader = response.body.getReader();
      let bytesThisAttempt = 0;
      try {
        while (true) {
          if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
          const { done, value } = await reader.read();
          if (done) break;
          bytesThisAttempt += value.byteLength;
          if (appendOffset + bytesThisAttempt > byteLimit) throw new Error("The video file exceeds the configured download size limit.");
          await writer.write(value);
          onProgress({ bytesDownloaded: appendOffset + bytesThisAttempt, totalBytes });
        }
        if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
        await writer.close();
      } catch (error) {
        try { await reader.cancel(error); } catch {}
        if (/size limit/i.test(String(error?.message || ""))) {
          try { await writer.abort(error); } catch {}
          await remove(id);
        } else {
          // Commit the partial bytes so a retry can continue with an HTTP Range request.
          try { await writer.close(); } catch {
            try { await writer.abort(error); } catch {}
            if (!appendOffset) await remove(id);
          }
        }
        throw error;
      }
      return {
        uri: "opfs://vivid-cinema-downloads/" + id,
        mimeType,
        size: appendOffset + bytesThisAttempt
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
