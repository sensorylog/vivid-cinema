import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const animeLibrary = await readFile(new URL("../scripts/anime-library.js", import.meta.url), "utf8");
const library = await readFile(new URL("../scripts/library.js", import.meta.url), "utf8");
const recommendations = await readFile(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const watch = await readFile(new URL("../scripts/watch.js", import.meta.url), "utf8");

test("anime library reuses the canonical shared library and progress stores", () => {
  assert.match(animeLibrary, /getLocalLibrary/);
  assert.match(animeLibrary, /getAllPlaybackProgress/);
  assert.match(animeLibrary, /upsertLibraryItem\("watchLater"/);
  assert.match(animeLibrary, /upsertLibraryItem\("favorites"/);
  assert.match(library, /const COLLECTIONS=\["favorites","watchLater","history","completed"\]/);
  assert.match(recommendations, /export function getAllPlaybackProgress\(\)/);
});

test("anime library separates watchlist, favourites, history, completed and continue-watching", () => {
  for (const section of ["watchlist", "favorites", "history", "completed", "continueWatching", "completedEpisodes"]) {
    assert.match(animeLibrary, new RegExp(section + ":"));
  }
  assert.match(animeLibrary, /item\.isAnime === true/);
  assert.match(animeLibrary, /!item\.completed/);
});

test("anime watch history and episode progress retain the anime identity across devices", () => {
  assert.match(watch, /isAnime: isAnimePlayback\(\)/);
  assert.match(library, /item\.isAnime===true/);
  assert.match(recommendations, /item\.isAnime === true/);
  assert.match(rules, /'isAnime'/);
  assert.match(rules, /keys\(\)\.hasAny\(\['isAnime'\]\) \|\| request\.resource\.data\.isAnime is bool/);
});

test("anime completed titles use the shared completed collection with owner-only Firestore access", () => {
  assert.match(library, /"completed"/);
  assert.match(rules, /match \/completed\/\{contentId\}/);
  assert.match(rules, /request\.resource\.data\.collection in \['favorites','watchLater','history','completed'\]/);
});

test("anime preferences persist Sub/Dub, autoplay, subtitle language and preferred player", () => {
  assert.match(animeLibrary, /autoplayNextEpisode/);
  assert.match(animeLibrary, /subtitleLanguage/);
  assert.match(animeLibrary, /preferredPlayer/);
  assert.match(animeLibrary, /writeAnimeTrackPreference\(next\.track\)/);
});
