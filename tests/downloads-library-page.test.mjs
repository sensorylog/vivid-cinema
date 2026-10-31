import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("downloads page explains that no direct-download source is currently connected", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  assert.match(page, /data-vivid-page="downloads-library"/);
  assert.match(page, /scripts\/my-downloads\.js/);
  assert.match(page, /authorized direct-download source/);
  assert.match(page, /My <span>Downloads<\/span>/);
  assert.match(page, /offline-player/);
});

test("download library retains saved-file playback without a remote resolver", async () => {
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  assert.match(script, /createIndexedDBPersistence\(\{ownerId:owner\}\)/);
  assert.match(script, /createBrowserDownloadAdapter/);
  assert.match(script, /createOfflinePlaybackController/);
  assert.match(script, /manager\.retry\(id\)/);
  assert.match(script, /data-action="export"/);
  assert.match(script, /Save file/);
  assert.match(script, /no authorized direct-download source connected/i);
  assert.doesNotMatch(script, /VIVID_DOWNLOADS|provider-integration|archive\.org|wikimedia\.org/i);
});
