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
  assert.doesNotMatch(page, /Internet Archive|archive\.org|Wikimedia|wikimedia\.org|public-domain|Creative Commons/i);
});

test("download library keeps saved-file playback but has no archive resolver dependency", async () => {
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  assert.match(script, /createIndexedDBPersistence\(\{ownerId:owner\}\)/);
  assert.match(script, /createBrowserDownloadAdapter/);
  assert.match(script, /createOfflinePlaybackController/);
  assert.match(script, /manager\.retry\(id\)/);
  assert.match(script, /data-action="export"/);
  assert.match(script, /Save file/);
  assert.match(script, /no authorized direct-download source connected/i);
  assert.doesNotMatch(script, /Internet Archive|archive\.org|Wikimedia|wikimedia\.org|VIVID_DOWNLOADS|provider-integration/i);
});
