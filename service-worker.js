const CACHE_NAME = "vivid-cinema-shell-v28";
const APP_SHELL = [
  "./","./index.html","./home.html","./discover.html","./collection.html","./title.html","./watch.html",
  "./library.html","./auth.html","./login.html","./forgot-password.html","./account.html","./terms.html","./privacy.html","./contact.html",
  "./offline.html","./404.html","./manifest.json","./robots.txt","./sitemap.xml","./icons/vivid-icon.svg",
  "./styles/vivid-foundation.css","./styles/vivid-system.css","./styles/vivid-shell.css","./styles/vivid-cinematic.css",
  "./styles/vivid-title.css","./styles/vivid-watch.css","./styles/vivid-library.css","./styles/vivid-discovery.css",
  "./styles/vivid-collection.css","./styles/vivid-auth.css","./styles/vivid-account.css","./styles/vivid-pwa.css",
  "./styles/vivid-atmosphere.css","./styles/vivid-landing.css","./styles/vivid-viewport.css",
  "./styles/vivid-legal.css","./styles.css","./scripts/app-shell.js","./scripts/pwa.js",
  "./scripts/atmosphere.js","./scripts/i18n.js","./scripts/routes.js",
  "./scripts/config.js","./scripts/utils.js","./scripts/content.js","./scripts/media.js","./scripts/tmdb.js",
  "./scripts/nav-auth.js","./scripts/library.js","./scripts/library-page.js","./scripts/discover.js",
  "./scripts/collection.js","./scripts/recommendations.js","./scripts/title.js","./scripts/watch.js","./scripts/landing.js",
  "./scripts/account.js","./scripts/auth.js","./script.js"
];

async function cacheShell(){
  const cache=await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL.map(asset=>cache.add(asset)));
}

self.addEventListener("install",event=>event.waitUntil(cacheShell()));

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

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==="navigate"){
    event.respondWith(networkFirst(request));
    return;
  }
  const isCodeOrStyle=/\.(?:js|css|html)$/.test(url.pathname);
  event.respondWith(isCodeOrStyle?networkFirst(request):staleWhileRevalidate(request));
});
