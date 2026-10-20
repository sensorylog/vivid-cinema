/**
 * Native Notify — web push for a web site (added by Agent Notify).
 *
 * A self-contained ES module: no dependencies, no build step. It turns
 * browser notifications on for this browser and registers it with the
 * universal push service as a 'web' device:
 *
 *   1. registers the service worker (/native-notify-sw.js, served from the
 *      site root — it shows each push and opens its data.url on click),
 *   2. asks the browser for permission (call enableNativeNotifyWebPush from a
 *      click: several browsers only show the prompt after a user gesture),
 *   3. subscribes with the app's VAPID public key, fetched from
 *      GET /api/universal/web-push/keys/:appId/:appToken (the web key rides
 *      the appToken segment),
 *   4. registers the subscription:
 *      POST /api/universal/device/register
 *        { appId, appToken, platform: 'web', deviceId, subscriberId?, webPush }
 *   5. keeps itself registered: ensureNativeNotifyWebPush() re-registers a
 *      granted browser that lost its subscription (2026-10-02).
 *
 * The device id is this browser's 'nn_web_device_id' (localStorage) — the SAME
 * key the notification bell reads its inbox under, so the bell shows exactly
 * the pushes this browser receives.
 *
 * Values come from your site's own configuration — never hardcode them here:
 *   NN_APP_ID / NN_WEB_KEY  (NEXT_PUBLIC_NN_APP_ID / NEXT_PUBLIC_NN_WEB_KEY
 *   in a Next.js app) — NN_WEB_KEY is the PUBLISHABLE WEB KEY (dashboard →
 *   App keys): safe in page source, unlike the app token. See
 *   native-notify/web/README-web-push.md.
 */

const DEFAULT_API_BASE = 'https://app.nativenotify.com';
const DEFAULT_STORAGE_KEY = 'nn_web_device_id';
const DEFAULT_OPTOUT_KEY = 'nn_web_push_optout';
const DEFAULT_SERVICE_WORKER = '/native-notify-sw.js';

/**
 * The credential the web helpers accept: webKey (preferred — safe in page
 * source) or appToken (kept working for existing sites). One of the two is
 * required; the type says the same as the runtime (`webKey || appToken`).
 * @typedef {{ webKey: string | null | undefined, appToken?: string | null | undefined } | { appToken: string | null | undefined, webKey?: string | null | undefined }} NativeNotifyWebCredential
 */

/**
 * Options for the web push helpers. Only appId and a credential are required — prefer webKey.
 * @typedef {Object} NativeNotifyWebPushOptionsBase
 * @property {string | number | null | undefined} appId Your Native Notify app id (from config).
 * @property {string | null | undefined} [webKey] Your PUBLISHABLE WEB KEY (from config) — safe in page source.
 * @property {string | null | undefined} [appToken] Your Native Notify app token — kept working for existing sites; do not put it in page source.
 * @property {string | null | undefined} [subscriberId] Your own user id, to reach this person later by id.
 * @property {string | undefined} [serviceWorkerPath] Where the worker is served (default "/native-notify-sw.js").
 * @property {string | undefined} [storageKey] localStorage key for the per-browser id (default "nn_web_device_id").
 * @property {string | undefined} [optOutKey] localStorage key remembering the visitor turned notifications off (default "nn_web_push_optout").
 * @property {string | undefined} [apiBase] Defaults to https://app.nativenotify.com.
 * @property {typeof fetch | undefined} [fetch] Custom fetch (tests, proxies).
 */

/** @typedef {NativeNotifyWebPushOptionsBase & NativeNotifyWebCredential} NativeNotifyWebPushOptions */

/**
 * What enabling / disabling / the silent re-register returns.
 * @typedef {Object} NativeNotifyWebPushResult
 * @property {boolean} ok
 * @property {"enabled" | "disabled" | "skipped" | "unsupported" | "denied" | "dismissed" | "failed"} status
 * @property {string | null} deviceId
 * @property {string | null} [message] Why it failed (plain English).
 */

/**
 * The browser's current web push state.
 * @typedef {Object} NativeNotifyWebPushState
 * @property {boolean} supported
 * @property {NotificationPermission | "unsupported"} permission
 * @property {boolean} subscribed
 */

/** @type {{ __nnFallbackDeviceKey?: string }} */
const nnGlobal = /** @type {any} */ (globalThis);

function randomKey() {
  return 'nn-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

/**
 * This browser's stable device id (shared with the notification bell).
 * @param {string} [storageKey]
 * @returns {string}
 */
export function getWebDeviceId(storageKey) {
  const key = storageKey || DEFAULT_STORAGE_KEY;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const fresh = randomKey();
    window.localStorage.setItem(key, fresh);
    return fresh;
  } catch (err) {
    if (!nnGlobal.__nnFallbackDeviceKey) nnGlobal.__nnFallbackDeviceKey = randomKey();
    return nnGlobal.__nnFallbackDeviceKey;
  }
}

/**
 * The visitor's explicit "Turn off notifications" choice (localStorage): the
 * browser keeps its granted permission after turning off, so the silent
 * re-register must respect it. Omit `set` to read; pass true/false to write.
 * @param {string} [optOutKey]
 * @param {boolean} [set]
 * @returns {boolean}
 */
function optOut(optOutKey, set) {
  const key = optOutKey || DEFAULT_OPTOUT_KEY;
  try {
    if (set === true) window.localStorage.setItem(key, '1');
    else if (set === false) window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === '1';
  } catch (err) {
    /* storage can be unavailable — best effort */
    return false;
  }
}

/** @returns {boolean} whether this browser can do web push at all */
export function isWebPushSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * The VAPID public key (base64url) → the bytes pushManager.subscribe wants.
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * @param {ArrayBuffer | null | undefined} a
 * @param {Uint8Array} b
 */
function sameKey(a, b) {
  if (!a) return false;
  const bytes = new Uint8Array(a);
  if (bytes.length !== b.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] !== b[i]) return false;
  return true;
}

/** @param {NativeNotifyWebPushOptions} opts */
function settings(opts) {
  // 2026-09-29: prefer the PUBLISHABLE WEB KEY (`webKey`, safe in page
  // source); `appToken` keeps every existing site working. Either rides the
  // same appToken field on the wire.
  const credential = opts && (opts.webKey || opts.appToken);
  if (!opts || opts.appId === undefined || opts.appId === null || opts.appId === '' || !credential) {
    throw new Error('Native Notify: appId and webKey are required (read them from your config).');
  }
  const doFetch =
    typeof opts.fetch === 'function' ? opts.fetch : /** @type {typeof fetch} */ ((input, init) => window.fetch(input, init));
  return {
    apiBase: String(opts.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
    appId: String(opts.appId),
    appToken: String(credential),
    doFetch,
  };
}

/**
 * @param {typeof fetch} doFetch
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function requestJson(doFetch, url, init) {
  const res = await doFetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json && json.error ? json.error : {};
    throw new Error(detail.message || 'Native Notify request failed (HTTP ' + res.status + ').');
  }
  return json;
}

/**
 * The browser's current state: supported, permission, subscribed.
 * @param {NativeNotifyWebPushOptions | undefined} [options]
 * @returns {Promise<NativeNotifyWebPushState>}
 */
export async function getWebPushState(options) {
  if (!isWebPushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const path = (options && options.serviceWorkerPath) || DEFAULT_SERVICE_WORKER;
  let subscribed = false;
  try {
    const registration = await navigator.serviceWorker.getRegistration(path);
    subscribed = Boolean(registration && (await registration.pushManager.getSubscription()));
  } catch (err) {
    subscribed = false;
  }
  return { supported: true, permission: Notification.permission, subscribed };
}

/**
 * Turn web push on for this browser — call it from a click ("Enable
 * notifications"). Safe to call again: it refreshes the registration.
 * @param {NativeNotifyWebPushOptions} options
 * @returns {Promise<NativeNotifyWebPushResult>}
 */
export async function enableNativeNotifyWebPush(options) {
  const opts = options || /** @type {any} */ ({});
  const deviceId = isWebPushSupported() ? getWebDeviceId(opts.storageKey) : null;
  if (!isWebPushSupported()) {
    return { ok: false, status: 'unsupported', deviceId, message: 'This browser does not support web push notifications.' };
  }
  try {
    const { apiBase, appId, appToken, doFetch } = settings(opts);
    // The visitor asked for notifications: forget any earlier opt-out.
    optOut(opts.optOutKey, false);
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        ok: false,
        status: permission === 'denied' ? 'denied' : 'dismissed',
        deviceId,
        message: permission === 'denied' ? 'Notifications are blocked for this site in the browser settings.' : 'The permission prompt was dismissed.',
      };
    }
    const workerPath = opts.serviceWorkerPath || DEFAULT_SERVICE_WORKER;
    // One service worker per scope: never replace a site's own worker (a PWA
    // / offline worker) with ours — point serviceWorkerPath at that worker and
    // add the Native Notify push listeners to it instead.
    const current = await navigator.serviceWorker.getRegistration();
    const currentWorker = current && (current.active || current.waiting || current.installing);
    if (currentWorker && new URL(currentWorker.scriptURL).pathname !== new URL(workerPath, window.location.href).pathname) {
      return {
        ok: false,
        status: 'failed',
        deviceId,
        message: `This site already has a service worker (${new URL(currentWorker.scriptURL).pathname}). Add the Native Notify push listeners to it and pass serviceWorkerPath: "${new URL(currentWorker.scriptURL).pathname}" — registering a second one would replace it.`,
      };
    }
    await navigator.serviceWorker.register(workerPath);
    const registration = await navigator.serviceWorker.ready;
    const keys = await requestJson(doFetch, apiBase + '/api/universal/web-push/keys/' + encodeURIComponent(appId) + '/' + encodeURIComponent(appToken));
    const publicKey = keys && keys.vapid && keys.vapid.publicKey;
    if (!publicKey) throw new Error('Native Notify did not return a web push key for this app.');
    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    // A subscription made with an older (rotated) key can no longer receive.
    if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: /** @type {BufferSource} */ (applicationServerKey),
      });
    }
    await requestJson(doFetch, apiBase + '/api/universal/device/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: Number(appId),
        appToken,
        platform: 'web',
        deviceId,
        subscriberId: opts.subscriberId || undefined,
        webPush: subscription.toJSON(),
      }),
    });
    return { ok: true, status: 'enabled', deviceId };
  } catch (err) {
    return { ok: false, status: 'failed', deviceId, message: err instanceof Error ? err.message : 'Web push could not be enabled.' };
  }
}

/**
 * Keep this browser registered WITHOUT a prompt or a click — call it on page
 * load. A granted browser can lose its subscription (site data cleared,
 * subscription expired) and the dialog is gone for good there, so waiting
 * for a click strands it. Nothing shows when permission is already granted;
 * un-granted browsers are left alone and an opt-out is respected.
 * @param {NativeNotifyWebPushOptions} options
 * @returns {Promise<NativeNotifyWebPushResult>}
 */
export async function ensureNativeNotifyWebPush(options) {
  const opts = options || /** @type {any} */ ({});
  const state = await getWebPushState(opts);
  if (!state.supported || state.permission !== 'granted' || optOut(opts.optOutKey)) {
    return { ok: false, status: 'skipped', deviceId: state.supported ? getWebDeviceId(opts.storageKey) : null };
  }
  return enableNativeNotifyWebPush(opts);
}

/**
 * Turn web push off for this browser (unsubscribe + deregister the device).
 * @param {NativeNotifyWebPushOptions} options
 * @returns {Promise<NativeNotifyWebPushResult>}
 */
export async function disableNativeNotifyWebPush(options) {
  const opts = options || /** @type {any} */ ({});
  if (!isWebPushSupported()) return { ok: false, status: 'unsupported', deviceId: null };
  const deviceId = getWebDeviceId(opts.storageKey);
  // The visitor's choice — the silent re-register must respect it.
  optOut(opts.optOutKey, true);
  try {
    const { apiBase, appId, appToken, doFetch } = settings(opts);
    const registration = await navigator.serviceWorker.getRegistration(opts.serviceWorkerPath || DEFAULT_SERVICE_WORKER);
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription) await subscription.unsubscribe();
    await requestJson(doFetch, apiBase + '/api/universal/device/deregister', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: Number(appId), appToken, deviceId }),
    });
    return { ok: true, status: 'disabled', deviceId };
  } catch (err) {
    return { ok: false, status: 'failed', deviceId, message: err instanceof Error ? err.message : 'Web push could not be turned off.' };
  }
}
