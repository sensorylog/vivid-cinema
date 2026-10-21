import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const watch = await readFile(new URL("../scripts/watch.js", import.meta.url), "utf8");

test("anime Player 2 mounts separately from the movie and TV Player 2", () => {
  assert.match(watch, /if \(isAnimePlayback\(\)\)\s*\{\s*mountAnimeSecondaryPlayer/);
  assert.match(watch, /else\s*\{\s*mountTflixSecondaryPlayer/);
});

test("anime Player 2 is mounted again after external anime IDs resolve", () => {
  assert.match(watch, /mountAnimeSecondaryPlayer\(\{ root: \$\("vivid-tflix-player"\), params: \{ \.\.\.currentParams, anime: true \}, media, title: details\.episode\?\.name \|\| media\.title \|\| media\.name, aniListId, malId \}\)/);
});
