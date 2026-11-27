import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const library = read("../scripts/library.js");
const progress = read("../scripts/recommendations.js");
const intelligence = read("../scripts/intelligence.js");
import { cleanItem } from "../scripts/library.js";

test("library, progress, and intelligence use the shared owner snapshot policy", () => {
  for (const source of [library, progress, intelligence]) {
    assert.match(source, /switchLocalOwner/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(/);
  }
  assert.match(library, /ensureLocalOwner/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(user/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g| null/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(progress, /ensureProgressOwner/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(user/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g| null/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(intelligence, /ensureIntelligenceOwner/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(u/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g| null/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(library, /TOMBSTONE_STORAGE_KEY/);
  assert.match(progress, /FOR_YOU_CACHE_KEY/);
  assert.match(intelligence, /TASTE_CACHE_KEY/);
  assert.match(progress, /void startPlaybackSync/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(intelligence, /void startIntelligenceSync/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
});

test("playback writes are bound to the owner active when queued", () => {
  assert.match(progress, /const ownerAtQueue = localStorage/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.getItem/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(LOCAL_OWNER_KEY/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g) /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g| "guest"/);
  assert.match(progress, /activeOwner === ownerAtQueue/);
  assert.match(progress, /String/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(auth/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.currentUser/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g/);
  assert.match(progress, /The signed-in account changed during playback progress sync/);
  assert.match(progress, /getDocsFromServer/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(collection/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(db, "users", user/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid, "progress"/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(progress, /remoteUpdated > 0 && remoteUpdated >= localUpdated/);
  assert.match(progress, /JSON/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.stringify/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(merged/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g) !== JSON/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.stringify/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(local/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g[contentId/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g]/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(progress, /vivid:sync-status/);
  assert.match(progress, /progressSyncStatus/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g("error", user/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid, "sync"/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(progress, /progressSyncStatus/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g("synced", uid, contentId/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(intelligence, /if/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(remoteUpdatedAt<localVersion/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)return/);
  assert.match(intelligence, /getDocsFromServer/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(collection/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(db,"users",u/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid,"feedback"/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(intelligence, /getDocsFromServer/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(collection/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(db,"users",u/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid,"taste"/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(intelligence, /The signed-in account changed before intelligence state could be reconciled/);
  assert.match(intelligence, /const s=read/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g);const stateAtSync=localStorage/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.getItem/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(KEY/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|""/);
  assert.match(intelligence, /Local intelligence changed during sync; newer local state was retained/);
  assert.match(intelligence, /const ownerAtStart=localStorage/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.getItem/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(LOCAL_OWNER_KEY/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|"guest"/);
  assert.match(intelligence, //getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(localStorage/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.getItem/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(KEY/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|""/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)!==stateAtStart/);
});

test("auth listeners continue handling later account changes", () => {
  assert.match(progress, /onAuthStateChanged/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(auth, user => /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g{/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/gs*ensureProgressOwner/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(user/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g| null/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(intelligence, /onAuthStateChanged/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(auth,u=>/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g{/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/gs*ensureIntelligenceOwner/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(u/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g| null/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(library, /onAuthStateChanged/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(auth,user=>/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g{/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/gs*ensureLocalOwner/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(user/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g?/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.uid /getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g|/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g| null/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
});

test("intelligence sync reports outcomes and retries when the device reconnects", () => {
  assert.match(intelligence, /vivid:sync-status/);
  assert.match(intelligence, /window/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.addEventListener/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g("online"/);
  assert.match(intelligence, /localItem/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.updatedAt/);
  assert.match(intelligence, /feedbackCleared/);
  assert.match(intelligence, /s/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.feedback/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g[k/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g]=/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g{/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g./getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g./getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.i,kind:"like",updatedAt/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g};delete s/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.feedbackCleared/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g[k/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g]/);
  assert.match(intelligence, /kind:"cleared",updatedAt:Number/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(tombstone/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.updatedAt/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(intelligence, /Vivid intelligence sync unavailable; local state is retained for retry/);
});

test("progress and library retain local-first semantics when cloud sync fails", () => {
  assert.match(progress, /Vivid playback progress sync failed/);
  assert.match(progress, /writeProgress/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(current/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g)/);
  assert.match(library, /Do not replace local data until all required cloud operations have been/);
  assert.match(library, /The signed-in account changed during library sync/);
});


test("library sync normalizes numeric and missing years to Firestore-safe strings", () => {
  const numericYear = cleanItem({ id: 550, media_type: "movie", title: "The Matrix", year: 1999 });
  assert.equal(numericYear.year, "1999");
  assert.equal(typeof numericYear.year, "string");
  const missingYear = cleanItem({ id: 551, media_type: "movie", title: "Untitled" });
  assert.equal(missingYear.year, "");
  assert.equal(typeof missingYear.year, "string");
});

test("manual cloud library sync initializes App Check before Firestore access", () => {
  const syncBody = library.slice(
    library.indexOf("async function performLibrarySyncForUser"),
    library.indexOf("const syncInFlight")
  );
  assert.match(syncBody, /const firebase = await getFirebase/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g);/);
  assert.match(syncBody, /await firebase/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g.ensureAppCheck/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g(/getActiveProfileId\\\(owner\\.uid\\\) === owner\\.profileId/g);/);
  assert.ok(
    syncBody.indexOf("await firebase.ensureAppCheck()") <
    syncBody.indexOf("fetchRemote("),
    "App Check must initialize before the first Firestore server read"
  );
});
