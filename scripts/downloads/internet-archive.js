const API = "https://archive.org";
const REQUEST_TIMEOUT_MS = 15000;
const RESULT_LIMIT = 12;
const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "ogv"]);
const MIME_BY_EXTENSION = Object.freeze({
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm",
  mov: "video/quicktime", ogv: "video/ogg"
});

function cleanTitle(value) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}
function safeIdentifier(value) {
  const id = String(value || "");
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(id) ? id : null;
}
function extensionOf(name) {
  const match = /\.([a-z0-9]{2,5})$/i.exec(String(name || ""));
  return match ? match[1].toLowerCase() : "";
}
function isExplicitlyLicensed(metadata = {}) {
  const license = String(metadata.licenseurl || "").toLowerCase();
  if (/creativecommons\.org\/(?:licenses|publicdomain)\//.test(license)) return true;
  const rights = String(metadata.rights || "").replace(/<[^>]*>/g, " ").toLowerCase();
  return /\b(public domain|public-domain|creative commons|cc0|no known copyright restrictions)\b/.test(rights);
}
function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0) + " " + units[index];
}
function searchUrl(title) {
  const query = new URLSearchParams();
  const safe = title.replace(/["\\]/g, " ").trim();
  query.set("q", 'mediatype:movies AND title:"' + safe + '"');
  query.set("rows", String(RESULT_LIMIT));
  query.set("page", "1");
  query.set("output", "json");
  for (const field of ["identifier", "title", "year", "licenseurl"]) query.append("fl[]", field);
  return API + "/advancedsearch.php?" + query.toString();
}
export function createInternetArchiveProvider({ fetchImpl = globalThis.fetch } = {}) {
  const cache = new Map();
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  // Keep the provider injectable for tests without replacing global fetch.
  const requestJson = async (url, signal) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Internet Archive request timed out.")), REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(url, { method: "GET", credentials: "omit", mode: "cors", redirect: "error", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Internet Archive returned HTTP " + response.status + ".");
      return await response.json();
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  };
  async function getOptions(media, { signal } = {}) {
    const title = cleanTitle(media?.title);
    if (!title) throw new TypeError("A movie or series title is required.");
    const episodeLabel = media?.media_type === "tv" && Number.isInteger(Number(media.season)) && Number.isInteger(Number(media.episode))
      ? " S" + String(media.season).padStart(2, "0") + "E" + String(media.episode).padStart(2, "0") : "";
    const queryTitle = title + episodeLabel + (media?.episode_title ? " " + cleanTitle(media.episode_title) : "");
    const cacheKey = queryTitle.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.options;
    const search = await requestJson(searchUrl(queryTitle), signal);
    const docs = Array.isArray(search?.response?.docs) ? search.response.docs : [];
    const unique = [...new Set(docs.map(doc => safeIdentifier(doc.identifier)).filter(Boolean))].slice(0, RESULT_LIMIT);
    const settled = await Promise.allSettled(unique.map(id => requestJson(API + "/metadata/" + encodeURIComponent(id), signal).then(item => {
      const metadata = item?.metadata || {};
      if (!isExplicitlyLicensed(metadata) || !Array.isArray(item.files)) return null;
      const files = item.files.filter(file => {
        if (!file || file.source === "metadata" || file.private === "true" || file.private === true) return false;
        const name = String(file.name || ""), ext = extensionOf(name), size = Number(file.size);
        return VIDEO_EXTENSIONS.has(ext) && !name.includes("/") && !name.startsWith(".") && Number.isFinite(size) && size >= 1024 * 1024 && size <= MAX_FILE_BYTES;
      }).sort((a, b) => {
        const rank = file => ({ mp4: 0, m4v: 1, webm: 2, mov: 3, ogv: 4 })[extensionOf(file.name)] ?? 9;
        return rank(a) - rank(b) || Number(b.size) - Number(a.size);
      });
      return { id, title: cleanTitle(metadata.title || id), year: String(metadata.year || metadata.date || "").slice(0, 4),
        license: String(metadata.licenseurl || metadata.rights || "Declared open licence").replace(/<[^>]*>/g, " ").slice(0, 180), files: files.slice(0, 4) };
    })));
    const options = [];
    for (const result of settled) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const item = result.value;
      for (const file of item.files) {
        const ext = extensionOf(file.name);
        const size = Number(file.size);
        options.push({
          id: item.id + "::" + file.name, sourceId: "internet-archive",
          label: "Internet Archive · " + item.title + (item.year ? " (" + item.year + ")" : "") + " · " + ext.toUpperCase() + " · " + formatBytes(size),
          quality: ext.toUpperCase(), format: ext.toUpperCase(), size,
          sourceTitle: item.title, license: item.license,
          detailsUrl: "https://archive.org/details/" + encodeURIComponent(item.id)
        });
      }
    }
    options.sort((a, b) => {
      const rank = value => ({ MP4: 0, M4V: 1, WEBM: 2, MOV: 3, OGV: 4 })[value] ?? 9;
      return rank(a.format) - rank(b.format) || (b.size || 0) - (a.size || 0);
    });
    cache.set(cacheKey, { options, expires: Date.now() + 5 * 60 * 1000 });
    return options;
  }
  async function resolve(job) {
    const media = job?.media || {};
    const [identifier, ...filenameParts] = String(media.source_file || "").split("::");
    const id = safeIdentifier(identifier);
    const filename = filenameParts.join("::");
    if (!id || !filename || filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") {
      throw new Error("The selected Internet Archive file is invalid. Search again and choose another result.");
    }
    const ext = extensionOf(filename);
    if (!VIDEO_EXTENSIONS.has(ext)) throw new Error("That file is not a supported video format.");
    const proxyUrl = new URL("https://us-central1-vivid-cinema.cloudfunctions.net/downloadMedia");
    proxyUrl.searchParams.set("source", "internet-archive");
    proxyUrl.searchParams.set("identifier", id);
    proxyUrl.searchParams.set("filename", filename);
    return { url: proxyUrl.href, type: "file", mimeType: MIME_BY_EXTENSION[ext], allowedHosts: [proxyUrl.hostname], headers: {} };
  }
  return Object.freeze({ sourceId: "internet-archive", getOptions, resolve });
}
