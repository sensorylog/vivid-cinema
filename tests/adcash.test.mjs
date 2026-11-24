import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Adcash ads are disabled from the shared app shell and service worker", async () => {
  const loader = await readFile(path.join(root, "scripts", "app-shell.js"), "utf8");
  const serviceWorker = await readFile(path.join(root, "service-worker.js"), "utf8");
  const headers = await readFile(path.join(root, "_headers"), "utf8");
  const firebase = await readFile(path.join(root, "firebase.json"), "utf8");
  const landing = await readFile(path.join(root, "index.html"), "utf8");

  assert.doesNotMatch(loader, /import ["']\.\/adcash\.js["']/);
  assert.doesNotMatch(landing, /adcash|acscdn|runAutoTag/i);
  assert.doesNotMatch(serviceWorker, /scripts\/adcash\.js/);
  assert.match(serviceWorker, /vivid-cinema-shell-v\d+/);
  assert.doesNotMatch(headers, /acscdn\.com/i);
  assert.doesNotMatch(firebase, /acscdn\.com/i);
});


test("Adsterra placements stay isolated to browsing surfaces and defer native loading", async () => {
  const advertising = await readFile(path.join(root, "scripts", "advertising.js"), "utf8");
  const style = await readFile(path.join(root, "styles", "vivid-advertising.css"), "utf8");
  const protectedPages = ["watch.html", "live.html", "watch-rooms.html", "login.html", "auth.html"];
  for (const page of protectedPages) {
    const html = await readFile(path.join(root, page), "utf8");
    assert.doesNotMatch(html, /scripts\/advertising\.js|vivid-advertising\.css/);
  }
  assert.match(advertising, /socialBar: false/);
  assert.match(advertising, /IntersectionObserver/);
  assert.match(advertising, /fetchpriority", "low"/);
  assert.match(advertising, /EXCLUDED_PAGES/);
  assert.match(advertising, /Sponsored/);
  assert.match(style, /max-height/);
});
