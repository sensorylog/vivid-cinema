import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFile(path.join(root, file), "utf8");

test("home trending animation avoids forced synchronous layout and repeated fallback requests", async () => {
  const source = await read("scripts/home-breathe.js");
  assert.doesNotMatch(source, /offsetWidth|offsetHeight|getBoundingClientRect\(/, "animation must not force synchronous layout");
  assert.match(source, /if\\s*\\(document\\.hidden\\)\\s*return/, "background tabs should not keep cycling the artwork");
  assert.match(source, /if \(!legacyPerformance && !timer && !window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\)/, "respect reduced-motion and legacy performance preferences");
  assert.doesNotMatch(source, /if \(!latest\.length\) latest = await loadDirectTrending\(\)/, "the interval must not repeatedly fetch TMDB when the rail is empty");
});


test("Home paints shelves independently and defers secondary shelves until near the viewport", async () => {
  const source=await read("script.js");
  const batch=source.slice(source.indexOf("async function loadSectionBatch(keys){"),source.indexOf("async function loadMoreSection"));
  const home=source.slice(source.indexOf("async function loadHome(){"),source.indexOf("let searchDialog"));
  assert.ok(batch.includes("Promise.all(keys.map(async key=>"));
  assert.match(home,/new IntersectionObserver/);
  assert.match(home,/rootMargin:"700px 0px"/);
  assert.match(batch,/vivid:home-trending-ready/);
  assert.ok(!source.includes("initFeatureStrip();void loadHome()"));
});

test("Home ambient artwork shares trending data and TMDB uses browser HTTP caching", async () => {
  const home=await read("script.js"),breathe=await read("scripts/home-breathe.js"),tmdb=await read("scripts/tmdb.js");
  assert.match(home,/vivid:home-trending-ready/);
  assert.match(breathe,/vivid:home-trending-ready/);
  assert.doesNotMatch(breathe,/tmdbApi|loadDirectTrending/);
  assert.match(tmdb,/cache: "default"/);
});

test("offline progress updates patch only the matching download row", async () => {
  const source=await read("scripts/downloads/desktop-offline.js");
  assert.match(source,/data-job-id=/);
  assert.ok(source.includes("function updateJobProgress(job)"));
  assert.ok(source.includes("else updateJobProgress(jobs[index])"));
  assert.ok(source.includes("if(changed)render()"));
});

test("watch page disables expensive ambient blur animation and overlay", async () => {
  const css = await read("styles/vivid-atmosphere.css");
  assert.match(css, /body\.vivid-watch-page\.vivid-atmosphere::before\{animation:none;filter:none/);
  assert.match(css, /body\.vivid-watch-page\.vivid-atmosphere::after\{display:none\}/);
});

test("noncritical analytics, telemetry and PWA modules do not block app-shell evaluation", async () => {
  const appShell = await read("scripts/app-shell.js");
  for (const module of ["google-tag", "vivid-pulse", "pwa", "analytics", "achievements"]) {
    assert.ok(!appShell.includes('import "./' + module + '.js";'), module + " must not be a blocking static import");
    assert.ok(appShell.includes('import("./' + module + '.js")'), module + " should load after first paint");
  }
});

test("app shell routes Back through its saved previous internal Vivid route", async () => {
  const appShell = await read("scripts/app-shell.js");
  assert.ok(appShell.includes('const NAV_STACK_KEY = "vivid:navigation-stack:v1"'));
  assert.ok(appShell.includes("function recordCurrentRoute()"));
  assert.ok(appShell.includes("function trackInternalNavigation(event)"));
  assert.ok(appShell.includes("location.assign(new URL(previous, location.origin).href)"));
  assert.ok(appShell.indexOf("recordCurrentRoute();") < appShell.indexOf("ensureBackControl();"));
  assert.ok(appShell.includes("scheduleIdle(() => { syncAccountNavigation(); }, 1200)"));
});

test("first-time service-worker installation does not force an extra page reload", async () => {
  const pwa = await read("scripts/pwa.js");
  assert.ok(pwa.includes("const hadController = Boolean(navigator.serviceWorker.controller)"));
  assert.ok(pwa.includes("if (hadController) {"));
  assert.ok(pwa.includes('navigator.serviceWorker.addEventListener("controllerchange"'));
});

test("home entry point does not import unused named bindings", async () => {
  const source = await read("script.js");
  assert.doesNotMatch(source, /\bgetHomeSections\b/);
  assert.doesNotMatch(source, /\brequestReleaseAlerts\b/);
  assert.doesNotMatch(source, /\bclearRecentSearches\b/);
});

test("static icons and fonts have explicit reusable cache headers", async () => {
  const headers = (await read("_headers")).replace(/\r\n/g, "\n");
  for (const extension of ["svg", "avif", "gif", "ico"]) {
    for (const pattern of [`/*.${extension}`, `/**/*.${extension}`]) {
      assert.ok(headers.includes(`${pattern}\n  Cache-Control: public, max-age=604800, stale-while-revalidate=2592000`));
    }
  }
  for (const extension of ["woff2", "woff"]) {
    for (const pattern of [`/*.${extension}`, `/**/*.${extension}`]) {
      assert.ok(headers.includes(`${pattern}\n  Cache-Control: public, max-age=2592000, stale-while-revalidate=2592000`));
    }
  }
});
