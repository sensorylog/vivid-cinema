import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("home hero and embedded trailer are removed while the featured-card strip remains", () => {
  const home = read("../home.html");
  assert.doesNotMatch(home, /class="vivid-hero"/);
  assert.doesNotMatch(home, /id="hero-(?:video|fallback|title|meta|copy|watch|more|prev|next|sound|pause)"/);
  assert.doesNotMatch(home, /youtube\.com|ytimg\.com/);
  assert.match(home, /<div class="vivid-feature-strip">/);
  assert.match(home, /<div class="vivid-feature-track" id="feature-track" aria-label="Featured titles carousel"><\/div>/);
  for (const path of [
    "../styles/vivid-cinematic.css",
    "../styles/vivid-viewport.css",
    "../styles/vivid-home.css",
    "../styles/vivid-home-breathe.css",
    "../styles/vivid-desktop.css",
    "../styles/vivid-audit-fixes.css",
    "../styles/vivid-liquid-glass.css",
    "../styles/vivid-media-layout.css"
  ]) {
    const css = stripComments(read(path));
    assert.doesNotMatch(css, /\.vivid-hero(?:-[a-z0-9_-]+)?|#hero-[a-z0-9_-]+/i, path);
  }
});

test("home script loads the existing featured cards without trailer/player behavior", () => {
  const js = read("../script.js");
  assert.match(js, /function renderFeatureStrip\(\)/);
  assert.match(js, /async function initFeatureStrip\(\)/);
  assert.match(js, /initFeatureStrip\(\);void loadHome\(\)/);
  assert.doesNotMatch(js, /loadHeroVideo|sendHeroPlayerCommand|youtubeUrl|initHero\(|showHero\(|hero-video|hero-sound|hero-pause|wireHeroSwipe|HERO_TRAILER/);
});

test("service worker shell cache is bumped for the homepage shell change", () => {
  const sw = read("../service-worker.js");
  assert.match(sw, /const CACHE_NAME = "vivid-cinema-shell-v146";/);
});
