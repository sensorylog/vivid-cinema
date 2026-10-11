import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("TFLIX-style trending billboard is restored above the unchanged featured-card strip", () => {
  const home = read("../home.html");
  assert.match(home, /<section id="hero" class="empty" aria-label="Trending today"/);
  assert.match(home, /<div class="vivid-feature-strip">/);
  assert.match(home, /<div class="vivid-feature-track" id="feature-track" aria-label="Featured titles carousel"><\/div>/);
  assert.ok(home.indexOf('<section id="hero"') < home.indexOf('<div class="vivid-feature-strip">'));
  assert.match(home, /vivid-tflix-hero\.css/);
  assert.match(home, /scripts\/tflix-hero\.js/);
  assert.match(home, /fonts\.googleapis\.com/);

  const heroCss = read("../styles/vivid-tflix-hero.css");
  assert.match(heroCss, /--bg:\s*var\(--vivid-site-ink,\s*#07090d\)/);
  assert.match(heroCss, /--accent:\s*#f5f7fa/);
  assert.match(heroCss, /--accent-h:\s*#fff/);
  assert.doesNotMatch(heroCss, /#e50914|#ff222e|rgba\(229,\s*9,\s*20/i, "hero must keep Vivid's neutral palette");

  for (const path of [
    "../styles/vivid-cinematic.css",
    "../styles/vivid-atmosphere.css",
    "../styles/vivid-viewport.css",
    "../styles/vivid-home.css",
    "../styles/vivid-home-breathe.css",
    "../styles/vivid-desktop.css",
    "../styles/vivid-audit-fixes.css",
    "../styles/vivid-liquid-glass.css",
    "../styles/vivid-media-layout.css"
  ]) {
    const css = stripComments(read(path));
    assert.doesNotMatch(css, /\.vivid-hero(?:-[a-z0-9_-]+)?|#hero-(?:video|fallback|title|meta|copy|watch|more|prev|next|sound|pause)/i, path);
  }
});

test("TFLIX-style hero uses TMDB stills and routes to Vivid title details without embedding a trailer", () => {
  const js = read("../scripts/tflix-hero.js");
  assert.match(js, /tmdbApi\.trending\("all",\s*"day"\)/);
  assert.match(js, /getImageUrl\(item\.backdrop_path,\s*"original"\)/);
  assert.match(js, /getMediaUrl\(item\)/);
  assert.match(js, /startHeroTimer\(\)/);
  assert.match(js, /aria-hidden", "true"/);
  assert.match(js, /\.inert = true/);
  assert.match(js, /tmdbApi\.trending\("movie", "day"\)/, "a fallback feed is available");
  assert.doesNotMatch(js, /youtube\.com|ytimg\.com|iframe|HERO_TRAILER/i);

  const homeScript = read("../script.js");
  assert.match(homeScript, /function renderFeatureStrip\(\)/);
  assert.match(homeScript, /async function initFeatureStrip\(\)/);
  assert.match(homeScript, /initFeatureStrip\(\);void loadHome\(\)/);
});

test("service worker shell cache includes the new hero assets", () => {
  const sw = read("../service-worker.js");
  assert.match(sw, /const CACHE_NAME = "vivid-cinema-shell-v147";/);
  assert.match(sw, /\.\/styles\/vivid-tflix-hero\.css/);
  assert.match(sw, /\.\/scripts\/tflix-hero\.js/);
});
