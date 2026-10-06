import crypto from "node:crypto";
import admin from "firebase-admin";
import webpush from "web-push";

const serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||"{}");
const vapidPrivateKey=process.env.VAPID_PRIVATE_KEY||"";
const tmdbApiKey=process.env.TMDB_API_KEY||"6a46c44a2b36f3b6c206e5f19cafa558";
if(!serviceAccount.project_id)throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
if(!vapidPrivateKey)throw new Error("Missing VAPID_PRIVATE_KEY");
admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
const db=admin.firestore();
webpush.setVapidDetails("mailto:notifications@vividcinema.app","BGZNNqdOPr-XJjdPnJMKPHvErIXftdRM0P8VxpjElqRs5AwpyY94lownEeUE2W-8GnFyvNd3-u7tmRu2b-5dEIg",vapidPrivateKey);

const TMDB="https://api.themoviedb.org/3";
const RELEASE_TYPES={2:"Limited theatrical",3:"Theatrical",4:"Digital",5:"Physical",6:"TV"};
const cache=new Map(),today=new Date().toISOString().slice(0,10);
const dateOnly=v=>v?String(v).slice(0,10):"";
const released=v=>Boolean(v&&v<=today);
const eventKey=x=>[x.date,x.type,x.note||""].join("|");
const safeRegion=v=>/^[A-Z]{2}$/.test(String(v||""))?String(v):"US";
const alertId=k=>crypto.createHash("sha256").update(k).digest("hex").slice(0,40);

async function tmdb(path,params={}){
 const url=new URL(TMDB+"/"+path.replace(/^\/+ /,"").replace(/^\/+ /,""));
 url.searchParams.set("api_key",tmdbApiKey);url.searchParams.set("language","en-US");
 Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")url.searchParams.set(k,v)});
 const key=url.toString();if(cache.has(key))return cache.get(key);
 const response=await fetch(key,{headers:{accept:"application/json"}});
 if(!response.ok)throw new Error("TMDB "+response.status);
 const data=await response.json();cache.set(key,data);return data;
}
async function movieEvents(id,region){
 const data=await tmdb("movie/"+encodeURIComponent(id)+"/release_dates");
 const country=(data.results||[]).find(x=>x.iso_3166_1===region)||(data.results||[]).find(x=>x.iso_3166_1==="US");
 return (country?.release_dates||[]).filter(x=>x?.release_date&&[2,3,4,5,6].includes(Number(x.type)))
  .map(x=>({date:dateOnly(x.release_date),type:Number(x.type),note:String(x.note||"").trim(),released:true}))
  .filter(x=>released(x.date)).filter((x,i,a)=>a.findIndex(y=>eventKey(y)===eventKey(x))===i);
}
async function inspect(item,region,previous){
 const mediaType=item.media_type==="tv"?"tv":"movie";
 if(mediaType==="movie"){
  const events=await movieEvents(item.id,region),current={mediaType,id:String(item.id),region,events,checkedAt:Date.now()};
  if(!previous)return {current,alert:null};
  const old=new Map((previous.events||[]).map(x=>[eventKey(x),x]));
  const event=events.find(x=>!old.has(eventKey(x)));
  if(!event)return {current,alert:null};
  return {current,alert:{type:"movie-release",mediaType,contentId:String(item.id),id:String(item.id),title:item.title||"A movie",releaseDate:event.date,releaseType:event.type,releaseTypeLabel:RELEASE_TYPES[event.type]||"New release",season:null,episode:null,episodeTitle:""}};
 }
 const details=await tmdb("tv/"+encodeURIComponent(item.id)),last=details?.last_episode_to_air;
 const current={mediaType,id:String(item.id),lastId:String(last?.id||""),lastDate:dateOnly(last?.air_date),lastSeason:Number(last?.season_number||0),lastEpisode:Number(last?.episode_number||0),checkedAt:Date.now()};
 if(!previous||!current.lastId||current.lastId===String(previous.lastId||""))return {current,alert:null};
 const seasonChanged=current.lastSeason>Number(previous.lastSeason||0);
 return {current,alert:{type:seasonChanged?"tv-season":"tv-episode",mediaType,contentId:String(item.id),id:String(item.id),title:item.title||details.name||"A series",releaseDate:current.lastDate,releaseType:null,releaseTypeLabel:seasonChanged?"New season":"New episode",season:current.lastSeason,episode:current.lastEpisode,episodeTitle:last?.name||""}};
}
async function sendPush(subscriptions,alert){
 let delivered=0;
 for(const sub of subscriptions){
  try{
   await webpush.sendNotification({endpoint:sub.data.endpoint,expirationTime:sub.data.expirationTime||null,keys:{p256dh:sub.data.keys.p256dh,auth:sub.data.keys.auth}},JSON.stringify({
    title:"Vivid Cinema · "+(alert.type==="movie-release"?"New release":alert.type==="tv-season"?"New season":"New episode"),
    body:alert.type==="movie-release"?alert.title+" · "+alert.releaseTypeLabel:alert.title+" · S"+alert.season+" E"+alert.episode+(alert.episodeTitle?" · "+alert.episodeTitle:""),
    tag:"vivid-release-"+alert.type+"-"+alert.contentId+"-"+(alert.releaseDate||alert.episode),
    url:"./title.html?id="+encodeURIComponent(alert.contentId)+"&type="+alert.mediaType
   }),{TTL:86400});delivered++;
  }catch(error){if(error?.statusCode===404||error?.statusCode===410)await sub.ref.delete().catch(()=>{});}
 }
 return delivered;
}

const users=new Map();
for(const collection of ["favorites","watchLater"]){
 const snapshot=await db.collectionGroup(collection).get();
 for(const doc of snapshot.docs){
  const userRef=doc.ref.parent.parent,item=doc.data();
  if(!userRef||!item?.id||!["movie","tv"].includes(item.media_type))continue;
  if(!users.has(userRef.path))users.set(userRef.path,{userRef,items:new Map()});
  users.get(userRef.path).items.set(item.media_type+":"+item.id,item);
 }
}
let checked=0,alerts=0,pushed=0,failures=0;
for(const {userRef,items} of users.values()){
 const profile=await userRef.get(),region=safeRegion(profile.data()?.preferences?.providerCountry);
 const subSnap=await userRef.collection("pushSubscriptions").get();
 const subscriptions=subSnap.docs.map(doc=>({ref:doc.ref,data:doc.data()})).filter(x=>x.data?.endpoint&&x.data?.keys?.p256dh&&x.data?.keys?.auth);
 for(const item of items.values()){
  const stateRef=userRef.collection("releaseStates").doc(item.media_type+"_"+item.id),stateSnap=await stateRef.get(),previous=stateSnap.exists?stateSnap.data():null;
  try{
   const result=await inspect(item,region,previous);checked++;
   if(result.alert){
    const alert={...result.alert,createdAt:Date.now(),key:result.alert.mediaType+":"+result.alert.contentId+":"+result.alert.type+":"+result.alert.releaseDate};
    const alertRef=userRef.collection("releaseAlerts").doc(alertId(alert.key)),existing=await alertRef.get();
    if(!existing.exists){await alertRef.set(alert);alerts++;pushed+=await sendPush(subscriptions,alert);}
   }
   await stateRef.set(result.current,{merge:true});
  }catch(error){failures++;console.warn("release check failed",userRef.path,item.media_type,item.id,error?.message||error);}
 }
}
console.log(JSON.stringify({users:users.size,checked,alerts,pushed,failures,at:new Date().toISOString()}));