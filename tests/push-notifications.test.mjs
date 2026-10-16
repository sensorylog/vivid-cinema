import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/push-notifications.js", import.meta.url), "utf8");
const disableBlock = source.match(/export async function disableCinemaPush\(\)\{([\s\S]*?)\n\}/)?.[1] || "";

test("disabling push removes only the current browser endpoint", () => {
  assert.ok(disableBlock, "disableCinemaPush must exist");
  assert.match(disableBlock, /getSubscription\(\)/);
  assert.match(disableBlock, /keyId\(subscription\.endpoint\)/);
  assert.match(disableBlock, /deleteDoc\(doc\(db,"users",user\.uid,SUBS_COLLECTION,keyId\(subscription\.endpoint\)\)\)/);
  assert.doesNotMatch(disableBlock, /getDocs\(|snapshot\.docs\.map/);
});

test("push opt-out reports remote cleanup and unsubscribe failures", () => {
  assert.match(disableBlock, /remoteRemovalSucceeded=false/);
  assert.match(disableBlock, /if\(subscription\)await subscription\.unsubscribe\(\)/);
  assert.match(disableBlock, /return remoteRemovalSucceeded/);
});

test("push notifications use the same Firebase SDK version as the shared Firebase app", async () => {
  const firebase = await readFile(new URL("../scripts/firebase.js", import.meta.url), "utf8");
  const appVersion = firebase.match(/firebase-app\.js/);
  assert.ok(appVersion, "shared Firebase app SDK import must exist");
  const sharedVersion = firebase.match(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-app\.js/)?.[1];
  const authVersion = source.match(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-auth\.js/)?.[1];
  const firestoreVersion = source.match(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-firestore\.js/)?.[1];
  assert.ok(sharedVersion, "shared Firebase SDK version must be explicit");
  assert.equal(authVersion, sharedVersion, "push auth SDK must match shared Firebase SDK");
  assert.equal(firestoreVersion, sharedVersion, "push Firestore SDK must match shared Firebase SDK");
});
