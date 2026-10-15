import test from "node:test";
import assert from "node:assert/strict";
import { parseIntent, intentHasFilters } from "../scripts/intent-parser.js";

test("parses a funny movie with a two-hour runtime cap", () => {
  const intent = parseIntent("A funny movie under 2 hours");
  assert.equal(intent.mediaType, "movie");
  assert.equal(intent.genre.key, "comedy");
  assert.equal(intent.runtimeMax, 120);
  assert.equal(intentHasFilters(intent), true);
  assert.ok(intent.constraints.includes("Movies"));
});

test("parses anime as Japanese-language animated TV and preserves an episode runtime cap", () => {
  const intent = parseIntent("Japanese anime under 25 minutes");
  assert.equal(intent.anime, true);
  assert.equal(intent.mediaType, "tv");
  assert.equal(intent.language, "ja");
  assert.equal(intent.genre.key, "animation");
  assert.equal(intent.runtimeMax, 25);
});

test("parses TV genre, language and release year", () => {
  const intent = parseIntent("Korean thriller series from 2022");
  assert.equal(intent.mediaType, "tv");
  assert.equal(intent.genre.key, "thriller");
  assert.equal(intent.language, "ko");
  assert.equal(intent.year, 2022);
});

test("parses a single year and supported language without inventing a mood", () => {
  const intent = parseIntent("French drama in 2019");
  assert.equal(intent.genre.key, "drama");
  assert.equal(intent.language, "fr");
  assert.equal(intent.year, 2019);
});

test("unsupported tone, subtitle and provider constraints are surfaced rather than silently applied", () => {
  const intent = parseIntent("A dark anime, dubbed, on Netflix");
  assert.equal(intent.anime, true);
  assert.ok(intent.unsupported.some(value => value.includes("theme")));
  assert.ok(intent.unsupported.some(value => value.includes("Dub/subtitle")));
  assert.ok(intent.unsupported.some(value => value.includes("Streaming availability")));
});

test("TV genre approximations are disclosed instead of labelled as exact matches", () => {
  const intent = parseIntent("Korean thriller series");
  assert.equal(intent.mediaType, "tv");
  assert.equal(intent.genre.tvLabel, "Mystery (closest TV category)");
  assert.ok(intent.unsupported.some(value => value.startsWith("Catalogue limitation:") && value.includes("no distinct TV Thriller")));
});

test("anime movie requests stay movies and preserve Japanese animation filters", () => {
  const intent = parseIntent("Japanese anime movie under 2 hours");
  assert.equal(intent.mediaType, "movie");
  assert.equal(intent.anime, true);
  assert.equal(intent.language, "ja");
  assert.equal(intent.genre.key, "animation");
  assert.equal(intent.runtimeMax, 120);
});

test("mixed-media runtime constraints distinguish movie runtime from episode runtime", () => {
  const intent = parseIntent("funny under 2 hours");
  assert.equal(intent.mediaType, "all");
  assert.ok(intent.constraints.some(value => value.includes("Movies up to 120 min; TV episodes up to 120 min")));
});

test("empty input stays a genuine cold-start request", () => {
  const intent = parseIntent("");
  assert.equal(intent.mediaType, "all");
  assert.equal(intent.genre, null);
  assert.equal(intent.runtimeMax, null);
  assert.equal(intentHasFilters(intent), false);
});
