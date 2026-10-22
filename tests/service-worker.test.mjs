import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "service-worker.js"), "utf8");

test("service worker has a versioned cache and required offline shell", () => {
  assert.match(source, /const CACHE_NAME = "vivid-cinema-shell-v\d+"/);
  assert.match(source, /const REQUIRED_APP_SHELL = \["\.\/", "\.\/index\.html", "\.\/home\.html", "\.\/offline\.html", "\.\/manifest\.json"\]/);
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
  assert.match(source, /fetch\(request,\{signal:controller\.signal,cache:"no-store"\}\)/);
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