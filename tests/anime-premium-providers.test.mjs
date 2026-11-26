import test from "node:test";
import assert from "node:assert/strict";
import { buildAnimePremiumProviderUrl, resolveAnimePremiumProviderOptions, listAnimePremiumProviders } from "../scripts/playback/anime-premium-providers.js";

const episode = { mediaType: "tv", tmdbId: "12345", aniListId: "21", malId: "21", season: 2, episode: 3, track: "sub" };

test("Premium provider registry includes existing Vivid sources and anime-specific alternatives", () => {
  assert.deepEqual(listAnimePremiumProviders().map(item => item.id), [
    "vidplus", "vidlink", "vidsrc", "anixo", "anilink", "megaplay", "megaplay-legacy", "megavid", "megaflix", "vidapi", "embedwave", "vidfast", "embedapistream", "vidrift"
  ]);
});

test("VidAPI and EmbedWave use the documented TMDB episode routes", () => {
  assert.equal(buildAnimePremiumProviderUrl("vidsrc", episode), "https://vidsrc.sh/embed/tv/12345/2/3?ds_lang=en");
  assert.equal(buildAnimePremiumProviderUrl("vidapi", episode), "https://vaplayer.ru/embed/tv/12345/2/3?autoplay=1&controls=1&overlay=1");
  assert.equal(buildAnimePremiumProviderUrl("embedwave", episode), "https://embedwave.cc/embed/tv/12345/2/3?autoplay=true");
});

test("VidLink and VidPlus use their documented MAL and AniList anime routes", () => {
  assert.match(buildAnimePremiumProviderUrl("vidlink", episode), /^https:\/\/vidlink\.pro\/anime\/21\/3\/sub\?/);
  assert.match(buildAnimePremiumProviderUrl("vidlink", episode), /fallback=true/);
  assert.match(buildAnimePremiumProviderUrl("vidlink", { ...episode, track: "dub" }), /\/anime\/21\/3\/dub\?/);
  assert.match(buildAnimePremiumProviderUrl("vidplus", episode), /^https:\/\/player\.vidplus\.to\/embed\/anime\/21\/3\?/);
  assert.match(buildAnimePremiumProviderUrl("vidplus", { ...episode, track: "dub" }), /dub=true/);
});

test("AniXo, AniLink, MegaPlay, Megavid and MegaFlix use anime-specific embed paths", () => {
  assert.equal(buildAnimePremiumProviderUrl("anixo", episode), "https://anixo.buzz/embed/ani/21/3?track=sub&autoSkipIntro=1&autoSkipOutro=1");
  assert.equal(buildAnimePremiumProviderUrl("anilink", episode), "https://anilink.cc/watch/21/3?variant=sub&autoplay=true&primaryColor=e50914");
  assert.equal(buildAnimePremiumProviderUrl("megaplay", episode), "https://megaplay.buzz/stream/ani/21/3/sub");
  assert.equal(buildAnimePremiumProviderUrl("megaplay-legacy", episode), "https://ani.megaplay.su/ani/21/3/sub");
  assert.equal(buildAnimePremiumProviderUrl("megavid", episode), "https://megavid.buzz/ani/21/3/sub?autoplay=true");
  assert.equal(buildAnimePremiumProviderUrl("megaflix", episode), "https://megaflix.buzz/stream/ani/21/3/sub");
  assert.equal(buildAnimePremiumProviderUrl("vidrift", episode), "https://embed.vidrift.net/embed/anilist/21/3");
  assert.equal(buildAnimePremiumProviderUrl("vidfast", episode), "https://vidfast.to/embed/tv/12345/2/3");
  assert.equal(buildAnimePremiumProviderUrl("embedapistream", episode), "https://watch.embed-api.stream/embed/tv/12345/2/3");
});

test("MAL fallback is used when an anime provider accepts MAL but AniList is unavailable", () => {
  assert.equal(buildAnimePremiumProviderUrl("anixo", { ...episode, aniListId: "", malId: "20" }), "https://anixo.buzz/embed/mal/20/3?track=sub&autoSkipIntro=1&autoSkipOutro=1");
  assert.equal(buildAnimePremiumProviderUrl("megavid", { ...episode, aniListId: "", malId: "20" }), "https://megavid.buzz/mal/20/3/sub?autoplay=true");
  assert.equal(buildAnimePremiumProviderUrl("megaplay", { ...episode, aniListId: "", malId: "20" }), "https://megaplay.buzz/stream/mal/20/3/sub");
  assert.equal(buildAnimePremiumProviderUrl("vidlink", { ...episode, malId: "" }), "");
});

test("episode-only anime providers stay unavailable for films while TMDB providers remain available", () => {
  const options = resolveAnimePremiumProviderOptions({ ...episode, mediaType: "movie" });
  assert.equal(options.filter(item => item.available).map(item => item.id).sort().join(","), "embedapistream,embedwave,vidapi,vidfast,vidrift,vidsrc");
  assert.equal(buildAnimePremiumProviderUrl("vidapi", { mediaType: "movie", tmdbId: "550" }), "https://vaplayer.ru/embed/movie/550?autoplay=1&controls=1&overlay=1");
  assert.equal(buildAnimePremiumProviderUrl("embedwave", { mediaType: "movie", tmdbId: "550" }), "https://embedwave.cc/embed/movie/550?autoplay=true");
  assert.equal(buildAnimePremiumProviderUrl("vidrift", { mediaType: "movie", tmdbId: "550" }), "https://embed.vidrift.net/embed/movie/550");
  assert.equal(buildAnimePremiumProviderUrl("vidfast", { mediaType: "movie", tmdbId: "550" }), "https://vidfast.to/embed/movie/550");
  assert.equal(buildAnimePremiumProviderUrl("embedapistream", { mediaType: "movie", tmdbId: "550" }), "https://watch.embed-api.stream/embed/movie/550");
  assert.equal(buildAnimePremiumProviderUrl("vidsrc", { mediaType: "movie", tmdbId: "550" }), "https://vidsrc.sh/embed/movie/550?ds_lang=en");
});

test("provider builders reject invalid catalogue IDs and unknown provider names", () => {
  assert.equal(buildAnimePremiumProviderUrl("vidplus", { ...episode, aniListId: "not-an-id" }), "");
  assert.equal(buildAnimePremiumProviderUrl("embedwave", { ...episode, tmdbId: "" }), "");
  assert.equal(buildAnimePremiumProviderUrl("unknown", episode), "");
});


test("provider event capability is explicit so only event-capable sources use automatic timeout failover", () => {
  const providers = Object.fromEntries(listAnimePremiumProviders().map(item => [item.id, item]));
  for (const id of ["vidplus", "vidlink", "vidsrc", "anixo", "anilink", "megaplay", "megavid", "megaflix", "vidapi", "vidrift"]) {
    assert.equal(providers[id].events, true, id + " should expose playback events");
  }
  for (const id of ["megaplay-legacy", "embedwave", "vidfast", "embedapistream"]) {
    assert.equal(providers[id].events, false, id + " should use manual fallback");
  }
});
