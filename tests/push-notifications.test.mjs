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
