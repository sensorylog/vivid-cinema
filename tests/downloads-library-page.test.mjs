import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("downloads page is a title-driven movie and series library with no manual provider setup", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  assert.match(page, /data-vivid-page="downloads-library"/);
  assert.match(page, /scripts\/my-downloads\.js/);
  assert.match(page, /Your movie &(?:amp;)? series downloads/);
  assert.match(page, /no API URL, provider account, or manual setup/);
  assert.doesNotMatch(page, /FlixQuest|flixquest-api-url|Save & test connection/);
  assert.match(page, /offline-player/);
});

test("offline library uses owner-scoped persistence, automatic provider integration, queue and local player", async () => {
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  assert.match(script, /createIndexedDBPersistence\(\{ownerId:owner\}\)/);
  assert.match(script, /createBrowserDownloadAdapter/);
  assert.match(script, /provider-integration\.js/);
  assert.match(script, /createOfflinePlaybackController/);
  assert.match(script, /integration\.resolve/);
  assert.match(script, /manager\.retry\(id\)/);
  assert.match(script, /manager\.enqueue\(/);
  assert.doesNotMatch(script, /FlixQuest|flixquest|createBrowserHlsDownloadAdapter/);
  assert.doesNotMatch(script, /Internet Archive|archive\.org/);
});
