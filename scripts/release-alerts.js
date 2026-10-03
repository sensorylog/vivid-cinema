import { tmdbApi } from "./tmdb.js";
import { getFollowedTitles } from "./library.js";

const ALERT_STATE_KEY="vivid:release-alerts:v1";
const ALERT_SEEN_KEY="vivid:release-seen:v1";
const MAX_SEEN=300;

function read(key,fallback){
  try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}
}
function write(key,value){
  try{localStorage.setItem(key,JSON.stringify(value));}catch{}
}
function state(){return read(ALERT_STATE_KEY,{permission:"default",lastCheckedAt:0});}
function seen(){return read(ALERT_SEEN_KEY,{});}
function alertKey(item,type,extra=""){return [item.media_type||item.mediaType||"movie",item.id,type,extra].join(":");}
function normalizeDate(value){return value?String(value).slice(0,10):"";}

export function getReleaseAlertState(){return state();}
export function getPendingReleaseAlerts(){return Object.values(seen()).filter(item=>item.pending===true).sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));}

export async function requestReleaseAlerts(){
  if(!("Notification" in window)) return "unsupported";
  const permission=await Notification.requestPermission();
  const next=state();
  next.permission=permission;
  next.requestedAt=Date.now();
  write(ALERT_STATE_KEY,next);
  return permission;
}

export function dismissReleaseAlert(key){
  const current=seen();
  if(current[key]){current[key].pending=false;current[key].dismissedAt=Date.now();write(ALERT_SEEN_KEY,current);}
}

export function clearReleaseAlerts(){
  write(ALERT_SEEN_KEY,{});
}

function addAlert(alert){
  const current=seen();
  const key=alert.key;
  if(current[key]) return false;
  current[key]={...alert,pending:true,createdAt:Date.now()};
  const entries=Object.entries(current).sort((a,b)=>Number(b[1].createdAt||0)-Number(a[1].createdAt||0)).slice(0,MAX_SEEN);
  write(ALERT_SEEN_KEY,Object.fromEntries(entries));
  return true;
}

function scheduleLabel(item,releaseDate){
  const today=new Date();today.setHours(0,0,0,0);
  const date=new Date(releaseDate+"T00:00:00");
  const diff=Math.round((date-today)/86400000);
  if(diff<=0)return "Now available";
  if(diff===1)return "Tomorrow";
  if(diff<=7)return "In "+diff+" days";
  return releaseDate;
}

async function inspectMovie(item){
  const details=await tmdbApi.movieDetailsBasic(item.id);
  const release=normalizeDate(details.release_date);
  if(!release)return null;
  return {
    key:alertKey(item,"movie-release",release),
    type:"movie-release",
    title:item.title||details.title||details.name,
    media_type:"movie",
    id:item.id,
    releaseDate:release,
    schedule:scheduleLabel(item,release),
    message:(new Date(release+"T00:00:00")<=new Date())?"is now available":"is coming "+scheduleLabel(item,release).toLowerCase()
  };
}

async function inspectTv(item){
  const details=await tmdbApi.tvDetailsBasic(item.id);
  const alerts=[];
  const firstAir=normalizeDate(details.first_air_date);
  if(firstAir){
    alerts.push({key:alertKey(item,"tv-release",firstAir),type:"tv-release",title:item.title||details.name,media_type:"tv",id:item.id,releaseDate:firstAir,schedule:scheduleLabel(item,firstAir),message:"has a new release date"});
  }
  // Basic details carry season/episode counts. We deliberately do not poll every
  // episode here: the next phase can add episode-level monitoring without turning
  // every Home visit into a large TMDB request burst.
  return alerts;
}

export async function checkForReleaseAlerts(){
  const followed=getFollowedTitles().slice(0,30);
  if(!followed.length)return [];
  const results=await Promise.allSettled(followed.map(item=>item.media_type==="tv"?inspectTv(item):inspectMovie(item)));
  const alerts=[];
  results.forEach(result=>{
    if(result.status!=="fulfilled"||!result.value)return;
    const list=Array.isArray(result.value)?result.value:[result.value];
    list.forEach(alert=>{if(alert&&addAlert(alert))alerts.push(alert);});
  });
  const next=state();
  next.lastCheckedAt=Date.now();
  write(ALERT_STATE_KEY,next);
  return alerts;
}

export function deliverReleaseAlerts(alerts=[]){
  if(!alerts.length||!("Notification" in window)||Notification.permission!=="granted")return;
  alerts.slice(0,3).forEach(alert=>{
    try{
      new Notification("Vivid Cinema · "+alert.type==="movie-release"?"New movie":"New TV release",{body:alert.title+" — "+alert.schedule,tag:alert.key});
    }catch{}
  });
}
