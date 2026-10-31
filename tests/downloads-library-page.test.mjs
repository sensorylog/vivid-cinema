import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("offline downloads page is distinct from installer downloads", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  assert.match(page, /data-vivid-page="downloads-library"/);
  assert.match(page, /scripts\/my-downloads\.js/);
  assert.match(page, /Download sources aren’t connected yet/);
});
test("offline library uses owner-scoped metadata and fails closed without a resolver", async () => {
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  assert.match(script, /createIndexedDBPersistence\(\{ ownerId: owner \}\)/);
  assert.match(script, /No authorized direct-file download source is configured/);
  assert.match(script, /Retry unavailable/);
  assert.doesNotMatch(script, /createBrowserDownloadAdapter/);
});
