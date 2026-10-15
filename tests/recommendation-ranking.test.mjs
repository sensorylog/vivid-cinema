import test from "node:test";
import assert from "node:assert/strict";
import { rankIntentCandidates, collectIntentCandidates } from "../scripts/recommendations.js";

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

test("intent result collection throws when every catalogue request fails", () => {
  const failure = new Error("TMDB unavailable");
  assert.throws(
    () => collectIntentCandidates([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: new Error("timeout") }
    ]),
    error => error === failure
  );
});

test("intent result collection keeps partial successes when one catalogue request fails", () => {
  const results = [{ id: "movie-1" }, { id: "movie-2" }];
  assert.deepEqual(collectIntentCandidates([
    { status: "fulfilled", value: results },
    { status: "rejected", reason: new Error("TV catalogue unavailable") }
  ]), results);
});

test("intent result collection reports partial failure when the only successful request is empty", () => {
  const failure = new Error("TV catalogue unavailable");
  assert.throws(
    () => collectIntentCandidates([
      { status: "fulfilled", value: [] },
      { status: "rejected", reason: failure }
    ]),
    error => error === failure
  );
});

test("intent result collection treats successful empty responses as no matches", () => {
  assert.deepEqual(collectIntentCandidates([
    { status: "fulfilled", value: [] },
    { status: "fulfilled", value: [] }
  ]), []);
});
