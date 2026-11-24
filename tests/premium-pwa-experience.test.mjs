import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("premium PWA shell keeps all seven mobile destinations", () => {
  const shell = read("../scripts/app-shell.js");
  const mobileNav = shell.slice(shell.indexOf("function syncMobileNavigation()"), shell.indexOf("function syncNavigation()"));
  assert.match(mobileNav, /navLink\("home\.html".*?"Home"/s);
  assert.match(mobileNav, /navLink\("discover\.html".*?"Browse"/s);
  assert.match(mobileNav, /navLink\("for-you\.html".*?"For You"/s);
  assert.match(mobileNav, /navLink\("live\.html".*?"Live"/s);
  assert.match(mobileNav, /navLink\("library\.html".*?"Library"/s);
  assert.match(mobileNav, /navLink\("news\.html".*?"News"/s);
  assert.match(mobileNav, /navLink\("search\.html".*?"Search"/s);
  assert.ok(mobileNav.includes(`.join("")`));
});

test("premium PWA experience styles are loaded globally and respect reduced motion", () => {
  const shell = read("../scripts/app-shell.js");
  const worker = read("../service-worker.js");
  const css = read("../styles/vivid-premium-experience.css");
  assert.match(shell, /vivid-premium-experience\.css\?v=2/);
  assert.match(shell, /vivid-app-experience/);
  assert.match(worker, /vivid-cinema-shell-v\d+/);
  assert.match(worker, /vivid-premium-experience\.css\?v=2/);
  assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto;/);
  assert.match(css, /grid-template-columns:\s*repeat\(7/);
  assert.match(css, /aria-current="page"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});


test("installed iOS PWA gets a standalone app shell and safe-area-aware content", () => {
  const shell = read("../scripts/app-shell.js");
  const worker = read("../service-worker.js");
  const css = read("../styles/vivid-premium-experience.css");
  assert.match(shell, /function setStandaloneExperience\(\)/);
  assert.match(shell, /display-mode:\s*standalone/);
  assert.match(shell, /vivid-ios-standalone/);
  assert.match(shell, /apple-mobile-web-app-status-bar-style/);
  assert.match(shell, /vivid-premium-experience\.css\?v=2/);
  assert.match(worker, /vivid-cinema-shell-v\d+/);
  assert.match(worker, /vivid-premium-experience\.css\?v=2/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /overscroll-behavior-y:\s*contain/);
});


test("installed iOS PWA supports an edge-swipe back gesture without hijacking players", () => {
  const shell = read("../scripts/app-shell.js");
  const css = read("../styles/vivid-premium-experience.css");
  assert.match(shell, /function initStandaloneBackGesture\(\)/);
  assert.match(shell, /touchstart/);
  assert.match(shell, /touchend/);
  assert.match(shell, /touch.clientX > 22/);
  assert.match(shell, /dx < 112/);
  assert.match(shell, /video, iframe/);
  assert.match(shell, /history.back\(\)/);
  assert.match(css, /touch-action:\s*manipulation/);
});


test("canonical design tokens are available to the app shell and public landing page", () => {
  const shell = read("../scripts/app-shell.js");
  const worker = read("../service-worker.js");
  const landing = read("../index.html");
  const tokenFiles = ["tokens", "typography", "spacing", "motion", "theme"];
  for (const name of tokenFiles) {
    assert.ok(shell.includes(`"./styles/${name}.css?v=1"`));
    assert.ok(shell.includes("link.dataset.vividDesignSystem = name"));
    assert.ok(worker.includes(`styles/${name}.css?v=1`));
    assert.ok(landing.includes(`styles/${name}.css?v=1`));
    assert.ok(landing.includes(`data-vivid-design-system="${name}"`));
    assert.ok(read(`../styles/${name}.css`).length > 100);
  }
  assert.match(worker, /vivid-cinema-shell-v301/);
});

test("design tokens define restrained cinematic surfaces, type, spacing and reduced motion", () => {
  const tokens = read("../styles/tokens.css");
  const typography = read("../styles/typography.css");
  const spacing = read("../styles/spacing.css");
  const motion = read("../styles/motion.css");
  const theme = read("../styles/theme.css");
  assert.match(tokens, /--vivid-color-background/);
  assert.match(tokens, /--vivid-color-surface-3/);
  assert.match(tokens, /--vivid-color-accent/);
  assert.match(typography, /--vivid-type-display/);
  assert.match(typography, /--vivid-type-page-title/);
  for (const value of ["4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px", "96px"]) {
    assert.ok(spacing.includes(value), `spacing scale is missing ${value}`);
  }
  assert.match(motion, /prefers-reduced-motion:\s*reduce/);
  assert.match(theme, /data-vivid-theme="light"/);
});
