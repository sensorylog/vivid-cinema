import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnimeTitle, resolveAnimeIds, clearAnimeIdResolverCache } from "../scripts/playback/anime-id-resolver.js";

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

test("prefers a season-specific AniList entry and keeps its local episode numbering", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    const search = body.variables?.search || "";
    const media = search.includes("Final Season")
      ? [{ id: 2, idMal: 2, episodes: 16, seasonYear: 2020, title: { english: "Attack on Titan: The Final Season", romaji: "Shingeki no Kyojin: The Final Season", native: "" }, synonyms: [] }]
      : [{ id: 1, idMal: 1, episodes: 25, seasonYear: 2013, title: { english: "Attack on Titan", romaji: "Shingeki no Kyojin", native: "" }, synonyms: [] }];
    return { ok: true, json: async () => input.toString().includes("graphql.anilist.co") ? { data: { Page: { media } } } : { data: [] } };
  };
  try {
    const result = await resolveAnimeIds("Attack on Titan", { seasonTitle: "The Final Season", seasonYear: "2020", globalEpisode: 60, localEpisode: 1, episodeOffset: 59 });
    assert.deepEqual(result, { aniListId: "2", malId: "2", episodeOffset: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an old season ID when its episode count cannot cover the requested season", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const payload = input.toString().includes("graphql.anilist.co")
      ? { data: { Page: { media: [{ id: 1, idMal: 1, episodes: 12, seasonYear: 2014, title: { english: "Example Anime", romaji: "Example Anime", native: "" }, synonyms: [] }] } } }
      : { data: [] };
    return { ok: true, json: async () => payload };
  };
  try {
    const result = await resolveAnimeIds("Example Anime", { seasonTitle: "Season 2", seasonYear: "2017", globalEpisode: 13, localEpisode: 1, episodeOffset: 12 });
    assert.equal(result.aniListId, "");
    assert.equal(result.malId, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("anime ID results are cached per title and TMDB season identity", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  clearAnimeIdResolverCache();
  globalThis.fetch = async input => {
    calls += 1;
    const payload = input.toString().includes("graphql.anilist.co")
      ? { data: { Media: { id: 101, idMal: 202, episodes: 24, seasonYear: 2024, title: { english: "Cache Sample", romaji: "Cache Sample", native: "" }, synonyms: [] } } }
      : { data: [] };
    return { ok: true, json: async () => payload };
  };
  try {
    const options = { seasonTitle: "Season 1", seasonYear: "2024", globalEpisode: 1, localEpisode: 1, episodeOffset: 0 };
    const first = await resolveAnimeIds("Cache Sample", options);
    const callsAfterFirst = calls;
    const second = await resolveAnimeIds("Cache Sample", options);
    assert.deepEqual(second, first);
    assert.equal(calls, callsAfterFirst);
  } finally {
    clearAnimeIdResolverCache();
    globalThis.fetch = originalFetch;
  }
});
