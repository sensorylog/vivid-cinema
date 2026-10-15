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

test("genres absent from the TV catalogue are not sent as invalid TV genre IDs", () => {
  for (const phrase of ["horror series", "romance series", "historical series"]) {
    const intent = parseIntent(phrase);
    assert.equal(intent.mediaType, "tv");
    assert.equal(intent.genre.tvId, null, phrase + " should not use a movie-only genre ID");
    assert.ok(intent.unsupported.some(value => value.startsWith("Catalogue limitation:")), phrase + " should disclose the missing TV filter");
  }
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


test("plural genre words are parsed for natural catalogue queries", () => {
  const thrillers = parseIntent("Korean thrillers from 2020");
  assert.equal(thrillers.genre.key, "thriller");
  assert.equal(thrillers.language, "ko");
  assert.equal(thrillers.year, 2020);

  const comedies = parseIntent("funny comedies from 1998");
  assert.equal(comedies.genre.key, "comedy");
  assert.equal(comedies.year, 1998);

  const mysteries = parseIntent("mysteries series");
  assert.equal(mysteries.genre.key, "mystery");
});


test("parses decades as date ranges instead of mistaking them for single years", () => {
  const short = parseIntent("90s thrillers");
  assert.equal(short.decade, 1990);
  assert.equal(short.year, null);
  assert.equal(short.genre.key, "thriller");

  const long = parseIntent("movies from the 1990s");
  assert.equal(long.mediaType, "movie");
  assert.equal(long.decade, 1990);

  const recent = parseIntent("2020s TV shows");
  assert.equal(recent.mediaType, "tv");
  assert.equal(recent.decade, 2020);
});

test("parses production-country queries for African and international catalogues", () => {
  assert.equal(parseIntent("Nigerian movies").country, "NG");
  assert.equal(parseIntent("Ghanaian films").country, "GH");
  assert.equal(parseIntent("British crime series").country, "GB");
  assert.equal(parseIntent("South Korean thrillers").country, "KR");
});

test("recognizes supported streaming providers but does not apply provider filters to a specific title search", () => {
  const collection = parseIntent("movies on Netflix");
  assert.deepEqual(collection.provider, { id: 8, name: "Netflix" });
  assert.equal(collection.providerOnly, true);
  assert.equal(intentHasFilters(collection), true);
  assert.ok(collection.unsupported.some(value => value.includes("region-specific")));

  const title = parseIntent("Inception on Netflix");
  assert.equal(title.providerOnly, false);
  assert.equal(intentHasFilters(title), false);
  assert.equal(intentHasFilters(parseIntent("Inception movie on Netflix")), false);
  assert.equal(intentHasFilters(parseIntent("horror movies on Netflix")), true);
  assert.ok(title.unsupported.some(value => value.includes("specific-title")));

  assert.equal(parseIntent("Disney Plus movies").provider.id, 337);
  assert.equal(parseIntent("Prime Video series").provider.id, 9);
});
