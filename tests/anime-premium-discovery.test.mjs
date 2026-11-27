import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
import { isAnimeMetadata } from "../scripts/anime-eligibility.js";
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
  assert.match(script, /isAnimeMetadata\(item\)/);
  assert.doesNotMatch(script, /initializeApp\s*\(|getAuth\s*\(/);
});

test("Premium anime eligibility requires animation metadata and a Japanese origin signal", () => {
  assert.equal(isAnimeMetadata({ original_language: "ja", genre_ids: [16] }), true);
  assert.equal(isAnimeMetadata({ original_language: "en", genre_ids: [16], origin_country: ["JP"] }), true);
  assert.equal(isAnimeMetadata({ original_language: "en", genre_ids: [16], origin_country: ["US"] }), false);
  assert.equal(isAnimeMetadata({ original_language: "ja", genre_ids: [18] }), false);
  assert.equal(isAnimeMetadata({ original_language: "ja", genres: [{ id: 16 }] }), true);
});

test("catalogue cards open dedicated title routes and signature cards use per-title SVG masks", () => {
  assert.match(html, /id="vap-identities"/);
  assert.match(script, /anime-premium-title\.html/);
  assert.match(script, /vap-identity-svg/);
  assert.match(script, /items\.map\(identityCard\)/);
  assert.match(script, /identityCardInstance/);
  assert.match(script, /<path d="\x27 \+ path \+ \x27" fill="#2a203a"\/>/);
  assert.doesNotMatch(script, /\.m3u8|\.mp4|playbackUrl|streamUrl/i);
});

test("search respects the selected media type and release year and supports result pagination", () => {
  assert.match(script, /tmdbApi\.searchMulti\(query, page\)/);
  assert.match(script, /isAnimeMetadata\(item\)/);
  assert.match(script, /state\.type === "all" \|\| item\.media_type === state\.type/);
  assert.match(script, /!state\.year \|\| yearOf\(item\) === state\.year/);
  assert.match(script, /totalPages: Math\.min\(500, Number\(response\.total_pages \|\| 1\)\)/);
  assert.match(script, /state\.page \+= 1; loadCatalogue\(false\)/);
  assert.match(script, /\$\("vap-load-more"\)\.hidden = state\.page >= state\.totalPages/);
});

test("search, type, year and sort controls share one catalogue state", () => {
  assert.match(script, /state\.type = button\.dataset\.vapType/);
  assert.match(script, /state\.year = event\.target\.value/);
  assert.match(script, /state\.sort = event\.target\.value/);
  assert.match(script, /state\.query = \$\("vap-search"\)\.value\.trim\(\)/);
  assert.match(script, /function yearOf\(item\).*item\.year/);
});

test("Premium discovery assets are cached and syntax-checked", () => {
  assert.match(sw, /scripts\/anime-premium-discovery\.js/);
  assert.match(sw, /vivid-cinema-shell-v365/);
  assert.match(sw, /anime-premium-title\.html/);
  assert.match(sw, /anime-premium-title\.js/);
  assert.match(sw, /vivid-anime-premium-title\.css/);
  assert.match(syntax, /scripts\/anime-premium-discovery\.js/);
  assert.match(syntax, /scripts\/anime-premium-title\.js/);
});
