import test from "node:test";
import assert from "node:assert/strict";
import { buildPlotKeywordQueries, isPlotDescriptionQuery, scorePlotCandidate } from "../scripts/plot-search.js";

test("detects remembered plot descriptions but not ordinary structured filters", () => {
  assert.equal(isPlotDescriptionQuery("I watched a movie where a man relives the same day"), true);
  assert.equal(isPlotDescriptionQuery("A funny movie under 2 hours"), false);
  assert.equal(isPlotDescriptionQuery("Korean thriller series"), false);
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

