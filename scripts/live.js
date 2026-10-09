const frame=document.getElementById("live-frame");
const video=document.getElementById("live-video");
const player=document.getElementById("live-player");
const closePlayer=document.getElementById("live-close");
const tryNext=document.getElementById("live-try-next");
const playerTitle=document.getElementById("live-player-title");
const playerMeta=document.getElementById("live-player-meta");
const playerLoading=document.getElementById("live-player-loading");
const playerError=document.getElementById("live-player-error");
const search=document.getElementById("live-search");
const grid=document.getElementById("live-channel-grid");
const guideStatus=document.getElementById("live-guide-status");
const filtersRoot=document.querySelector(".vivid-live-filters");

const PAGE_SIZE=30;
const CATALOG_TIMEOUT_MS=20000;
const SOURCES=[
 {id:"nexus",name:"IPTV Nexus",url:"https://dearbulut.github.io/iptv/playlists/online.m3u",priority:100},
 {id:"free-tv",name:"Free-TV",url:"https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",priority:90},
 {id:"iptv-org",name:"IPTV-org",url:"https://iptv-org.github.io/iptv/index.m3u",priority:70}
];

let channels=[],activeFilter="all",activeCountry="all",activeLanguage="all",page=1,currentSources=[],sourceIndex=0,lastFocusedChannel=null,hls=null,playAttempt=0,sourceTimeout=null,videoAttempt=0;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label=v=>String(v||"").replace(/[-_]+/g," ").replace(/\b\w/g,m=>m.toUpperCase());
const normalize=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"");
const sourceRank={Nexus:3,"Free-TV":2,"IPTV-org":1};

async function fetchJsonWithTimeout(url){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),CATALOG_TIMEOUT_MS);
 try{
   const res=await fetch(url,{cache:"no-store",signal:controller.signal});
   if(!res.ok)throw Error("HTTP "+res.status);
   return await res.json();
 }finally{clearTimeout(timer)}
}

function fetchWithTimeout(url){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),CATALOG_TIMEOUT_MS);
 return fetch(url,{cache:"no-store",signal:controller.signal}).finally(()=>clearTimeout(timer));
}

function parseAttrs(text){
 const attrs={};
 const re=/([-\w]+)="([^"]*)"/g;
 let m;
 while((m=re.exec(text)))attrs[m[1].toLowerCase()]=m[2];
 return attrs;
}

function normalizeYoutubeEmbed(rawUrl) {
 try {
  const url=new URL(rawUrl);
  const host=url.hostname.toLowerCase().replace(/^www\./,"");
  let id="";
  if(host==="youtu.be")id=url.pathname.split("/").filter(Boolean)[0]||"";
  else if(["youtube.com","m.youtube.com","youtube-nocookie.com"].includes(host)){
   if(url.pathname==="/watch")id=url.searchParams.get("v")||"";
   else if(/^\/(embed|live|shorts)\//.test(url.pathname))id=url.pathname.split("/")[2]||"";
  }
  if(!/^[\w-]{11}$/.test(id))return rawUrl;
  return "https://www.youtube-nocookie.com/embed/"+id+"?autoplay=1&rel=0";
 }catch{return rawUrl}
}

function parseM3U(text,provider){
 const lines=String(text||"").split(/\r?\n/);
 const rows=[];
 let meta=null;
 for(const raw of lines){
   const value=raw.trim();
   if(value.startsWith("#EXTINF:")){
     const comma=value.indexOf(",");
     const head=comma>=0?value.slice(0,comma):value;
     const attrs=parseAttrs(head);
     meta={
       id:attrs["tvg-id"]||"",
       name:(comma>=0?value.slice(comma+1).trim():"Live")||"Live",
       logo:attrs["tvg-logo"]||"",
       category:attrs["group-title"]||"general",
       country:attrs["tvg-country"]||"",
       language:attrs["tvg-language"]||"",
       score:Number(attrs["nexus-score"]||0)||0
     };
   }else if(meta&&value&&!value.startsWith("#")){
     if(!/^https?:\/\//i.test(value)){meta=null;continue}
     const isYouTube=/(youtube\.com|youtu\.be)\//i.test(value);
     rows.push({
       meta,
       source:{
         type:isYouTube?"iframe":"video",
         url:isYouTube?normalizeYoutubeEmbed(value):value,
         quality:"public",
         score:meta.score,
         labels:[],
         provider
       }
     });
     meta=null;
   }
 }
 return rows;
}

function normalizeApiFallback(channelsData,streamsData,countriesData){
 const names=new Map((channelsData||[]).filter(c=>c&&c.id&&!c.is_nsfw&&!c.closed).map(c=>[c.id,c]));
 const countryNames=new Map((countriesData||[]).filter(c=>c&&c.code).map(c=>[c.code,c.name]));
 const grouped=new Map();
 (streamsData||[]).filter(s=>s&&s.channel&&/^https?:\/\//i.test(s.url)).forEach(s=>{
   const ch=names.get(s.channel);if(!ch)return;
   if(!grouped.has(ch.id))grouped.set(ch.id,{id:ch.id,name:ch.name,altNames:ch.alt_names||[],country:countryNames.get(ch.country)||ch.country||"International",countryCode:ch.country,logo:ch.logo||"",language:"",category:(ch.categories||[])[0]||"general",categories:ch.categories||["general"],provider:"IPTV-org",sources:[]});
   const row=grouped.get(ch.id);
   if(row.sources.length<4&&!row.sources.some(x=>x.url===s.url))row.sources.push({type:"video",url:s.url,quality:s.quality||"",labels:s.labels||[],score:0,provider:"IPTV-org"});
 });
 return [...grouped.values()].filter(c=>c.sources.length);
}

function normalizeNexusOnline(data){
 const rows=Array.isArray(data)?data:[];
 return rows.filter(c=>c&&!c.is_nsfw&&!c.closed&&Array.isArray(c.streams)&&c.streams.length).map(c=>({
   id:c.id,name:c.name,altNames:c.alt_names||[],country:c.country||"International",countryCode:c.country||"",logo:c.logo||"",language:(c.languages||[])[0]||"",category:(c.categories||[])[0]||"general",categories:c.categories||["general"],provider:"Nexus",sources:c.streams.filter(s=>s&&/^https?:\/\//i.test(s.url)).slice(0,5).map(s=>({type:/youtube\.com|youtu\.be/i.test(s.url)?"iframe":"video",url:/youtube\.com|youtu\.be/i.test(s.url)?normalizeYoutubeEmbed(s.url):s.url,quality:s.quality||"",labels:s.labels||[],score:Number(s.health?.score??s.score??s.rank??c.score??0)||0,provider:"Nexus"}))
 })).filter(c=>c.sources.length);
}

function mergeCatalogue(groups){
 const byKey=new Map();
 const aliases=new Map();
 groups.flat().forEach(c=>{
   const keys=[c.id,c.name,...(c.altNames||[])].map(normalize).filter(Boolean);
   const existing=keys.map(k=>aliases.get(k)).find(Boolean);
   const key=existing||keys[0];
   if(!key)return;
   const old=byKey.get(key);
   if(!old){
     byKey.set(key,{...c,sources:[...c.sources]});
     keys.forEach(k=>aliases.set(k,key));
     return;
   }
   const sources=[...(old.sources||[]),...(c.sources||[])]
     .filter(s=>s?.url)
     .filter((s,i,a)=>a.findIndex(x=>x.url===s.url)===i)
     .sort((a,b)=>(b.score||0)-(a.score||0)||(sourceRank[b.provider]||0)-(sourceRank[a.provider]||0))
     .slice(0,5);
   const preferred=(sourceRank[c.provider]||0)>(sourceRank[old.provider]||0)?c:old;
   byKey.set(key,{
     ...old,...preferred,
     logo:old.logo||c.logo||"",
     altNames:[...(old.altNames||[]),...(c.altNames||[])].filter((v,i,a)=>v&&a.indexOf(v)===i),
     categories:[...(old.categories||[]),...(c.categories||[])].filter((v,i,a)=>v&&a.indexOf(v)===i),
     sources
   });
   keys.forEach(k=>aliases.set(k,key));
 });
 return [...byKey.values()]
   .filter(c=>c.sources?.length)
   .map(c=>({...c,sources:c.sources.sort((a,b)=>{
     const aGeo=(a.labels||[]).includes("Geo-blocked")?1:0;
     const bGeo=(b.labels||[]).includes("Geo-blocked")?1:0;
     return aGeo-bGeo||(b.score||0)-(a.score||0)||(sourceRank[b.provider]||0)-(sourceRank[a.provider]||0);
   })}))
   .sort((a,b)=>a.name.localeCompare(b.name));
}

function renderFilters(){
 if(!filtersRoot)return;
 const cats=[...new Set(channels.flatMap(c=>c.categories?.length?c.categories:[c.category]).filter(Boolean))].sort();
 const opts=[["all","All categories"],...cats.map(v=>["category:"+v,label(v)])];
 filtersRoot.innerHTML=opts.map(o=>'<button class="'+(o[0]===activeFilter?"is-active":"")+'" type="button" data-live-filter="'+esc(o[0])+'" aria-pressed="'+(o[0]===activeFilter?"true":"false")+'">'+esc(o[1])+"</button>").join("");
 filtersRoot.querySelectorAll("[data-live-filter]").forEach(b=>b.onclick=()=>{
   activeFilter=b.dataset.liveFilter;page=1;
   filtersRoot.querySelectorAll("[data-live-filter]").forEach(x=>{x.classList.toggle("is-active",x===b);x.setAttribute("aria-pressed",x===b?"true":"false")});
   render();
 });
 const countries=[...new Set(channels.map(c=>c.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 const languages=[...new Set(channels.flatMap(c=>[c.language,...(c.languages||[])]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 const countrySelect=document.getElementById("live-country");
 const languageSelect=document.getElementById("live-language");
 if(countrySelect){
   countrySelect.innerHTML='<option value="all">All countries</option>'+countries.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
   countrySelect.value=activeCountry;
 }
 if(languageSelect){
   languageSelect.innerHTML='<option value="all">All languages</option>'+languages.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
   languageSelect.value=activeLanguage;
 }
}

function visible(){
 const q=(search?.value||"").trim().toLowerCase();
 return channels.filter(c=>{
   const hay=[c.name,...(c.altNames||[]),c.country,c.category,...(c.categories||[]),c.language].filter(Boolean).join(" ").toLowerCase();
   const okFilter=activeFilter==="all"||c.categories?.includes(activeFilter.slice(9))||activeFilter==="category:"+c.category;
   const countryOk=activeCountry==="all"||c.country===activeCountry||c.countryCode===activeCountry;
   const languageValues=[c.language,...(c.languages||[])].filter(Boolean);
   const languageOk=activeLanguage==="all"||languageValues.includes(activeLanguage);
   return okFilter&&countryOk&&languageOk&&(!q||hay.includes(q));
 });
}

function card(c){
 const source=c.sources?.[0];
 const badge=source?.provider||c.provider||"Live";
 const health=source?.score>0?" · "+Math.round(source.score)+"% health":"";
 return '<button class="vivid-live-channel" type="button" data-channel-id="'+esc(c.id)+'"><span class="vivid-live-channel-art">'+(c.logo?'<img src="'+esc(c.logo)+'" alt="" loading="lazy" decoding="async">':'<i class="bi bi-broadcast" aria-hidden="true"></i>')+'<span class="vivid-live-channel-play" aria-hidden="true"><i class="bi bi-play-fill"></i></span></span><span class="vivid-live-channel-copy"><strong>'+esc(c.name)+'</strong><small>'+esc([c.country,label(c.category)].filter(Boolean).join(" · ")||"Live")+' · '+esc(badge+health)+'</small></span></button>';
}

function render(){
 const list=visible();
 const totalPages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));
 page=Math.min(page,totalPages);
 const startIndex=(page-1)*PAGE_SIZE;
 const pageItems=list.slice(startIndex,startIndex+PAGE_SIZE);
 grid.innerHTML=pageItems.length?pageItems.map(card).join(""):'<div class="vivid-live-empty"><i class="bi bi-tv"></i><strong>No channels found</strong><span>Try another search or filter.</span></div>';
 grid.insertAdjacentHTML("beforeend",'<div class="vivid-live-pagination" aria-label="Channel pages"><button type="button" data-live-page="prev" '+(page<=1?"disabled":"")+'><i class="bi bi-chevron-left"></i> Previous</button><span>Page '+page+" of "+totalPages+'</span><button type="button" data-live-page="next" '+(page>=totalPages?"disabled":"")+'>Next <i class="bi bi-chevron-right"></i></button></div>');
 if(guideStatus)guideStatus.textContent=list.length.toLocaleString()+" channels shown · Page "+page+" of "+totalPages;
}

function destroyHls(){
 if(hls){try{hls.destroy()}catch{}hls=null;}
}

function clearSourceTimeout(){if(sourceTimeout){clearTimeout(sourceTimeout);sourceTimeout=null;}}

function advanceSourceOrFail(){
 clearSourceTimeout();
 if(sourceIndex<currentSources.length-1){sourceIndex++;playSource();return;}
 showError();
}

function stopMedia(){
 clearSourceTimeout();
 playAttempt++;
 destroyHls();
 try{video.pause()}catch{}
 video.removeAttribute("src");
 try{video.load()}catch{}
 frame.src="about:blank";
}

function showError(){
 clearSourceTimeout();
 if(playerLoading)playerLoading.hidden=true;
 if(playerError)playerError.hidden=false;
}

function loadHlsScript(){
 if(window.Hls)return Promise.resolve(window.Hls);
 if(window.__vividHlsPromise)return window.__vividHlsPromise;
 window.__vividHlsPromise=new Promise((resolve,reject)=>{
   const script=document.createElement("script");
   script.src="https://cdn.jsdelivr.net/npm/hls.js@1.6.2/dist/hls.min.js";
   script.async=true;
   script.onload=()=>window.Hls?resolve(window.Hls):reject(Error("HLS library unavailable"));
   script.onerror=()=>reject(Error("HLS library failed to load"));
   document.head.appendChild(script);
 });
 return window.__vividHlsPromise;
}

async function playVideoSource(s){
 const attempt=++playAttempt;
 videoAttempt=attempt;
 destroyHls();
 video.hidden=false;
 frame.hidden=true;
 frame.src="about:blank";
 video.removeAttribute("src");
 if(video.canPlayType("application/vnd.apple.mpegurl")){
   video.src=s.url;
 }else{
   try{
     const Hls=await loadHlsScript();
     if(!Hls.isSupported())throw Error("HLS not supported");
     if(attempt!==playAttempt)return;
     hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:30});
     hls.on(Hls.Events.ERROR,(event,data)=>{
       if(attempt!==playAttempt)return;
       if(data?.fatal)advanceSourceOrFail();
     });
     hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(attempt===playAttempt)video.play().catch(()=>{});});
     hls.loadSource(s.url);
     return;
   }catch{}
 }
 if(attempt!==playAttempt)return;
 const p=video.play();if(p?.catch)p.catch(()=>{});
}

function playSource(){
 const s=currentSources[sourceIndex];
 if(!s)return showError();
 clearSourceTimeout();
 if(playerError)playerError.hidden=true;
 if(playerLoading)playerLoading.hidden=false;
 if(s.type==="iframe"){
   playAttempt++;
   destroyHls();
   try{video.pause()}catch{}
   video.removeAttribute("src");
   try{video.load()}catch{}
   video.hidden=true;frame.hidden=false;frame.src=s.url;
   if(playerMeta)playerMeta.textContent="Embedded player · "+(s.provider||"public source");
 }else{
   if(playerMeta)playerMeta.textContent="Live stream · "+(s.provider||"public source")+(s.score?" · source score "+Math.round(s.score)+"%":"");
   playVideoSource(s);
 }
 const attempt=playAttempt;
 sourceTimeout=setTimeout(()=>{
   if(attempt!==playAttempt||player.hidden)return;
   advanceSourceOrFail();
 },25000);
}

function play(c){
 if(!c?.sources?.length)return;
 lastFocusedChannel=document.activeElement;
 currentSources=c.sources;sourceIndex=0;
 if(playerTitle)playerTitle.textContent=c.name;
 player.hidden=false;
 player.classList.add("is-open");
 document.body.classList.add("vivid-live-player-open");
 playSource();
}

function close(){
 stopMedia();
 player.classList.remove("is-open");
 player.hidden=true;
 document.body.classList.remove("vivid-live-player-open");
 if(playerLoading)playerLoading.hidden=true;
 if(playerError)playerError.hidden=true;
 if(lastFocusedChannel?.isConnected)lastFocusedChannel.focus();
}

document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!player.hidden)close()});
grid?.addEventListener("click",e=>{
 const pager=e.target.closest("[data-live-page]");
 if(pager){
   const total=Math.max(1,Math.ceil(visible().length/PAGE_SIZE));
   page=pager.dataset.livePage==="prev"?Math.max(1,page-1):Math.min(total,page+1);
   render();
   grid.scrollIntoView({behavior:"smooth",block:"start"});
   return;
 }
 const b=e.target.closest("[data-channel-id]");
 if(b)play(channels.find(c=>c.id===b.dataset.channelId));
});
closePlayer?.addEventListener("click",close);
tryNext?.addEventListener("click",advanceSourceOrFail);
 video?.addEventListener("error",()=>{if(videoAttempt===playAttempt)advanceSourceOrFail()});
 video?.addEventListener("playing",()=>{clearSourceTimeout();if(playerLoading)playerLoading.hidden=true});
 frame?.addEventListener("load",()=>{if(frame.src!=="about:blank"&&playerLoading)playerLoading.hidden=true});
 search?.addEventListener("input",()=>{page=1;render()});
 document.getElementById("live-country")?.addEventListener("change",e=>{activeCountry=e.target.value;page=1;render()});
 document.getElementById("live-language")?.addEventListener("change",e=>{activeLanguage=e.target.value;page=1;render()});

(async()=>{
 try{
   if(guideStatus)guideStatus.textContent="Loading public live-channel listings…";
   const parsed=[];
   try{
     const nexus=await fetchJsonWithTimeout("https://dearbulut.github.io/iptv/api/v1/channels.online.json");
     const online=normalizeNexusOnline(nexus);
     if(online.length)parsed.push(online);
   }catch(e){console.warn("Nexus API unavailable:",e)}

   if(!parsed.length){
     const results=await Promise.all(SOURCES.map(s=>fetchWithTimeout(s.url).catch(()=>null)));
     const m3u=await Promise.all(results.map(async(res,i)=>res?.ok?normalizeM3U(await res.text(),SOURCES[i].name==="IPTV-org"?"IPTV-org":SOURCES[i].name==="Free-TV"?"Free-TV":"Nexus"):[]));
     parsed.push(...m3u.filter(Boolean));
   }

   if(!parsed.some(x=>x.length)){
     try{
       const [channelsData,streamsData,countriesData]=await Promise.all([
         fetchJsonWithTimeout("https://iptv-org.github.io/api/channels.json"),
         fetchJsonWithTimeout("https://iptv-org.github.io/api/streams.json"),
         fetchJsonWithTimeout("https://iptv-org.github.io/api/countries.json")
       ]);
       parsed.push(normalizeApiFallback(channelsData,streamsData,countriesData));
     }catch(e){console.warn("IPTV-org API fallback unavailable:",e)}
   }

   channels=mergeCatalogue(parsed);
   if(!channels.length)throw Error("No live channels returned");
   if(guideStatus)guideStatus.textContent=channels.length.toLocaleString()+" channel listings loaded · stream availability varies";
 }catch(e){
   console.warn("Live catalogue load failed:",e);
   channels=[];
   if(guideStatus)guideStatus.textContent="Live catalogue temporarily unavailable";
 }
 renderFilters();
 render();
})();
