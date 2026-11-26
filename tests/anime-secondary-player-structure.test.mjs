import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const watch = await readFile(new URL("../scripts/watch.js", import.meta.url), "utf8");

test("anime Player 2 mounts separately from the movie and TV Player 2", () => {
  assert.match(watch, /if \(isAnimePlayback\(\)\)\s*\{[\s\S]*?import\("\.\/playback\/anime-secondary-player\.js"\)/);
  assert.match(watch, /import\("\.\/playback\/tflix-secondary-player\.js"\)/);
  assert.doesNotMatch(watch, /^import .*secondary-player\.js/m);
});

test("anime Player 2 is mounted again after external anime IDs resolve", () => {
  assert.match(watch, /mountSecondaryPlayer\(currentParams, details\.episode\?\.name \|\| media\.title \|\| media\.name, details\)/);
});

test("anime Player 2 shares the audio preference and cleans up stale instances", async () => {
  const player = await readFile(new URL("../scripts/playback/anime-secondary-player.js", import.meta.url), "utf8");
  assert.match(player, /readAnimeTrackPreference/);
  assert.match(player, /writeAnimeTrackPreference/);
  assert.match(player, /root\.__vividAnimePlayer2Cleanup\?\.\(\)/);
  assert.match(player, /window\.addEventListener\("vivid:anime-track-changed"/);
});

test("anime Player 2 only auto-advances when an iframe fails to load", async () => {
  const player = await readFile(new URL("../scripts/playback/anime-secondary-player.js", import.meta.url), "utf8");
  assert.match(player, /if \(!frameLoaded\) \{\s*tryNextServer/);
  assert.match(player, /Actual video playback is not yet confirmed/);
});

test("anime Player 2 sets the provider URL before inserting the iframe", async () => {
  const player = await readFile(new URL("../scripts/playback/anime-secondary-player.js", import.meta.url), "utf8");
  assert.match(player, /frame\.src = url;\s*screen\.appendChild\(frame\)/);
});
