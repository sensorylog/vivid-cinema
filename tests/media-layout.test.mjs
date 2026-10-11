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

test("home YouTube viewport is centered and constrained to a landscape frame", () => {
  const css = read("../styles/vivid-media-layout.css");
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9\s*!important/);
  assert.match(css, /width:\s*min\(100%,\s*177\.78svh\)/);
  assert.match(css, /height:\s*min\(100%,\s*56\.25vw\)/);
  assert.match(css, /translate\(-50%,\s*-50%\)/);
  assert.match(css, /background-size:\s*contain\s*!important/);
  assert.match(css, /height: 100svh !important/);
});

test("home trailer requests muted autoplay and preserves the user's sound choice", () => {
  const js = read("../script.js");
  assert.match(js, /autoplay:\s*"1",\s*mute:\s*"1"/);
  assert.match(js, /iframe\.src=youtubeUrl\(trailer\.key\)/);
  assert.match(js, /if\(!heroMuted\)sendHeroPlayerCommand\("unMute"\)/);
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
  assert.match(serviceWorker, /vivid-cinema-shell-v139/);
  assert.match(serviceWorker, /vivid-media-layout\.css\?v=1/);
  assert.match(landing, /vivid-media-layout\.css\?v=1/);
});

test("obsolete appended media override blocks are removed", () => {
  assert.doesNotMatch(read("../styles/vivid-home.css"), /Home hero: preserve the whole trailer/);
  assert.doesNotMatch(read("../styles/vivid-liquid-glass.css"), /MEDIA CONTAINMENT — artwork/);
  assert.doesNotMatch(read("../styles/vivid-watch-polish.css"), /Inline playback must size to the viewport/);
});
