const EXTENSIONS = new Map([
  ["video/mp4", "mp4"], ["video/webm", "webm"], ["video/ogg", "ogv"], ["video/quicktime", "mov"]
]);
function safeFileTitle(value) {
  return typeof value === "string" && /^File:.{1,220}$/i.test(value)
    && !/[\u0000-\u001f]/.test(value);
}
function readLicence(info) {
  const license = String(info?.extmetadata?.LicenseUrl?.value || "").replace(/<[^>]*>/g, "").trim().toLowerCase();
  return /creativecommons\.org\/(?:licenses|publicdomain)\//.test(license);
}
export async function onRequest({ request }) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const title = new URL(request.url).searchParams.get("title") || "";
  if (!safeFileTitle(title)) return new Response("Invalid Commons file title", { status: 400 });
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "query", format: "json", formatversion: "2", prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: "LicenseUrl|LicenseShortName", titles: title, origin: "*"
  })) api.searchParams.set(key, value);
  const metadataResponse = await fetch(api, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!metadataResponse.ok) return new Response("Commons metadata is unavailable", { status: 502 });
  const metadata = await metadataResponse.json();
  const page = (Array.isArray(metadata?.query?.pages) ? metadata.query.pages : Object.values(metadata?.query?.pages || {}))[0];
  const info = page?.imageinfo?.[0];
  const mime = String(info?.mime || "").toLowerCase();
  const extension = EXTENSIONS.get(mime);
  const size = Number(info?.size);
  if (page?.title?.toLowerCase() !== title.toLowerCase() || !info || !extension || !readLicence(info)
    || !Number.isFinite(size) || size < 1024 * 1024 || size > 8 * 1024 * 1024 * 1024) {
    return new Response("This Commons file is not a verified openly licensed video", { status: 403 });
  }
  let fileUrl;
  try { fileUrl = new URL(info.url); } catch {}
  if (fileUrl?.protocol !== "https:" || fileUrl.hostname !== "upload.wikimedia.org" || !fileUrl.pathname.startsWith("/wikipedia/commons/")) {
    return new Response("Commons returned an untrusted media URL", { status: 502 });
  }
  const headers = new Headers();
  for (const name of ["Range", "If-Range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = await fetch(fileUrl, { method: request.method, headers, redirect: "follow", signal: request.signal });
  let finalHost = "";
  try { finalHost = new URL(upstream.url).hostname.toLowerCase(); } catch {}
  if (finalHost !== "upload.wikimedia.org") return new Response("Commons redirected to an untrusted host", { status: 502 });
  if (![200, 206, 416].includes(upstream.status)) return new Response("The Commons file is temporarily unavailable", { status: upstream.status >= 400 ? upstream.status : 502 });
  const filename = title.replace(/^File:/i, "");
  const outputHeaders = new Headers({
    "Content-Type": mime,
    "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes"
  });
  for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) outputHeaders.set(name, value);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers: outputHeaders });
}
