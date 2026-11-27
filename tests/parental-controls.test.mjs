import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProfile } from "../scripts/profile-schema.js";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Kids profiles default to conservative ratings and block unrated content", () => {
  const profile = normalizeProfile("child", { name: "Kids", isKids: true });
  assert.equal(profile.movieRatingLimit, "PG");
  assert.equal(profile.tvRatingLimit, "TV-PG");
  assert.equal(profile.allowUnrated, false);
  assert.deepEqual(profile.blockedGenreIds, [27, 53, 80, 10752]);
});

test("adult profiles retain unrestricted defaults", () => {
  const profile = normalizeProfile("adult", { name: "Adult" });
  assert.equal(profile.movieRatingLimit, "NC-17");
  assert.equal(profile.tvRatingLimit, "TV-MA");
  assert.equal(profile.allowUnrated, true);
  assert.deepEqual(profile.blockedGenreIds, []);
});

test("parental controls cover every discovery, saved-library and playback entry point", async () => {
  const [
    content, searchPage, discover, title, watch, service, searchEngine, collection,
    libraryPage, animePremiumLibrary, freeAnime, animePremiumDiscovery,
    animeTitle, animeWatch, person, offline, browserOffline
  ] = await Promise.all([
    read("../scripts/content.js"),
    read("../scripts/search-page.js"),
    read("../scripts/discover.js"),
    read("../scripts/title.js"),
    read("../scripts/watch.js"),
    read("../cloudflare/functions/lib/profile-service.js"),
    read("../scripts/search.js"),
    read("../scripts/collection.js"),
    read("../scripts/library-page.js"),
    read("../scripts/anime-premium-library.js"),
    read("../scripts/anime.js"),
    read("../scripts/anime-premium-discovery.js"),
    read("../scripts/anime-premium-title.js"),
    read("../scripts/anime-premium-watch.js"),
    read("../scripts/person.js"),
    read("../scripts/downloads/desktop-offline.js"),
    read("../scripts/my-downloads.js")
  ]);

  for (const source of [
    content, searchPage, discover, title, watch, searchEngine, collection,
    libraryPage, animePremiumLibrary, freeAnime, animePremiumDiscovery,
    animeTitle, animeWatch, person, offline, browserOffline
  ]) assert.match(source, /parental-controls/);

  // The filtered Collection route uses direct TMDB discovery calls when filters
  // are active, so it must independently apply the policy before rendering.
  assert.match(collection, /await filterAllowedTitles\(sort\(data\.items\|\|\[\]\)\)/);
  assert.match(libraryPage, /filterAllowedTitles\(source\.favorites/);
  assert.match(libraryPage, /filterAllowedTitles\(getContinueWatching\(8\)\)/);
  assert.match(animePremiumLibrary, /filterAllowedTitles\(source\.watchlist/);
  assert.match(freeAnime, /filterAllowedTitles\(resolved\)/);
  assert.match(animePremiumDiscovery, /filterAllowedTitles\(raw\.flatMap/);

  assert.match(service, /parent-authorization-required/);
  assert.match(service, /parent-pin-required/);
  const pin = await read("../api/profile-pin.js");
  assert.match(pin, /kids-parent-pin-required/);
  assert.match(pin, /isKids: profileSnapshot\.data\(\)\?\.isKids === true/);
});
