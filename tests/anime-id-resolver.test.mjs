import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnimeTitle } from "../scripts/playback/anime-id-resolver.js";

test("normalizes punctuation, accents, and title separators", () => {
  assert.equal(normalizeAnimeTitle("Spy × Family"), "spy family");
  assert.equal(normalizeAnimeTitle("  Café   Terrace & Its Goddesses "), "cafe terrace and its goddesses");
});

test("normalizes common season suffixes for safer title matching", () => {
  assert.equal(normalizeAnimeTitle("Demon Slayer Season 2"), "demon slayer");
  assert.equal(normalizeAnimeTitle("Mob Psycho 100"), "mob psycho 100");
});
