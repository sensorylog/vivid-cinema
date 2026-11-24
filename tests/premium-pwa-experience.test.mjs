import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("premium PWA shell keeps four direct mobile destinations and a More menu", () => {
  const shell = read("../scripts/app-shell.js");
  const mobileNav = shell.slice(shell.indexOf("function syncMobileNavigation()"), shell.indexOf("function syncNavigation()"));
  assert.ok(mobileNav.includes('navLink("home.html", "bi-house-fill", "Home"'));
  assert.ok(mobileNav.includes('navLink("collection.html?collection=movies", "bi-film", "Movies"'));
  assert.ok(mobileNav.includes('navLink("collection.html?collection=tv", "bi-tv", "Series"'));
  assert.ok(mobileNav.includes('navLink("live.html", "bi-broadcast-pin", "Live"'));
  assert.match(mobileNav, /data-vivid-more-navigation/);
  assert.equal((mobileNav.match(/navLink\(/g) || []).length, 4);
  assert.ok(mobileNav.includes(`.join("")`));
});

test("mobile navigation distributes all five destinations across the full bar", () => {
  const css = read("../styles/vivid-shell.css");
  assert.match(css, /\.vivid-mobile-nav\.vivid-v2-mobile-nav\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /justify-content:\s*stretch/);
  const glass = read("../styles/vivid-liquid-glass.css");
  assert.match(glass, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(glass, /\.vivid-mobile-nav :is\(a, button\)/);
  const premium = read("../styles/vivid-premium-experience.css");
  assert.match(premium, /grid-template-columns:\s*repeat\(5,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(premium, /grid-template-columns:\s*repeat\(7/);
  assert.match(premium, /:is\(a, button\)/);
  const appShell = read("../scripts/app-shell.js");
  const moreStart = appShell.indexOf("function syncMoreNavigation(");
  const moreEnd = appShell.indexOf("function syncMobileNavigation()", moreStart);
  const moreMenu = appShell.slice(moreStart, moreEnd);
  assert.match(moreMenu, /role", "menu"/);
  assert.match(moreMenu, /role", "menuitem"/);
  assert.match(moreMenu, /event.key === "ArrowDown"/);
  assert.match(moreMenu, /event.key === "Escape"/);
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
  assert.match(css, /grid-template-columns:\s*repeat\(5/);
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
  assert.ok(shell.includes('const styles = ["tokens", "typography", "spacing", "motion", "theme"]'));
  assert.ok(shell.includes("link.dataset.vividDesignSystem = name"));
  assert.ok(shell.includes("link.href = `./styles/${name}.css?v=1`"));
  for (const name of tokenFiles) {
    assert.ok(worker.includes(`styles/${name}.css?v=1`));
    assert.ok(landing.includes(`styles/${name}.css?v=1`));
    assert.ok(landing.includes(`data-vivid-design-system="${name}"`));
    assert.ok(read(`../styles/${name}.css`).length > 100);
  }
  assert.match(worker, /vivid-cinema-shell-v304/);
  assert.ok(worker.includes("vivid-rounded-cards.css?v=round-1"));
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
  assert.match(tokens, /--vivid-radius-lg/);
  assert.match(tokens, /--vivid-focus-ring/);
  assert.match(theme, /--vivid-theme-focus/);
  assert.match(typography, /--vivid-type-display/);
  assert.match(typography, /--vivid-type-page-title/);
  for (const value of ["4px", "8px", "12px", "16px", "24px", "32px", "48px", "64px", "96px"]) {
    assert.ok(spacing.includes(value), `spacing scale is missing ${value}`);
  }
  assert.match(motion, /prefers-reduced-motion:\s*reduce/);
  assert.match(theme, /data-vivid-theme="light"/);
});
