import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "service-worker.js"), "utf8");

test("service worker has a versioned cache and required offline shell", () => {
  assert.match(source, /const CACHE_NAME = "vivid-cinema-shell-v\d+"/);
  assert.match(source, /const REQUIRED_APP_SHELL = \["\.\/index\.html", "\.\/home\.html", "\.\/offline\.html", "\.\/manifest\.json"\]/);
  assert.match(source, /failedRequired\.length/);
  assert.match(source, /optional assets were not precached/);
  assert.match(source, /\.\/scripts\/local-owner\.js/);
});

test("every precached asset exists in the repository", async () => {
  const match = source.match(/const APP_SHELL = \[([\s\S]*?)\n\];/);
  assert.ok(match, "APP_SHELL array must be discoverable");
  const assets = [...match[1].matchAll(/"([^"]+)"/g)].map(entry => entry[1]);
  const paths = [...new Set(assets.map(asset => asset.replace(/^\.\//, "").split("?")[0]))];
  const missing = [];
  for (const asset of paths) {
    if (!asset || asset === ".") continue;
    try { await access(path.join(root, asset)); }
    catch { missing.push(asset); }
  }
  assert.deepEqual(missing, [], "Missing precache assets: " + missing.join(", "));
});

test("ordinary JavaScript and CSS use network-first while retaining offline cache fallback", () => {
  assert.match(source, /const CACHE_NAME = "vivid-cinema-shell-v\d+"/);
  assert.match(source, /isCodeOrStyle.*networkFirst/);
  assert.match(source, /event\.respondWith\(isCodeOrStyle\?networkFirst\(request\):isHtml\?networkFirst\(request\):staleWhileRevalidate\(request,event\)\)/);
  assert.match(source, /redirect:"follow"/);
  assert.match(source, /response\.redirected&&response\.url/);
});

test("service worker never returns redirect-marked or redirect-status responses", () => {
  assert.match(source, /function isSafeResponse\(response\)/);
  assert.match(source, /!response\.redirected/);
  assert.match(source, /response\.type!=="opaqueredirect"/);
  assert.match(source, /response\.status>=300&&response\.status<400/);
  assert.match(source, /async function fetchWithoutRedirect\(/);
  assert.match(source, /redirect:"error"/);
  assert.match(source, /async function safeCachedResponse\(/);
  assert.match(source, /await cache\.delete\(request\)/);
  assert.doesNotMatch(source, /cache\.add\(/, "precache must validate responses before storing them");
  assert.match(source, /asset!=="\.\/"/, "root alias is not precached because it can redirect");
});

function createWorkerHarness(fetchImpl, initialCache = new Map()) {
  const cacheEntries = new Map(initialCache);
  const cacheKey = (request) => typeof request === "string"
    ? new URL(request, "https://vivid.test/service-worker.js").href
    : request.url;
  const cache = {
    async match(request) { return cacheEntries.get(cacheKey(request)) || null; },
    async put(request, response) { cacheEntries.set(cacheKey(request), response); },
    async delete(request) { return cacheEntries.delete(cacheKey(request)); }
  };
  const cacheStorage = {
    async open() { return cache; },
    async match(request) { return cache.match(request); },
    async keys() { return ["vivid-cinema-shell-v250"]; },
    async delete() { return true; }
  };
  const handlers = {};
  const context = {
    self: {
      location: { origin: "https://vivid.test", href: "https://vivid.test/service-worker.js" },
      addEventListener(name, callback) { handlers[name] = callback; },
      skipWaiting: async () => {},
      clients: {}
    },
    caches: cacheStorage,
    fetch: (request, init) => fetchImpl(request, init),
    AbortController,
    setTimeout,
    clearTimeout,
    URL,
    Request,
    Response,
    console,
    Promise,
    Map,
    Set,
    Error
  };
  runInNewContext(source + "\nglobalThis.__worker = { networkFirst, staleWhileRevalidate, safeCachedResponse, cacheAssetsWithConcurrency };", context);
  return { worker: context.__worker, cacheEntries, cacheKey, handlers };
}

function mockResponse({ redirected = false, url = "https://vivid.test/home.html", status = 200 } = {}) {
  return { redirected, url, status, type: "basic", ok: status >= 200 && status < 300, clone() { return { ...this }; } };
}

test("network navigation redirects are re-fetched at their final URL before being served", async () => {
  const calls = [];
  const harness = createWorkerHarness(async (request, init) => {
    calls.push({ request: typeof request === "string" ? request : request.url, init });
    if (calls.length === 1) return mockResponse({ redirected: true, url: "https://vivid.test/home.html" });
    return mockResponse({ redirected: false, url: "https://vivid.test/home.html" });
  });
  const request = new Request("https://vivid.test/home.html");
  const response = await harness.worker.networkFirst(request);
  assert.equal(response.redirected, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request, "https://vivid.test/home.html");
  assert.equal(calls[1].init.redirect, "error");
});

test("redirected responses already in cache are deleted and never returned", async () => {
  const request = new Request("https://vivid.test/home.html");
  const key = request.url;
  const harness = createWorkerHarness(async () => { throw new Error("network unavailable"); }, new Map([[key, mockResponse({ redirected: true })]]));
  const response = await harness.worker.networkFirst(request);
  assert.equal(response.status, 504);
  assert.equal(harness.cacheEntries.has(key), false);
});

test("notification navigation is restricted to the app origin", () => {
  assert.match(source, /function safeNotificationUrl\(/);
  assert.match(source, /url\.origin===self\.location\.origin/);
  assert.match(source, /new URL\(client\.url\)\.origin===self\.location\.origin/);
});

test("legacy MediaForge entry points are absent from the offline shell", async () => {
  assert.doesNotMatch(source, /mediaforge/i);
  const home = await readFile(path.join(root, "home.html"), "utf8");
  assert.doesNotMatch(home, /mediaforge/i);
  await assert.rejects(access(path.join(root, "mediaforge.html")));
  await assert.rejects(access(path.join(root, "scripts", "mediaforge.js")));
  await assert.rejects(access(path.join(root, "styles", "vivid-mediaforge.css")));
});
test("app-shell manifest contains no duplicate cache URLs", () => {
  const match = source.match(/const APP_SHELL = \[([\s\S]*?)\n\];/);
  assert.ok(match, "APP_SHELL array must be discoverable");
  const assets = [...match[1].matchAll(/"([^"]+)"/g)].map(entry => entry[1]);
  const duplicates = assets.filter((asset, index) => assets.indexOf(asset) !== index);
  assert.deepEqual(duplicates, [], "Duplicate precache URLs waste cache space: " + duplicates.join(", "));
});


test("optional app-shell precache limits concurrent requests", async () => {
  let active = 0;
  let maxActive = 0;
  let requests = 0;
  const harness = createWorkerHarness(async request => {
    requests += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return mockResponse({ url: new URL(typeof request === "string" ? request : request.url, "https://vivid.test/").href });
  });
  const cache = { async put() {} };
  const assets = Array.from({ length: 20 }, (_, index) => "./assets/test-" + index + ".js");
  const failures = await harness.worker.cacheAssetsWithConcurrency(cache, assets, 6);

  assert.equal(failures.length, 0);
  assert.equal(requests, assets.length);
  assert.ok(maxActive <= 6, "optional precache should not start more than six requests concurrently");
});

test("app shell includes current versioned assets without dropping existing cache entries", () => {
  for (const current of [
    "./scripts/watch.js?v=watch-player-server-scroll-1",
    "./scripts/live.js?v=live8",
    "./scripts/title.js?v=no-archive-download-2",
    "./scripts/newsroom.js?v=20261020-newsroom-images-3",
    "./scripts/tflix-hero.js?v=hero-fast-fallback-1",
    "./scripts/mascot-autoplay.js?v=2"
  ]) assert.ok(source.includes(JSON.stringify(current)), "Missing current asset: " + current);

  // Preserve older entries until all runtime consumers have been verified;
  // pruning query-versioned assets is a separate cleanup, not required here.
  assert.ok(source.includes(JSON.stringify("./scripts/firebase.js?v=20261016-auth-runtime-audit2")));
});
test("service worker precaches Hls.js and serves the exact CORS library offline", () => {
  assert.ok(source.includes('const HLS_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js"'));
  assert.match(source, /const APP_SHELL = \[\s*HLS_LIBRARY_URL/);
  assert.match(source, /asset===HLS_LIBRARY_URL&&response\.type==="cors"/);
  assert.match(source, /if\(url\.href===HLS_LIBRARY_URL\)/);
  assert.match(source, /cache\.put\(HLS_LIBRARY_URL,response\.clone\(\)\)/);
  assert.ok(source.includes('"./scripts/downloads/browser-hls-adapter.js"'));
});
test("Hls.js CORS response is cached and served again when offline", async () => {
  const libraryUrl = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js";
  let offline = false;
  const harness = createWorkerHarness(async () => {
    if (offline) throw new Error("offline");
    return {
      ok: true, status: 200, redirected: false, type: "cors", url: libraryUrl,
      clone() { return { ...this }; }
    };
  });
  const dispatch = async () => {
    const event = {
      request: new Request(libraryUrl, { mode: "cors" }),
      respondWith(promise) { this.response = promise; }
    };
    harness.handlers.fetch(event);
    return event.response;
  };
  const online = await dispatch();
  assert.equal(online.url, libraryUrl);
  assert.ok(harness.cacheEntries.has(libraryUrl));
  offline = true;
  const cached = await dispatch();
  assert.equal(cached.url, libraryUrl);
});
