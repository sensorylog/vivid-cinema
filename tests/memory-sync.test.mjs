import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const library = read("../scripts/library.js");
const progress = read("../scripts/recommendations.js");
const intelligence = read("../scripts/intelligence.js");

test("library, progress, and intelligence use the shared owner snapshot policy", () => {
  for (const source of [library, progress, intelligence]) {
    assert.match(source, /switchLocalOwner\(/);
  }
  assert.match(library, /ensureLocalOwner\(user\?\.uid \|\| null\)/);
  assert.match(progress, /ensureProgressOwner\(user\?\.uid \|\| null\)/);
  assert.match(intelligence, /ensureIntelligenceOwner\(u\?\.uid \|\| null\)/);
  assert.match(library, /TOMBSTONE_STORAGE_KEY/);
  assert.match(progress, /FOR_YOU_CACHE_KEY/);
  assert.match(intelligence, /TASTE_CACHE_KEY/);
  assert.match(progress, /void startPlaybackSync\(\)/);
  assert.match(intelligence, /void startIntelligenceSync\(\)/);
});

test("playback writes are bound to the owner active when queued", () => {
  assert.match(progress, /const ownerAtQueue = localStorage\.getItem\(LOCAL_OWNER_KEY\) \|\| "guest"/);
  assert.match(progress, /activeOwner === ownerAtQueue/);
  assert.match(progress, /String\(auth\?\.currentUser\?\.uid \|\| ""\) === ownerAtQueue/);
  assert.match(progress, /The signed-in account changed during playback progress sync/);
  assert.match(progress, /getDocsFromServer\(collection\(db, "users", user\.uid, "progress"\)\)/);
  assert.match(progress, /remoteUpdated > 0 && remoteUpdated >= localUpdated/);
  assert.match(progress, /JSON\.stringify\(merged\) !== JSON\.stringify\(local\[contentId\]\)/);
  assert.match(progress, /vivid:sync-status/);
  assert.match(progress, /progressSyncStatus\("error", user\.uid, "sync"\)/);
  assert.match(progress, /progressSyncStatus\("synced", uid, contentId\)/);
  assert.match(intelligence, /if\(Number\(x\.updatedAt\|\|0\)<localVersion\)return/);
  assert.match(intelligence, /getDocsFromServer\(collection\(db,"users",u\.uid,"feedback"\)\)/);
  assert.match(intelligence, /getDocsFromServer\(collection\(db,"users",u\.uid,"taste"\)\)/);
  assert.match(intelligence, /The signed-in account changed before intelligence state could be reconciled/);
  assert.match(intelligence, /const s=read\(\);const stateAtSync=localStorage\.getItem\(KEY\)\|\|""/);
  assert.match(intelligence, /Local intelligence changed during sync; newer local state was retained/);
  assert.match(intelligence, /const ownerAtStart=localStorage\.getItem\(LOCAL_OWNER_KEY\)\|\|"guest"/);
  assert.match(intelligence, /\(localStorage\.getItem\(KEY\)\|\|""\)!==stateAtStart/);
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
  assert.match(intelligence, /feedbackCleared/);
  assert.match(intelligence, /s\.feedback\[k\]=\{\.\.\.i,kind:"like",updatedAt\};delete s\.feedbackCleared\[k\]/);
  assert.match(intelligence, /kind:"cleared",updatedAt:Number\(tombstone\.updatedAt\)/);
  assert.match(intelligence, /Vivid intelligence sync unavailable; local state is retained for retry/);
});

test("progress and library retain local-first semantics when cloud sync fails", () => {
  assert.match(progress, /Vivid playback progress sync failed/);
  assert.match(progress, /writeProgress\(current\)/);
  assert.match(library, /Do not replace local data until all required cloud operations have been/);
  assert.match(library, /The signed-in account changed during library sync/);
});
