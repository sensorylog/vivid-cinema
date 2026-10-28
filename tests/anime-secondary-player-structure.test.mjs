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
