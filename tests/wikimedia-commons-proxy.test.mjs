import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/commons-download.js";

const metadata = {
  query: { pages: [{ title: "File:Example.mp4", imageinfo: [{
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.mp4",
    size: 40000000, mime: "video/mp4",
    extmetadata: { LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" } }
  }] }] }
};
test("Commons proxy verifies licence and streams media with range support", async () => {
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("commons.wikimedia.org/w/api.php")) return Response.json(metadata);
    const response = new Response(new Uint8Array([7, 8]), { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-1/40000000", "content-length": "2" } });
    Object.defineProperty(response, "url", { value: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.mp4" });
    return response;
  };
  try {
    const request = new Request("https://vivid.example/api/commons-download?title=File%3AExample.mp4", { headers: { Range: "bytes=0-1" } });
    const response = await onRequest({ request });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(response.headers.get("content-range"), "bytes 0-1/40000000");
    assert.equal(calls[1].init.headers.get("Range"), "bytes=0-1");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [7, 8]);
  } finally { globalThis.fetch = originalFetch; }
});
test("Commons proxy rejects files without machine-readable open licences", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ query: { pages: [{ title: "File:Example.mp4", imageinfo: [{
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.mp4", size: 40000000, mime: "video/mp4", extmetadata: {}
  }] }] } });
  try {
    const response = await onRequest({ request: new Request("https://vivid.example/api/commons-download?title=File%3AExample.mp4") });
    assert.equal(response.status, 403);
  } finally { globalThis.fetch = originalFetch; }
});
test("Commons proxy rejects unsafe titles and unsupported methods", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return Response.json(metadata); };
  try {
    const bad = await onRequest({ request: new Request("https://vivid.example/api/commons-download?title=../secret") });
    const post = await onRequest({ request: new Request("https://vivid.example/api/commons-download?title=File%3AExample.mp4", { method: "POST" }) });
    assert.equal(bad.status, 400);
    assert.equal(post.status, 405);
    assert.equal(fetched, false);
  } finally { globalThis.fetch = originalFetch; }
});
