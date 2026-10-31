import { validateAllowedHttpsUrl } from "../playback/direct-stream-validation.js";

const PLAYLIST_LIMIT = 2 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_MAX_SEGMENTS = 12000;
const DEFAULT_CONCURRENCY = 3;
const HLS_MIME = "application/vnd.apple.mpegurl";

function safeId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new TypeError("Invalid download job ID.");
  return id;
}

function parseAttributes(value) {
  const result = {};
  const pattern = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(value))) {
    const raw = match[2].trim();
    result[match[1].toUpperCase()] = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\(["\\])/g, "$1")
      : raw;
  }
  return result;
}

function resolveResource(uri, baseUrl, allowedHosts) {
  let absolute;
  try { absolute = new URL(uri, baseUrl); } catch { throw new Error("The HLS playlist contains an invalid resource URL."); }
  const safe = validateAllowedHttpsUrl(absolute.href, allowedHosts);
  if (!safe) throw new Error("An HLS resource is not HTTPS or its host is not allowlisted.");
  return safe;
}

function chooseVariant(variants, maxHeight = 1080) {
  if (!variants.length) throw new Error("The HLS master playlist contains no usable variants.");
  const underLimit = variants.filter(item => !item.height || item.height <= maxHeight);
  const pool = underLimit.length ? underLimit : variants;
  return pool.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
}

export function parseHlsPlaylist(text, baseUrl, { maxHeight = 1080, allowedHosts = [] } = {}) {
  if (typeof text !== "string" || !text.startsWith("#EXTM3U")) throw new Error("The source did not return a valid HLS playlist.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const attrs = parseAttributes(lines[i].slice(lines[i].indexOf(":") + 1));
    const uri = lines.slice(i + 1).find(line => line.trim() && !line.trim().startsWith("#"));
    if (!uri) continue;
    const resolution = /^(\d+)x(\d+)$/i.exec(attrs.RESOLUTION || "");
    variants.push({
      uri: uri.trim(),
      bandwidth: Number(attrs.BANDWIDTH) || 0,
      height: resolution ? Number(resolution[2]) : 0
    });
  }
  if (variants.length) {
    const selected = chooseVariant(variants, maxHeight);
    return { kind: "master", variantUrl: resolveResource(selected.uri, baseUrl, allowedHosts).href, variants };
  }

  if (!lines.some(line => line.trim() === "#EXT-X-ENDLIST")) {
    throw new Error("Browser offline storage currently requires a completed VOD playlist (EXT-X-ENDLIST).");
  }
  const keys = lines.filter(line => line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:"));
  for (const line of keys) {
    const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
    if (attrs.METHOD !== "NONE") throw new Error("Encrypted HLS playlists are not supported by this browser offline adapter.");
  }
  if (lines.some(line => line.startsWith("#EXT-X-DEFINE:"))) {
    throw new Error("HLS playlist variable substitution is not supported.");\n  }\n  if (lines.some(line => line.startsWith("#EXT-X-I-FRAME-STREAM-INF:") || /^#EXT-X-MEDIA:.*TYPE=(?:"(?:AUDIO|SUBTITLES)"|(?:AUDIO|SUBTITLES)).*URI=/.test(line))) {
    throw new Error("HLS alternate audio and I-frame playlists are not supported by this browser offline adapter.");\n  }\n  if (lines.some(line => line.startsWith("#EXT-X-BYTERANGE:"))) {
    throw new Error("HLS byte-range playlists are not supported by this browser offline adapter.");
  }

  const resources = [];
  const output = [];
  let segmentIndex = 0;
  let mapIndex = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { output.push(""); continue; }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseAttributes(line.slice(line.indexOf(":") + 1));
      if (!attrs.URI) throw new Error("The HLS initialization map is missing its URI.");
      if (attrs.BYTERANGE) throw new Error("HLS byte-range initialization maps are not supported.");
      const path = "segments/init-" + String(mapIndex++).padStart(5, "0") + ".bin";
      resources.push({ uri: attrs.URI, path, kind: "map" });
      output.push(line.replace(/URI="[^"]*"/, 'URI="' + path + '"'));
      continue;
    }
    if (line.startsWith("#")) { output.push(line); continue; }
    const path = "segments/segment-" + String(segmentIndex++).padStart(6, "0") + ".bin";
    resources.push({ uri: line, path, kind: "segment" });
    output.push(path);
  }
  if (!segmentIndex) throw new Error("The HLS media playlist contains no media segments.");
  return { kind: "media", resources, playlist: output.join("\n") + "\n", segmentCount: segmentIndex, mediaUrl: baseUrl };
}

export function createBrowserHlsDownloadAdapter({
  resolve,
  allowedHosts = [],
  storage = globalThis.navigator?.storage,
  fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_MAX_BYTES,
  maxSegments = DEFAULT_MAX_SEGMENTS,
  maxHeight = 1080,
  concurrency = DEFAULT_CONCURRENCY
} = {}) {
  if (typeof resolve !== "function") throw new TypeError("An authorized HLS resolver is required.");
  if (!Array.isArray(allowedHosts) || !allowedHosts.length) throw new TypeError("At least one authorized HLS host is required.");
  if (typeof storage?.getDirectory !== "function") throw new Error("Origin Private File System storage is unavailable.");
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("maxBytes must be a positive safe integer.");
  if (!Number.isInteger(maxSegments) || maxSegments < 1 || maxSegments > 50000) throw new TypeError("maxSegments must be between 1 and 50000.");

  const activeObjectUrls = new Map();
  const limit = Math.max(1, Math.min(6, Number(concurrency) || DEFAULT_CONCURRENCY));

  async function rootDirectory() {
    return (await storage.getDirectory()).getDirectoryHandle("vivid-cinema-downloads", { create: true });
  }
  async function jobDirectory(id, create = false) {
    return (await rootDirectory()).getDirectoryHandle(id, { create });
  }
  async function writeFile(directory, path, data) {
    const parts = path.split("/");
    let target = directory;
    for (const part of parts.slice(0, -1)) target = await target.getDirectoryHandle(part, { create: true });
    const handle = await target.getFileHandle(parts.at(-1), { create: true });
    const writer = await handle.createWritable({ keepExistingData: false });
    try { await writer.write(data); await writer.close(); }
    catch (error) { try { await writer.abort(error); } catch {} throw error; }
  }
  async function readFile(directory, path) {
    const parts = path.split("/");
    let target = directory;
    for (const part of parts.slice(0, -1)) target = await target.getDirectoryHandle(part);
    return target.getFileHandle(parts.at(-1)).then(handle => handle.getFile());
  }
  async function remove(id) {
    const root = await rootDirectory();
    try { await root.removeEntry(id, { recursive: true }); }
    catch (error) { if (error?.name !== "NotFoundError") throw error; }
    for (const url of activeObjectUrls.get(id) || []) URL.revokeObjectURL(url);
    activeObjectUrls.delete(id);
  }
  async function fetchText(url, headers, signal) {
    const response = await fetchImpl(url.href, { method: "GET", headers, credentials: "omit", mode: "cors", redirect: "error", cache: "no-store", signal });
    if (!response.ok || response.redirected) throw new Error("Unable to retrieve the authorized HLS playlist.");
    const mime = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (mime.includes("text/html") || mime.includes("application/json")) throw new Error("The HLS playlist endpoint returned a non-playlist response.");
    const text = await response.text();
    if (text.length > PLAYLIST_LIMIT) throw new Error("The HLS playlist exceeds the size limit.");
    return text;
  }
  async function downloadResource(resource, directory, headers, signal, progress) {
    const url = resolveResource(resource.uri, resource.baseUrl, allowedHosts);
    const response = await fetchImpl(url.href, { method: "GET", headers, credentials: "omit", mode: "cors", redirect: "error", cache: "no-store", signal });
    if (!response.ok || response.redirected || !response.body?.getReader) throw new Error("An HLS media resource could not be downloaded.");
    const mime = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (mime.includes("text/html") || mime.includes("application/json")) throw new Error("An HLS segment returned an HTML or JSON response.");
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("The HLS asset exceeds the configured size limit.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        progress.bytes += value.byteLength;
        if (progress.bytes > maxBytes) throw new Error("The HLS asset exceeds the configured size limit.");
        chunks.push(value);
      }
    } catch (error) {
      try { await reader.cancel(error); } catch {}
      throw error;
    }
    await writeFile(directory, resource.path, new Blob(chunks, { type: mime.split(";")[0] || "application/octet-stream" }));
    progress.onProgress({ bytesDownloaded: progress.bytes, totalBytes: progress.totalBytes });
    return size;
  }

  return Object.freeze({
    async download(job, { signal, onProgress = () => {} } = {}) {
      const id = safeId(job?.id);
      if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
      const source = await resolve(job, { signal });
      if (source?.offlineAllowed !== true || source?.type !== "hls") {
        throw new Error("The provider did not explicitly authorize this HLS asset for offline storage.");
      }
      const startUrl = resolveResource(source.url, source.url, allowedHosts);
      const headers = source.headers && typeof source.headers === "object" ? source.headers : {};
      const firstText = await fetchText(startUrl, headers, signal);
      let parsed = parseHlsPlaylist(firstText, startUrl.href, { maxHeight, allowedHosts });
      if (parsed.kind === "master") {
        const variantUrl = resolveResource(parsed.variantUrl, startUrl.href, allowedHosts);
        const variantText = await fetchText(variantUrl, headers, signal);
        parsed = parseHlsPlaylist(variantText, variantUrl.href, { maxHeight, allowedHosts });
        if (parsed.kind !== "media") throw new Error("Nested HLS master playlists are not supported.");
      }
      if (parsed.resources.length > maxSegments) throw new Error("The HLS playlist contains too many segments.");
      // Resolve every segment against the selected media playlist, not the master.
      for (const resource of parsed.resources) resource.baseUrl = parsed.mediaUrl || startUrl.href;

      const directory = await jobDirectory(id, true);
      const progress = { bytes: 0, totalBytes: null, onProgress };
      let cursor = 0;
      const workers = Array.from({ length: Math.min(limit, parsed.resources.length) }, async () => {
        while (cursor < parsed.resources.length) {
          if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
          const resource = parsed.resources[cursor++];
          await downloadResource(resource, directory, headers, signal, progress);
        }
      });
      try {
        const settled = await Promise.allSettled(workers);
        const failed = settled.find(item => item.status === "rejected");
        if (failed) throw failed.reason;
        if (signal?.aborted) throw new DOMException("Download aborted.", "AbortError");
        await writeFile(directory, "index.m3u8", new Blob([parsed.playlist], { type: HLS_MIME }));
        await writeFile(directory, "metadata.json", new Blob([JSON.stringify({
          version: 1, id, kind: "hls-vod", segmentCount: parsed.segmentCount, size: progress.bytes,
          createdAt: Date.now(), sourceId: String(source.sourceId || "").slice(0, 80)
        })], { type: "application/json" }));
      } catch (error) {
        await remove(id);
        throw error;
      }
      return { uri: "opfs-hls://vivid-cinema-downloads/" + id, mimeType: HLS_MIME, size: progress.bytes, kind: "hls" };
    },
    async removePartial(job) { await remove(safeId(job?.id)); },
    async removeAsset(job) {
      const match = /^opfs-hls:\\/\\/vivid-cinema-downloads\\/([a-zA-Z0-9_-]{1,128})$/.exec(String(job?.asset?.uri || ""));
      if (match) await remove(match[1]);
    },
    async getAssetUrl(asset) {
      const match = /^opfs-hls:\\/\\/vivid-cinema-downloads\\/([a-zA-Z0-9_-]{1,128})$/.exec(String(asset?.uri || ""));
      if (!match) throw new TypeError("Invalid Vivid offline HLS asset URI.");
      const id = match[1], directory = await jobDirectory(id, false);
      const playlistFile = await readFile(directory, "index.m3u8");
      let playlist = await playlistFile.text();
      const urls = [];
      const paths = new Set();
      for (const line of playlist.split(/\r?\n/)) {
        if (line && !line.startsWith("#")) paths.add(line.trim());
        const map = /#EXT-X-MAP:.*?URI="([^"]+)"/.exec(line);
        if (map) paths.add(map[1]);
      }
      const replacements = new Map();
      for (const path of paths) {
        const file = await readFile(directory, path);
        const url = URL.createObjectURL(file);
        urls.push(url);
        replacements.set(path, url);
      }
      playlist = playlist.split(/\r?\n/).map(line => {
        if (line && !line.startsWith("#")) return replacements.get(line.trim()) || line;
        return line.replace(/(#EXT-X-MAP:.*?URI=")([^"]+)(")/, (_all, before, path, after) => before + (replacements.get(path) || path) + after);
      }).join("\n");
      const manifestUrl = URL.createObjectURL(new Blob([playlist], { type: HLS_MIME }));
      urls.push(manifestUrl);
      activeObjectUrls.set(id, urls);
      return manifestUrl;
    },
    revokeAssetUrl(asset) {
      const match = /^opfs-hls:\\/\\/vivid-cinema-downloads\\/([a-zA-Z0-9_-]{1,128})$/.exec(String(asset?.uri || ""));
      if (!match) return;
      for (const url of activeObjectUrls.get(match[1]) || []) URL.revokeObjectURL(url);
      activeObjectUrls.delete(match[1]);
    }
  });
}
