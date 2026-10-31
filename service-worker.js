// Bump this version whenever the precached app shell changes.
const CACHE_NAME = "vivid-cinema-shell-v261";
const HLS_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js";
const APP_SHELL = [
  HLS_LIBRARY_URL,
  "./","./index.html","./home.html","./downloads.html","./my-downloads.html","./for-you.html",
  "./person.html","./discover.html","./collection.html","./title.html","./watch.html",
  "./library.html","./auth.html","./login.html","./verify-email.html","./forgot-password.html",
  "./account.html","./achievements.html","./terms.html","./privacy.html","./contact.html",
  "./donate.html","./donation-success.html","./offline.html","./live.html","./news.html",
  "./community.html","./news-story.html","./moderator.html","./scripts/news-source-registry.js","./search.html",
  "./anime.html","./help.html","./about.html","./accessibility.html","./cookies.html",
  "./404.html","./manifest.json","./robots.txt","./icons/vivid-icon.svg","./assets/images/IMG_6099.jpeg",
  "./scripts/mascot-autoplay.js?v=1","./styles/vivid-foundation.css","./styles/vivid-system.css","./styles/downloads.css","./styles/vivid-liquid-glass.css",
  "./styles/vivid-liquid-glass.css?v=lg4","./styles/my-downloads.css","./styles/vivid-media-layout.css?v=1","./styles/vivid-home.css","./styles/vivid-donate.css","./styles/vivid-shell.css",
  "./styles/vivid-cinematic.css","./styles/vivid-title.css","./styles/vivid-person.css","./styles/vivid-watch.css","./styles/vivid-watch.css?v=watch-player-layout-3",
  "./styles/vivid-library.css","./styles/vivid-library.css?v=library-mobile-fix1","./styles/vivid-discovery.css","./styles/vivid-for-you.css","./styles/vivid-collection.css",
  "./styles/vivid-auth.css","./styles/vivid-account.css","./styles/vivid-account-cinematic.css?v=20261018-cinematic-1","./styles/vivid-achievements-page.css?v=20261018-cinematic-1","./styles/vivid-pwa.css",
  "./styles/vivid-tflix-hero.css","./styles/vivid-tflix-hero.css?v=hero-trailer-full-bleed-1","./styles/vivid-viewport.css?v=page-gutters-1","./styles/vivid-apple-tv-mobile.css?v=apple-tv-mobile-2","./scripts/tflix-hero.js",
  "./scripts/tflix-hero.js?v=hero-responsive-artwork-1","./styles/vivid-atmosphere.css","./styles/vivid-search-standalone.css","./styles/vivid-desktop.css","./styles/vivid-landing.css",
  "./styles/vivid-landing-final.css","./styles/vivid-home-breathe.css","./styles/vivid-news.css","./styles/vivid-community.css","./styles/vivid-moderation.css",
  "./styles/vivid-anime.css","./styles/vivid-viewport.css","./styles/vivid-legal.css","./styles/vivid-live.css","./styles/vivid-audit-fixes.css",
  "./styles/vivid-achievements.css?v=20261018-achievements-1","./scripts/achievements.js","./scripts/achievements-page.js?v=20261018-cinematic-1","./scripts/achievement-catalog.js","./scripts/app-shell.js",
  "./scripts/donate.js","./scripts/google-tag.js","./scripts/analytics.js","./scripts/vivid-pulse.js","./scripts/provider-region.js",
  "./scripts/search.js","./scripts/search-page.js","./scripts/intelligence.js","./scripts/intent-parser.js","./scripts/plot-search.js",
  "./scripts/for-you.js","./scripts/vivid-recall-chat.js","./scripts/firebase-ai.js","./scripts/local-owner.js","./scripts/firebase.js",
  "./scripts/firebase.js?v=20261016-auth-runtime-audit2","./scripts/pwa.js","./scripts/atmosphere.js","./scripts/i18n.js","./scripts/routes.js",
  "./scripts/config.js","./scripts/utils.js","./scripts/content.js","./scripts/media.js","./scripts/tmdb.js",
  "./scripts/nav-auth.js","./scripts/downloads.js?v=direct-download-v3","./scripts/my-downloads.js","./scripts/downloads/provider-integration.js","./scripts/downloads/internet-archive.js","./scripts/downloads/wikimedia-commons.js","./scripts/downloads/download-manager.js","./scripts/downloads/indexeddb-persistence.js","./scripts/downloads/browser-direct-adapter.js","./scripts/downloads/browser-hls-adapter.js","./scripts/downloads/offline-playback.js","./scripts/library.js","./scripts/library-page.js","./scripts/discover.js",
  "./scripts/collection.js","./scripts/person.js","./scripts/recommendations.js","./scripts/release-alerts.js","./scripts/cinema-reminders.js",
  "./scripts/push-notifications.js","./native-notify/web/nativeNotifyIds.js","./native-notify/web/native-notify-web-push.js","./scripts/news.js","./scripts/news.js?v=20261018-feedback-sync-4",
  "./scripts/newsroom.js","./scripts/news-community-highlights.js","./scripts/news-community.js","./scripts/news-story.js","./scripts/moderation.js",
  "./scripts/editorial-desk.js","./scripts/title.js","./scripts/playback/player-engine.js","./scripts/playback/playback-servers.js","./scripts/playback/server-settings.js",
  "./scripts/watch.js","./scripts/playback/tflix-secondary-player.js","./scripts/playback/playback-urls.js","./scripts/landing.js","./scripts/account.js",
  "./scripts/account-bootstrap.js","./scripts/account-bootstrap.js?v=20261016-account-bootstrap-1","./scripts/auth.js","./scripts/auth.js?v=20261024-desktop-persistence-1","./scripts/verify-email.js",
  "./scripts/anime.js","./scripts/live.js","./scripts/home-breathe.js","./data/live-channels.json","./script.js",
  "./script.js?v=20261006-2","./scripts/watch.js?v=watch-player-server-scroll-1","./scripts/account.js?v=20261016-account-runtime-2","./styles/vivid-news.css?v=20261021-this-week-1","./scripts/newsroom.js?v=20261020-newsroom-images-3",
  "./scripts/live.js?v=live8","./styles/vivid-cleanup.css?v=1","./styles/vivid-title-refresh.css?v=beast-1","./scripts/title.js?v=download-flow-1","./styles/vivid-donate.css?v=support3", "./scripts/tflix-hero.js?v=hero-fast-fallback-1", "./scripts/mascot-autoplay.js?v=2",
  "./styles/vivid-watch.css?v=player-flow-3-servers","./styles/vivid-watch.css?v=watch-player-layout-1","./styles/vivid-watch.css?v=watch-player-layout-2","./styles/vivid-cleanup.css?v=4","./styles/vivid-watch-polish.css?v=2",
  "./styles/vivid-tflix-hero.css?v=hero-motion-2","./styles/vivid-tflix-hero.css?v=hero-motion-3","./scripts/tflix-hero.js?v=hero-rank-fast-2","./scripts/intelligence.js?v=20261018-sync-stage-1","./scripts/intelligence.js?v=20261018-feedback-payload-2",
  "./scripts/intelligence.js?v=20261018-feedback-sync-3","./scripts/intelligence.js?v=20261018-feedback-sync-4","./scripts/news.js?v=20261018-sync-stage-1","./scripts/news.js?v=20261018-feedback-sync-3","./scripts/newsroom.js?v=20261018-firestore-db-1",
  "./scripts/newsroom.js?v=20261019-premium-polish-3","./scripts/watch.js?v=watch-player-layout-1","./scripts/watch.js?v=watch-player-layout-2","./scripts/watch.js?v=watch-player-layout-3","./scripts/watch.js?v=watch-player-choice-2",
  "./scripts/watch.js?v=watch-player-tv-seven-servers-3","./scripts/playback/tflix-secondary-player.js?player-choice-1","./scripts/playback/tflix-secondary-player.js?tv-episodes-3","./scripts/live.js?v=live7"
];
const REQUIRED_APP_SHELL = ["./index.html", "./home.html", "./offline.html", "./manifest.json"];
function isSafeResponse(response){
 return !!response&&!response.redirected&&response.type!=="opaqueredirect"&&!(response.status>=300&&response.status<400);
}
async function cacheAsset(cache,asset){
 const response=await fetch(asset,{cache:"no-store",redirect:"follow"});
 // Never precache a response whose request crossed a redirect. Safari can reject
 // a redirected response when a service worker returns it for a navigation.
 const allowedResponseType=response.type==="basic"||(asset===HLS_LIBRARY_URL&&response.type==="cors");
 const expectedUrl=new URL(asset,self.location.href).href;
 if(!response.ok||!allowedResponseType||!isSafeResponse(response)||response.url!==expectedUrl)throw new Error("Unsafe or unavailable precache response: "+asset);
 await cache.put(asset,response.clone());
}
async function cacheAssetsWithConcurrency(cache,assets,concurrency=6){
 const failures=[];
 let nextIndex=0;
 const workerCount=Math.min(Math.max(1,Math.floor(Number(concurrency)||1)),assets.length);
 await Promise.all(Array.from({length:workerCount},async()=>{
  while(nextIndex<assets.length){
   const index=nextIndex++;
   try{await cacheAsset(cache,assets[index]);}
   catch{failures.push(assets[index]);}
  }
 }));
 return failures;
}
async function safeCachedResponse(request){
 const cache=await caches.open(CACHE_NAME);
 const response=await cache.match(request);
 if(response&&!isSafeResponse(response)){
  await cache.delete(request);
  return null;
 }
 return response||null;
}
async function fetchWithoutRedirect(request,init={}){
 let response=await fetch(request,{...init,redirect:"follow"});
 if(response.redirected&&response.url){
  // Re-request the final URL so the Response handed to Safari is not marked
  // redirected. If that destination redirects again, fail closed to cache/offline.
  response=await fetch(response.url,{...init,credentials:request.credentials||"same-origin",headers:request.headers,redirect:"error"});
 }
 if(!isSafeResponse(response))throw new Error("Service worker refused to serve a redirect response");
 return response;
}
async function cacheShell(){
 const cache=await caches.open(CACHE_NAME);
 const requiredResults=await Promise.allSettled(REQUIRED_APP_SHELL.map(asset=>cacheAsset(cache,asset)));
 const failedRequired=requiredResults.map((result,index)=>result.status==="rejected"?REQUIRED_APP_SHELL[index]:null).filter(Boolean);
 if(failedRequired.length){
  await caches.delete(CACHE_NAME);
  throw new Error("Required Vivid shell assets failed to cache: "+failedRequired.join(", "));
 }
 const requiredSet=new Set(REQUIRED_APP_SHELL);
 // Do not precache "./": root requests may redirect to index.html depending on
 // host configuration, and redirected responses must never enter the app cache.
 const optional=[...new Set(APP_SHELL)].filter(asset=>asset!=="./"&&!requiredSet.has(asset));
 // Keep install-time network pressure bounded. The previous unbounded
 // Promise.allSettled launched every optional asset request at once.
 const failures = await cacheAssetsWithConcurrency(cache, optional);
 if(failures.length) console.warn("Vivid shell: optional assets were not precached", failures);
}
self.addEventListener("install",event=>{event.waitUntil(cacheShell().then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("vivid-cinema-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});
async function networkFirst(request){
 const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),6000);
 try{
  const response=await fetchWithoutRedirect(request,{signal:controller.signal,cache:"no-store"});
  if(response.ok&&response.type==="basic"){
   const cache=await caches.open(CACHE_NAME);
   await cache.put(request,response.clone());
  }
  return response;
 }catch{
  return (await safeCachedResponse(request))||new Response("",{status:504,statusText:"Offline"});
 }finally{clearTimeout(timeout);}
}
async function staleWhileRevalidate(request,event,isNavigation=false){
 // Start the refresh before awaiting the cache, then keep the fetch event alive
 // so a cached response does not cause the browser to cancel the background update.
 const cachedPromise=safeCachedResponse(request);
 const refresh=fetchWithoutRedirect(request,{cache:"no-store"}).then(async response=>{
  if(response.ok&&response.type==="basic"){
   const cache=await caches.open(CACHE_NAME);
   await cache.put(request,response.clone());
  }
  return response;
 }).catch(()=>null);
 event.waitUntil(refresh.then(()=>undefined));
 const cached=await cachedPromise;
 if(cached)return cached;
 const fresh=await refresh;
 if(fresh&&isSafeResponse(fresh))return fresh;
 // Only document navigations should receive HTML as an offline fallback.
 if(isNavigation)return (await safeCachedResponse("./offline.html"))||new Response("",{status:504,statusText:"Offline"});
 // Returning offline.html for a missing script, stylesheet, or image can break
 // the page with an unexpected HTML response. Fail the asset request instead.
 return new Response("",{status:504,statusText:"Offline"});
}
// Pushes arrive from Native Notify (web push) and from the legacy reminder
// senders. Native Notify sends {title,body,image,tag,data:{url}}; the older
// senders send {title,body,tag,url}. Both shapes are normalised here so the
// existing cinema reminders keep working and Native Notify deep links open
// the right page. The click handler below is unchanged.
self.addEventListener("push",event=>{event.waitUntil((async()=>{
 let data={};
 try{data=event.data?.json?.()||{};}catch{try{data=JSON.parse(event.data?.text?.()||"{}");}catch{}}
 const nested=data.data&&typeof data.data==="object"?data.data:null;
 const deepLink=(nested&&(nested.url||nested.link))||data.url||"./home.html";
 const tag=(nested&&nested.tag)||data.tag||"vivid-cinema-reminder";
 const options={body:data.body||"Your Vivid Cinema reminder is ready.",icon:"./icons/vivid-icon.svg",badge:"./icons/vivid-icon.svg",tag,renotify:false,data:{...(nested||{}),url:deepLink}};
 if(typeof data.image==="string"&&data.image)options.image=data.image;
 await self.registration.showNotification(data.title||"Vivid Cinema",options);
})());});
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET")return;
 const url=new URL(request.url);
 if(url.href===HLS_LIBRARY_URL){
  event.respondWith((async()=>{
   const cached=await safeCachedResponse(HLS_LIBRARY_URL);
   if(cached)return cached;
   try{
    const response=await fetch(request,{cache:"no-store",redirect:"error"});
    if(response.ok&&response.type==="cors"&&isSafeResponse(response)){
     const cache=await caches.open(CACHE_NAME);
     await cache.put(HLS_LIBRARY_URL,response.clone());
    }
    return response;
   }catch{return new Response("",{status:504,statusText:"Offline"});}
  })());
  return;
 }
 if(url.origin!==self.location.origin)return;
 // Authentication must not depend on stale cached documents or SDK bundles.
 // Always try the network first for auth pages, auth modules and Firebase config.
 const isAuthDocument=/\/(?:login|auth|forgot-password|verify-email|auth-diagnostics|account)\.html$/.test(url.pathname);
 const isAuthRuntime=/\/scripts\/(?:auth|firebase|nav-auth|auth-diagnostics|app-shell|account|account-bootstrap)\.js$/.test(url.pathname)||/\/init\.json$/.test(url.pathname);
 const isFreshNewsRuntime=/\/scripts\/(?:newsroom|intelligence)\.js$/.test(url.pathname)||/\/styles\/vivid-news\.css$/.test(url.pathname)||/\/data\/(?:news-feed\.json|news-thumbnails\/)/.test(url.pathname);
 if(isAuthDocument||isAuthRuntime){event.respondWith(networkFirst(request));return;}
 if(isFreshNewsRuntime){event.respondWith(networkFirst(request));return;}
 if(request.mode==="navigate"){event.respondWith(staleWhileRevalidate(request,event,true));return;}
 const isCodeOrStyle=/\.(?:js|css)$/.test(url.pathname);
 const isHtml=/\.html$/.test(url.pathname);
 event.respondWith(isCodeOrStyle?networkFirst(request):isHtml?networkFirst(request):staleWhileRevalidate(request,event));
});
function safeNotificationUrl(value){
 try{const url=new URL(value||"./home.html",self.location.origin);return url.origin===self.location.origin?url.href:new URL("./home.html",self.location.origin).href;}
 catch{return new URL("./home.html",self.location.origin).href;}
}
// A tap must always do something: a tab this worker does not control yet cannot be
// navigated (navigate() rejects silently), so the rejection is swallowed and the tab
// is still focused instead of leaving the tap looking dead. Native Notify deep links
// (data.url) and the legacy reminder links both come through here.
self.addEventListener("notificationclick",event=>{event.notification.close();const target=safeNotificationUrl(event.notification.data?.url);event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(async list=>{const existing=list.find(client=>{try{return new URL(client.url).origin===self.location.origin;}catch{return false;}});if(existing){try{await existing.navigate(target)}catch{}return existing.focus();}return clients.openWindow(target);}));});
