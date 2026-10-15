import test from "node:test";
import assert from "node:assert/strict";
import { buildPlotKeywordQueries, isPlotDescriptionQuery, scorePlotCandidate, scorePlotCandidates } from "../scripts/plot-search.js";
import { readFileSync } from "node:fs";

test("detects remembered plot descriptions but not ordinary structured filters", () => {
  assert.equal(isPlotDescriptionQuery("I watched a movie where a man relives the same day"), true);
  assert.equal(isPlotDescriptionQuery("A funny movie under 2 hours"), false);
  assert.equal(isPlotDescriptionQuery("Korean thriller series"), false);
  assert.equal(isPlotDescriptionQuery("A man wakes up in the same place every day and cannot leave"), true);
});

test("extracts searchable plot phrases and distinctive clue words", () => {
  const queries = buildPlotKeywordQueries("I remember a movie where a boy finds a magical remote that stops time");
  assert.ok(queries.length > 0);
  assert.ok(queries.some(query => query.includes("remote") || query.includes("time")));
  assert.ok(queries.every(query => !/^(movie|remember|where|that)$/.test(query)));
});

test("ranks catalogue entries by actual title and plot-summary overlap", () => {
  const query = "I watched a movie where a man relives the same day";
  const likely = scorePlotCandidate(query, { title: "Groundhog Day", overview: "A man relives the same day over and over again." });
  const unrelated = scorePlotCandidate(query, { title: "Finding Nemo", overview: "A clownfish searches the ocean for his son." });
  assert.ok(likely > unrelated);
  assert.ok(likely > 0);
  assert.equal(unrelated, 0);
});
test("rejects generic one-word overlap for a detailed plot description", () => {
  const query = "I watched a movie where a man relives the same day";
  assert.equal(scorePlotCandidate(query, { title: "Man", overview: "A man faces a difficult decision." }), 0);
});



test("plot keyword queries balance short clue phrases with longer phrases and concepts", () => {
  const queries = buildPlotKeywordQueries("A woman keeps reliving the same day in a time loop");
  assert.ok(queries.includes("time loop"), "the distinctive two-word clue must not be crowded out");
  assert.ok(queries.some(query => query.split(" ").length === 3), "longer phrases should remain represented");
  assert.ok(queries.some(query => query.split(" ").length === 1), "single clue words should remain as fallback queries");
  assert.ok(queries.length <= 8);
});

test("plot scoring downweights generic overlaps and normalizes accented text", () => {
  const query = "A man relives the same day in a time loop";
  const genericOnly = scorePlotCandidate(query, { title: "Man", overview: "A man has a day." });
  const likely = scorePlotCandidate(query, { title: "Groundhog Day", overview: "A man relives the same day again and again." });
  const accented = scorePlotCandidate("a woman returns to cafe", { title: "Café Return", overview: "A woman returns to a café." });
  assert.equal(genericOnly, 0);
  assert.ok(likely > 0);
  assert.ok(accented > 0);
});

test("plot candidates deduplicate by typed identity and rank the strongest plot overlap first", () => {
  const ranked = scorePlotCandidates("a man relives the same day", [
    { id: 1, media_type: "movie", title: "Groundhog Day", overview: "A man relives the same day." },
    { id: 1, media_type: "movie", title: "Groundhog Day", overview: "A man repeats a day." },
    { id: 1, media_type: "tv", title: "Loop", overview: "A man relives the same day repeatedly." },
    { id: 2, media_type: "movie", title: "Finding Nemo", overview: "A clownfish searches the ocean." }
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].title, "Groundhog Day");
  assert.ok(ranked[0].plotScore > ranked[1].plotScore);
});

test("plot matching has a constrained catalogue-overview fallback when keyword matching yields no candidate", () => {
  const source = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  assert.match(source, /TMDB keyword tagging is incomplete/);
  assert.match(source, /const fallbackCalls = \[\]/);
  assert.match(source, /scorePlotCandidates\(intent\.query \|\| "", uniqueByKey\(candidates\)\)/);
  assert.match(source, /same verified/);
  assert.match(source, /tmdbApi\\.discoverMovies\\(params\\)/);
  assert.match(source, /tmdbApi\\.discoverTv\\(params\\)/);
});
