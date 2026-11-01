"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const MEDIA_TYPES = Object.freeze({
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mp4v": "video/mp4", ".f4v": "video/mp4",
  ".mkv": "video/x-matroska", ".mka": "audio/x-matroska", ".mks": "video/x-matroska",
  ".webm": "video/webm", ".mov": "video/quicktime", ".qt": "video/quicktime",
  ".avi": "video/x-msvideo", ".ogv": "video/ogg", ".ogg": "video/ogg",
  ".mpg": "video/mpeg", ".mpeg": "video/mpeg", ".m1v": "video/mpeg", ".m2v": "video/mpeg",
  ".vob": "video/mpeg", ".wmv": "video/x-ms-wmv", ".asf": "video/x-ms-asf",
  ".flv": "video/x-flv", ".divx": "video/divx", ".ts": "video/mp2t",
  ".m2ts": "video/mp2t", ".mts": "video/mp2t", ".3gp": "video/3gpp",
  ".3gpp": "video/3gpp", ".3g2": "video/3gpp"
});

function getMediaContentType(filePath) {
  return MEDIA_TYPES[path.extname(String(filePath || "")).toLowerCase()] || "application/octet-stream";
}

// Returns null when no range was requested, {start,end} for a valid single
// byte range, or {unsatisfiable:true} for malformed/unsupported ranges.
function parseByteRange(header, size) {
  if (header == null || String(header).trim() === "") return null;
  if (!Number.isSafeInteger(size) || size < 0) return { unsatisfiable: true };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return { unsatisfiable: true };

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { unsatisfiable: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      return { unsatisfiable: true };
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function createMediaResponse(request, filePath, stat) {
  const method = String(request?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const size = Number(stat?.size);
  if (!Number.isSafeInteger(size) || size < 0) {
    return new Response("Invalid media file", { status: 500 });
  }

  const headers = new Headers({
    "Content-Type": getMediaContentType(filePath),
    "Accept-Ranges": "bytes",
    "Content-Length": String(size),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  const rangeHeader = request?.headers?.get?.("range");
  const range = parseByteRange(rangeHeader, size);

  if (range?.unsatisfiable) {
    headers.set("Content-Range", "bytes */" + size);
    headers.delete("Content-Length");
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    headers.set("Content-Range", "bytes " + range.start + "-" + range.end + "/" + size);
    headers.set("Content-Length", String(range.end - range.start + 1));
    if (method === "HEAD") return new Response(null, { status: 206, headers });
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start: range.start, end: range.end })), {
      status: 206,
      headers
    });
  }

  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), { status: 200, headers });
}

module.exports = { createMediaResponse, getMediaContentType, parseByteRange };
