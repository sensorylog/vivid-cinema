import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("premium PWA shell keeps five clear mobile destinations", () => {
  const shell = read("../scripts/app-shell.js");
  const mobileNav = shell.slice(shell.indexOf("function syncMobileNavigation()"), shell.indexOf("function syncNavigation()"));
  assert.match(mobileNav, /navLink\("home\.html".*?"Home"/s);
  assert.match(mobileNav, /navLink\("discover\.html".*?"Browse"/s);
  assert.match(mobileNav, /navLink\("for-you\.html".*?"For You"/s);
  assert.match(mobileNav, /navLink\("library\.html".*?"Library"/s);
  assert.match(mobileNav, /navLink\("search\.html".*?"Search"/s);
  assert.doesNotMatch(mobileNav, /navLink\("live\.html"|navLink\("news\.html"|navLink\("my-downloads\.html"/);
  assert.ok(mobileNav.includes(`.join("")`));
});

test("premium PWA experience styles are loaded globally and respect reduced motion", () => {
  const shell = read("../scripts/app-shell.js");
  const worker = read("../service-worker.js");
  const css = read("../styles/vivid-premium-experience.css");
  assert.match(shell, /vivid-premium-experience\.css\?v=1/);
  assert.match(shell, /vivid-app-experience/);
  assert.match(worker, /vivid-cinema-shell-v266/);
  assert.match(worker, /vivid-premium-experience\.css\?v=1/);
  assert.match(css, /@view-transition\s*\{\s*navigation:\s*auto;/);
  assert.match(css, /grid-template-columns:\s*repeat\(5/);
  assert.match(css, /aria-current="page"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
