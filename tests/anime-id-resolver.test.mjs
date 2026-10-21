import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnimeTitle, resolveAnimeIds } from "../scripts/playback/anime-id-resolver.js";

test("normalizes punctuation, accents, and title separators", () => {
  assert.equal(normalizeAnimeTitle("Spy × Family"), "spy family");
  assert.equal(normalizeAnimeTitle("  Café   Terrace & Its Goddesses "), "cafe terrace and its goddesses");
});

test("normalizes common season suffixes without damaging numbered titles", () => {
  assert.equal(normalizeAnimeTitle("Demon Slayer Season 2"), "demon slayer");
  assert.equal(normalizeAnimeTitle("Mob Psycho 100"), "mob psycho 100");
});

test("resolves AniList and MAL IDs from matching metadata results", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const payload = url.includes("graphql.anilist.co")
      ? { data: { Media: { id: 5114, idMal: 5114, title: { english: "Fullmetal Alchemist: Brotherhood", romaji: "Hagane no Renkinjutsushi", native: "鋼の錬金術師" }, synonyms: [] } } }
      : { data: [{ mal_id: 5114, title: "Hagane no Renkinjutsushi", title_english: "Fullmetal Alchemist: Brotherhood", title_japanese: "鋼の錬金術師", titles: [] }] };
    return { ok: true, json: async () => payload };
  };
  try {
    assert.deepEqual(await resolveAnimeIds("Fullmetal Alchemist: Brotherhood"), { aniListId: "5114", malId: "5114" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unrelated catalogue results instead of assigning the wrong anime IDs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    const payload = url.includes("graphql.anilist.co")
      ? { data: { Media: { id: 999, idMal: 999, title: { english: "Completely Different Show", romaji: "Different Show", native: "別の番組" }, synonyms: [] } } }
      : { data: [{ mal_id: 999, title: "Completely Different Show", title_english: "Different Show", title_japanese: "別の番組", titles: [] }] };
    return { ok: true, json: async () => payload };
  };
  try {
    assert.deepEqual(await resolveAnimeIds("Naruto"), { aniListId: "", malId: "" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
