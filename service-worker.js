const CACHE_NAME = "vivid-cinema-shell-v77";
const APP_SHELL = [
  "./","./index.html","./home.html","./person.html","./discover.html","./collection.html","./title.html","./watch.html",
  "./library.html","./auth.html","./login.html","./forgot-password.html","./account.html","./terms.html","./privacy.html","./contact.html",
  "./offline.html","./news.html","./search.html","./anime.html","./help.html","./about.html","./accessibility.html","./cookies.html","./404.html","./manifest.json","./robots.txt","./icons/vivid-icon.svg",
  "./styles/vivid-foundation.css","./styles/vivid-system.css","./styles/vivid-shell.css","./styles/vivid-cinematic.css",
  "./styles/vivid-title.css","./styles/vivid-watch.css","./styles/vivid-library.css","./styles/vivid-discovery.css",
  "./styles/vivid-collection.css","./styles/vivid-auth.css","./styles/vivid-account.css","./styles/vivid-pwa.css",
  "./styles/vivid-atmosphere.css","./styles/vivid-search-standalone.css","./styles/vivid-landing.css","./styles/vivid-landing-final.css","./styles/vivid-hero-mobile.css","./styles/vivid-home-breathe.css","./styles/vivid-news.css","./styles/vivid-anime.css","./styles/vivid-viewport.css",
  "./styles/vivid-legal.css","./styles/vivid-audit-fixes.css","./scripts/app-shell.js","./scripts/analytics.js","./scripts/provider-region.js","./scripts/search.js","./scripts/search-page.js","./scripts/intelligence.js","./scripts/firebase.js","./scripts/pwa.js","./scripts/home-catalogue-fallback.js",
  "./scripts/atmosphere.js","./scripts/i18n.js","./scripts/routes.js",
  "./scripts/config.js","./scripts/utils.js","./scripts/content.js","./scripts/media.js","./scripts/tmdb.js",
  "./scripts/nav-auth.js","./scripts/library.js","./scripts/library-page.js","./scripts/discover.js",
  "./scripts/collection.js","./scripts/person.js","./scripts/recommendations.js","./scripts/release-alerts.js","./scripts/cinema-reminders.js","./scripts/push-notifications.js","./scripts/news.js","./scripts/title.js","./scripts/watch.js","./scripts/external-providers.js","./scripts/landing.js",
  "./scripts/account.js","./scripts/auth.js","./script.js"
];

async function cacheShell(){
  const cache=await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL.map(asset=>cache.add(asset)));
}

self.addEventListener("install",event=>{
  event.waitUntil(cacheShell().then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith("vivid-cinema-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("message",event=>{
  if(event.data?.type==="SKIP_WAITING")self.skipWaiting();
});

async function networkFirst(request){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6000);
  try{
    const response=await fetch(request,{signal:controller.signal,cache:"no-store"});
    if(response.ok&&response.type==="basic"){
      const cache=await caches.open(CACHE_NAME);
      await cache.put(request,response.clone());
    }
    return response;
  }catch{
    return (await caches.match(request))||new Response("",{status:504,statusText:"Offline"});
  }finally{
    clearTimeout(timeout);
  }
}

async function staleWhileRevalidate(request){
  const cached=await caches.match(request);
  const refresh=fetch(request,{cache:"no-store"}).then(async response=>{
    if(response.ok&&response.type==="basic"){
      const cache=await caches.open(CACHE_NAME);
      await cache.put(request,response.clone());
    }
    return response;
  }).catch(()=>null);
  return cached||await refresh||new Response("",{status:504,statusText:"Offline"});
}

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data?.json?.() || {};
    } catch {
      try {
        data = JSON.parse(event.data?.text?.() || "{}");
      } catch {}
    }
    const title = data.title || "Vivid Cinema";
    const options = {
      body: data.body || "Your Vivid Cinema reminder is ready.",
      icon: "./icons/vivid-icon.svg",
      badge: "./icons/vivid-icon.svg",
      tag: data.tag || "vivid-cinema-reminder",
      renotify: false,
      data: { url: data.url || "./home.html" }
    };
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  const isCodeOrStyle = /\.(?:js|css)$/.test(url.pathname);
  const isHtml = /\.html$/.test(url.pathname);
  event.respondWith(isCodeOrStyle ? staleWhileRevalidate(request) : isHtml ? networkFirst(request) : staleWhileRevalidate(request));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "./home.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const existing = list.find(client => client.url.includes(self.location.origin));
      if (existing) {
        existing.navigate(new URL(target, self.location.origin).href);
        return existing.focus();
      }
      return clients.openWindow(new URL(target, self.location.origin).href);
    })
  );
});
