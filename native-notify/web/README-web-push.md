# Agent Notify — web push (browser notifications)

_Added by Agent Notify (add-on: Web push, v1, base stack: Other — any framework (REST))._

This pull request lets your site turn on browser notifications and register
each browser with Native Notify as a **web** device. It is additive — nothing
existing is modified.

> **Public values only.** `native-notify/web/nativeNotifyIds.js` holds your app id and the PUBLISHABLE web key — both safe to commit and in page source. Never put your app **token** (the key that can send) in website code.

## What is in this PR

- `native-notify-sw.js` — the service worker. It must be served from the site ROOT as
  `/native-notify-sw.js` (it shows each push and opens its `data.url` on click).
- `native-notify/web/native-notify-web-push.js` — plain-JS module: `enableNativeNotifyWebPush`,
  `disableNativeNotifyWebPush`, `getWebPushState`, `isWebPushSupported`.
- `native-notify/web/NativeNotifyWebPush.jsx` — React / Next.js: `<NativeNotifyWebPushButton />`
  and the `useNativeNotifyWebPush` hook (`"use client"`).
- `native-notify/web/nativeNotifyIds.js` — your app id and PUBLISHABLE web key (public by design:
  it can register a browser and read that browser's own inbox, never send).
  The mount imports it, so there is nothing to set in your host — no
  environment variables. Regenerated the web key in Native Notify? Ask Agent
  Notify to update this file.
- This guide.

## How it works

1. Registers `/native-notify-sw.js` (scope: the whole site).
2. Asks for notification permission — **from a click**: several browsers only
   show the prompt after a user gesture, so never call it on page load.
3. Fetches the app's VAPID public key from
   `GET /api/universal/web-push/keys/:appId/:appToken` and subscribes.
4. Registers the subscription:
   `POST /api/universal/device/register { appId, appToken, platform: "web", deviceId, subscriberId?, webPush }`.
5. Keeps itself registered on every visit: `ensureNativeNotifyWebPush()`
   re-registers a browser that already GRANTED permission but lost its
   subscription or device id (cleared site data, an expired subscription) —
   silently, no prompt and no click. The React hook does it on mount; in
   plain JS call it once per page load. A browser the visitor turned
   notifications off for is left alone (2026-10-02).

The device id is this browser's `nn_web_device_id` (localStorage) — the same
key the notification bell reads its inbox under, so the bell shows exactly the
pushes this browser receives.

## Wire it up

### React / Next.js

`NativeNotifyWebPush.jsx` is a client component, so a Next.js App Router
layout or page can render it directly. Only `appId` and a credential are
required — prefer `webKey` (the PUBLISHABLE WEB KEY, safe in page source);
`appToken` keeps working for existing sites (JSDoc-typed — a strict
TypeScript project type-checks this as is):

```tsx
import NativeNotifyWebPushButton from "@/native-notify/web/NativeNotifyWebPush";
import { NN_APP_ID, NN_WEB_KEY } from "@/native-notify/web/nativeNotifyIds";

// App id + publishable web key: written to native-notify/web/nativeNotifyIds.js by Agent Notify —
// public values, nothing to set in your host.

export function SiteHeader() {
  return (
    <header>
      {/* the rest of your header */}
      <NativeNotifyWebPushButton
        appId={NN_APP_ID}
        webKey={NN_WEB_KEY}
      />
    </header>
  );
}
```

For your own UI use the hook: `const push = useNativeNotifyWebPush({ appId, webKey });`
→ `push.supported`, `push.permission`, `push.subscribed`, `push.busy`,
`push.error`, `push.enable()` (call it from a click), `push.disable()`.

### Plain JS

```js
import { enableNativeNotifyWebPush } from "/native-notify/web/native-notify-web-push.js";
import { NN_APP_ID, NN_WEB_KEY } from "/native-notify/web/nativeNotifyIds.js"; // public values, written by Agent Notify

document.querySelector("#enable-push").addEventListener("click", async () => {
  const result = await enableNativeNotifyWebPush({ appId: NN_APP_ID, webKey: NN_WEB_KEY });
  if (!result.ok) console.warn(result.message);
});
```

A browser that already granted permission but lost its subscription (for
example after a visitor clears the site's data) can never return through the
permission prompt — the dialog is gone for good. Re-register it silently on
every page load (no prompt, no click; a browser the visitor turned
notifications off for stays off):

```js
import { ensureNativeNotifyWebPush } from "/native-notify/web/native-notify-web-push.js";
ensureNativeNotifyWebPush({ appId: NN_APP_ID, webKey: NN_WEB_KEY });
```

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `appId` / `webKey` | — | Required. `webKey` is the app's PUBLISHABLE WEB KEY (Native Notify → Keys) — safe in page source. `appToken` keeps working for sites that already use one. |
| `subscriberId` | — | Your own user id, so you can later push to this person by id. |
| `serviceWorkerPath` | `/native-notify-sw.js` | Where the worker is served. |
| `apiBase` | `https://app.nativenotify.com` | The Native Notify API. |

### Already have a service worker?

A site can have only **one service worker per scope**. If yours already has
one (a PWA / offline worker), do NOT register `/native-notify-sw.js` — copy
its two listeners (`push` and `notificationclick`) into your existing
worker and pass `serviceWorkerPath` with your worker's path.
`enableNativeNotifyWebPush` refuses (with that explanation) rather than
replace another worker.

## Not seeing the notification? Check your machine before the code

A push can be **accepted** by the browser's push service and still show
nothing: "accepted" only proves the first hop (Native Notify → the push
service). The last hop — push service → browser → the banner — depends on the
machine's own notification settings, and that is the most common reason a
working push looks broken. Check both, in this order:

**1. The operating system must allow the browser to notify at all**

- **macOS** — Apple menu → System Settings → Notifications → your browser
  (Chrome / Firefox / Safari / Edge): **Allow Notifications ON**, style
  **Banners** or Alerts. Turn **Focus / Do Not Disturb** off, and keep the
  browser running (a fully quit browser shows nothing until it reopens).
- **Windows** — Settings → System → Notifications: Notifications ON with the
  browser allowed in the per-app list; turn **Do Not Disturb / Focus assist**
  off.
- **Linux** — your desktop's notification settings (GNOME: Settings →
  Notifications; KDE: System Settings → Notifications) with Do Not Disturb
  off and a notification daemon running.

**2. The browser must allow this site**

- **Chrome** — the tune icon by the address bar → Notifications → Allow (or
  Settings → Site settings → Notifications); "quieter messaging" can swallow
  the banner, and a pending **"Relaunch to update"** suppresses notifications
  until Chrome restarts.
- **Firefox** — Settings → Privacy & Security → Notifications → the site's
  entry must say Allow.
- **Safari** — Settings → Websites → Notifications → Allow; on iPhone/iPad
  the site must be added to the Home Screen first.

The **bell's inbox is the discriminator**: a send that reaches the inbox but
shows no banner was muted by a setting above; an empty inbox means the push
never reached the browser (a registration/subscription problem, not a display
one).

**If a tap on the banner does nothing:** a tap is handled by the worker's
`notificationclick`. The bundled listener focuses a tab already on the
destination and otherwise opens a window — it never navigates a tab this
worker does not control, because that call rejects silently and the tap looks
dead (the tab that registered the worker is not controlled until it reloads).
Keep that pattern if you merge the listeners into your own worker.

## Checklist

- [x] `appId` / `webKey` are in `native-notify/web/nativeNotifyIds.js` — public values; nothing to set in your host (no environment variables)
- [ ] Serve `native-notify-sw.js` from the site root as /native-notify-sw.js (or add its listeners to your existing service worker)
- [ ] Render `<NativeNotifyWebPushButton />` (or call `enableNativeNotifyWebPush` from a click) — ask Agent Notify to mount it for you
- [ ] Click it in a browser, allow notifications, then send a push from Agent Notify — it lands on the device AND in the notification inbox (deletable under **Push notifications → Inbox** in [Native Notify](https://dashboard.nativenotify.com))
- [ ] Confirm notifications can appear at all on your machine — the OS allows your browser (macOS System Settings → Notifications → your browser; Windows/Linux equivalents) and the browser allows this site (see "Not seeing the notification?" above)
