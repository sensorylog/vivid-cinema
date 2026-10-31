import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("offline downloads page provides archive catalogue search and local video playback", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  assert.match(page, /data-vivid-page="downloads-library"/);
  assert.match(page, /scripts\/my-downloads\.js/);
  assert.match(page, /archive-search-form/);
  assert.match(page, /offline-player/);
});
test("offline library connects owner-scoped persistence, authorized source, queue and local player", async () => {
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  assert.match(script, /createIndexedDBPersistence\(\{ ownerId: owner \}\)/);
  assert.match(script, /createInternetArchiveSource/);
  assert.match(script, /createBrowserDownloadAdapter/);
  assert.match(script, /createOfflinePlaybackController/);
  assert.match(script, /manager\.retry\(id\)/);
  assert.match(script, /manager\.enqueue\(/);
  assert.doesNotMatch(script, /No authorized direct-file download source is configured/);
});
