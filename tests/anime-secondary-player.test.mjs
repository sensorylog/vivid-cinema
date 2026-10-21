import test from "node:test";
import assert from "node:assert/strict";
import { buildAnimeSecondaryServerUrl, listAnimeSecondaryServers } from "../scripts/playback/anime-secondary-player.js";

const ids = { aniListId: "21", malId: "21", episode: 3, track: "sub" };

test("anime Player 2 exposes the five requested providers", () => {
  assert.deepEqual(listAnimeSecondaryServers().map(server => server.name), ["AniXo", "AniLink", "MegaPlay", "Megavid", "MegaFlix"]);
});

test("anime Player 2 builds the documented AniList embed routes", () => {
  assert.equal(buildAnimeSecondaryServerUrl("anixo", ids), "https://anixo.buzz/embed/ani/21/3?track=sub");
  assert.equal(buildAnimeSecondaryServerUrl("anilink", ids), "https://anilink.cc/watch/21/3?variant=sub");
  assert.equal(buildAnimeSecondaryServerUrl("megaplay", ids), "https://ani.megaplay.su/ani/21/3/sub");
  assert.equal(buildAnimeSecondaryServerUrl("megavid", ids), "https://megavid.buzz/ani/21/3/sub");
  assert.equal(buildAnimeSecondaryServerUrl("megaflix", ids), "https://megaflix.buzz/stream/ani/21/3/sub");
});

test("anime Player 2 supports dub and MAL fallbacks where documented", () => {
  assert.equal(buildAnimeSecondaryServerUrl("anixo", { malId: "20", episode: 2, track: "dub" }), "https://anixo.buzz/embed/mal/20/2?track=dub");
  assert.equal(buildAnimeSecondaryServerUrl("megaplay", { malId: "20", episode: 2, track: "dub" }), "https://ani.megaplay.su/mal/20/2/dub");
  assert.equal(buildAnimeSecondaryServerUrl("megaflix", { malId: "20", episode: 2, track: "dub" }), "https://megaflix.buzz/stream/mal/20/2/dub");
  assert.equal(buildAnimeSecondaryServerUrl("anilink", { malId: "20", episode: 2, track: "dub" }), "");
});

test("anime Player 2 rejects invalid IDs and unknown providers", () => {
  assert.equal(buildAnimeSecondaryServerUrl("anixo", { aniListId: "not-an-id", episode: 1 }), "");
  assert.equal(buildAnimeSecondaryServerUrl("nope", ids), "");
});
