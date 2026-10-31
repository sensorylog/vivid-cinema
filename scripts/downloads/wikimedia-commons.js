const API = "https://commons.wikimedia.org/w/api.php";
const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const RESULT_LIMIT = 12;
const EXTENSIONS = new Map([
  ["video/mp4", { extension: "mp4", mimeType: "video/mp4" }],
  ["video/webm", { extension: "webm", mimeType: "video/webm" }],
  ["video/ogg", { extension: "ogv", mimeType: "video/ogg" }],
  ["video/quicktime", { extension: "mov", mimeType: "video/quicktime" }]
]);
const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
function licenceOf(info) {
  const value = clean(info?.extmetadata?.LicenseUrl?.value || "").toLowerCase();
  return /creativecommons\.org\/(?:licenses|publicdomain)\//.test(value) ? value : "";
}
function searchUrl(title) {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    generator: "search", gsrsearch: '"' + title.replace(/["\\]/g, " ").slice(0, 160) + '" filemime:video',
    gsrnamespace: "6", gsrlimit: String(RESULT_LIMIT),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "LicenseUrl|LicenseShortName|Artist|Credit", origin: "*"
  });
  return API + "?" + params.toString();
}
export function createWikimediaCommonsProvider({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const cache = new Map();
  async function requestJson(url, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Wikimedia Commons search timed out.")), 15000);
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(url, { credentials: "omit", mode: "cors", redirect: "error", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Wikimedia Commons returned HTTP " + response.status + ".");
      return response.json();
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async function getOptions(media, { signal } = {}) {
    const title = clean(media?.title);
    if (!title) throw new TypeError("A movie or series title is required.");
    const episode = media?.media_type === "tv" ? " S" + String(media.season || 1).padStart(2, "0") + "E" + String(media.episode || 1).padStart(2, "0") : "";
    const query = title + episode;
    const key = query.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.options;
    const data = await requestJson(searchUrl(query), signal);
    const pages = Array.isArray(data?.query?.pages) ? data.query.pages : Object.values(data?.query?.pages || {});
    const options = [];
    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      const license = licenceOf(info);
      const mime = EXTENSIONS.get(String(info?.mime || "").toLowerCase());
      const size = Number(info?.size);
      const fileTitle = String(page?.title || "");
      const url = String(info?.url || "");
      let parsed;
      try { parsed = new URL(url); } catch {}
      if (!license || !mime || !Number.isFinite(size) || size < 1024 * 1024 || size > MAX_FILE_BYTES
        || !/^File:/i.test(fileTitle) || parsed?.protocol !== "https:" || parsed?.hostname !== "upload.wikimedia.org"
        || !parsed.pathname.startsWith("/wikipedia/commons/")) continue;
      const short = clean(info?.extmetadata?.LicenseShortName?.value || "Open licence");
      options.push({
        id: fileTitle, sourceId: "wikimedia-commons",
        label: fileTitle.replace(/^File:/i, "") + " · " + mime.extension.toUpperCase() + " · " + formatBytes(size),
        quality: mime.extension.toUpperCase(), format: mime.extension.toUpperCase(), size,
        license: short + " · " + license,
        detailsUrl: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(fileTitle.replace(/ /g, "_"))
      });
    }
    options.sort((a, b) => (b.size || 0) - (a.size || 0));
    cache.set(key, { options, expires: Date.now() + 5 * 60 * 1000 });
    return options;
  }
  async function resolve(job) {
    const title = String(job?.media?.source_file || "");
    if (!/^File:.{1,220}$/i.test(title) || /[\u0000-\u001f]/.test(title)) throw new Error("The selected Wikimedia Commons file is invalid.");
    const url = new URL("https://us-central1-vivid-cinema.cloudfunctions.net/downloadMedia");
    url.searchParams.set("source", "wikimedia-commons");
    url.searchParams.set("title", title);
    return { url: url.href, type: "file", mimeType: "video/mp4", allowedHosts: [url.hostname], headers: {} };
  }
  return Object.freeze({ sourceId: "wikimedia-commons", getOptions, resolve });
}
function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0) + " " + units[index];
}
