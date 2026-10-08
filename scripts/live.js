const frame=document.getElementById("live-frame");
const video=document.getElementById("live-video");
const player=document.getElementById("live-player");
const closePlayer=document.getElementById("live-close");
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

let channels=[],activeFilter="all",page=1,currentSources=[],sourceIndex=0,lastFocusedChannel=null,hls=null;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label=v=>String(v||"").replace(/[-_]+/g," ").replace(/\b\w/g,m=>m.toUpperCase());
const normalize=v=>String(v||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"");
const sourceRank={Nexus:3,"Free-TV":2,"IPTV-org":1};

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
         url:value,
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
 const countries=[...new Set(channels.map(c=>c.country).filter(Boolean))].sort();
 const opts=[["all","All"],...cats.map(v=>["category:"+v,label(v)]),...countries.map(v=>["country:"+v,v])];
 filtersRoot.innerHTML=opts.map((o,i)=>'<button class="'+(i?"":"is-active")+'" type="button" data-live-filter="'+esc(o[0])+'">'+esc(o[1])+"</button>").join("");
 filtersRoot.querySelectorAll("[data-live-filter]").forEach(b=>b.onclick=()=>{
   activeFilter=b.dataset.liveFilter;page=1;
   filtersRoot.querySelectorAll("[data-live-filter]").forEach(x=>x.classList.toggle("is-active",x===b));
   render();
 });
}

function visible(){
 const q=(search?.value||"").trim().toLowerCase();
 return channels.filter(c=>{
   const hay=[c.name,...(c.altNames||[]),c.country,c.category,...(c.categories||[]),c.language].filter(Boolean).join(" ").toLowerCase();
   const okFilter=activeFilter==="all"||c.categories?.includes(activeFilter.slice(9))||activeFilter==="category:"+c.category||activeFilter==="country:"+c.country;
   return okFilter&&(!q||hay.includes(q));
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
 if(guideStatus)guideStatus.textContent=list.length.toLocaleString()+" channels · Page "+page+" of "+totalPages;
}

function destroyHls(){
 if(hls){try{hls.destroy()}catch{}hls=null;}
}

function stopMedia(){
 destroyHls();
 try{video.pause()}catch{}
 video.removeAttribute("src");
 try{video.load()}catch{}
 frame.src="about:blank";
}

function showError(){
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
     hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:30});
     hls.on(Hls.Events.ERROR,(event,data)=>{
       if(data?.fatal){
         destroyHls();
         if(sourceIndex<currentSources.length-1){sourceIndex++;playSource();}else showError();
       }
     });
     hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
     hls.loadSource(s.url);
     return;
   }catch{}
 }
 const p=video.play();if(p?.catch)p.catch(()=>{});
}

function playSource(){
 const s=currentSources[sourceIndex];
 if(!s)return showError();
 if(playerError)playerError.hidden=true;
 if(playerLoading)playerLoading.hidden=false;
 if(s.type==="iframe"){
   destroyHls();video.hidden=true;stopMedia();frame.hidden=false;frame.src=s.url;
   if(playerMeta)playerMeta.textContent="Live stream · "+(s.provider||"public source");
 }else{
   if(playerMeta)playerMeta.textContent="Live stream · "+(s.provider||"public source")+(s.score?" · health "+Math.round(s.score)+"%":"");
   playVideoSource(s);
 }
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
video?.addEventListener("error",()=>{
 if(sourceIndex<currentSources.length-1){sourceIndex++;playSource()}else showError();
});
video?.addEventListener("playing",()=>{if(playerLoading)playerLoading.hidden=true});
frame?.addEventListener("load",()=>{if(playerLoading)playerLoading.hidden=true});
search?.addEventListener("input",()=>{page=1;render()});

(async()=>{
 try{
   const results=await Promise.all(SOURCES.map(s=>fetchWithTimeout(s.url).catch(()=>null)));
   const nexusRes=results[0],freeTvRes=results[1],iptvRes=results[2];
   const nexus=nexusRes?.ok?normalizeM3U(await nexusRes.text(),"Nexus"):[];
   const freeTv=freeTvRes?.ok?normalizeM3U(await freeTvRes.text(),"Free-TV"):[];
   const iptv=iptvRes?.ok?normalizeM3U(await iptvRes.text(),"IPTV-org"):[];
   channels=mergeCatalogue([nexus,freeTv,iptv]);
   if(!channels.length)throw Error("No live channels returned");
   if(guideStatus)guideStatus.textContent=channels.length.toLocaleString()+" health-filtered channels ready";
 }catch(e){
   console.warn("Live catalogue load failed:",e);
   channels=[];
   if(guideStatus)guideStatus.textContent="Live catalogue temporarily unavailable";
 }
 renderFilters();
 render();
})();
