import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, script, css, sw, syntax] = await Promise.all([
  read("../anime-premium.html"),
  read("../scripts/anime-premium-discovery.js"),
  read("../styles/vivid-anime-premium.css"),
  read("../service-worker.js"),
  read("../automation/check-syntax.mjs")
]);

test("Premium discovery exposes search, collections, type, year and sort controls", () => {
  for (const id of ["vap-search-form", "vap-search", "vap-sort", "vap-year", "vap-catalogue-grid", "vap-load-more"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const type of ["all", "tv", "movie"]) assert.match(html, new RegExp('data-vap-type="' + type + '"'));
  for (const id of ["vap-popular", "vap-series", "vap-films", "vap-top-rated", "vap-identities"]) assert.match(html, new RegExp('id="' + id + '"'));
});

test("Premium catalogue uses the existing anime metadata API and filters Japanese animation", () => {
  assert.match(script, /getAnimePage\(/);
  assert.match(script, /tmdbApi\.searchMulti\(/);
  assert.match(script, /item\.original_language === "ja"/);
  assert.match(script, /genre_ids\s*\|\|\s*\[\]\)\.includes\(16\)/);
  assert.doesNotMatch(script, /initializeApp\s*\(|getAuth\s*\(/);
});

test("catalogue cards open dedicated title routes and signature cards use per-title SVG masks", () => {
  assert.match(html, /id="vap-identities"/);
  assert.match(script, /anime-premium-title\.html/);
  assert.match(script, /vap-identity-svg/);
  assert.doesNotMatch(script, /\.m3u8|\.mp4|playbackUrl|streamUrl/i);
});

test("Premium discovery assets are cached and syntax-checked", () => {
  assert.match(sw, /scripts\/anime-premium-discovery\.js/);
  assert.match(sw, /vivid-cinema-shell-v335/);
  assert.match(sw, /anime-premium-title\.html/);
  assert.match(sw, /anime-premium-title\.js/);
  assert.match(sw, /vivid-anime-premium-title\.css/);
  assert.match(syntax, /scripts\/anime-premium-discovery\.js/);
  assert.match(syntax, /scripts\/anime-premium-title\.js/);
});
