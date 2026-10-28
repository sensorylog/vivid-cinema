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
  assert.match(source, /if \(document\.hidden\) return/, "background tabs should not keep cycling the artwork");
  assert.match(source, /if \(!timer && !window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\)/, "respect reduced-motion preference");
  assert.doesNotMatch(source, /if \(!latest\.length\) latest = await loadDirectTrending\(\)/, "the interval must not repeatedly fetch TMDB when the rail is empty");
});

test("watch page disables expensive ambient blur animation and overlay", async () => {
  const css = await read("styles/vivid-atmosphere.css");
  assert.match(css, /body\.vivid-watch-page\.vivid-atmosphere::before\{animation:none;filter:none/);
  assert.match(css, /body\.vivid-watch-page\.vivid-atmosphere::after\{display:none\}/);
});

test("shared app-shell modules are not redundantly imported a second time", async () => {
  const appShell = await read("scripts/app-shell.js");
  assert.match(appShell, /^import ["']\.\/google-tag\.js["'];/m);
  assert.match(appShell, /^import ["']\.\/vivid-pulse\.js["'];/m);
  assert.doesNotMatch(appShell, /import\(["']\.\/google-tag\.js["']\)/);
  assert.doesNotMatch(appShell, /import\(["']\.\/vivid-pulse\.js["']\)/);
});

test("home entry point does not import unused named bindings", async () => {
  const source = await read("script.js");
  assert.doesNotMatch(source, /\bgetHomeSections\b/);
  assert.doesNotMatch(source, /\brequestReleaseAlerts\b/);
  assert.doesNotMatch(source, /\bclearRecentSearches\b/);
});

test("static icons and fonts have explicit reusable cache headers", async () => {
  const headers = await read("_headers");
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
