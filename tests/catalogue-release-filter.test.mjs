import test from "node:test";
import assert from "node:assert/strict";
import { isReleasedMedia, normalizeResults } from "../scripts/media.js";

test("movie catalogue filtering excludes future release dates", () => {
  assert.equal(isReleasedMedia({ media_type: "movie", release_date: "2026-10-21" }, "2026-10-20"), false);
  assert.equal(isReleasedMedia({ media_type: "movie", release_date: "2026-10-20" }, "2026-10-20"), true);
  assert.equal(isReleasedMedia({ media_type: "movie", release_date: "2020-05-01" }, "2026-10-20"), true);
});

test("TV catalogue filtering uses first air date and excludes unaired series", () => {
  assert.equal(isReleasedMedia({ media_type: "tv", first_air_date: "2026-12-01" }, "2026-10-20"), false);
  assert.equal(isReleasedMedia({ media_type: "tv", first_air_date: "2026-10-20" }, "2026-10-20"), true);
});

test("normalization applies the release gate to all catalogue result batches", () => {
  const results = normalizeResults([
    { id: 1, title: "Released movie", release_date: "2020-01-01" },
    { id: 2, title: "Future movie", release_date: "2999-01-01" },
    { id: 3, name: "Future series", first_air_date: "2999-01-01" },
    { id: 4, title: "Legacy metadata without date" }
  ], "movie");

  assert.deepEqual(results.map(item => item.id), ["1", "4"]);
});

test("missing and malformed release dates remain visible for backwards compatibility", () => {
  assert.equal(isReleasedMedia({ id: 1, title: "Undated" }, "2026-10-20"), true);
  assert.equal(isReleasedMedia({ id: 2, title: "Malformed", release_date: "TBA" }, "2026-10-20"), true);
});
