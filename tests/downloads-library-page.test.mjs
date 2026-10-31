import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("offline downloads page is a title-driven movie and series library", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  assert.match(page, /data-vivid-page="downloads-library"/);
  assert.match(page, /scripts\/my-downloads\.js/);
  assert.match(page, /Your movie &(?:amp;)? series downloads/);
  assert.doesNotMatch(page, /Internet Archive|archive-search|archive-results/);
  assert.match(page, /offline-player/);
});
test("offline library uses owner-scoped persistence, configured authorized resolver, queue and local player", async () => {
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  assert.match(script, /createIndexedDBPersistence\(\{ownerId:owner\}\)/);
  assert.match(script, /createBrowserDownloadAdapter/);
  assert.match(script, /createOfflinePlaybackController/);
  assert.match(script, /integration\.resolve/);
  assert.match(script, /manager\.retry\(id\)/);
  assert.match(script, /manager\.enqueue\(/);
  assert.match(script, /No authorized download provider is configured/);
  assert.doesNotMatch(script, /Internet Archive|archive\.org/);
});
