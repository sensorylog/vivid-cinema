import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createDownloadProxyHandler } from "../functions/download-proxy.js";

function responseWithUrl(body, options, url) {
  const response = new Response(body, options);
  Object.defineProperty(response, "url", { value: url });
  return response;
}
async function invoke(handler, { method = "GET", query = {}, headers = {} } = {}) {
  const req = { method, query, get: name => headers[name.toLowerCase()] || undefined };
  const res = new PassThrough();
  res.headers = {};
  res.set = function (name, value) { this.headers[name.toLowerCase()] = value; return this; };
  res.status = function (value) { this.statusCode = value; return this; };
  res.send = function (value) { this.end(value); return this; };
  const chunks = [];
  res.on("data", chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => { res.once("finish", resolve); res.once("error", reject); });
  await handler(req, res);
  await finished;
  return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) };
}
const archiveMetadata = { metadata: { licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/" }, files: [{ name: "film.mp4", size: "40000000" }] };
const commonsMetadata = { query: { pages: [{ title: "File:Film.mp4", imageinfo: [{
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Film.mp4", size: 40000000, mime: "video/mp4",
  extmetadata: { LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" } }
}] }] } };

test("Internet Archive proxy rechecks licence metadata and streams byte ranges", async () => {
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("archive.org/metadata/")) return Response.json(archiveMetadata);
    return responseWithUrl(new Uint8Array([1, 2, 3]), {
      status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-2/40000000", "content-length": "3" }
    }, "https://ia800123.us.archive.org/12/items/test_item/film.mp4");
  };
  try {
    const result = await invoke(createDownloadProxyHandler(), {
      query: { source: "internet-archive", identifier: "test_item", filename: "film.mp4" },
      headers: { range: "bytes=0-2" }
    });
    assert.equal(result.status, 206);
    assert.equal(result.headers["content-type"], "video/mp4");
    assert.equal(result.headers["content-range"], "bytes 0-2/40000000");
    assert.equal(calls[1].init.headers.get("range"), "bytes=0-2");
    assert.deepEqual([...result.body], [1, 2, 3]);
  } finally { globalThis.fetch = originalFetch; }
});

test("Wikimedia Commons proxy verifies machine-readable licence and streams the original file", async () => {
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("commons.wikimedia.org/w/api.php")) return Response.json(commonsMetadata);
    return responseWithUrl(new Uint8Array([9, 8]), {
      status: 200, headers: { "content-type": "video/mp4", "content-length": "2" }
    }, "https://upload.wikimedia.org/wikipedia/commons/a/ab/Film.mp4");
  };
  try {
    const result = await invoke(createDownloadProxyHandler(), { query: { source: "wikimedia-commons", title: "File:Film.mp4" } });
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "video/mp4");
    assert.deepEqual([...result.body], [9, 8]);
    assert.ok(calls[0].url.includes("commons.wikimedia.org/w/api.php"));
  } finally { globalThis.fetch = originalFetch; }
});

test("proxy rejects undeclared rights, malformed files and unknown sources", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ metadata: { rights: "All rights reserved" }, files: [{ name: "film.mp4", size: "40000000" }] });
  try {
    const handler = createDownloadProxyHandler();
    const rights = await invoke(handler, { query: { source: "internet-archive", identifier: "test_item", filename: "film.mp4" } });
    const invalid = await invoke(handler, { query: { source: "internet-archive", identifier: "../secret", filename: "film.mp4" } });
    const unknown = await invoke(handler, { query: { source: "other", identifier: "test_item", filename: "film.mp4" } });
    assert.equal(rights.status, 403);
    assert.equal(invalid.status, 400);
    assert.equal(unknown.status, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test("proxy handles CORS preflight and rejects unsupported methods", async () => {
  const handler = createDownloadProxyHandler();
  const options = await invoke(handler, { method: "OPTIONS" });
  const post = await invoke(handler, { method: "POST" });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-origin"], "*");
  assert.equal(post.status, 405);
});
