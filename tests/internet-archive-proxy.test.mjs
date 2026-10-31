import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/ia-download/[identifier]/[filename].js";

const metadata = { metadata: { licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/" }, files: [{ name: "film.mp4", size: "40000000" }] };

test("proxies only verified licensed archive files and forwards byte ranges", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/metadata/")) return Response.json(metadata);
    const response = new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-2/40000000", "content-length": "3" } });
    Object.defineProperty(response, "url", { value: "https://ia800123.us.archive.org/12/items/test_item/film.mp4" });
    return response;
  };
  try {
    const request = new Request("https://vivid.example/api/ia-download/test_item/film.mp4", { headers: { Range: "bytes=0-2" } });
    const response = await onRequest({ request, params: { identifier: "test_item", filename: "film.mp4" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(response.headers.get("content-range"), "bytes 0-2/40000000");
    assert.equal(calls[1].init.headers.Range, "bytes=0-2");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  } finally { globalThis.fetch = originalFetch; }
});

test("refuses archive items without a recognized open licence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ metadata: { rights: "All rights reserved" }, files: [{ name: "film.mp4", size: "40000000" }] });
  try {
    const response = await onRequest({ request: new Request("https://vivid.example/api/ia-download/test_item/film.mp4"), params: { identifier: "test_item", filename: "film.mp4" } });
    assert.equal(response.status, 403);
  } finally { globalThis.fetch = originalFetch; }
});

test("rejects path traversal, non-video files and methods other than GET or HEAD", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return Response.json(metadata); };
  try {
    const traversal = await onRequest({ request: new Request("https://vivid.example/api/ia-download/test_item/../secret.mp4"), params: { identifier: "test_item", filename: "../secret.mp4" } });
    const unsupported = await onRequest({ request: new Request("https://vivid.example/api/ia-download/test_item/movie.exe"), params: { identifier: "test_item", filename: "movie.exe" } });
    const post = await onRequest({ request: new Request("https://vivid.example/api/ia-download/test_item/film.mp4", { method: "POST" }), params: { identifier: "test_item", filename: "film.mp4" } });
    assert.equal(traversal.status, 400);
    assert.equal(unsupported.status, 415);
    assert.equal(post.status, 405);
    assert.equal(fetched, false);
  } finally { globalThis.fetch = originalFetch; }
});
