import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeSearchCatalogueResults } from "../scripts/content.js";
import { parseIntent } from "../scripts/intent-parser.js";
import {
  buildStructuredSearchParams,
  isStructuredSearchIntent,
  matchesStructuredSearchIntent,
  chooseSimilarityTarget,
  getSearchIntent,
  recentSearchStorageKey,
  getRecentSearchOwner
} from "../scripts/search.js";

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


test("structured search builds verified TMDB genre, language, year and type filters", () => {
  const intent = parseIntent("Korean thrillers from 2020");
  assert.equal(isStructuredSearchIntent(intent, intent.query), true);

  const movie = buildStructuredSearchParams(intent, "movie", 2);
  assert.equal(movie.with_genres, "53");
  assert.equal(movie.with_original_language, "ko");
  assert.equal(movie.primary_release_year, "2020");
  assert.equal(movie.page, 2);

  const tv = buildStructuredSearchParams(intent, "tv", 3);
  assert.equal(tv.with_genres, "9648");
  assert.equal(tv.with_original_language, "ko");
  assert.equal(tv.first_air_date_year, "2020");
  assert.equal(tv.page, 3);
});

test("structured search never broadens a genre unsupported by the TV catalogue", () => {
  const intent = parseIntent("horror movies");
  assert.equal(buildStructuredSearchParams(intent, "movie", 1).with_genres, "27");
  assert.equal(buildStructuredSearchParams(intent, "tv", 1), null);
});

test("type-only searches use discovery, but named text searches keep their text intent", () => {
  assert.equal(isStructuredSearchIntent(parseIntent("movies"), "movies"), true);
  assert.equal(isStructuredSearchIntent(parseIntent("TV shows"), "TV shows"), true);
  assert.equal(isStructuredSearchIntent(parseIntent("Christopher Nolan movies"), "Christopher Nolan movies"), false);
  assert.equal(isStructuredSearchIntent(parseIntent("movies like Inception"), "movies like Inception"), false);
});

test("structured text supplements must satisfy the requested genre, year and language", () => {
  const intent = parseIntent("Korean thrillers from 2020");
  const matching = {
    media_type: "movie",
    raw: { genre_ids: [53], original_language: "ko", release_date: "2020-08-01" }
  };
  const wrongGenre = {
    media_type: "movie",
    raw: { genre_ids: [35], original_language: "ko", release_date: "2020-08-01" }
  };
  const wrongYear = {
    media_type: "movie",
    raw: { genre_ids: [53], original_language: "ko", release_date: "2019-08-01" }
  };
  const wrongLanguage = {
    media_type: "movie",
    raw: { genre_ids: [53], original_language: "en", release_date: "2020-08-01" }
  };
  assert.equal(matchesStructuredSearchIntent(matching, intent), true);
  assert.equal(matchesStructuredSearchIntent(wrongGenre, intent), false);
  assert.equal(matchesStructuredSearchIntent(wrongYear, intent), false);
  assert.equal(matchesStructuredSearchIntent(wrongLanguage, intent), false);
});

test("intent-aware search combines structured discovery with verified text matches", () => {
  const source = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  assert.match(source, /tmdbApi\.discoverMovies\(params\)/);
  assert.match(source, /tmdbApi\.discoverTv\(params\)/);
  assert.match(source, /matchesStructuredSearchIntent\(item, parsed\)/);
  assert.match(source, /mergeSearchCatalogueResults\(\[discovered, relevantTextItems\]\)/);
});


test("search results disclose unsupported mood, subtitle, and provider constraints", () => {
  const source = readFileSync(new URL("../scripts/search-page.js", import.meta.url), "utf8");
  assert.match(source, /currentSearchNotes = result\.intent\?\.filters\?\.unsupported/);
  assert.match(source, /vivid-search-filter-note/);
  assert.match(source, /notes\.map\(note => '<li>' \+ escapeHtml\(note\)/);
});


test("explicit catalogue search never hides a title because of recommendation feedback", () => {
  const source = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getNotForMeKeys/);
  assert.doesNotMatch(source, /filter\(item => !notForMe\.has\(item\.content_id\)\)/);
});


test("similarity intent resolves a reference title instead of treating the whole phrase as a title search", () => {
  assert.equal(getSearchIntent("movies like Inception").similarity, "inception");
  assert.equal(getSearchIntent("TV shows similar to Breaking Bad").similarity, "breaking bad");
  assert.equal(getSearchIntent("I like Inception").similarity, "");
});

test("similarity target resolution prefers exact title matches and respects media type", () => {
  const items = [
    { id: "2", media_type: "tv", title: "Inception: The Series", raw: { original_name: "Inception: The Series", popularity: 100 } },
    { id: "1", media_type: "movie", title: "Inception", raw: { original_title: "Inception", popularity: 20 } },
    { id: "3", media_type: "movie", title: "Inception 2", raw: { original_title: "Inception 2", popularity: 500 } }
  ];
  assert.equal(chooseSimilarityTarget(items, "Inception", "movie").id, "1");
  assert.equal(chooseSimilarityTarget(items, "Inception", "tv").id, "2");
  assert.equal(chooseSimilarityTarget(items, "Inception").id, "1");
  assert.equal(chooseSimilarityTarget([
    { id: "99", media_type: "movie", title: "Unrelated Blockbuster", raw: { popularity: 9999 } }
  ], "an obscure misspelled title"), null);
});

test("similarity search calls the matching movie or TV catalogue endpoint and has a text fallback", () => {
  const source = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  assert.match(source, /tmdbApi\.movieSimilar\(target\.id, page\)/);
  assert.match(source, /tmdbApi\.tvSimilar\(target\.id, page\)/);
  assert.match(source, /searchContent\(searchIntent\.similarity, 1\)/);
  assert.match(source, /Fall through to the regular text-search results/);
});


test("similar-title results identify the resolved reference title in the results heading", () => {
  const pageSource = readFileSync(new URL("../scripts/search-page.js", import.meta.url), "utf8");
  assert.match(pageSource, /currentSimilarityTarget = result\.intent\?\.similarityTarget/);
  assert.match(pageSource, /SIMILAR TO/);
  assert.match(pageSource, /escapeHtml\(similarityTarget\.title\)/);
});


test("recent search storage is isolated by account and waits for auth ownership", () => {
  const source = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  assert.notEqual(recentSearchStorageKey("account-a"), recentSearchStorageKey("account-b"));
  assert.notEqual(recentSearchStorageKey("account-a"), recentSearchStorageKey(null));
  assert.equal(getRecentSearchOwner(), null, "history remains unavailable until auth ownership resolves in a non-browser test");
  assert.match(source, /vivid:search:recent:v2:/);
  assert.match(source, /recentSearchStorageKey\(recentSearchOwner\)/);
  assert.match(source, /recentSearchOwnerReady \? readRecent\(recentSearchOwner\) : \[\]/);
  assert.match(source, /vivid:auth-ready/);
  assert.match(source, /localStorage\.removeItem\(LEGACY_RECENT_KEY\)/);
  const page = readFileSync(new URL("../scripts/search-page.js", import.meta.url), "utf8");
  const home = readFileSync(new URL("../script.js", import.meta.url), "utf8");
  assert.match(page, /rememberSearch\(query, searchOwnerAtStart\)/);
  assert.match(home, /rememberSearch\(query,searchOwnerAtStart\)/);
  assert.match(page, /if \(changedOwner\)/);
  assert.match(home, /if \(changedOwner\)/);
  assert.doesNotMatch(source, /localStorage\.getItem\(RECENT_KEY\)/);
});
