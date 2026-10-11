import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("home hero and embedded trailer are removed while the featured-card strip remains", () => {
  const home = read("../home.html");
  assert.doesNotMatch(home, /class="vivid-hero"/);
  assert.doesNotMatch(home, /id="hero-(?:video|fallback|title|meta|copy|watch|more|prev|next|sound|pause)"/);
  assert.doesNotMatch(home, /youtube\.com|ytimg\.com/);
  assert.match(home, /<div class="vivid-feature-strip">/);
  const cinematicCss = read("../styles/vivid-cinematic.css").replace(/\/\*[\\s\\S]*?\\*\//g, "");
  const homeCss = read("../styles/vivid-home.css").replace(/\/\*[\\s\\S]*?\\*\//g, "");
  const mediaCss = read("../styles/vivid-media-layout.css").replace(/\/\*[\\s\\S]*?\\*\//g, "");
  assert.doesNotMatch(cinematicCss, /\\.vivid-hero(?:-[a-z0-9_-]+)?|#hero-[a-z0-9_-]+/i);
  assert.doesNotMatch(homeCss, /\\.vivid-hero(?:-[a-z0-9_-]+)?|#hero-[a-z0-9_-]+/i);
  assert.doesNotMatch(mediaCss, /\\.vivid-hero(?:-[a-z0-9_-]+)?|#hero-[a-z0-9_-]+/i);
  assert.match(home, /<div class="vivid-feature-track" id="feature-track" aria-label="Featured titles carousel"><\/div>/);
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
