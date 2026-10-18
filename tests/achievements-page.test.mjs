import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("account is a navigable profile hub and links to the dedicated achievement page", () => {
  const html = read("account.html");
  assert.match(html, /class="account-dashboard"/);
  assert.match(html, /class="account-rail-links"/);
  for (const section of ["profile-section", "preferences-section", "activity-section", "achievements-section", "security-section"]) {
    assert.match(html, new RegExp('href="#' + section + '"'));
  }
  assert.match(html, /href="achievements\.html"/);
  assert.doesNotMatch(html, /id="achievement-grid"/);
});

test("achievement destination has collection filters and an accessible detail dialog", () => {
  const html = read("achievements.html");
  assert.match(html, /id="achievement-gallery"/);
  assert.match(html, /data-achievement-filter="all"/);
  assert.match(html, /data-achievement-filter="earned"/);
  assert.match(html, /data-achievement-filter="locked"/);
  assert.match(html, /<dialog[^>]*id="achievement-detail-dialog"/);
  assert.match(html, /aria-labelledby="achievement-detail-title"/);
});

test("each catalog achievement has its own art treatment and gallery uses the live snapshot", () => {
  const css = read("styles/vivid-achievements-page.css");
  const ids = [...css.matchAll(/\.achievement-art\[data-achievement="([^"]+)"\]/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, 16);
  const js = read("scripts/achievements-page.js");
  assert.match(js, /getAchievementSnapshot/);
  assert.match(js, /vivid:achievements-changed/);
  assert.match(js, /showModal\(\)/);
});
