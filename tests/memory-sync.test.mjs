import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const library = read("../scripts/library.js");
const progress = read("../scripts/recommendations.js");
const intelligence = read("../scripts/intelligence.js");

test("library, progress, and intelligence use the shared owner snapshot policy", () => {
  for (const source of [library, progress, intelligence]) {
    assert.match(source, /switchLocalOwner\\(/);
  }
  assert.match(library, /ensureLocalOwner\\(user\\?\\.uid \\|\\| null\\)/);
  assert.match(progress, /ensureProgressOwner\\(user\\?\\.uid \\|\\| null\\)/);
  assert.match(intelligence, /ensureIntelligenceOwner\\(u\\?\\.uid \\|\\| null\\)/);
  assert.match(library, /TOMBSTONE_STORAGE_KEY/);
  assert.match(progress, /FOR_YOU_CACHE_KEY/);
  assert.match(intelligence, /TASTE_CACHE_KEY/);
});

test("playback writes are bound to the owner active when queued", () => {
  assert.match(progress, /const ownerAtQueue = localStorage\.getItem\(LOCAL_OWNER_KEY\) \|\| "guest"/);
  assert.match(progress, /activeOwner === ownerAtQueue/);
  assert.match(progress, /String\(auth\?\.currentUser\?\.uid \|\| ""\) === ownerAtQueue/);
  assert.match(progress, /The signed-in account changed during playback progress sync/);
});

test("auth listeners continue handling later account changes", () => {
  assert.match(progress, /onAuthStateChanged\(auth, user => \{\s*ensureProgressOwner\(user\?\.uid \|\| null\)/);
  assert.match(intelligence, /onAuthStateChanged\(auth,u=>\{\s*ensureIntelligenceOwner\(u\?\.uid \|\| null\)/);
  assert.match(library, /onAuthStateChanged\(auth,user=>\{\s*ensureLocalOwner\(user\?\.uid \|\| null\)/);
});

test("intelligence sync reports outcomes and retries when the device reconnects", () => {
  assert.match(intelligence, /vivid:sync-status/);
  assert.match(intelligence, /window\.addEventListener\("online"/);
  assert.match(intelligence, /localItem\.updatedAt/);
  assert.match(intelligence, /Vivid intelligence sync unavailable; local state is retained for retry/);
});

test("progress and library retain local-first semantics when cloud sync fails", () => {
  assert.match(progress, /Vivid playback progress sync failed/);
  assert.match(progress, /writeProgress\(current\)/);
  assert.match(library, /Do not replace local data until all required cloud operations have been/);
  assert.match(library, /The signed-in account changed during library sync/);
});
