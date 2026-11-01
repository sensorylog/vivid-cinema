import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source=await readFile(new URL("../scripts/push-notifications.js",import.meta.url),"utf8");
const publicKey="BMNW0k1P89YhNVPP4NJYa4mDOw2arwbEJUPJ3mDcV6UpcSn-WP_T2PqJc6ANEkvtzUe9LacEMJ4com85M4w-eN8";

test("Vivid registers browser push directly with its own VAPID public key",()=>{
  assert.match(source,/const VAPID_PUBLIC_KEY=/);
  assert.ok(source.includes(publicKey));
  assert.match(source,/pushManager\.subscribe\(\{userVisibleOnly:true,applicationServerKey:key\}\)/);
  assert.match(source,/subscription\.toJSON\(\)/);
  assert.match(source,/setDoc\(doc\(db,"users",user\.uid,SUBS_COLLECTION,keyId\(json\.endpoint\)\)/);
  assert.doesNotMatch(source,/NativeNotify|native-notify|app\.nativenotify\.com|NN_APP_ID|NN_WEB_KEY/);
});

test("push subscriptions are tied to the signed-in user and preserve browser opt-out",()=>{
  assert.match(source,/Sign in to Vivid Cinema before enabling notifications/);
  assert.match(source,/window\.Notification\.permission/);
  assert.match(source,/LEGACY_OPTOUT_KEY="nn_web_push_optout"/);
  assert.match(source,/optedOut\(\)/);
  assert.match(source,/applicationServerKey/);
});

test("disabling push removes only the current browser endpoint",()=>{
  const block=source.match(/export async function disableCinemaPush\(\)\{([\s\S]*?)\n\}/)?.[1]||"";
  assert.ok(block);
  assert.match(block,/getSubscription\(\)/);
  assert.match(block,/keyId\(subscription\.endpoint\)/);
  assert.match(block,/deleteDoc\(doc\(db,"users",user\.uid,SUBS_COLLECTION,keyId\(subscription\.endpoint\)\)\)/);
  assert.match(block,/if\(subscription\)await subscription\.unsubscribe\(\)/);
  assert.match(block,/return remoteRemovalSucceeded/);
  assert.doesNotMatch(block,/getDocs\(|snapshot\.docs\.map/);
});

test("push notification Firebase SDK versions match the shared Firebase app",async()=>{
  const firebase=await readFile(new URL("../scripts/firebase.js",import.meta.url),"utf8");
  const shared=firebase.match(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-app\.js/)?.[1];
  const auth=source.match(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-auth\.js/)?.[1];
  const firestore=source.match(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-firestore\.js/)?.[1];
  assert.ok(shared);
  assert.equal(auth,shared);
  assert.equal(firestore,shared);
});

test("the service worker keeps push display and safe notification click-through",async()=>{
  const worker=await readFile(new URL("../service-worker.js",import.meta.url),"utf8");
  assert.match(worker,/addEventListener\("push"/);
  assert.match(worker,/Your Vivid Cinema reminder is ready\./);
  assert.match(worker,/function safeNotificationUrl\(/);
  assert.match(worker,/addEventListener\("notificationclick"/);
  assert.match(worker,/addEventListener\("fetch"/);
});

test("hosting no longer needs Native Notify as a connection origin",async()=>{
  const hosting=await readFile(new URL("../firebase.json",import.meta.url),"utf8");
  assert.doesNotMatch(hosting,/app\.nativenotify\.com/);
});

test("both scheduled senders use the same Vivid VAPID public key",async()=>{
  for(const file of ["send-cinema-reminders.mjs","send-release-alerts.mjs"]){
    const sender=await readFile(new URL("../automation/"+file,import.meta.url),"utf8");
    assert.ok(sender.includes(publicKey),file+" must use the configured Vivid public key");
    assert.match(sender,/process\.env\.VAPID_PRIVATE_KEY/);
    assert.doesNotMatch(sender,/BGZNNqdOPr-/);
  }
});

test("the Native Notify add-on worker remains inert and cannot take over the site scope",async()=>{
  const worker=await readFile(new URL("../native-notify-sw.js",import.meta.url),"utf8");
  assert.doesNotMatch(worker,/self\.registration\.showNotification/);
  assert.doesNotMatch(worker,/addEventListener\(['"]push/);
  assert.doesNotMatch(worker,/addEventListener\(['"]notificationclick/);
  assert.match(worker,/self\.registration\.unregister\(\)/);
});
