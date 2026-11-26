import test from "node:test";
import assert from "node:assert/strict";
import { getAnimeGlobalEpisode, normalizeAnimeTrack, readAnimeTrackPreference, writeAnimeTrackPreference, normalizeAnimeProviderMessage } from "../scripts/playback/anime-playback.js";

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

test("AnimeEmbed messages require their documented channel and normalize progress", () => {
  assert.equal(normalizeAnimeProviderMessage("animeembed", { channel: "other", event: "play" }), null);
  const message = normalizeAnimeProviderMessage("animeembed", { channel: "animeembed", event: "progress", currentTime: 42, duration: 120 });
  assert.equal(message.type, "PLAYER_EVENT");
  assert.equal(message.data.player_status, "timeupdate");
  assert.equal(message.data.player_progress, 42);
  assert.equal(message.data.player_duration, 120);
});

test("Vidy JSON-string events normalize while malformed or unknown events are rejected", () => {
  const message = normalizeAnimeProviderMessage("vidy", JSON.stringify({ event: "playing", position: 9, duration: 80 }));
  assert.equal(message.data.player_progress, 9);
  assert.equal(normalizeAnimeProviderMessage("vidy", "{bad json"), null);
  assert.equal(normalizeAnimeProviderMessage("vidy", { event: "arbitrary" }), null);
});
