import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanItem } from "../scripts/library.js";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const library = read("../scripts/library.js");
const progress = read("../scripts/recommendations.js");
const intelligence = read("../scripts/intelligence.js");

test("profile-aware local stores use the shared snapshot migration policy", () => {
  for (const source of [library, progress, intelligence]) {
    assert.ok(source.includes("switchLocalOwner("));
    assert.ok(source.includes("seedLegacyOwnerProfileSnapshot("));
    assert.ok(source.includes("getActiveProfileId("));
  }
  assert.ok(library.includes('activeKeys:[STORAGE_KEY,TOMBSTONE_STORAGE_KEY]'));
  assert.ok(progress.includes("FOR_YOU_CACHE_KEY"));
  assert.ok(intelligence.includes("TASTE_CACHE_KEY"));
});

test("playback progress reads and writes are scoped to the active profile", () => {
  assert.ok(progress.includes('doc(db, "users", uid, "profiles", profileId, "progress", contentId)'));
  assert.ok(progress.includes('collection(db, "users", user.uid, "profiles", profileId, "progress")'));
  assert.ok(progress.includes("getActiveProfileId(owner.uid) === owner.profileId"));
  assert.ok(progress.includes("const ownerAtQueue = localStorage.getItem(LOCAL_OWNER_KEY) || \"guest\""));
  assert.ok(progress.includes("activeOwner === ownerAtQueue"));
  assert.ok(progress.includes("initializeProfileFoundation(user)"));
  assert.match(progress, /remoteUpdated > 0 && remoteUpdated >= localUpdated/);
  assert.match(progress, /JSON\.stringify\(merged\) !== JSON\.stringify\(local\[contentId\]\)/);
  assert.match(progress, /progressSyncStatus\("error", user\.uid, "sync"\)/);
});

test("recommendation intelligence stores feedback, events and taste per profile", () => {
  for (const name of ["feedback", "events", "taste"]) {
    assert.ok(intelligence.includes('"profiles",profileId,"' + name + '"'));
  }
  assert.ok(intelligence.includes('"profiles",owner.profileId,...path'));
  assert.ok(intelligence.includes("const scopedOwner=String(u.uid)+\"::\"+String(profileId)"));
  assert.ok(intelligence.includes("initializeProfileFoundation(u)"));
  assert.match(intelligence, /if\(remoteUpdatedAt<localVersion\)return/);
  assert.match(intelligence, /Local intelligence changed during sync; newer local state was retained/);
});

test("all local-first stores react to profile changes and retain account-switch guards", () => {
  for (const source of [library, progress, intelligence]) {
    assert.ok(source.includes('window.addEventListener("vivid:profile-changed"'));
  }
  assert.ok(library.includes("The active account or profile changed during library sync"));
  assert.ok(progress.includes("The signed-in account changed during playback progress sync"));
  assert.ok(intelligence.includes("The signed-in account changed during intelligence sync"));
});

test("library and progress retain local-first state when cloud sync fails", () => {
  assert.match(progress, /Vivid playback progress sync failed/);
  assert.match(progress, /writeProgress\(current\)/);
  assert.match(library, /Do not replace local data until all required cloud operations have been/);
  assert.match(library, /The active account or profile changed during library sync/);
});

test("library sync normalizes numeric and missing years to Firestore-safe strings", () => {
  const numericYear = cleanItem({ id: 550, media_type: "movie", title: "The Matrix", year: 1999 });
  assert.equal(numericYear.year, "1999");
  assert.equal(typeof numericYear.year, "string");
  const missingYear = cleanItem({ id: 551, media_type: "movie", title: "Untitled" });
  assert.equal(missingYear.year, "");
  assert.equal(typeof missingYear.year, "string");
});

test("profile migration and App Check run before the first library server read", () => {
  const syncBody = library.slice(
    library.indexOf("async function performLibrarySyncForUser"),
    library.indexOf("const syncInFlight")
  );
  assert.ok(syncBody.indexOf("await initializeProfileFoundation(user)") >= 0);
  assert.ok(syncBody.indexOf("await firebase.ensureAppCheck()") > syncBody.indexOf("const firebase = await getFirebase()"));
  assert.ok(syncBody.indexOf("await firebase.ensureAppCheck()") < syncBody.indexOf("fetchRemote("));
});
