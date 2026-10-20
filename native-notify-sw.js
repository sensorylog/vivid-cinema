// @ts-nocheck — a service worker runs in ServiceWorkerGlobalScope, not the
// page: a project that type-checks its JavaScript with the DOM lib would
// otherwise flag `self.registration` / `clients` here.
/**
 * Native Notify — the web push service worker (added by Agent Notify).
 *
 * Served from the site ROOT (/native-notify-sw.js) so it covers the whole
 * site, and named that way on purpose: a site can have only ONE service
 * worker per scope — if yours already has one (a PWA / offline worker), do
 * not register this file; add its listeners to your existing worker instead
 * (see native-notify/web/README-web-push.md).
 */
// Don't wait for every tab to close: a stale worker keeps handling clicks.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Notification', {
      body: payload.body || '',
      image: payload.image,
      tag: payload.tag,
      data: payload.data || {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Deep links come from the push's data: send {"url": "/offers"}.
  const url = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Focus a tab already on the destination; never navigate() one — an
      // uncontrolled tab cannot be navigated and the click would look dead.
      const open = windows.find((client) => client.url === url);
      return open ? open.focus().catch(() => clients.openWindow(url)) : clients.openWindow(url);
    })
  );
});
