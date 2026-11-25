import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cardItem } from "../scripts/movie-quick-actions.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("quick actions reuse the canonical library collections and never create a second store", async () => {
  const source = await read("../scripts/movie-quick-actions.js");
  assert.match(source, /data-collection="favorites"/);
  assert.match(source, /data-collection="watchLater"/);
  assert.match(source, /toggleLibraryItem\(collection, activeItem\)/);
  assert.match(source, /import\("\.\/library\.js"\)/);
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem)\(/);
});

test("quick actions are available from a long press and suppress the card's normal navigation", async () => {
  const source = await read("../scripts/movie-quick-actions.js");
  assert.match(source, /pointerdown/);
  assert.match(source, /HOLD_DELAY\s*=\s*520/);
  assert.match(source, /pointermove/);
  assert.match(source, /swipe|touchend|sheetStartY/i);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
});

test("card identity is read from existing home-card data and title URLs", () => {
  const article = {
    dataset: { id: "123", type: "tv", title: "Series" },
    matches: () => false,
    querySelector: () => null,
    getAttribute: () => "Series"
  };
  assert.deepEqual(cardItem(article), {
    id: "123", media_type: "tv", title: "Series", year: "", poster_path: "", backdrop_path: ""
  });
});

test("African Stories public routes show only the development gate", async () => {
  for (const path of ["../african-stories.html", "../african-stories-watch.html", "../african-stories-submit.html"]) {
    const html = await read(path);
    assert.match(html, /In Development/);
    assert.match(html, /full destination isn't open yet/);
    assert.doesNotMatch(html, /scripts\/african-stories\/(?:discovery|player|acquisition)\.js/);
    assert.doesNotMatch(html, /african-discovery-query|african-player-frame|african-submission-form/);
  }
});
