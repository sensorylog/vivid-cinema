import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("TFLIX-style trending billboard is restored above the unchanged featured-card strip", () => {
  const home = read("../home.html");
  assert.doesNotMatch(home, /vivid-qr-share|QR code to visit Vivid Cinema|Scan to visit Vivid Cinema/i, "home no longer exposes the QR scan-to-visit feature");
  assert.match(home, /<section id="hero" class="empty" aria-label="Trending today"/);
  assert.match(home, /<div class="vivid-feature-strip">/);
  assert.match(home, /<div class="vivid-feature-track" id="feature-track" aria-label="Featured titles carousel"><\/div>/);
  assert.ok(home.indexOf('<section id="hero"') < home.indexOf('<div class="vivid-feature-strip">'));
  const homeCss = read("../styles/vivid-home.css");
  const stripCss = homeCss.slice(homeCss.indexOf("/* Featured titles sit immediately after"), homeCss.indexOf("/* Home catalogue:"));
  assert.match(stripCss, /margin:0 auto!important/);
  assert.doesNotMatch(stripCss, /margin:-\d+px/, "featured strip must not overlap the hero");
  assert.match(home, /vivid-tflix-hero\.css/);
  assert.match(home, /scripts\/tflix-hero\.js/);
  assert.match(home, /fonts\.googleapis\.com/);

  const heroCss = read("../styles/vivid-tflix-hero.css");
  assert.match(heroCss, /--bg:\s*var\(--vivid-site-ink,\s*#07090d\)/);
  assert.match(heroCss, /--accent:\s*#f5f7fa/);
  assert.match(heroCss, /--accent-h:\s*#fff/);
  assert.doesNotMatch(heroCss, /#e50914|#ff222e|rgba\(229,\s*9,\s*20/i, "hero must keep Vivid's neutral palette");
  assert.match(heroCss, /env\(safe-area-inset-top, 0px\)/, "header must respect the iPhone notch/Dynamic Island safe area");
  assert.match(heroCss, /env\(safe-area-inset-bottom, 0px\)/, "hero actions must sit above the home indicator");
  assert.match(heroCss, /height: clamp\(520px, 74svh, 680px\)/, "mobile hero uses the small viewport-aware height");
  assert.match(heroCss, /transition: opacity 1\.1s/, "hero artwork cross-fades between titles");
  assert.match(heroCss, /animation: heroZoom 18s ease-out forwards/, "active hero artwork slowly zooms in");
  assert.ok(heroCss.includes("to { transform: scale(1.035); }"), "hero artwork uses a restrained push-in to avoid cropping faces");
  assert.doesNotMatch(heroCss, /margin-bottom:\s*-8vh/, "hero must not overlap the following content");

  const desktopCss = read("../styles/vivid-desktop.css");
  assert.doesNotMatch(desktopCss, /\.vivid-feature-strip\s*\{[^}]*margin:\s*-\d+px/is, "desktop featured strip must never overlap the hero");
  const parsedDesktopCss = stripComments(desktopCss);
  assert.match(parsedDesktopCss, /\.vivid-cinema-home\s+#hero\s*\{/, "desktop hero sizing must remain active outside comments");
  assert.match(parsedDesktopCss, /height:\s*min\(820px,\s*88vh\)/, "desktop hero includes a viewport-height fallback for Safari");

  const shellCss = read("../styles/vivid-shell.css");
  assert.match(shellCss, /var\(--vivid-safe-left,0px\)/, "shared header includes left safe-area inset");
  assert.match(shellCss, /var\(--vivid-safe-right,0px\)/, "shared header includes right safe-area inset");
  assert.match(heroCss, /vivid-topbar \.vivid-nav-action[\s\S]*?display: inline-flex !important/, "mobile sign-in remains a readable text action instead of a clipped icon box");

  const watchPolish = read("../styles/vivid-watch-polish.css");
  assert.match(watchPolish, /orientation:\s*landscape\) and \(min-height:\s*521px\)/, "landscape playback is height-aware on desktop");
  assert.match(watchPolish, /177\.78dvh - 284px/, "desktop player width accounts for its header and footer");
  assert.match(watchPolish, /177\.78dvh - 200px/, "short landscape player fits its controls and safe frame");
  assert.match(watchPolish, /aspect-ratio:\s*16\s*\/\s*9/, "player preserves a 16:9 frame");
  assert.match(read("../watch.html"), /vivid-watch-polish\.css\?v=cinema-watch-1/, "watch page uses the current responsive playback styles");

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

test("TFLIX-style hero uses TMDB stills, plays listed trailers, and routes to Vivid title details", () => {
  const js = read("../scripts/tflix-hero.js");
  assert.match(js, /tmdbApi\.trending\("all",\s*"day",\s*1\)/);
  assert.match(js, /getImageUrl\(item\.backdrop_path,\s*"w1280"\)/);
  assert.match(js, /getMediaUrl\(item\)/);
  assert.match(js, /TRAILER_WINDOW_MS = 30000/);
  assert.match(js, /aria-hidden", "true"/);
  assert.match(js, /\.inert = true/);
  assert.match(js, /tmdbApi\.trending\("movie", "day", 1\)/, "a cached fallback feed is available");
  assert.doesNotMatch(js, /cache:\s*false/, "hero trending requests should use the shared TMDB cache");
  assert.match(js, /slide\.inert = index !== 0/);
  assert.match(js, /window\.vividCinemaSelectHero = selectHeroItem/);
  assert.match(js, /new CustomEvent\("vivid:hero-change"/);
  assert.match(js, /trending_rank/);
  assert.match(js, /Featured on Vivid/);

  const api = read("../scripts/tmdb.js");
  assert.match(api, /trending: \(mediaType = "all", timeWindow = "week", page = 1, options = \{\}\) => tmdb\("trending\/" \+ mediaType \+ "\/" \+ timeWindow, \{ page \}, options\)/);
  assert.match(js, /youtube-nocookie\.com\/embed/, "the active hero may play a listed trailer inline");
  assert.match(js, /hero-trailer-layer/, "trailer playback stays inside the hero layer");

  const homeScript = read("../script.js");
  assert.match(homeScript, /function renderFeatureStrip\(\)/);
  assert.match(homeScript, /async function initFeatureStrip\(\)/);
  assert.match(homeScript, /initFeatureStrip\(\);void loadHome\(\)/);
  assert.match(homeScript, /window\.vividCinemaSelectHero/);
  assert.match(homeScript, /addEventListener\("vivid:hero-change"/);
});

test("service worker shell cache includes the new hero assets", () => {
  const sw = read("../service-worker.js");
  const home = read("../home.html");
  assert.match(sw, /const CACHE_NAME = "vivid-cinema-shell-v\d+";/);
  assert.match(sw, /\.\/styles\/vivid-tflix-hero\.css/);
  assert.match(sw, /\.\/styles\/vivid-tflix-hero\.css\?v=hero-trailer-full-bleed-1/);
  assert.match(home, /vivid-tflix-hero\.css\?v=hero-trailer-full-bleed-1/);
  assert.match(sw, /\.\/scripts\/tflix-hero\.js\?v=hero-trailer-autoplay-2/);
  assert.match(home, /vivid-apple-tv-mobile\.css\?v=apple-tv-mobile-2/);
  assert.match(sw, /\.\/styles\/vivid-apple-tv-mobile\.css\?v=apple-tv-mobile-2/);
  const mobileCss = stripComments(read("../styles/vivid-apple-tv-mobile.css"));
  assert.match(mobileCss, /max-width: 640px/);
  assert.match(mobileCss, /scroll-snap-type: x proximity/);
  assert.match(mobileCss, /safe-area-inset-bottom, 0px/);
  assert.match(mobileCss, /prefers-reduced-motion: reduce/);
});


test("mobile Home v2 has an immersive billboard and connected full-bleed shelves", () => {
  const mobileCss = stripComments(read("../styles/vivid-apple-tv-mobile.css"));
  assert.match(mobileCss, /height: clamp\(610px, 82svh, 790px\) !important/);
  assert.match(mobileCss, /margin: -100px 0 0 !important/);
  assert.match(mobileCss, /backdrop-filter: blur\(22px\)/);
  assert.match(mobileCss, /linear-gradient\(0deg, #050608 0%/);
  assert.match(mobileCss, /scroll-snap-type: x mandatory/);
  assert.match(mobileCss, /vivid-rails \+ \.vivid-rails::before/);
  assert.match(mobileCss, /vivid-continue-card \.vivid-card-media/);
  assert.match(read("../home.html"), /vivid-apple-tv-mobile\.css\?v=apple-tv-mobile-2/);
  assert.match(read("../service-worker.js"), /vivid-cinema-shell-v\d+/);
});


test("Vivid typography uses real bold weights consistently across the shared design system", () => {
  const systemCss = stripComments(read("../styles/vivid-system.css"));
  assert.match(systemCss, /font-weight:\s*700\s*!important/);
  assert.match(systemCss, /font-weight:\s*800\s*!important/);
  assert.match(systemCss, /font-synthesis:\s*weight/);
  assert.match(read("../service-worker.js"), /vivid-cinema-shell-v\d+/);
});


test("mascot video retries muted inline autoplay when ready and visible", () => {
  const home = read("../home.html");
  const autoplay = read("../scripts/mascot-autoplay.js");
  assert.match(home, /class="vivid-mascot-video" autoplay muted loop playsinline preload="auto"/);
  assert.match(home, /assets\/videos\/vivid-mascot\.MP4/);
  assert.match(home, /scripts\/mascot-autoplay\.js\?v=1/);
  assert.match(autoplay, /video\.play\(\)/);
  assert.match(autoplay, /IntersectionObserver/);
  assert.match(autoplay, /visibilitychange/);
  assert.match(read("../service-worker.js"), /vivid-cinema-shell-v\d+/);
  assert.match(read("../service-worker.js"), /scripts\/mascot-autoplay\.js\?v=1/);
});


test("Home loads the current audit stylesheet once, without a duplicate cache-busting request", () => {
  const home = read("../home.html");
  const references = [...home.matchAll(/<link\b[^>]*href=["']([^"']*vivid-audit-fixes\.css(?:\?[^"']*)?)["'][^>]*>/g)]
    .map((match) => match[1]);
  assert.deepEqual(references, ["styles/vivid-audit-fixes.css?v=editorial-v2"]);
});
