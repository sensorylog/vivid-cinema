import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeSearchCatalogueResults } from "../scripts/content.js";

test("catalogue search merges multi-search and dedicated title indexes without duplicates", () => {
  const merged = mergeSearchCatalogueResults([
    [
      { id: "7", media_type: "movie", title: "Example", overview: "", poster_path: "" },
      { id: "8", media_type: "person", title: "Actor", poster_path: "/actor.jpg" }
    ],
    [
      { id: "7", media_type: "movie", title: "Example", overview: "A fuller plot summary.", poster_path: "/poster.jpg" }
    ],
    [{ id: "9", media_type: "tv", title: "Example Series", overview: "Series summary." }]
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged.filter(item => item.media_type === "movie" && item.id === "7").length, 1);
  assert.equal(merged.find(item => item.id === "7").overview, "A fuller plot summary.");
  assert.ok(merged.some(item => item.media_type === "person" && item.id === "8"));
  assert.ok(merged.some(item => item.media_type === "tv" && item.id === "9"));
});

test("catalogue search merge ignores invalid entries and keeps movie and TV identities separate", () => {
  const merged = mergeSearchCatalogueResults([[
    { id: "42", media_type: "movie", title: "Movie" },
    { id: "42", media_type: "tv", title: "Series" },
    { id: "43", media_type: "person", title: "Person" },
    { id: "", media_type: "movie", title: "Invalid" },
    { id: "44", media_type: "unknown", title: "Invalid type" }
  ]]);
  assert.deepEqual(merged.map(item => item.media_type + ":" + item.id), ["movie:42", "tv:42", "person:43"]);
});

test("search page requests can be paginated without changing catalogue identity rules", () => {
  const source = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  const pageSource = readFileSync(new URL("../scripts/search-page.js", import.meta.url), "utf8");
  assert.match(source, /searchContent\(q, page\)/);
  assert.match(pageSource, /data-search-load-more/);
  assert.match(pageSource, /currentPage \+ 1/);
  assert.match(pageSource, /item\.media_type \+ ":" \+ item\.id/);
});
