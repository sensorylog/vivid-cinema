import test from "node:test";
import assert from "node:assert/strict";
import { rankIntentCandidates } from "../scripts/recommendations.js";

function candidate(id, extra = {}) {
  return {
    id: String(id),
    media_type: "movie",
    title: "Comedy " + id,
    vote_average: 7.5,
    popularity: 80,
    raw: { genre_ids: [35], original_language: "en", release_date: "2022-04-01" },
    ...extra
  };
}

test("filtered ranking preserves a useful number of results in one requested genre", () => {
  const candidates = Array.from({ length: 8 }, (_, index) => candidate(index + 1));
  const ranked = rankIntentCandidates(candidates, {
    taste: { genres: { 35: 1 }, media: { movie: 1 } },
    limit: 12
  });
  assert.equal(ranked.length, 8);
});

test("explicit likes boost candidates and not-for-me exclusions are respected", () => {
  const candidates = [candidate(1), candidate(2), candidate(3)];
  const ranked = rankIntentCandidates(candidates, {
    taste: { genres: { 35: 1 }, media: { movie: 1 } },
    feedback: { "movie:2": { kind: "like" } },
    excluded: new Set(["movie:3"]),
    limit: 10
  });
  assert.equal(ranked[0].id, "2");
  assert.deepEqual(ranked.map(item => item.id).sort(), ["1", "2"]);
});

test("filtered ranking deduplicates typed title identities", () => {
  const ranked = rankIntentCandidates([candidate(7), candidate(7), candidate(8)], { limit: 10 });
  assert.equal(ranked.length, 2);
});
