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

test("the registration client targets the verified universal web push endpoints", async () => {
  const client = await readFile(new URL("../native-notify/web/native-notify-web-push.js", import.meta.url), "utf8");
  // Verified against the live API on 2026-10-20:
  //   GET /api/universal/web-push/keys/:appId/:webKey -> { vapid: { publicKey } }
  //   webPush.registerPath -> /api/universal/device/register
  assert.match(client, /'\/api\/universal\/web-push\/keys\/'/);
  assert.match(client, /keys && keys\.vapid && keys\.vapid\.publicKey/);
  assert.match(client, /'\/api\/universal\/device\/register'/);
  assert.match(client, /platform: 'web'/);
  assert.match(client, /webPush: subscription\.toJSON\(\)/);
  // The VAPID key is fetched, never hardcoded, so a rotated key still works.
  assert.doesNotMatch(client, /applicationServerKey: "B/);
});

test("the add-on's draft worker is inert and cannot take over the site scope", async () => {
  const draft = await readFile(new URL("../native-notify-sw.js", import.meta.url), "utf8");
  assert.doesNotMatch(draft, /self\.registration\.showNotification/);
  assert.doesNotMatch(draft, /addEventListener\(['"]push/);
  assert.doesNotMatch(draft, /addEventListener\(['"]notificationclick/);
  assert.match(draft, /self\.registration\.unregister\(\)/);
});

test("a notification click still opens the link when the tab cannot be navigated", async () => {
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(worker, /try\{await existing\.navigate\(target\)\}catch\{\}/);
  assert.match(worker, /return existing\.focus\(\)/);
  assert.match(worker, /then\(async list=>/);
});

// ---------------------------------------------------------------------------
// Behaviour tests. These run the REAL registration modules against a fake
// browser, so the endpoints, the request body and the page-load cost are
// exercised instead of merely matched as source text.
// ---------------------------------------------------------------------------
const NN_APP_ID = 33997;
const NN_WEB_KEY = "nnweb_17fddb48834e82ae4a61b6338aea1b74840941721bbfec2d";
// The key the API returns for this app (GET /api/universal/web-push/keys/:appId/:webKey).
const NN_VAPID_PUBLIC_KEY = "BGeQhf3dp-gLCmXB4s25Si0MBVKzZ_jr6eQ9b5KTjWQvlTYM61VTd3XzVcB1N02W57CMd_MEEr8sQPbwiiIJVbw";

function setGlobal(name, value) {
  // Node exposes navigator as a getter on globalThis, so define rather than assign.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function vapidKeyBytes(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function installFakeBrowser({ permission = "granted", legacySubscription = false } = {}) {
  const calls = [];
  const store = new Map();
  const expectedKey = vapidKeyBytes(NN_VAPID_PUBLIC_KEY);
  const makeSubscription = () => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/vivid-browser-1",
    options: { applicationServerKey: legacySubscription ? new Uint8Array([9, 9, 9]).buffer : expectedKey.slice().buffer, userVisibleOnly: true },
    toJSON() {
      return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: "p256dh-key", auth: "auth-secret" } };
    },
    async unsubscribe() {
      calls.push({ unsubscribe: true });
      return true;
    },
  });
  const state = { subscription: makeSubscription() };
  const registration = {
    active: { scriptURL: "https://vivid-cinema.web.app/service-worker.js" },
    waiting: null,
    installing: null,
    pushManager: {
      async getSubscription() {
        return state.subscription;
      },
      async subscribe(options) {
        calls.push({ subscribe: options });
        state.subscription = makeSubscription();
        return state.subscription;
      },
    },
  };
  const notify = {
    permission,
    async requestPermission() {
      calls.push({ requestPermission: true });
      return permission === "default" ? "granted" : permission;
    },
  };
  const browserWindow = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    location: { href: "https://vivid-cinema.web.app/home.html" },
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    async fetch(url, init) {
      calls.push({ url: String(url), init });
      if (String(url).includes("/api/universal/web-push/keys/")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, vapid: { publicKey: NN_VAPID_PUBLIC_KEY } }) };
      }
      if (String(url).includes("/api/universal/device/register")) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 404, json: async () => ({ error: { message: "not found" } }) };
    },
    PushManager: function PushManager() {},
    Notification: notify,
  };
  setGlobal("window", browserWindow);
  setGlobal("Notification", notify);
  setGlobal("navigator", {
    serviceWorker: {
      async getRegistration() {
        return registration;
      },
      async register(path, options) {
        calls.push({ register: String(path), options });
        return registration;
      },
      ready: Promise.resolve(registration),
    },
  });
  return { calls, expectedKey, store };
}

const pushModule = await import(new URL("../scripts/push-notifications.js", import.meta.url));

test("page load never asks for permission or calls the API before the visitor allows it", async () => {
  const env = installFakeBrowser({ permission: "default" });
  const result = await pushModule.ensureCinemaPush();
  assert.equal(result.ok, false);
  assert.equal(result.status, "skipped");
  assert.equal(env.calls.filter((call) => call.url || call.register || call.requestPermission).length, 0);
});

test("enabling a browser registers it with Native Notify and reuses its subscription", async () => {
  const env = installFakeBrowser({ permission: "default" });
  const result = await pushModule.enableCinemaPush();
  // enableCinemaPush throws when enabling fails, so reaching this line is the
  // success signal; it returns { deviceId } (the client's own result shape is
  // internal to the module).
  assert.equal(typeof result.deviceId, "string");
  assert.equal(result.deviceId.startsWith("nn-"), true);
  const keys = env.calls.find((call) => call.url && call.url.includes("/api/universal/web-push/keys/" + NN_APP_ID + "/"));
  assert.ok(keys, "the VAPID key is fetched for app 33997");
  assert.ok(keys.url.endsWith("/" + NN_WEB_KEY), "the publishable web key authenticates the key fetch");
  const register = env.calls.find((call) => call.url && call.url.endsWith("/api/universal/device/register"));
  assert.ok(register, "the device is registered at the path the API advertises");
  assert.equal(register.init.method, "POST");
  const body = JSON.parse(register.init.body);
  assert.equal(body.appId, NN_APP_ID);
  assert.equal(body.platform, "web");
  assert.equal(body.appToken, NN_WEB_KEY);
  assert.equal(typeof body.deviceId, "string");
  assert.equal(body.webPush.endpoint, "https://fcm.googleapis.com/fcm/send/vivid-browser-1");
  assert.ok(body.webPush.keys.p256dh && body.webPush.keys.auth);
  assert.equal(env.calls.some((call) => call.subscribe || call.unsubscribe), false, "an existing subscription is reused, never re-subscribed");
});

test("a browser subscribed with the old VAPID key is moved onto the Native Notify key", async () => {
  const env = installFakeBrowser({ permission: "granted", legacySubscription: true });
  const result = await pushModule.enableCinemaPush();
  assert.equal(typeof result.deviceId, "string");
  assert.equal(env.calls.some((call) => call.unsubscribe), true, "the dead legacy subscription is dropped");
  const subscribe = env.calls.find((call) => call.subscribe);
  assert.ok(subscribe, "a new subscription is created with the Native Notify key");
  assert.equal(subscribe.subscribe.userVisibleOnly, true);
  assert.deepEqual(Array.from(new Uint8Array(subscribe.subscribe.applicationServerKey)), Array.from(env.expectedKey));
});

test("the silent refresh registers once per browser, not on every page load", async () => {
  const env = installFakeBrowser({ permission: "granted" });
  const registerCalls = () => env.calls.filter((call) => call.url && call.url.endsWith("/api/universal/device/register")).length;
  const first = await pushModule.ensureCinemaPush();
  assert.equal(first.ok, true);
  assert.equal(registerCalls(), 1);
  const second = await pushModule.ensureCinemaPush();
  assert.equal(second.status, "skipped");
  assert.equal(registerCalls(), 1, "a second page load does not register the browser again");
});

test("Vivid's own service worker registration options are restored after registering", async () => {
  const env = installFakeBrowser({ permission: "granted" });
  await pushModule.enableCinemaPush();
  const registrations = env.calls.filter((call) => call.register);
  assert.ok(registrations.length >= 1);
  const restored = registrations[registrations.length - 1];
  assert.equal(restored.register, "/service-worker.js");
  assert.equal(restored.options.scope, "./");
  assert.equal(restored.options.updateViaCache, "none", "the PWA's update mode must survive");
});
