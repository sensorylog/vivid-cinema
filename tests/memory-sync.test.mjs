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

test("playback and intelligence cloud writes are bound to the active profile", () => {
  assert.ok(progress.includes('const ownerAtQueue = localStorage.getItem(LOCAL_OWNER_KEY) || "guest"'));
  assert.ok(progress.includes("activeOwner === ownerAtQueue"));
  assert.ok(progress.includes("getActiveProfileId(owner.uid) === owner.profileId"));
  assert.ok(progress.includes('collection(db, "users", user.uid, "profiles", profileId, "progress")'));
  assert.match(progress, /remoteUpdated > 0 && remoteUpdated >= localUpdated/);
  assert.match(progress, /JSON\.stringify\(merged\) !== JSON\.stringify\(local\[contentId\]\)/);
  assert.match(progress, /progressSyncStatus\("error", user\.uid, "sync"\)/);
  assert.match(intelligence, /if\(remoteUpdatedAt<localVersion\)return/);
  assert.ok(intelligence.includes('collection(db,"users",u.uid,"profiles",profileId,"feedback")'));
  assert.ok(intelligence.includes('collection(db,"users",u.uid,"profiles",profileId,"taste")'));
  assert.match(intelligence, /The signed-in account changed before intelligence state could be reconciled/);
  assert.match(intelligence, /Local intelligence changed during sync; newer local state was retained/);
  assert.match(intelligence, /const ownerAtStart=localStorage\.getItem\(LOCAL_OWNER_KEY\)\|\|"guest"/);
  assert.match(intelligence, /\(localStorage\.getItem\(KEY\)\|\|""\)!==stateAtStart/);
});

test("auth listeners continue handling later account and profile changes", () => {
  assert.ok(progress.includes("onAuthStateChanged(auth, user => {"));
  assert.ok(progress.includes("ensureProgressOwner(user?.uid || null)"));
  assert.ok(intelligence.includes("onAuthStateChanged(auth,u=>{"));
  assert.ok(intelligence.includes("ensureIntelligenceOwner(u?.uid || null)"));
  assert.ok(library.includes("onAuthStateChanged(auth,user=>{"));
  assert.ok(library.includes("ensureLocalOwner(user?.uid || null)"));
  assert.match(progress, /vivid:profile-changed/);
  assert.match(intelligence, /vivid:profile-changed/);
  assert.match(library, /vivid:profile-changed/);
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
