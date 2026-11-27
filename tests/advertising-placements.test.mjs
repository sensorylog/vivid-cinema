import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("native advertising supports independent, optional placement units", async () => {
  const advertising = await readFile(path.join(root, "scripts", "advertising.js"), "utf8");
  assert.match(advertising, /nativeBannerUnits: Object\.freeze/);
  assert.match(advertising, /primary: Object\.freeze/);
  assert.match(advertising, /secondary: Object\.freeze\(\{\s*enabled: false/);
  assert.match(advertising, /maxNativeRequestsPerSession: 8/);
  assert.match(advertising, /maxNativePlacementsPerPage: 2/);
  assert.match(advertising, /wasPlacementRequested/);
  assert.match(advertising, /vivid-native-ad-slot-\$\{page\}-\$\{placement\.key\}/);
  assert.match(advertising, /if \(!unit\?\.enabled \|\| !unit\.src \|\| !unit\.containerId\) return/);
});

test("all approved browsing pages define a primary and optional secondary position", async () => {
  const advertising = await readFile(path.join(root, "scripts", "advertising.js"), "utf8");
  for (const page of ["home", "discover", "collection", '"for-you"', "anime"]) {
    const pageStart = advertising.indexOf(`${page}: [`);
    assert.notEqual(pageStart, -1, `missing placement configuration for ${page}`);
    const pageEnd = advertising.indexOf("\n  ]", pageStart);
    assert.notEqual(pageEnd, -1, `unterminated placement configuration for ${page}`);
    const pageConfig = advertising.slice(pageStart, pageEnd);
    assert.match(pageConfig, /key: "primary"/);
    assert.match(pageConfig, /key: "secondary"/);
  }
  assert.match(advertising, /"watch", "watch-room", "watch-rooms", "live"/);
});

test("configured native ad anchors exist in their target pages", async () => {
  const placements = [
    ["home.html", ".vivid-catalogue-explore", "#top-10"],
    ["discover.html", ".vivid-discovery-results", ".vivid-discovery-filters"],
    ["collection.html", "#collection-grid", ".vivid-collection-toolbar"],
    ["for-you.html", "#recommendation-grid", ".vivid-for-you-controls"],
    ["anime.html", "#anime-grid", ".vivid-anime-controls"]
  ];
  for (const [page, ...selectors] of placements) {
    const html = await readFile(path.join(root, page), "utf8");
    for (const selector of selectors) {
      const token = selector.startsWith("#") ? `id="${selector.slice(1)}"` : `class="${selector.slice(1)}"`;
      assert.ok(html.includes(token) || (selector.startsWith(".") && new RegExp(`class="[^"]*\\\\b${selector.slice(1)}\\\\b[^"]*"`).test(html)), page + " is missing " + selector);
    }
  }
});

test("native ad presentation does not crop provider creatives", async () => {
  const style = await readFile(path.join(root, "styles", "vivid-advertising.css"), "utf8");
  const advertising = await readFile(path.join(root, "scripts", "advertising.js"), "utf8");
  assert.doesNotMatch(style, /max-height\s*:/);
  assert.doesNotMatch(style, /overflow\s*:\s*hidden/);
  assert.match(advertising, /Sponsored/);
});

test("Adsterra script origins are explicitly allowed by the site CSP", async () => {
  const headers = await readFile(path.join(root, "_headers"), "utf8");
  assert.match(headers, /script-src[^\n]*https:\/\/bancadeltempoidea\.org/);
  assert.match(headers, /connect-src[^\n]*https:\/\/bancadeltempoidea\.org/);
  assert.match(headers, /script-src[^\n]*https:\/\/aarems\.org/);
  assert.match(headers, /connect-src[^\n]*https:\/\/aarems\.org/);
});

test("browsing pages use the refreshed advertising assets", async () => {
  for (const page of ["home.html", "discover.html", "collection.html", "anime.html", "for-you.html"]) {
    const html = await readFile(path.join(root, page), "utf8");
    assert.match(html, /styles\/vivid-advertising\.css\?v=2/);
    assert.match(html, /scripts\/advertising\.js\?v=4/);
  }
});


test("Popunder uses a best-effort 24-hour browser tag-load cap and stays off excluded pages", async () => {
  const advertising = await readFile(path.join(root, "scripts", "advertising.js"), "utf8");
  assert.ok(advertising.includes("popunder: Object.freeze({"));
  assert.ok(advertising.includes("enabled: true,"));
  assert.ok(advertising.includes("if (!config?.enabled || !config.src) return;"));
  assert.ok(advertising.includes("maxScriptLoadsPerVisitorMs: 24 * 60 * 60 * 1000"));
  assert.ok(advertising.includes('eligiblePages: Object.freeze(["home", "discover", "collection", "for-you", "anime"])'));
  assert.ok(advertising.includes("vivid:popunder:last-script-load"));
  assert.ok(advertising.includes("Fail closed when storage is unavailable"));
  assert.ok(advertising.includes("if (!config.eligiblePages.includes(page) || EXCLUDED_PAGES.has(page)) return;"));
  assert.match(advertising, /function loadPopunder\(page\) \{[\s\S]*?if \(window\.vividDownloads\?\.available\) return;/);
  assert.match(advertising, /function loadSocialBar\(\)[\s\S]*?function loadPopunder\(page\)/, "other ad placements remain independently enabled");
});
