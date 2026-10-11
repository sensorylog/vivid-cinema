import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("canonical media layout keeps poster artwork inside its frames", () => {
  const css = read("../styles/vivid-media-layout.css");
  assert.match(css, /object-fit:\s*contain\s*!important/);
  assert.match(css, /object-position:\s*center/);
  assert.match(css, /transform:\s*none\s*!important/);
  assert.match(css, /\.vivid-watch-artwork/);
  assert.match(css, /\.vivid-card-media/);
  assert.match(css, /\.vivid-anime-poster img/);
  assert.match(css, /\.vivid-similar-card img/);
  assert.match(css, /\.vivid-person-credit-poster img/);
});

test("retired home hero is absent while shared media layout remains for other surfaces", () => {
  const css = read("../styles/vivid-media-layout.css");
  const home = read("../home.html");
  const js = read("../script.js");
  assert.match(css, /\.vivid-card-media/);
  assert.match(css, /\.vivid-watch-page/);
  assert.doesNotMatch(home, /class="vivid-hero"/);
  assert.doesNotMatch(js, /loadHeroVideo|sendHeroPlayerCommand|youtubeUrl|hero-video/);
});

test("featured cards load independently of the removed trailer player", () => {
  const js = read("../script.js");
  assert.match(js, /function renderFeatureStrip\(\)/);
  assert.match(js, /async function initFeatureStrip\(\)/);
  assert.match(js, /initFeatureStrip\(\);void loadHome\(\)/);
  assert.doesNotMatch(js, /autoplay:\s*"1"|heroMuted|sendHeroPlayerCommand|loadHeroVideo/);
});

test("watch player is constrained for both inline and modal layouts", () => {
  const css = read("../styles/vivid-media-layout.css");
  assert.match(css, /\.vivid-player-overlay\.vivid-player-inline \.vivid-player-dialog/);
  assert.match(css, /\.vivid-player-overlay:not\(\.vivid-player-inline\) \.vivid-player-dialog/);
  assert.match(css, /calc\(177\.78dvh - 250px\)/);
  assert.match(css, /\.vivid-player-frame/);
  assert.match(css, /\.flickv4-player-frame/);
});

test("canonical layout is loaded app-wide and refreshed by the service worker", () => {
  const appShell = read("../scripts/app-shell.js");
  const serviceWorker = read("../service-worker.js");
  const landing = read("../index.html");
  assert.match(appShell, /vivid-media-layout\.css\?v=1/);
  assert.match(serviceWorker, /const CACHE_NAME = "vivid-cinema-shell-v\d+";/);
  assert.match(serviceWorker, /vivid-media-layout\.css\?v=1/);
  assert.match(landing, /vivid-media-layout\.css\?v=1/);
});

test("obsolete appended media override blocks are removed", () => {
  assert.doesNotMatch(read("../styles/vivid-home.css"), /Home hero: preserve the whole trailer/);
  assert.doesNotMatch(read("../styles/vivid-liquid-glass.css"), /MEDIA CONTAINMENT — artwork/);
  assert.doesNotMatch(read("../styles/vivid-watch-polish.css"), /Inline playback must size to the viewport/);
});


test("primary watch player uses its own responsive server rail", () => {
  const css = read("../styles/vivid-watch.css");
  const watch = read("../scripts/watch.js");
  assert.match(css, /\.vivid-player-layout\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(245px,300px\)/);
  assert.match(css, /@media\(max-width:860px\)/);
  assert.match(watch, /aria-label="Vivid Cinema playback servers"/);
  assert.match(watch, /serverPanel\?\.scrollIntoView/);
  assert.doesNotMatch(watch, /document\.body\.appendChild\(serverPanel\)/);
});
