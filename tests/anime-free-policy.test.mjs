import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FREE_ANIME_SAMPLE_IDS, FREE_ANIME_MAX_EPISODE, FREE_ANIME_MAX_SEASON, isFreeAnimePreview } from "../scripts/anime-free-policy.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [page, client, watch] = await Promise.all([
  read("../anime.html"),
  read("../scripts/anime.js"),
  read("../scripts/watch.js")
]);

test("free Anime is a fixed six-series sampler, not a paginated full catalogue", () => {
  assert.equal(FREE_ANIME_SAMPLE_IDS.length, 6);
  assert.match(page, /six selected series and the first episode of each/);
  assert.match(page, /anime-premium\.html/);
  assert.doesNotMatch(page, /anime-load-more/);
  assert.match(client, /FREE_ANIME_SAMPLE_IDS\.map/);
  assert.match(client, /buildWatchUrl\(item\.id, "tv", 1, 1\)/);
  assert.doesNotMatch(client, /getAnimePage|load\(false\)/);
});

test("free Anime only grants the first episode of the curated sample series", () => {
  assert.equal(FREE_ANIME_MAX_SEASON, 1);
  assert.equal(FREE_ANIME_MAX_EPISODE, 1);
  assert.equal(isFreeAnimePreview({ id: "85937", type: "tv", season: "1", episode: "1" }), true);
  assert.equal(isFreeAnimePreview({ id: "85937", type: "tv", season: "1", episode: "2" }), false);
  assert.equal(isFreeAnimePreview({ id: "85937", type: "tv", season: "2", episode: "1" }), false);
  assert.equal(isFreeAnimePreview({ id: "95479", type: "movie", season: "1", episode: "1" }), false);
  assert.equal(isFreeAnimePreview({ id: "999999", type: "tv", season: "1", episode: "1" }), false);
  assert.match(watch, /isFreeAnimePreview\(currentParams\)/);
  assert.match(watch, /renderAnimePremiumGate/);
  assert.match(watch, /isAnimePlayback\(\) && !isFreeAnimePreview\(currentParams\)/);
  assert.match(watch, /continues on Premium/);
});

test("free anime preview page does not mount episode navigation that bypasses its limit", () => {
  assert.match(watch, /if \(!isFreeAnimePreview\(currentParams\)\) mountSecondaryPlayer/);
});
