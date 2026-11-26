import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, titleScript, discovery, tmdb, sw, syntax, css, library] = await Promise.all([
  read("../anime-premium-title.html"),
  read("../scripts/anime-premium-title.js"),
  read("../scripts/anime-premium-discovery.js"),
  read("../scripts/tmdb.js"),
  read("../service-worker.js"),
  read("../automation/check-syntax.mjs"),
  read("../styles/vivid-anime-premium-title.css"),
  read("../scripts/library.js")
]);

test("Premium title route has its own cinematic title shell and content sections", () => {
  assert.match(html, /data-vivid-page="anime-premium-title"/);
  assert.match(html, /scripts\/anime-premium-title\.js/);
  assert.match(html, /anime-premium-watch\.html/);
  assert.match(html, /styles\/vivid-anime-premium-title\.css/);
  for (const id of ["vap-title-hero", "vap-title-backdrop-a", "vap-title-backdrop-b", "vap-title-facts", "vap-title-cast", "vap-title-related"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test("Living Cinematic Backdrop preloads same-title images and crossfades every 8.5 seconds", () => {
  assert.match(titleScript, /movieImages/);
  assert.match(titleScript, /tvImages/);
  assert.match(titleScript, /preloadImage\(/);
  assert.match(titleScript, /window\.setInterval\(\(\) => \{ void advanceBackdrop\(\); \}, 8500\)/);
  assert.match(titleScript, /prefers-reduced-motion/);
  assert.match(titleScript, /IntersectionObserver/);
  assert.match(css, /transition:opacity 1\.8s/);
  assert.match(css, /vap-title-kenburns/);
});

test("title experience stays metadata-only and uses official trailer links only", () => {
  assert.match(tmdb, /movieImages: \(id\)/);
  assert.match(tmdb, /tvImages: \(id\)/);
  assert.match(titleScript, /video\.site === "YouTube"/);
  assert.match(titleScript, /video\.official === true/);
  assert.doesNotMatch(titleScript, /<video|playbackUrl|streamUrl|\.m3u8|\.mp4/i);
});

test("anime identity cards use per-title SVG silhouette masks and mobile poster fallback", () => {
  assert.match(discovery, /IDENTITY_MASKS/);
  assert.match(discovery, /clipPath/);
  assert.match(discovery, /vap-identity-mobile-poster/);
  assert.match(discovery, /anime-premium-title\.html/);
  assert.match(css, /vap-title-hero\.is-scrolled/);
});

test("title route and runtime are available offline and included in syntax checks", () => {
  assert.match(sw, /vivid-cinema-shell-v337/);
  assert.match(sw, /anime-premium-title\.html/);
  assert.match(sw, /vivid-anime-premium-title\.css/);
  assert.match(sw, /anime-premium-title\.js/);
  assert.match(syntax, /scripts\/anime-premium-title\.js/);
});

test("Anime Premium My List uses the shared Vivid Library favorites collection", () => {
  assert.match(titleScript, /from "\.\/library\.js"/);
  assert.match(titleScript, /hasLibraryItem\("favorites", item\)/);
  assert.match(titleScript, /toggleLibraryItem\("favorites", item\)/);
  assert.match(titleScript, /media_type: mediaType/);
  assert.match(titleScript, /poster_path: details\.poster_path/);
  assert.match(titleScript, /vivid:library-changed/);
  assert.match(titleScript, /aria-pressed/);
  assert.match(titleScript, /Added to My List/);
  assert.match(titleScript, /vap:favorites-changed/);
  assert.doesNotMatch(titleScript, /vivid:anime-premium:my-list/);
  assert.match(library, /export function toggleLibraryItem\(collection,item\)/);
  assert.match(library, /export function syncLibraryForUser\(user=null\)/);
  assert.match(library, /export async function startLibrarySync\(\)/);
  assert.match(library, /onAuthStateChanged\(auth,user=>/);
});
