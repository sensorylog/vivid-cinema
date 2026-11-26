import test from "node:test";
import assert from "node:assert/strict";
import { getAnimeGlobalEpisode, normalizeAnimeTrack, readAnimeTrackPreference, writeAnimeTrackPreference } from "../scripts/playback/anime-playback.js";

test("anime episode mapping converts split TMDB seasons to continuous anime episode numbers", () => {
  const seasons = [
    { season_number: 0, episode_count: 3 },
    { season_number: 1, episode_count: 12 },
    { season_number: 2, episode_count: 13 },
    { season_number: 3, episode_count: 11 }
  ];
  assert.equal(getAnimeGlobalEpisode({ type: "tv", season: 1, episode: 12 }, seasons), 12);
  assert.equal(getAnimeGlobalEpisode({ type: "tv", season: 2, episode: 1 }, seasons), 13);
  assert.equal(getAnimeGlobalEpisode({ type: "tv", season: 3, episode: 11 }, seasons), 36);
});

test("anime episode mapping leaves movies and unknown seasons unchanged", () => {
  const seasons = [{ season_number: 1, episode_count: 12 }];
  assert.equal(getAnimeGlobalEpisode({ type: "movie", episode: 1 }, seasons), 1);
  assert.equal(getAnimeGlobalEpisode({ type: "tv", season: 4, episode: 2 }, seasons), 2);
});

test("anime track preference safely normalizes and persists sub or dub", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(normalizeAnimeTrack("DUB"), "dub");
  assert.equal(normalizeAnimeTrack("unknown"), "sub");
  assert.equal(readAnimeTrackPreference(storage), "sub");
  assert.equal(writeAnimeTrackPreference("dub", storage), "dub");
  assert.equal(readAnimeTrackPreference(storage), "dub");
  assert.equal(writeAnimeTrackPreference("invalid", storage), "sub");
});
