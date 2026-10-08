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
const FALLBACK=[{id:"atv-international",name:"&TV International",category:"international",country:"IN",language:"hin",provider:"2embed",sources:[{type:"iframe",url:"https://www.2embed.online/iptv/stream.php?url=N2lFS2R2cHpjbmFSSFRCNG5TOTI3MDFaS2xKWW1saFVwOUdVRDRqMEhlRXdMcmc4NHpLTERrWTZOY2NIdGdmblVXOWJKMFRYTmZzdE1HcWNoemdMZUk3NUZPUUdHMi92L1RUMkZYZ291NHlGZTRTOTJOUTVnZnA1Vm1QSzdvUGs4b0NtNS9qaTlJcVFMWERyZW92REF5QnFMM24yWkhnZEh2bHRyUTY3ZGg4PTo6DPl8NG74VB9DVg1WkNPVKg%3D%3D&title=%26TV+International&qualities=Auto,1080p,720p,480p,360p"}]}];
const PAGE_SIZE=30; let channels=[],activeFilter="all",page=1,currentSources=[],sourceIndex=0;
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label=v=>String(v||"").replace(/[-_]+/g," ").replace(/\b\w/g,m=>m.toUpperCase());
function normalizeApi(channelsData,streamsData,countriesData){
 const names=new Map(channelsData.filter(c=>c&&c.id&&!c.is_nsfw&&!c.closed).map(c=>[c.id,c]));
 const countryNames=new Map(countriesData.filter(c=>c&&c.code).map(c=>[c.code,c.name]));
 const grouped=new Map();
 streamsData.filter(s=>s&&s.channel&&/^https?:\/\//i.test(s.url)).forEach(s=>{
   const c=names.get(s.channel);if(!c)return;
   const key=c.id;
   if(!grouped.has(key))grouped.set(key,{id:key,name:c.name,altNames:c.alt_names||[],country:countryNames.get(c.country)||c.country||"International",countryCode:c.country,logo:c.logo||"",language:(s.languages||[])[0]||"",category:(c.categories||[])[0]||"general",categories:c.categories||[],provider:"iptv-org",sources:[]});
   const row=grouped.get(key);
   if(row.sources.length<3&&!row.sources.some(x=>x.url===s.url))row.sources.push({type:"video",url:s.url,quality:s.quality||"",labels:s.labels||[]});
 });
 return [...grouped.values()].filter(c=>c.sources.length);
}
function parseM3U(text,provider){
 const lines=String(text||"").split(/\\r?\\n/);
 const rows=[];
 let meta=null;
 for(const line of lines){
   const value=line.trim();
   if(value.startsWith("#EXTINF:")){
     const comma=value.indexOf(",");
     const attrs=comma>=0?value.slice(0,comma):value;
     const name=comma>=0?value.slice(comma+1).trim():"Live";
     const attr=(key)=>{const m=attrs.match(new RegExp(key+'="([^"]*)"', "i"));return m?m[1]:""};
     meta={name:name||"Live",logo:attr("tvg-logo"),category:attr("group-title")||"general",country:attr("tvg-country")||"",language:attr("tvg-language")||""};
   }else if(meta&&value&&!value.startsWith("#")){
     if(!/^https?:\\/\\//i.test(value)){meta=null;continue}
     const isYouTube=/((youtube\\.com|youtu\\.be)\\/)/i.test(value);
     rows.push({meta,source:{type:isYouTube?"iframe":"video",url:value,quality:"public",labels:[provider]},provider});
     meta=null;
   }
 }
 return rows;
}
function normalizeM3U(rows){
 const grouped=new Map();
 rows.forEach(({meta,source,provider})=>{
   const name=meta.name||"Live";
   const key=name.toLowerCase().replace(/[^a-z0-9]+/g,"");
   if(!key)return;
   if(!grouped.has(key))grouped.set(key,{id:provider+"-"+key,name,altNames:[],country:meta.country||"International",countryCode:"",logo:meta.logo||"",language:meta.language||"",category:meta.category||"general",categories:[meta.category||"general"],provider,sources:[]});
   const row=grouped.get(key);
   if(!row.logo&&meta.logo)row.logo=meta.logo;
   if(!row.sources.some(x=>x.url===source.url)&&row.sources.length<3)row.sources.push(source);
 });
 return [...grouped.values()].filter(c=>c.sources.length);
}

function renderFilters(){
 if(!filtersRoot)return;
 const cats=[...new Set(channels.flatMap(c=>c.categories?.length?c.categories:[c.category]).filter(Boolean))].sort();
 const countries=[...new Set(channels.map(c=>c.country).filter(Boolean))].sort();
 const opts=[["all","All"],...cats.map(v=>["category:"+v,label(v)]),...countries.map(v=>["country:"+v,v])];
 filtersRoot.innerHTML=opts.map((o,i)=>`<button class="${i?"":"is-active"}" type="button" data-live-filter="${esc(o[0])}">${esc(o[1])}</button>`).join("");
 filtersRoot.querySelectorAll("[data-live-filter]").forEach(b=>b.onclick=()=>{activeFilter=b.dataset.liveFilter;page=1;filtersRoot.querySelectorAll("[data-live-filter]").forEach(x=>x.classList.toggle("is-active",x===b));render()});
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
 const badge=c.provider==="2embed"?"2Embed":c.provider==="Free-TV"?"Free-TV":c.provider==="Curated FAST"?"FAST":"IPTV";
 return `<button class="vivid-live-channel" type="button" data-channel-id="${esc(c.id)}"><span class="vivid-live-channel-art">${c.logo?`<img src="${esc(c.logo)}" alt="" loading="lazy" decoding="async">`:`<i class="bi bi-broadcast" aria-hidden="true"></i>`}<span class="vivid-live-channel-play" aria-hidden="true"><i class="bi bi-play-fill"></i></span></span><span class="vivid-live-channel-copy"><strong>${esc(c.name)}</strong><small>${esc([c.country,label(c.category)].filter(Boolean).join(" · ")||"Live")} · ${esc(badge)}</small></span></button>`;
}
function render(){
 const list=visible();
 const totalPages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));
 page=Math.min(page,totalPages);
 const startIndex=(page-1)*PAGE_SIZE;
 const pageItems=list.slice(startIndex,startIndex+PAGE_SIZE);
 grid.innerHTML=pageItems.length?pageItems.map(card).join(""):`<div class="vivid-live-empty"><i class="bi bi-tv"></i><strong>No channels found</strong><span>Try another search or filter.</span></div>`;
 const pager=`<div class="vivid-live-pagination" aria-label="Channel pages"><button type="button" data-live-page="prev" ${page<=1?"disabled":""}><i class="bi bi-chevron-left"></i> Previous</button><span>Page ${page} of ${totalPages}</span><button type="button" data-live-page="next" ${page>=totalPages?"disabled":""}>Next <i class="bi bi-chevron-right"></i></button></div>`;
 grid.insertAdjacentHTML("beforeend",pager);
 if(guideStatus)guideStatus.textContent=`${list.length.toLocaleString()} channels · Page ${page} of ${totalPages}`;
}
function stopMedia(){try{video.pause()}catch{}video.removeAttribute("src");video.load();frame.src="about:blank";}
function showError(){if(playerLoading)playerLoading.hidden=true;if(playerError)playerError.hidden=false;}
function playSource(){
 const s=currentSources[sourceIndex];
 if(!s)return showError();
 if(playerError)playerError.hidden=true;
 if(playerLoading)playerLoading.hidden=false;
 if(s.type==="iframe"){
   video.hidden=true;stopMedia();frame.hidden=false;frame.src=s.url;
   if(playerMeta)playerMeta.textContent="2Embed live stream";
 }else{
   frame.hidden=true;frame.src="about:blank";video.hidden=false;video.src=s.url;
   if(playerMeta)playerMeta.textContent=`Live stream · ${s.quality||"public source"}`;
   const p=video.play();if(p?.catch)p.catch(()=>{});
 }
}
let lastFocusedChannel=null;
function play(c){
 if(!c?.sources?.length)return;
 lastFocusedChannel=document.activeElement;
 currentSources=c.sources;sourceIndex=0;
 if(playerTitle)playerTitle.textContent=c.name;
 player.hidden=false;
 player.classList.add("is-open");
 document.body.classList.add("vivid-live-player-open");
 playSource();
 window.setTimeout(()=>closePlayer?.focus(),0);
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
video?.addEventListener("error",()=>{if(sourceIndex<currentSources.length-1){sourceIndex++;playSource()}else showError()});
video?.addEventListener("playing",()=>{if(playerLoading)playerLoading.hidden=true});
frame?.addEventListener("load",()=>{if(playerLoading)playerLoading.hidden=true});
search?.addEventListener("input",()=>{page=1;render()});
(async()=>{
 try{
   const [seedRes,channelsRes,streamsRes,countriesRes,freeTvRes,curatedRes]=await Promise.all([
     fetch("./data/live-channels.json",{cache:"no-store"}),
     fetch("https://iptv-org.github.io/api/channels.json",{cache:"no-store"}),
     fetch("https://iptv-org.github.io/api/streams.json",{cache:"no-store"}),
     fetch("https://iptv-org.github.io/api/countries.json",{cache:"no-store"}),
     fetch("https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8",{cache:"no-store"}),
     fetch("https://raw.githubusercontent.com/RW1986/IPTV/main/lineup.m3u8",{cache:"no-store"})
   ]);
   const seed=seedRes.ok?await seedRes.json():FALLBACK;
   const apiChannels=channelsRes.ok?await channelsRes.json():[];
   const apiStreams=streamsRes.ok?await streamsRes.json():[];
   const countries=countriesRes.ok?await countriesRes.json():[];
   const freeTv=freeTvRes.ok?normalizeM3U(parseM3U(await freeTvRes.text(),"Free-TV")):[];
   const curated=curatedRes.ok?normalizeM3U(parseM3U(await curatedRes.text(),"Curated FAST")):[];
   const fallbackSeed=(Array.isArray(seed)?seed:[]).map(c=>({...c,provider:"2embed",sources:[{type:"iframe",url:c.streamUrl}]}));
   const api=normalizeApi(apiChannels,apiStreams,countries);
   const byName=new Map();
   [...freeTv,...curated,...api,...fallbackSeed].forEach(c=>{
     const key=c.name.toLowerCase().replace(/[^a-z0-9]+/g,"");
     const old=byName.get(key);
     if(!old){byName.set(key,c);return}
     const sources=[...old.sources,...c.sources].filter((s,i,a)=>s?.url&&a.findIndex(x=>x.url===s.url)===i).slice(0,3);
     const preferred=c.provider==="2embed"?c:old;
     byName.set(key,{...preferred,sources,logo:preferred.logo||old.logo||c.logo});
   });
   channels=[...byName.values()];
   if(!channels.length)throw Error("No live channels returned");
 }catch(e){console.warn("Live catalogue fallback:",e);channels=FALLBACK}
 renderFilters();render();
})();