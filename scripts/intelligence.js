import { tmdbApi } from "./tmdb.js";
import { getLocalLibrary } from "./library.js";

import { switchLocalOwner } from "./local-owner.js";

const KEY="vivid:intelligence:v1";
const SESSION_KEY="vivid:session:v1";
const TASTE_CACHE_KEY="vivid:taste:v1";
export function removeLegacySearchQueryEvents(events = []) {
 return (Array.isArray(events) ? events : []).filter(event => event?.type !== "search_query");
}
const empty=()=>({version:1,feedback:{},feedbackCleared:{},events:[],taste:{genres:{},languages:{},countries:{},actors:{},directors:{},media:{movie:0,tv:0},decades:{},updatedAt:0,dirty:false},onboarding:{completed:false,dismissed:false,completedAt:0}});
let firebasePromise=null, syncPromise=null, sessionId=null;
const LOCAL_OWNER_KEY="vivid:intelligence-owner:v1";
const TASTE_SIGNAL_TYPES=new Set(["title_opened","trailer_started","watch_started","playback_progress","watch_completed","recommendation_clicked"]);
function ensureIntelligenceOwner(uid){
 try{
  const result=switchLocalOwner({
   storage:localStorage,
   ownerKey:LOCAL_OWNER_KEY,
   activeKeys:[KEY,SESSION_KEY,TASTE_CACHE_KEY],
   uid,
   emptyValues:{[KEY]:JSON.stringify(empty()),[SESSION_KEY]:"",[TASTE_CACHE_KEY]:""}
  });
  if(result.changed){
   sessionId=null;
   window.dispatchEvent(new CustomEvent("vivid:account-switched",{detail:{uid:uid?String(uid):null}}));
   window.dispatchEvent(new CustomEvent("vivid:intelligence-changed",{detail:read()}));
  }
 }catch(error){console.warn("Vivid could not switch account-local intelligence snapshots:",error)}
}

function read(){try{const v=JSON.parse(localStorage.getItem(KEY));const d=empty();const events=removeLegacySearchQueryEvents(v?.events);const state={...d,...v,feedback:{...d.feedback,...(v?.feedback||{})},feedbackCleared:{...d.feedbackCleared,...(v?.feedbackCleared||{})},events,taste:{...d.taste,...(v?.taste||{})},onboarding:{...d.onboarding,...(v?.onboarding||{})}};if(Array.isArray(v?.events)&&events.length!==v.events.length){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}}return state}catch{return empty()}}
function write(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch{};window.dispatchEvent(new CustomEvent("vivid:intelligence-changed",{detail:v}))}
function key(x){return x?String(x.media_type||x.mediaType||"movie")+":"+String(x.id):""}
function safe(x){return{id:String(x?.id||""),media_type:x?.media_type||x?.mediaType||"movie",title:String(x?.title||x?.name||"Untitled").slice(0,300),year:String(x?.year||"").slice(0,10),poster_path:String(x?.poster_path||"").slice(0,500),backdrop_path:String(x?.backdrop_path||"").slice(0,500),genre_ids:[...new Set((x?.genre_ids||x?.raw?.genre_ids||[]).map(Number).filter(id=>Number.isFinite(id)&&id>0))].slice(0,20)} }
function sid(){if(sessionId)return sessionId;sessionId=localStorage.getItem(SESSION_KEY)||Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);try{localStorage.setItem(SESSION_KEY,sessionId)}catch{}return sessionId}
async function fb(){if(!firebasePromise)firebasePromise=Promise.all([import("./firebase.js"),import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")]).then(([f,a,s])=>({...f,onAuthStateChanged:a.onAuthStateChanged,collection:s.collection,doc:s.doc,getDocs:s.getDocs,getDocsFromServer:s.getDocsFromServer,setDoc:s.setDoc,deleteDoc:s.deleteDoc})).catch(e=>{firebasePromise=null;throw e});return firebasePromise}
async function user(){
 try{
  const {auth,onAuthStateChanged}=await fb();
  if(auth.currentUser)return auth.currentUser;
  return await new Promise(resolve=>{
   let settled=false;
   let unsubscribe=()=>{};
   const finish=u=>{if(settled)return;settled=true;unsubscribe();resolve(u)};
   unsubscribe=onAuthStateChanged(auth,finish);
   setTimeout(()=>finish(auth.currentUser||null),1200);
  });
 }catch{return null}
}
function cloud(path,data){
 const ownerAtCall=localStorage.getItem(LOCAL_OWNER_KEY)||"guest";
 return user().then(async u=>{
  if(!u||ownerAtCall==="guest"||String(u.uid)!==ownerAtCall||
     (localStorage.getItem(LOCAL_OWNER_KEY)||"guest")!==ownerAtCall)return {status:"local"};
  const {db,doc,setDoc}=await fb();
  await setDoc(doc(db,"users",u.uid,...path),data,{merge:true});
  window.dispatchEvent(new CustomEvent("vivid:sync-status",{detail:{store:"intelligence",status:"synced",path:path.join("/")}}));
  return {status:"synced"};
 }).catch(error=>{
  window.dispatchEvent(new CustomEvent("vivid:sync-status",{detail:{store:"intelligence",status:"error",path:path.join("/")}}));
  console.warn("Vivid intelligence cloud write failed; local state is retained for the next sync:",error);
  return {status:"error"};
 });
}

export function getFeedback(x){return read().feedback[typeof x==="string"?x:key(x)]?.kind||null}
export function getFeedbackState(){return read().feedback}
export function getNotForMeKeys(){return new Set(Object.entries(read().feedback).filter(([,v])=>v.kind==="not_for_me").map(([k])=>k))}
export function isNotForMe(x){return getFeedback(x)==="not_for_me"}
export function getRecommendationMemory(){
 const events=read().events;
 const memory=new Map();
 for(const event of events){
  if(!event?.contentId||!["recommendation_impression","recommendation_clicked"].includes(event.type))continue;
  const current=memory.get(event.contentId)||{impressions:0,clicks:0,lastSeen:0};
  if(event.type==="recommendation_impression")current.impressions++;
  if(event.type==="recommendation_clicked")current.clicks++;
  current.lastSeen=Math.max(current.lastSeen,Number(event.occurredAt||0));
  memory.set(event.contentId,current);
 }
 return memory;
}

export function invalidateRecommendationCaches(){try{localStorage.removeItem("vivid:for-you:v1");localStorage.removeItem("vivid:for-you:v2");localStorage.removeItem("vivid:taste:v1")}catch{};window.dispatchEvent(new CustomEvent("vivid:recommendations-invalidated"))}

export function recordBehavior(type,item=null,metadata={}){
 const s=read(),x=item?safe(item):null,now=Date.now();
 const duplicateWindow=["title_opened","trailer_started","watch_started"].includes(type)?15000:type==="playback_progress"?30000:["recommendation_row_view","recommendation_impression","recommendation_clicked"].includes(type)?60000:0;
 const duplicate=duplicateWindow&&s.events.some(e=>e.type===type&&e.contentId===key(x)&&now-Number(e.occurredAt||0)<duplicateWindow);
 if(duplicate)return;
 const clean={};Object.entries(metadata||{}).slice(0,10).forEach(([k,v])=>{if(typeof v==="string")clean[k.slice(0,40)]=v.slice(0,160);else if(typeof v==="number"||typeof v==="boolean")clean[k.slice(0,40)]=v});
 const event={id:now.toString(36)+"-"+Math.random().toString(36).slice(2,7),type:String(type).slice(0,60),contentId:x?key(x):null,mediaType:x?.media_type||null,occurredAt:now,sessionId:sid(),metadata:clean};
 s.events.push(event);if(s.events.length>300)s.events.splice(0,s.events.length-300);if(TASTE_SIGNAL_TYPES.has(type)){s.taste.updatedAt=0;s.taste.dirty=true;}write(s);cloud(["events",event.sessionId+"_"+event.id],event)
}

export function setFeedback(item,kind){
 const x=safe(item),k=key(x);if(!k||!["like","not_for_me"].includes(kind))return null;
 const s=read(),next=s.feedback[k]?.kind===kind?null:kind;
 if(next){s.feedback[k]={...x,kind:next,updatedAt:Date.now()};delete s.feedbackCleared[k]}
 else{delete s.feedback[k];s.feedbackCleared[k]={updatedAt:Date.now()}}
 s.taste.updatedAt=0;s.taste.dirty=true;write(s);invalidateRecommendationCaches();
 cloud(["feedback",k],next?{...x,kind:next,updatedAt:s.feedback[k].updatedAt}:{kind:"cleared",updatedAt:s.feedbackCleared[k].updatedAt});
 recordBehavior(next||"feedback_cleared",x,{feedback:next||""});void rebuildTasteProfile();return next
}

function add(m,k,w){if(k)m[k]=(m[k]||0)+w}
function decay(t,h=60){const age=Math.max(0,(Date.now()-Number(t||0))/86400000);return Math.pow(.5,age/h)}
function eventSignal(s,k){
 const now=Date.now();
 return s.events.reduce((sum,e)=>{
  if(e.contentId!==k)return sum;
  const age=Math.max(0,(now-Number(e.occurredAt||0))/86400000);
  const recent=Math.pow(.5,age/45);
  const weights={title_opened:.12,trailer_started:.45,watch_started:1.4,watch_completed:3.2,playback_progress:.35,recommendation_impression:.04,recommendation_clicked:.9};
  return sum+(weights[e.type]||0)*recent;
 },0)
}
function top(m,n){return Object.fromEntries(Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n))}
async function seeds(){
 const l=getLocalLibrary(),s=read(),all=[...(l.favorites||[]).map(x=>({item:x,w:4})),...(l.history||[]).filter(x=>Number(x.completion||0)>=25).map(x=>({item:x,w:2.5*Number(x.completion||0)/100})),...(l.watchLater||[]).map(x=>({item:x,w:1})),...Object.values(s.feedback).filter(x=>x.kind==="like").map(x=>({item:x,w:5}))];
  const eventBoosted=(l.history||[]).map(item=>({item,w:eventSignal(s,key(item))})).filter(x=>x.w>0);
  const behavioralItems=new Map;
  for(const event of s.events){
   if(!event?.contentId||!TASTE_SIGNAL_TYPES.has(event.type))continue;
   const parts=String(event.contentId).split(":");
   const typeFromKey=parts.shift();
   const media_type=event.mediaType||typeFromKey;
   const id=parts.join(":");
   if(!id||!media_type)continue;
   const item={id,media_type,title:"",updatedAt:Number(event.occurredAt||0)};
   const k=key(item),w=eventSignal(s,k),cur=behavioralItems.get(k);
   if(w>0&&(!cur||w>cur.w))behavioralItems.set(k,{item,w});
  }
  all.push(...eventBoosted,...behavioralItems.values());
 const m=new Map;all.forEach(x=>{const k=key(x.item),cur=m.get(k);if(k&&(!cur||x.w>cur.w))m.set(k,x)});return [...m.values()].sort((a,b)=>b.w-a.w).slice(0,12)
}
export async function rebuildTasteProfile(){
 const ownerAtStart=localStorage.getItem(LOCAL_OWNER_KEY)||"guest";
 const stateAtStart=localStorage.getItem(KEY)||"";
 const s=read(),l=getLocalLibrary(),t={genres:{},languages:{},countries:{},actors:{},directors:{},media:{movie:0,tv:0},decades:{}};
 const apply=(items,base,completion)=>{(items||[]).forEach(x=>{let w=base*decay(x.updatedAt||x.lastWatchedAt);if(completion){const c=Number(x.completion||0);w*=c>=80?1.8:c>=40?1.15:.55}add(t.media,x.media_type||"movie",w)})};
 apply(l.favorites,3.5,false);apply(l.watchLater,1.2,false);apply(l.history,2.2,true);Object.values(s.feedback).forEach(x=>{if(x.kind==="like")add(t.media,x.media_type||"movie",4.5*decay(x.updatedAt,75))});
 const ss=await seeds();const details=await Promise.allSettled(ss.slice(0,8).map(x=>x.item.media_type==="tv"?tmdbApi.tvDetails(x.item.id):tmdbApi.movieDetails(x.item.id)));
 if((localStorage.getItem(LOCAL_OWNER_KEY)||"guest")!==ownerAtStart || (localStorage.getItem(KEY)||"")!==stateAtStart)return read().taste;
 details.forEach((r,i)=>{if(r.status!=="fulfilled")return;const d=r.value,w=ss[i].w*(1+Math.min(.75,eventSignal(s,key(ss[i].item))));(d.genres||[]).forEach(g=>add(t.genres,String(g.id),w));if(d.original_language)add(t.languages,d.original_language,w*.8);(d.production_countries||[]).forEach(c=>add(t.countries,c.iso_3166_1,w*.55));const y=Number(String(d.release_date||d.first_air_date||"").slice(0,4));if(y>=1900)add(t.decades,String(Math.floor(y/10)*10),w*.45);(d.credits?.cast||[]).slice(0,10).forEach(p=>add(t.actors,String(p.id),w*.42));(d.credits?.crew||[]).filter(p=>["Director","Creator"].includes(p.job)).slice(0,5).forEach(p=>add(t.directors,String(p.id),w*.5))});
 s.taste={genres:top(t.genres,20),languages:top(t.languages,10),countries:top(t.countries,12),actors:top(t.actors,20),directors:top(t.directors,12),media:t.media,decades:top(t.decades,8),updatedAt:Date.now(),dirty:false};write(s);try{localStorage.setItem(TASTE_CACHE_KEY,JSON.stringify(s.taste))}catch{};cloud(["taste","profile"],{version:1,...s.taste});return s.taste
}
export async function getTasteProfile(){const t=read().taste;return t.updatedAt&&!t.dirty? t:rebuildTasteProfile()}
export function getTasteStrength(){const s=read(),l=getLocalLibrary();const explicit=new Set([...Object.keys(s.feedback),...(l.favorites||[]).map(key),...(l.watchLater||[]).map(key)]);const viewed=new Set((l.history||[]).map(key));const behavioral=new Set(s.events.filter(e=>TASTE_SIGNAL_TYPES.has(e.type)&&e.contentId).map(e=>String(e.contentId)));return Math.min(1,explicit.size*.14+viewed.size*.045+behavioral.size*.025)}
export function shouldShowColdStart(){const s=read(),l=getLocalLibrary();return !s.onboarding.completed&&!s.onboarding.dismissed&&!Object.keys(s.feedback).length&&!(l.history||[]).length&&!(l.favorites||[]).length}
export async function completeColdStart(items=[]){const s=read(),seen=new Set;items.slice(0,6).forEach(x=>{const i=safe(x),k=key(i);if(!k||seen.has(k))return;seen.add(k);const updatedAt=Date.now();s.feedback[k]={...i,kind:"like",updatedAt};delete s.feedbackCleared[k];cloud(["feedback",k],{...i,kind:"like",updatedAt});recordBehavior("cold_start_like",i)});s.onboarding={completed:true,dismissed:false,completedAt:Date.now()};write(s);invalidateRecommendationCaches();await rebuildTasteProfile();return s}
export function dismissColdStart(){const s=read();s.onboarding={...s.onboarding,dismissed:true};write(s)}
export function mergeBehaviorEvents(localEvents = [], remoteEvents = [], limit = 300) {
 const byId = new Map();
 const addEvent = event => {
  if (!event || typeof event !== "object" || !event.id || !event.sessionId) return;
  const id = String(event.sessionId) + "_" + String(event.id);
  const current = byId.get(id);
  if (!current || Number(event.occurredAt || 0) > Number(current.occurredAt || 0)) byId.set(id, event);
 };
 [...localEvents, ...remoteEvents].forEach(addEvent);
 const safeLimit = Math.max(1, Math.min(300, Number(limit) || 300));
 return [...byId.values()]
  .sort((a, b) => Number(a.occurredAt || 0) - Number(b.occurredAt || 0))
  .slice(-safeLimit);
}

export async function syncIntelligenceForUser(u){
 ensureIntelligenceOwner(u?.uid || null);
 if(!u)return read();
 try{
  const {db,collection,getDocsFromServer,doc,setDoc,deleteDoc}=await fb();
  const [f,e,t]=await Promise.all([getDocsFromServer(collection(db,"users",u.uid,"feedback")),getDocsFromServer(collection(db,"users",u.uid,"events")),getDocsFromServer(collection(db,"users",u.uid,"taste"))]);
  const {auth}=await fb();
  if(String(auth?.currentUser?.uid || "")!==String(u.uid) ||
     (localStorage.getItem(LOCAL_OWNER_KEY) || "guest")!==String(u.uid)){
   throw new Error("The signed-in account changed during intelligence sync. Please retry.");
  }
  const s=read();const stateAtSync=localStorage.getItem(KEY)||"";let feedbackChanged=false;
  const localEventIds=new Set(s.events.map(event=>String(event.sessionId||"")+"_"+String(event.id||"")));
  const remoteEvents=e.docs.map(d=>d.data()||{}).filter(event=>event.id&&event.sessionId&&event.type!=="search_query");
  const mergedEvents=mergeBehaviorEvents(s.events,remoteEvents,300);
  const mergedEventIds=new Set(mergedEvents.map(event=>String(event.sessionId||"")+"_"+String(event.id||"")));
  const eventDocsToDelete=e.docs.filter(d=>{
   const event=d.data()||{};
   return event.type==="search_query"||!event.id||!event.sessionId||!mergedEventIds.has(d.id);
  });
  const eventDocIdsToDelete=new Set(eventDocsToDelete.map(d=>d.id));
  const retainedRemoteEventIds=new Set(e.docs.filter(d=>!eventDocIdsToDelete.has(d.id)).map(d=>d.id));
  const ownerIsCurrent=()=>String(auth?.currentUser?.uid||"")===String(u.uid)&&
   (localStorage.getItem(LOCAL_OWNER_KEY)||"guest")===String(u.uid);
  for(let i=0;i<eventDocsToDelete.length;i+=20){
   if(!ownerIsCurrent())throw new Error("The signed-in account changed during event retention cleanup. Please retry.");
   await Promise.all(eventDocsToDelete.slice(i,i+20).map(eventDoc=>deleteDoc(eventDoc.ref)));
  }
  const eventsToUpload=s.events.filter(event=>{
   const eventDocId=String(event.sessionId||"")+"_"+String(event.id||"");
   return event.id&&event.sessionId&&mergedEventIds.has(eventDocId)&&!retainedRemoteEventIds.has(eventDocId);
  });
  for(let i=0;i<eventsToUpload.length;i+=20){
   if(!ownerIsCurrent())throw new Error("The signed-in account changed during event sync. Please retry.");
   await Promise.all(eventsToUpload.slice(i,i+20).map(event=>{
    const eventDocId=String(event.sessionId)+"_"+String(event.id);
    return setDoc(doc(db,"users",u.uid,"events",eventDocId),event,{merge:true});
   }));
  }
  const remoteAddedTasteSignal=mergedEvents.some(event=>
   !localEventIds.has(String(event.sessionId||"")+"_"+String(event.id||""))&&TASTE_SIGNAL_TYPES.has(event.type)
  );
  s.events=mergedEvents;
  if(remoteAddedTasteSignal){s.taste.updatedAt=0;s.taste.dirty=true;}
  const remoteFeedback=new Map(f.docs.map(d=>[d.id,d.data()||{}]));
  for(const [id,localItem] of Object.entries(s.feedback)){
   const remoteItem=remoteFeedback.get(id);
   if(!remoteItem || Number(localItem.updatedAt||0)>Number(remoteItem.updatedAt||0)){
    await setDoc(doc(db,"users",u.uid,"feedback",id),localItem,{merge:true});
   }
  }
  for(const [id,tombstone] of Object.entries(s.feedbackCleared)){
   const remoteItem=remoteFeedback.get(id);
   if(!remoteItem || Number(tombstone.updatedAt||0)>Number(remoteItem.updatedAt||0)){
    await setDoc(doc(db,"users",u.uid,"feedback",id),{kind:"cleared",updatedAt:Number(tombstone.updatedAt)||Date.now()},{merge:true});
   }
  }
  f.docs.forEach(d=>{
   const x=d.data()||{};
   const localItem=s.feedback[d.id];
   const localClear=s.feedbackCleared[d.id];
   const remoteUpdatedAt=Number(x.updatedAt||0);
   const localVersion=Math.max(Number(localItem?.updatedAt||0),Number(localClear?.updatedAt||0));
   if(remoteUpdatedAt<localVersion)return;
   if(x.kind==="cleared"){
    if(!localItem&&localClear&&Number(localClear.updatedAt||0)===remoteUpdatedAt)return;
    delete s.feedback[d.id];
    s.feedbackCleared[d.id]={updatedAt:remoteUpdatedAt};
    feedbackChanged=true;
   }else{
    if(localItem&&localItem.kind===x.kind&&Number(localItem.updatedAt||0)===remoteUpdatedAt&&!localClear)return;
    s.feedback[d.id]=x;
    delete s.feedbackCleared[d.id];
    feedbackChanged=true;
   }
  });
  const remote=t.docs.find(d=>d.id==="profile")?.data();
   if(feedbackChanged||s.taste.dirty){
    // Keep local behavior/feedback changes dirty; a newer remote timestamp
    // cannot represent local device-only behavior events.
    s.taste.updatedAt=0;
    s.taste.dirty=true;
   }else if(remote&&Number(remote.updatedAt||0)>Number(s.taste.updatedAt||0)){
    s.taste={...remote,dirty:false};
   }else if(Number(s.taste.updatedAt||0)>0&&Number(s.taste.updatedAt||0)>Number(remote?.updatedAt||0)){
    await setDoc(doc(db,"users",u.uid,"taste","profile"),{version:1,...s.taste},{merge:true});
  }
  const {auth:finalAuth}=await fb();
  if(String(finalAuth?.currentUser?.uid || "")!==String(u.uid) ||
     (localStorage.getItem(LOCAL_OWNER_KEY) || "guest")!==String(u.uid)){
   throw new Error("The signed-in account changed before intelligence state could be reconciled. Please retry.");
  }
  if((localStorage.getItem(KEY)||"")!==stateAtSync){
   throw new Error("Local intelligence changed during sync; newer local state was retained. Please retry.");
  }
  write(s);invalidateRecommendationCaches();
  window.dispatchEvent(new CustomEvent("vivid:sync-status",{detail:{store:"intelligence",status:"synced"}}));
  return s
 }catch(e){
  window.dispatchEvent(new CustomEvent("vivid:sync-status",{detail:{store:"intelligence",status:"error"}}));
  console.warn("Vivid intelligence sync unavailable; local state is retained for retry:",e);
  return read()
 }
}
export function startIntelligenceSync(){
 if(syncPromise)return syncPromise;
 syncPromise=(async()=>{
  try{
   const {auth,onAuthStateChanged}=await fb();
   return await new Promise(resolve=>{
    let initialStateHandled=false;
    onAuthStateChanged(auth,u=>{
     ensureIntelligenceOwner(u?.uid || null);
     if(!u){
      if(!initialStateHandled){initialStateHandled=true;resolve(read())}
      return;
     }
     void syncIntelligenceForUser(u).then(value=>{
      if(!initialStateHandled){initialStateHandled=true;resolve(value)}
     });
    });
   });
  }catch{return read()}
 })();
 return syncPromise;
}
if(typeof window!=="undefined"){
 // Keep account ownership aligned on every surface that imports Intelligence,
 // not only the watch page.
 void startIntelligenceSync();
 window.addEventListener("online",()=>{
  void user().then(u=>u&&syncIntelligenceForUser(u)).catch(()=>{});
 });
}
