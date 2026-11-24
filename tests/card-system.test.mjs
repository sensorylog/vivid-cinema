import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("poster card contract is shared by home, search, recommendations, library and collections", () => {
  const css = read("../styles/vivid-rounded-cards.css");
  assert.match(css, /\.vivid-card--poster/);
  for (const path of [
    "../script.js",
    "../scripts/search-page.js",
    "../scripts/for-you.js",
    "../scripts/library-page.js",
    "../scripts/collection.js",
    "../scripts/discover.js",
    "../scripts/watch.js",
    "../scripts/title.js"
  ]) {
    assert.match(read(path), /vivid-card--poster/, path + " must use the shared poster card contract");
  }
  assert.match(read("../scripts/search-page.js"), /item\.media_type === "person" \? "" : " vivid-card--poster"/);
});

test("hero cards keep a separate full-bleed presentation contract", () => {
  const css = read("../styles/vivid-rounded-cards.css");
  assert.match(css, /\.vivid-card--hero/);
  assert.match(read("../home.html"), /hero-slide vivid-card--hero/);
  assert.match(read("../scripts/tflix-hero.js"), /hero-slide vivid-card--hero/);
});

test("community posts and news articles use their dedicated shared card contracts", () => {
  const css = read("../styles/vivid-rounded-cards.css");
  assert.match(css, /\.vivid-card--community/);
  assert.match(css, /\.vivid-card--news/);
  assert.match(read("../scripts/news-community.js"), /vivid-card--community/);
  assert.match(read("../scripts/news.js"), /vivid-card--news/);
  assert.match(read("../scripts/news.js"), /vivid-news-search-card vivid-card--poster/);
  assert.match(read("../community.html"), /vivid-rounded-cards\.css/);
  assert.match(read("../news.html"), /vivid-rounded-cards\.css/);
});

test("shared card motion respects reduced-motion and remains available offline", () => {
  const css = read("../styles/vivid-rounded-cards.css");
  const worker = read("../service-worker.js");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.ok(worker.includes('"./styles/vivid-rounded-cards.css?v=round-1"'));
  assert.match(worker, /vivid-cinema-shell-v304/);
});
