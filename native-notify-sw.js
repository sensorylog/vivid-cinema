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
// Self-defence: if this draft is ever registered by mistake it removes ITSELF at
// once, so it can never replace /service-worker.js, break the offline shell or
// claim the scope. Nothing registers it today.
self.addEventListener('activate', (event) => event.waitUntil(self.registration.unregister().then(() => undefined)));

// NO push listener here on purpose (Agent Notify, safety review 2026-10-20).
// Vivid's real worker is /service-worker.js and it already handles pushes. A push
// listener in this file would show EVERY notification twice if the two ever ran
// together, so this draft only cleans itself up (see the activate handler).

// NO notificationclick listener here either — /service-worker.js owns clicks
// (it restricts navigation to the app origin via safeNotificationUrl).
