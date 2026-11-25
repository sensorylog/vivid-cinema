import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("African Stories playback runtime retains strict published-work and edition checks", async () => {
  const player = await read("../scripts/african-stories/player.js");
  const providers = await read("../scripts/african-stories/providers.js");
  assert.match(player, /getDoc\(doc\(db, "africanWorksPublic", workId\)\)/);
  assert.match(player, /find\(item => item\.versionId === versionId\)/);
  assert.match(player, /source\.enabled === true/);
  assert.match(player, /No playable source published/);
  assert.match(providers, /provider === "youtube"/);
  assert.match(providers, /provider === "archive"/);
  assert.match(player, /createAfricanPlaybackSession/);
});

test("public African Stories player route does not load the playback runtime", async () => {
  const page = await read("../african-stories-watch.html");
  assert.match(page, /african-development-gate/);
  assert.doesNotMatch(page, /african-player-frame|african-player-video|scripts\/african-stories\/player\.js/);
});

test("African Stories operations console remains separately permission-gated", async () => {
  const admin = await read("../scripts/african-stories/admin.js");
  const page = await read("../african-stories-admin.html");
  assert.match(admin, /africanStoriesEditor|africanStoriesPublisher|africanStoriesProviderAdmin|africanStoriesRightsAdmin/);
  assert.match(page, /RESTRICTED OPERATIONS|African Stories Console/);
});
