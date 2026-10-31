import { Readable } from "node:stream";

// Keep proxy limits aligned with the browser OPFS adapter.
const MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const IA_EXTENSIONS = new Map([
  ["mp4", "video/mp4"], ["m4v", "video/mp4"], ["webm", "video/webm"],
  ["mov", "video/quicktime"], ["ogv", "video/ogg"]
]);
const COMMONS_MIME = new Map([
  ["video/mp4", "mp4"], ["video/webm", "webm"], ["video/ogg", "ogv"], ["video/quicktime", "mov"]
]);
const jsonHeaders = { Accept: "application/json" };

function licensedArchive(metadata = {}) {
  const url = String(metadata.licenseurl || "").toLowerCase();
  if (/creativecommons\.org\/(?:licenses|publicdomain)\//.test(url)) return true;
  const rights = String(metadata.rights || "").replace(/<[^>]*>/g, " ").toLowerCase();
  return /\b(public domain|public-domain|creative commons|cc0|no known copyright restrictions)\b/.test(rights);
}
function licensedCommons(info = {}) {
  const url = String(info?.extmetadata?.LicenseUrl?.value || "").replace(/<[^>]*>/g, "").trim().toLowerCase();
  return /creativecommons\.org\/(?:licenses|publicdomain)\//.test(url);
}
function safeArchiveIdentifier(value) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(String(value || ""));
}
function safeArchiveFilename(value) {
  return typeof value === "string" && value.length <= 220
    && !/[\/\\\u0000-\u001f]/.test(value) && !value.startsWith(".") && value !== "..";
}
function safeCommonsTitle(value) {
  return typeof value === "string" && /^File:.{1,220}$/i.test(value) && !/[\u0000-\u001f]/.test(value);
}
async function fetchJson(url) {
  const response = await fetch(url, { headers: jsonHeaders, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Source metadata returned HTTP " + response.status + ".");
  return response.json();
}
async function resolveArchive(req) {
  const identifier = String(req.query.identifier || "");
  const filename = String(req.query.filename || "");
  if (!safeArchiveIdentifier(identifier) || !safeArchiveFilename(filename)) {
    const error = new Error("Invalid Internet Archive file reference."); error.status = 400; throw error;
  }
  const extension = filename.split(".").pop().toLowerCase();
  const mimeType = IA_EXTENSIONS.get(extension);
  if (!mimeType) { const error = new Error("Unsupported video format."); error.status = 415; throw error; }
  const item = await fetchJson("https://archive.org/metadata/" + encodeURIComponent(identifier));
  if (!licensedArchive(item?.metadata || {})) { const error = new Error("This item has no recognized public-domain or Creative Commons declaration."); error.status = 403; throw error; }
  const file = Array.isArray(item.files) ? item.files.find(entry => entry?.name === filename && entry.private !== "true" && entry.private !== true) : null;
  const size = Number(file?.size);
  if (!file || !Number.isFinite(size) || size < 1024 * 1024 || size > MAX_FILE_BYTES) {
    const error = new Error("The selected video file is not available for download."); error.status = 404; throw error;
  }
  return {
    url: "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodeURIComponent(filename),
    mimeType, filename
  };
}
async function resolveCommons(req) {
  const title = String(req.query.title || "");
  if (!safeCommonsTitle(title)) { const error = new Error("Invalid Wikimedia Commons file title."); error.status = 400; throw error; }
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "query", format: "json", formatversion: "2", prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: "LicenseUrl|LicenseShortName",
    titles: title, origin: "*"
  })) api.searchParams.set(key, value);
  const metadata = await fetchJson(api);
  const pages = Array.isArray(metadata?.query?.pages) ? metadata.query.pages : Object.values(metadata?.query?.pages || {});
  const page = pages[0], info = page?.imageinfo?.[0];
  const mimeType = String(info?.mime || "").toLowerCase();
  const extension = COMMONS_MIME.get(mimeType);
  const size = Number(info?.size);
  if (String(page?.title || "").toLowerCase() !== title.toLowerCase() || !info || !extension || !licensedCommons(info)
    || !Number.isFinite(size) || size < 1024 * 1024 || size > MAX_FILE_BYTES) {
    const error = new Error("This Commons file is not a verified openly licensed video."); error.status = 403; throw error;
  }
  let url;
  try { url = new URL(info.url); } catch {}
  if (url?.protocol !== "https:" || url.hostname !== "upload.wikimedia.org" || !url.pathname.startsWith("/wikipedia/commons/")) {
    const error = new Error("Wikimedia Commons returned an untrusted media URL."); error.status = 502; throw error;
  }
  return { url: url.href, mimeType, filename: title.replace(/^File:/i, "") };
}
export function createDownloadProxyHandler() {
  return async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Range, If-Range, Content-Type");
    res.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Content-Disposition");
    res.set("Vary", "Origin");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET" && req.method !== "HEAD") return res.set("Allow", "GET, HEAD, OPTIONS").status(405).send("Method not allowed");
    try {
      const source = String(req.query.source || "");
      const media = source === "internet-archive" ? await resolveArchive(req)
        : source === "wikimedia-commons" ? await resolveCommons(req) : null;
      if (!media) return res.status(400).send("Unknown download source.");
      const headers = new Headers();
      for (const name of ["range", "if-range"]) {
        const value = req.get(name);
        if (value) headers.set(name, value);
      }
      const upstream = await fetch(media.url, {
        method: req.method, headers, redirect: "follow", signal: AbortSignal.timeout(540000)
      });
      let finalUrl;
      try { finalUrl = new URL(upstream.url); } catch {}
      const hostAllowed = source === "internet-archive"
        ? finalUrl && (finalUrl.hostname === "archive.org" || finalUrl.hostname.endsWith(".archive.org"))
        : finalUrl?.hostname === "upload.wikimedia.org";
      if (!hostAllowed) return res.status(502).send("The source redirected to an untrusted host.");
      if (![200, 206, 416].includes(upstream.status)) return res.status(upstream.status >= 400 ? upstream.status : 502).send("The source file is temporarily unavailable.");
      res.status(upstream.status);
      res.set("Content-Type", media.mimeType);
      res.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(media.filename));
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "private, no-store");
      res.set("Accept-Ranges", "bytes");
      for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
        const value = upstream.headers.get(name);
        if (value) res.set(name, value);
      }
      if (req.method === "HEAD" || !upstream.body) return res.end();
      Readable.fromWeb(upstream.body).on("error", error => {
        if (!res.headersSent) res.status(502);
        res.destroy(error);
      }).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy(error);
      const status = Number(error?.status) || (error?.name === "TimeoutError" ? 504 : 502);
      return res.status(status).send(String(error?.message || "Download source failed.").slice(0, 240));
    }
  };
}
