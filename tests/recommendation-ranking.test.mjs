import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankIntentCandidates, collectIntentCandidates } from "../scripts/recommendations.js";

const recommendationsSource = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");

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

test("filtered recommendation requests guard results across account switches", () => {
  assert.match(recommendationsSource, /export async function getIntentRecommendations\(intent = \{\}, limit = 18\) \{\s*const ownerAtStart = currentProgressOwner\(\);/);
  assert.match(recommendationsSource, /const responses = await Promise\.allSettled\(calls\);\s*if \(currentProgressOwner\(\) !== ownerAtStart\) return \[\];/);
});

test("genre-constrained searches skip media types without a supported genre ID", () => {
  assert.match(recommendationsSource, /if \(intent\.genre && !genreId\) return \[\]/);
});

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

test("not-for-me feedback lowers similar-genre recommendations without excluding other genres", () => {
  const candidates = [
    candidate(1, { raw: { genre_ids: [35], original_language: "en", release_date: "2022-04-01" } }),
    candidate(2, { raw: { genre_ids: [18], original_language: "en", release_date: "2022-04-01" } })
  ];
  const ranked = rankIntentCandidates(candidates, {
    feedback: { "movie:99": { kind: "not_for_me", genre_ids: [35] } },
    limit: 2
  });
  assert.deepEqual(ranked.map(item => item.id), ["2", "1"]);
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


test("active movie playback progress lowers its ranking against an otherwise equal unseen title", () => {
  const candidates = [candidate(1), candidate(2)];
  const ranked = rankIntentCandidates(candidates, {
    progress: {
      "movie:1": { progress: 700, duration: 1000, percentage: 70, completed: false, updatedAt: 2 }
    },
    limit: 2
  });
  assert.deepEqual(ranked.map(item => item.id), ["2", "1"]);
});

test("completed movies receive a stronger playback penalty than unseen titles", () => {
  const candidates = [candidate(1), candidate(2)];
  const ranked = rankIntentCandidates(candidates, {
    progress: {
      "movie:1": { progress: 1000, duration: 1000, percentage: 100, completed: true, updatedAt: 2 }
    },
    limit: 2
  });
  assert.deepEqual(ranked.map(item => item.id), ["2", "1"]);
});

test("unfinished TV episode progress is applied to the parent series recommendation", () => {
  const candidates = [
    candidate(1, { media_type: "tv", raw: { genre_ids: [35], original_language: "en", first_air_date: "2022-04-01" } }),
    candidate(2, { media_type: "tv", raw: { genre_ids: [35], original_language: "en", first_air_date: "2022-04-01" } })
  ];
  const ranked = rankIntentCandidates(candidates, {
    progress: {
      "tv:1:1:3": { progress: 800, duration: 1000, percentage: 80, completed: false, updatedAt: 2 }
    },
    limit: 2
  });
  assert.deepEqual(ranked.map(item => item.id), ["2", "1"]);
});


test("recent repeated impressions receive a meaningful but bounded rotation penalty", async () => {
  const { scoreRecommendationExposure } = await import("../scripts/recommendations.js");
  const now = 1_800_000_000_000;
  const unseen = scoreRecommendationExposure(null, now);
  const seen = scoreRecommendationExposure({ impressions: 5, clicks: 0, lastSeen: now }, now);
  assert.equal(unseen.seenPenalty, 0);
  assert.ok(seen.seenPenalty >= 4);
  assert.ok(seen.seenPenalty <= 5);
  assert.equal(seen.clickRecovery, 0);
});

test("exposure penalty fades over time and clicks soften but do not erase repetition", async () => {
  const { scoreRecommendationExposure } = await import("../scripts/recommendations.js");
  const now = 1_800_000_000_000;
  const recent = scoreRecommendationExposure({ impressions: 5, clicks: 0, lastSeen: now }, now);
  const old = scoreRecommendationExposure({ impressions: 5, clicks: 0, lastSeen: now - 42 * 86400000 }, now);
  const clicked = scoreRecommendationExposure({ impressions: 5, clicks: 1, lastSeen: now }, now);
  assert.ok(old.seenPenalty < recent.seenPenalty);
  assert.ok(clicked.clickRecovery > 0);
  assert.ok(clicked.clickRecovery < clicked.seenPenalty);
});


test("available cast and director metadata contributes to a bounded taste match", () => {
  const candidates = [
    candidate(11, { raw: { genre_ids: [], original_language: "en", release_date: "2022-01-01", credits: { cast: [{ id: 700 }], crew: [{ id: 900, job: "Director" }] } } }),
    candidate(12, { raw: { genre_ids: [], original_language: "en", release_date: "2022-01-01", credits: { cast: [{ id: 701 }], crew: [{ id: 901, job: "Director" }] } } })
  ];
  const ranked = rankIntentCandidates(candidates, {
    taste: { actors: { "700": 3 }, directors: { "900": 3 } },
    limit: 2
  });
  assert.equal(ranked[0].id, "11");
  assert.equal(ranked[0].recommendationReason, "Because you like this cast");
});

test("personalized ranking cache versions its score and includes the requested result limit", () => {
  assert.match(recommendationsSource, /"rankingVersion:4"/);
  assert.match(recommendationsSource, /"limit:" \+ Math\.max\(1, Math\.min\(40, Number\(limit\) \|\| 12\)\)/);
  assert.match(recommendationsSource, /cached\?\.version === 4/);
  assert.match(recommendationsSource, /writeForYouCache\(\{ version: 4, fingerprint, updatedAt: Date\.now\(\), items \}\)/);
});
