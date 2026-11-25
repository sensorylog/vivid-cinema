import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const player = readFileSync(new URL("../scripts/african-stories/player.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../african-stories-watch.html", import.meta.url), "utf8");
const providers = readFileSync(new URL("../scripts/african-stories/providers.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../scripts/african-stories/admin.js", import.meta.url), "utf8");

test("African Stories player loads only exact published work and edition records", () => {
  assert.match(player, /getDoc\(doc\(db, "africanWorksPublic", workId\)\)/);
  assert.match(player, /find\(item => item\.versionId === versionId\)/);
  assert.match(player, /source\.enabled === true/);
  assert.match(player, /No playable source published/);
});

test("African Stories player supports official embeds, archive media and protected partner sessions", () => {
  assert.match(providers, /provider === "youtube"/);
  assert.match(providers, /provider === "vimeo"/);
  assert.match(providers, /provider === "peertube"/);
  assert.match(providers, /provider === "archive"/);
  assert.match(player, /resolveInternetArchiveFile/);
  assert.match(player, /createAfricanPlaybackSession/);
  assert.match(page, /id="african-player-frame"/);
  assert.match(page, /id="african-player-video"/);
});

test("FilmFlux is a separate credited discovery route and not an arbitrary URL player", () => {
  assert.match(player, /fetchFilmFluxTrending/);
  assert.match(player, /Discovered through FilmFlux/);
  assert.match(player, /movie\.youtubeId/);
  assert.match(page, /\?provider=filmflux/);
  assert.doesNotMatch(player, /params\.get\(["']url["']\)/);
});

test("operations console provides source templates and requires editorial evidence", () => {
  assert.match(admin, /REPLACE_WITH_CREATOR_VERIFICATION_RECORD/);
  assert.match(admin, /REPLACE_WITH_RIGHTS_EVIDENCE_RECORD/);
  assert.match(admin, /watch_officially/);
  assert.match(page, /Official platform embeds retain the platform's player/);
});
