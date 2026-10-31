const ALLOWED_EXTENSIONS = new Map([
  ["mp4", "video/mp4"], ["m4v", "video/mp4"], ["webm", "video/webm"],
  ["mov", "video/quicktime"], ["ogv", "video/ogg"]
]);
function explicitlyLicensed(metadata = {}) {
  const license = String(metadata.licenseurl || "").toLowerCase();
  if (/creativecommons\.org\/(?:licenses|publicdomain)\//.test(license)) return true;
  const rights = String(metadata.rights || "").replace(/<[^>]*>/g, " ").toLowerCase();
  return /\b(public domain|public-domain|creative commons|cc0|no known copyright restrictions)\b/.test(rights);
}
function validIdentifier(value) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(String(value || ""));
}
function validFilename(value) {
  return typeof value === "string" && value.length <= 220 && !value.includes("/") && !value.includes("\\")
    && !value.startsWith(".") && /^[a-zA-Z0-9][a-zA-Z0-9._() -]*$/.test(value);
}
export async function onRequest({ request, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const identifier = String(params?.identifier || "");
  const filename = String(params?.filename || "");
  if (!validIdentifier(identifier) || !validFilename(filename)) return new Response("Invalid archive file reference", { status: 400 });
  const extension = filename.split(".").pop().toLowerCase();
  const mimeType = ALLOWED_EXTENSIONS.get(extension);
  if (!mimeType) return new Response("Unsupported video format", { status: 415 });
  const metadataResponse = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!metadataResponse.ok) return new Response("The archive item could not be verified", { status: 404 });
  const item = await metadataResponse.json();
  if (!explicitlyLicensed(item?.metadata || {})) return new Response("This item has no recognized public-domain or Creative Commons declaration", { status: 403 });
  const file = Array.isArray(item.files) ? item.files.find(entry => entry?.name === filename && entry.private !== "true" && entry.private !== true) : null;
  if (!file || !Number.isFinite(Number(file.size)) || Number(file.size) < 1024 * 1024 || Number(file.size) > 12 * 1024 * 1024 * 1024) {
    return new Response("The selected video file is not available for download", { status: 404 });
  }
  const upstreamUrl = "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodeURIComponent(filename);
  const headers = new Headers();
  const range = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  if (range) headers.set("Range", range);
  if (ifRange) headers.set("If-Range", ifRange);
  const upstream = await fetch(upstreamUrl, { method: request.method, headers, redirect: "follow", signal: request.signal });
  let finalHost = "";
  try { finalHost = new URL(upstream.url).hostname.toLowerCase(); } catch {}
  if (finalHost !== "archive.org" && !finalHost.endsWith(".archive.org")) return new Response("Archive redirected to an untrusted host", { status: 502 });
  if (![200, 206, 416].includes(upstream.status)) return new Response("The archive file is temporarily unavailable", { status: upstream.status >= 400 ? upstream.status : 502 });
  const outputHeaders = new Headers({
    "Content-Type": mimeType,
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
