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
  parsePersonCreditIntent,
  choosePersonSearchResult,
  buildPersonCreditResults,
  getSearchIntent,
  recentSearchStorageKey,
  getRecentSearchOwner,
  parseWatchProviderIntent,
  findWatchProviderId
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
  assert.equal(movie.with_origin_country, "KR");
  assert.equal(movie.page, 2);

  const tv = buildStructuredSearchParams(intent, "tv", 3);
  assert.equal(tv.with_genres, "9648");
  assert.equal(tv.with_original_language, "ko");
  assert.equal(tv.first_air_date_year, "2020");
  assert.equal(tv.with_origin_country, "KR");
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
    raw: { genre_ids: [53], original_language: "ko", origin_country: ["KR"], release_date: "2020-08-01" }
  };
  const wrongGenre = {
    media_type: "movie",
    raw: { genre_ids: [35], original_language: "ko", origin_country: ["KR"], release_date: "2020-08-01" }
  };
  const wrongYear = {
    media_type: "movie",
    raw: { genre_ids: [53], original_language: "ko", origin_country: ["KR"], release_date: "2019-08-01" }
  };
  const wrongLanguage = {
    media_type: "movie",
    raw: { genre_ids: [53], original_language: "en", origin_country: ["KR"], release_date: "2020-08-01" }
  };
  assert.equal(matchesStructuredSearchIntent(matching, intent), true);
  assert.equal(matchesStructuredSearchIntent(wrongGenre, intent), false);
  assert.equal(matchesStructuredSearchIntent(wrongYear, intent), false);
  assert.equal(matchesStructuredSearchIntent(wrongLanguage, intent), false);
});


test("structured discovery applies inclusive decade and origin-country filters", () => {
  const intent = parseIntent("Nigerian movies from the 90s");
  assert.equal(intent.country, "NG");
  assert.equal(intent.decade, 1990);

  const movie = buildStructuredSearchParams(intent, "movie", 1);
  assert.equal(movie.with_origin_country, "NG");
  assert.equal(movie["primary_release_date.gte"], "1990-01-01");
  assert.equal(movie["primary_release_date.lte"], "1999-12-31");

  const tv = buildStructuredSearchParams(intent, "tv", 1);
  assert.equal(tv.with_origin_country, "NG");
  assert.equal(tv["first_air_date.gte"], "1990-01-01");
  assert.equal(tv["first_air_date.lte"], "1999-12-31");

  const matching = { media_type: "movie", raw: { origin_country: ["NG"], release_date: "1995-06-01" } };
  const wrongCountry = { media_type: "movie", raw: { origin_country: ["GH"], release_date: "1995-06-01" } };
  const wrongDecade = { media_type: "movie", raw: { origin_country: ["NG"], release_date: "2005-06-01" } };
  assert.equal(matchesStructuredSearchIntent(matching, intent), true);
  assert.equal(matchesStructuredSearchIntent(wrongCountry, intent), false);
  assert.equal(matchesStructuredSearchIntent(wrongDecade, intent), false);
});

test("intent-aware search combines structured discovery with verified text matches", () => {
  const source = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  assert.match(source, /tmdbApi\.discoverMovies\(params\)/);
  assert.match(source, /tmdbApi\.discoverTv\(params\)/);
  assert.match(source, /primary_release_date\.gte/);
  assert.match(source, /first_air_date\.gte/);
  assert.match(source, /matchesStructuredSearchIntent\(item, parsed\)/);
  assert.match(source, /mergeSearchCatalogueResults\(\[discovered, relevantTextItems\]\)/);
  const recommendations = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  assert.match(recommendations, /intent\.decade/);
  assert.match(recommendations, /intent\.country/);
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


test("person-credit intent recognizes explicit director, cast, writer and creator searches", () => {
  assert.deepEqual(parsePersonCreditIntent("movies directed by Christopher Nolan"), {
    personName: "Christopher Nolan",
    role: "director",
    mediaType: "movie",
    query: "movies directed by Christopher Nolan"
  });
  assert.equal(parsePersonCreditIntent("TV shows starring Pedro Pascal").role, "actor");
  assert.equal(parsePersonCreditIntent("written by Greta Gerwig").role, "writer");
  assert.equal(parsePersonCreditIntent("series created by Vince Gilligan").role, "creator");
  assert.equal(parsePersonCreditIntent("movies by Christopher Nolan").role, "director");
  assert.equal(parsePersonCreditIntent("Christopher Nolan movies"), null);
  assert.equal(parsePersonCreditIntent("with a twist"), null);
  assert.equal(parsePersonCreditIntent("movies with a twist"), null);
  assert.equal(parsePersonCreditIntent("movies by the sea"), null);
  assert.equal(parsePersonCreditIntent("by the sea"), null);
});

test("person search resolution prefers an exact name and the requested professional department", () => {
  const people = [
    { id: 11, media_type: "person", name: "Christopher Nolan", known_for_department: "Directing", popularity: 80 },
    { id: 12, media_type: "person", name: "Christopher Nolan Jr.", known_for_department: "Acting", popularity: 99 },
    { id: 14, name: "Christopher Nolan", known_for_department: "Directing", popularity: 40 },
    { id: 13, media_type: "movie", title: "Nolan" }
  ];
  assert.equal(choosePersonSearchResult(people, "Christopher Nolan", "director").id, 11);
  assert.equal(choosePersonSearchResult([{ id: 14, name: "Christopher Nolan", known_for_department: "Directing" }], "Christopher Nolan", "director").id, 14);
  assert.equal(choosePersonSearchResult(people, "not a real person", "director"), null);
});

test("person credits filter by job, media type and page without mixing cast with crew", () => {
  const details = {
    combined_credits: {
      cast: [
        { id: 1, media_type: "movie", title: "Actor Movie", release_date: "2022-01-01", popularity: 10 },
        { id: 2, media_type: "tv", name: "Actor Series", first_air_date: "2021-01-01", popularity: 20 }
      ],
      crew: [
        { id: 3, media_type: "movie", title: "Directed Film", release_date: "2020-01-01", job: "Director", popularity: 30 },
        { id: 4, media_type: "movie", title: "Written Film", release_date: "2019-01-01", job: "Writer", popularity: 25 },
        { id: 5, media_type: "tv", name: "Directed Series", first_air_date: "2018-01-01", job: "Director", popularity: 15 }
      ]
    }
  };
  const directors = buildPersonCreditResults(details, "director", "movie", 1, 12);
  assert.deepEqual(directors.map(item => item.title), ["Directed Film"]);

  const actorPage1 = buildPersonCreditResults(details, "actor", "all", 1, 1);
  const actorPage2 = buildPersonCreditResults(details, "actor", "all", 2, 1);
  assert.equal(actorPage1.length, 1);
  assert.equal(actorPage2.length, 1);
  assert.notEqual(actorPage1[0].id, actorPage2[0].id);
  assert.ok([actorPage1[0].media_type, actorPage2[0].media_type].includes("movie"));
  assert.ok([actorPage1[0].media_type, actorPage2[0].media_type].includes("tv"));
});

test("person-credit search uses TMDB people search and combined credits, and labels results", () => {
  const searchSource = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  const pageSource = readFileSync(new URL("../scripts/search-page.js", import.meta.url), "utf8");
  assert.match(searchSource, /tmdbApi\.searchPeople\(personIntent\.personName, 1\)/);
  assert.match(searchSource, /tmdbApi\.personDetails\(person\.id\)/);
  const tmdbSource = readFileSync(new URL("../scripts/tmdb.js", import.meta.url), "utf8");
  assert.match(tmdbSource, /searchPeople: \(query, page = 1\) => tmdb\("search\/person", \{ query, page \}\)/);
  assert.match(searchSource, /buildPersonCreditResults\(/);
  assert.match(pageSource, /personRoleLabels/);
  assert.match(pageSource, /currentPersonTarget = result\.intent\?\.personTarget/);
});


test("provider intent is explicit and resolves provider IDs from TMDB's regional list", () => {
  assert.equal(parseWatchProviderIntent("Korean horror movies on Netflix").key, "netflix");
  assert.equal(parseWatchProviderIntent("Netflix movies").name, "Netflix");
  assert.equal(parseWatchProviderIntent("movies like Netflix"), null);
  assert.equal(parseWatchProviderIntent("Inception on Netflix"), null);
  assert.equal(parseWatchProviderIntent("Inception movie on Netflix"), null);
  assert.equal(parseWatchProviderIntent("movies on Netflix in Ghana").key, "netflix");
  const titleWithProvider = parseIntent("Inception on Netflix in Ghana");
  assert.equal(titleWithProvider.titleQuery, "Inception");
  assert.equal(titleWithProvider.providerRegion, "GH");
  assert.equal(titleWithProvider.country, null);
  assert.equal(parseIntent("movies on Netflix in Ghana").providerRegion, "GH");
  assert.equal(parseIntent("movies on Netflix in Ghana").country, null);
  assert.equal(parseIntent("Apple TV Plus").mediaType, "all");
  assert.equal(getSearchIntent("Apple TV Plus").type, null);
  assert.equal(parseWatchProviderIntent("TV shows streaming on Disney+").key, "disney-plus");
  assert.equal(parseWatchProviderIntent("movies on Apple TV+").key, "apple-tv");
  assert.equal(parseWatchProviderIntent("movies on Paramount+").key, "paramount-plus");
  assert.equal(parseWatchProviderIntent("movies on MUBI").key, "mubi");
  assert.ok(parseIntent("movies on MUBI").unsupported.length > 0);
  assert.equal(parseIntent("Mad Max movies").unsupported.length, 0, "the film title Mad Max must not be mistaken for the Max streaming service");

  const netflix = findWatchProviderId({
    results: [
      { provider_id: 8, provider_name: "Netflix" },
      { provider_id: 119, provider_name: "Amazon Prime Video" }
    ]
  }, parseWatchProviderIntent("movies on Netflix"));
  const prime = findWatchProviderId({
    results: [{ provider_id: 119, provider_name: "Amazon Prime Video" }]
  }, parseWatchProviderIntent("movies on Prime Video"));
  assert.equal(netflix, "8");
  assert.equal(prime, "119");
});

test("provider search uses regional streaming filters and never mixes unverified text results", () => {
  const intent = parseIntent("Korean horror movies");
  const params = buildStructuredSearchParams(intent, "movie", 2, { id: "8", region: "GH" });
  assert.equal(params.with_watch_providers, "8");
  assert.equal(params.watch_region, "GH");
  assert.equal(params.with_watch_monetization_types, "flatrate|free|ads");

  const source = readFileSync(new URL("../scripts/search.js", import.meta.url), "utf8");
  assert.match(source, /tmdbApi\.movieWatchProviders\(providerRegion\)/);
  assert.match(source, /tmdbApi\.tvWatchProviders\(providerRegion\)/);
  assert.match(source, /providerIntent \? \[\] : textItems\.filter/);
  assert.match(source, /const titleSearchQuery = !providerIntent && parsed\.titleQuery \? parsed\.titleQuery : q/);
  assert.match(source, /searchContent\(titleSearchQuery, page\)/);
  assert.match(source, /TMDB could not verify/);
  assert.match(source, /TMDB could not complete every provider-filtered catalogue request/);
  const page = readFileSync(new URL("../scripts/search-page.js", import.meta.url), "utf8");
  assert.match(page, /STREAMING ON/);
  assert.match(page, /providerTarget\.region/);
});
