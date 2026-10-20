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

test("browser push registration goes through Native Notify using the existing service worker", () => {
  assert.match(source, /from "\.\.\/native-notify\/web\/native-notify-web-push\.js"/);
  assert.match(source, /from "\.\.\/native-notify\/web\/nativeNotifyIds\.js"/);
  assert.match(source, /const PUSH_SERVICE_WORKER="\/service-worker\.js"/);
  assert.match(source, /serviceWorkerPath:PUSH_SERVICE_WORKER/);
  assert.match(source, /enableNativeNotifyWebPush\(/);
  // One browser can hold only one push subscription, so the old hand-rolled
  // VAPID subscription (and its hardcoded key) must be gone entirely.
  assert.doesNotMatch(source, /pushManager\.subscribe\(/);
  assert.doesNotMatch(source, /VAPID_PUBLIC_KEY/);
});

test("the existing service worker understands Native Notify pushes and keeps reminders working", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /const deepLink=\(nested&&\(nested\.url\|\|nested\.link\)\)\|\|data\.url/);
  assert.match(worker, /options\.image=data\.image/);
  assert.match(worker, /Your Vivid Cinema reminder is ready\./);
  // Caching, update and click behaviour must stay in this one worker.
  assert.match(worker, /function safeNotificationUrl\(/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /addEventListener\("fetch"/);
});

test("the hosting CSP allows the Native Notify API", async () => {
  const hosting = await readFile(new URL("../firebase.json", import.meta.url), "utf8");
  assert.match(hosting, /connect-src[^"]*https:\/\/app\.nativenotify\.com/);
});

test("scheduled reminder senders stay untouched until the Native Notify send API is verified", async () => {
  for (const file of ["send-cinema-reminders.mjs", "send-release-alerts.mjs"]) {
    const sender = await readFile(new URL("../automation/" + file, import.meta.url), "utf8");
    assert.doesNotMatch(sender, /nativenotify/i);
  }
});
