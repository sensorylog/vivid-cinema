import { tmdbApi } from "./tmdb.js";
import { getFollowedTitles } from "./library.js";

const STATE="vivid:release-alerts:v2", SEEN="vivid:release-seen:v2", KNOWN="vivid:release-known:v2", SETTINGS="vivid:release-settings:v1";
const MAX_SEEN=300, MAX_FOLLOWED=30, CHECK_MS=4*60*60*1000;
const RELEASE_TYPES={2:"Limited theatrical",3:"Theatrical",4:"Digital",5:"Physical",6:"TV"};

function read(k,f){try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}}
function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}
function state(){return read(STATE,{permission:"default",lastCheckedAt:0,region:"US"});}
function seen(){return read(SEEN,{});}
function known(){return read(KNOWN,{});}
function prefs(){return {movies:true,episodes:true,seasons:true,...read(SETTINGS,{})};}
function today(){const d=new Date();d.setHours(0,0,0,0);return d;}
function date(v){return v?String(v).slice(0,10):"";}
function released(v){return Boolean(v&&new Date(date(v)+"T00:00:00")<=today());}
function key(item,type,extra=""){return [item.media_type||item.mediaType||"movie",item.id,type,extra].join(":");}
function getRegion(){
  try{const v=String(localStorage.getItem("vivid:provider-country")||"").toUpperCase();if(/^[A-Z]{2}$/.test(v))return v;}catch{}
  try{const m=(Intl.DateTimeFormat().resolvedOptions().locale||"").match(/[-_]([A-Z]{2})\b/);if(m)return m[1];}catch{}
  return "US";
}
function addAlert(a){
  const all=seen();if(all[a.key])return false;
  all[a.key]={...a,pending:true,createdAt:Date.now()};
  write(SEEN,Object.fromEntries(Object.entries(all).sort((a,b)=>(b[1].createdAt||0)-(a[1].createdAt||0)).slice(0,MAX_SEEN)));
  return true;
}
function movieEvents(data,region){
  const rows=data?.results||[], country=rows.find(x=>x.iso_3166_1===region)||rows.find(x=>x.iso_3166_1==="US")||rows[0];
  return (country?.release_dates||[]).filter(x=>x?.release_date&&[2,3,4,5,6].includes(Number(x.type)))
    .map(x=>({date:date(x.release_date),type:Number(x.type),note:String(x.note||"").trim()}))
    .filter(x=>x.date)
    .filter((x,i,a)=>a.findIndex(y=>x.date===y.date&&x.type===y.type&&x.note===y.note)===i);
}
async function inspectMovie(item,region){
  const [details,releases]=await Promise.all([tmdbApi.movieDetailsBasic(item.id),tmdbApi.movieReleaseDates(item.id)]);
  const events=movieEvents(releases,region);
  if(!events.length&&details.release_date)events.push({date:date(details.release_date),type:3,note:""});
  if(!events.length)return null;
  const stateKey=key(item,"movie-events",region), all=known(), old=all[stateKey], oldEvents=old?.events||[];
  all[stateKey]={region,events:events.map(x=>({...x,released:released(x.date)})),checkedAt:Date.now()};write(KNOWN,all);
  if(!old)return null;
  const oldMap=new Map(oldEvents.map(x=>[[x.date,x.type,x.note].join("|"),x]));
  const event=events.find(x=>released(x.date)&&(!oldMap.has([x.date,x.type,x.note].join("|"))||oldMap.get([x.date,x.type,x.note].join("|")).released!==true));
  if(!event)return null;
  return {key:key(item,"movie-release",[region,event.date,event.type,event.note].join("|")),type:"movie-release",title:item.title||details.title||"A movie",media_type:"movie",id:item.id,releaseDate:event.date,releaseType:event.type,releaseTypeLabel:RELEASE_TYPES[event.type]||"Release",region,note:event.note,schedule:"Now available"};
}
async function inspectTv(item){
  const details=await tmdbApi.tvDetailsBasic(item.id), last=details?.last_episode_to_air;
  const stateKey=key(item,"tv-state"), all=known(), old=all[stateKey];
  const current={lastId:Number(last?.id||0),lastDate:date(last?.air_date),lastSeason:Number(last?.season_number||0),lastEpisode:Number(last?.episode_number||0),checkedAt:Date.now()};
  all[stateKey]=current;write(KNOWN,all);
  if(!old||!current.lastId||current.lastId===Number(old.lastId||0))return null;
  const season=current.lastSeason>Number(old.lastSeason||0),type=season?"tv-season":"tv-episode";
  return {key:key(item,type,String(current.lastId)),type,title:item.title||details.name||"A series",media_type:"tv",id:item.id,releaseDate:current.lastDate,season:current.lastSeason,episode:current.lastEpisode,episodeTitle:last?.name||"",schedule:"Now available"};
}
export function getReleaseAlertState(){return state();}
export function getReleaseAlertSettings(){return prefs();}
export function saveReleaseAlertSettings(next={}){const p={...prefs(),...next};write(SETTINGS,{movies:Boolean(p.movies),episodes:Boolean(p.episodes),seasons:Boolean(p.seasons)});return prefs();}
export function getPendingReleaseAlerts(){return Object.values(seen()).filter(x=>x?.pending).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));}
export function dismissReleaseAlert(k){const all=seen();if(all[k]){all[k].pending=false;all[k].dismissedAt=Date.now();write(SEEN,all);}}
export function clearReleaseAlerts(){write(SEEN,{});}
export async function requestReleaseAlerts(){if(!("Notification" in window))return "unsupported";const permission=await Notification.requestPermission(),s=state();s.permission=permission;s.requestedAt=Date.now();write(STATE,s);return permission;}
export async function checkForReleaseAlerts({force=false}={}){
  const followed=getFollowedTitles().slice(0,MAX_FOLLOWED);if(!followed.length)return [];
  const s=state(),region=getRegion();if(!force&&s.region===region&&Date.now()-(s.lastCheckedAt||0)<CHECK_MS)return [];
  const p=prefs(), eligible=followed.filter(x=>(x.media_type||x.mediaType)==="tv"?(p.episodes||p.seasons):p.movies);
  const results=await Promise.allSettled(eligible.map(x=>(x.media_type||x.mediaType)==="tv"?inspectTv(x):inspectMovie(x,region))),alerts=[];
  results.forEach(r=>{if(r.status!=="fulfilled"||!r.value)return;const a=r.value;if((a.type==="tv-episode"&&!p.episodes)||(a.type==="tv-season"&&!p.seasons)|| (a.type==="movie-release"&&!p.movies))return;if(addAlert(a))alerts.push(a);});
  const next=state();next.lastCheckedAt=Date.now();next.followedCount=followed.length;next.checkedCount=eligible.length;next.region=region;next.lastErrorCount=results.filter(x=>x.status==="rejected").length;write(STATE,next);return alerts;
}
export async function deliverReleaseAlerts(alerts=[]){
  if(!alerts.length||!("Notification" in window)||Notification.permission!=="granted")return 0;
  try{const reg=await navigator.serviceWorker?.ready;if(!reg?.showNotification)return 0;let n=0;
    for(const a of alerts.slice(0,3)){const label=a.type==="tv-season"?"New season":a.type==="tv-episode"?"New episode":"New release";
      await reg.showNotification("Vivid Cinema · "+label,{body:a.type==="movie-release"?a.title+" · "+(a.releaseTypeLabel||"New release"):a.title+" · S"+a.season+" E"+a.episode+(a.episodeTitle?" · "+a.episodeTitle:""),tag:a.key,renotify:false,icon:"./icons/vivid-icon.svg",badge:"./icons/vivid-icon.svg",data:{url:"title.html?id="+encodeURIComponent(a.id)+"&type="+a.media_type}});n++;}
    return n;
  }catch{return 0;}
}