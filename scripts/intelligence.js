import { tmdbApi } from "./tmdb.js";
import { getLocalLibrary } from "./library.js";

const KEY="vivid:intelligence:v1";
const SESSION_KEY="vivid:session:v1";
const empty=()=>({version:1,feedback:{},events:[],taste:{genres:{},languages:{},countries:{},actors:{},directors:{},media:{movie:0,tv:0},decades:{},updatedAt:0},onboarding:{completed:false,dismissed:false,completedAt:0}});
let firebasePromise=null, syncPromise=null, sessionId=null;

function read(){try{const v=JSON.parse(localStorage.getItem(KEY));const d=empty();return {...d,...v,feedback:{...d.feedback,...(v?.feedback||{})},events:Array.isArray(v?.events)?v.events:[],taste:{...d.taste,...(v?.taste||{})},onboarding:{...d.onboarding,...(v?.onboarding||{})}}}catch{return empty()}}
function write(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch{};window.dispatchEvent(new CustomEvent("vivid:intelligence-changed",{detail:v}))}
function key(x){return x?String(x.media_type||x.mediaType||"movie")+":"+String(x.id):""}
function safe(x){return{id:String(x?.id||""),media_type:x?.media_type||x?.mediaType||"movie",title:String(x?.title||x?.name||"Untitled").slice(0,300),year:String(x?.year||"").slice(0,10),poster_path:String(x?.poster_path||"").slice(0,500),backdrop_path:String(x?.backdrop_path||"").slice(0,500)}}
function sid(){if(sessionId)return sessionId;sessionId=localStorage.getItem(SESSION_KEY)||Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);try{localStorage.setItem(SESSION_KEY,sessionId)}catch{}return sessionId}
async function fb(){if(!firebasePromise)firebasePromise=Promise.all([import("./firebase.js"),import("https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js"),import("https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js")]).then(([f,a,s])=>({...f,onAuthStateChanged:a.onAuthStateChanged,collection:s.collection,doc:s.doc,getDocs:s.getDocs,setDoc:s.setDoc})).catch(e=>{firebasePromise=null;throw e});return firebasePromise}
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
function cloud(path,data){void user().then(u=>u&&fb().then(({db,doc,setDoc})=>setDoc(doc(db,"users",u.uid,...path),data,{merge:true}))).catch(()=>{})}

export function getFeedback(x){return read().feedback[typeof x==="string"?x:key(x)]?.kind||null}
export function getFeedbackState(){return read().feedback}
export function getNotForMeKeys(){return new Set(Object.entries(read().feedback).filter(([,v])=>v.kind==="not_for_me").map(([k])=>k))}
export function isNotForMe(x){return getFeedback(x)==="not_for_me"}

export function invalidateRecommendationCaches(){try{localStorage.removeItem("vivid:for-you:v1");localStorage.removeItem("vivid:for-you:v2");localStorage.removeItem("vivid:taste:v1")}catch{};window.dispatchEvent(new CustomEvent("vivid:recommendations-invalidated"))}

export function recordBehavior(type,item=null,metadata={}){
 const s=read(),x=item?safe(item):null,now=Date.now();
 const duplicateWindow=["title_opened","trailer_started","watch_started"].includes(type)?15000:type==="playback_progress"?30000:0;
 const duplicate=duplicateWindow&&s.events.some(e=>e.type===type&&e.contentId===key(x)&&now-Number(e.occurredAt||0)<duplicateWindow);
 if(duplicate)return;
 const clean={};Object.entries(metadata||{}).slice(0,10).forEach(([k,v])=>{if(typeof v==="string")clean[k.slice(0,40)]=v.slice(0,160);else if(typeof v==="number"||typeof v==="boolean")clean[k.slice(0,40)]=v});
 const event={id:now.toString(36)+"-"+Math.random().toString(36).slice(2,7),type:String(type).slice(0,60),contentId:x?key(x):null,mediaType:x?.media_type||null,occurredAt:now,sessionId:sid(),metadata:clean};
 s.events.push(event);if(s.events.length>300)s.events.splice(0,s.events.length-300);write(s);cloud(["events",event.sessionId+"_"+event.id],event)
}

export function setFeedback(item,kind){
 const x=safe(item),k=key(x);if(!k||!["like","not_for_me"].includes(kind))return null;
 const s=read(),next=s.feedback[k]?.kind===kind?null:kind;
 if(next)s.feedback[k]={...x,kind:next,updatedAt:Date.now()};else delete s.feedback[k];
 s.taste.updatedAt=0;write(s);invalidateRecommendationCaches();
 cloud(["feedback",k],next?{...x,kind:next,updatedAt:s.feedback[k].updatedAt}:{kind:"cleared",updatedAt:Date.now()});
 recordBehavior(next||"feedback_cleared",x,{feedback:next||""});void rebuildTasteProfile();return next
}

function add(m,k,w){if(k)m[k]=(m[k]||0)+w}
function decay(t,h=60){const age=Math.max(0,(Date.now()-Number(t||0))/86400000);return Math.pow(.5,age/h)}
function top(m,n){return Object.fromEntries(Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n))}
async function seeds(){
 const l=getLocalLibrary(),s=read(),all=[...(l.favorites||[]).map(x=>({item:x,w:4})),...(l.history||[]).filter(x=>Number(x.completion||0)>=25).map(x=>({item:x,w:2.5*Number(x.completion||0)/100})),...(l.watchLater||[]).map(x=>({item:x,w:1})),...Object.values(s.feedback).filter(x=>x.kind==="like").map(x=>({item:x,w:5}))];
 const m=new Map;all.forEach(x=>{const k=key(x.item),cur=m.get(k);if(k&&(!cur||x.w>cur.w))m.set(k,x)});return [...m.values()].sort((a,b)=>b.w-a.w).slice(0,12)
}
export async function rebuildTasteProfile(){
 const s=read(),l=getLocalLibrary(),t={genres:{},languages:{},countries:{},actors:{},directors:{},media:{movie:0,tv:0},decades:{}};
 const apply=(items,base,completion)=>{(items||[]).forEach(x=>{let w=base*decay(x.updatedAt||x.lastWatchedAt);if(completion){const c=Number(x.completion||0);w*=c>=80?1.8:c>=40?1.15:.55}add(t.media,x.media_type||"movie",w)})};
 apply(l.favorites,3.5,false);apply(l.watchLater,1.2,false);apply(l.history,2.2,true);Object.values(s.feedback).forEach(x=>{if(x.kind==="like")add(t.media,x.media_type||"movie",4.5*decay(x.updatedAt,75))});
 const ss=await seeds();const details=await Promise.allSettled(ss.slice(0,6).map(x=>x.item.media_type==="tv"?tmdbApi.tvDetails(x.item.id):tmdbApi.movieDetails(x.item.id)));
 details.forEach((r,i)=>{if(r.status!=="fulfilled")return;const d=r.value,w=ss[i].w;(d.genres||[]).forEach(g=>add(t.genres,String(g.id),w));if(d.original_language)add(t.languages,d.original_language,w*.8);(d.production_countries||[]).forEach(c=>add(t.countries,c.iso_3166_1,w*.55));const y=Number(String(d.release_date||d.first_air_date||"").slice(0,4));if(y>=1900)add(t.decades,String(Math.floor(y/10)*10),w*.45);(d.credits?.cast||[]).slice(0,10).forEach(p=>add(t.actors,String(p.id),w*.42));(d.credits?.crew||[]).filter(p=>["Director","Creator"].includes(p.job)).slice(0,5).forEach(p=>add(t.directors,String(p.id),w*.5))});
 s.taste={genres:top(t.genres,20),languages:top(t.languages,10),countries:top(t.countries,12),actors:top(t.actors,20),directors:top(t.directors,12),media:t.media,decades:top(t.decades,8),updatedAt:Date.now()};write(s);try{localStorage.setItem("vivid:taste:v1",JSON.stringify(s.taste))}catch{};cloud(["taste","profile"],{version:1,...s.taste});return s.taste
}
export async function getTasteProfile(){const t=read().taste;return t.updatedAt? t:rebuildTasteProfile()}
export function getTasteStrength(){const s=read(),l=getLocalLibrary();return Math.min(1,Object.keys(s.feedback).length*.16+(l.history||[]).length*.05)}
export function shouldShowColdStart(){const s=read(),l=getLocalLibrary();return !s.onboarding.completed&&!s.onboarding.dismissed&&!Object.keys(s.feedback).length&&!(l.history||[]).length&&!(l.favorites||[]).length}
export async function completeColdStart(items=[]){const s=read(),seen=new Set;items.slice(0,6).forEach(x=>{const i=safe(x),k=key(i);if(!k||seen.has(k))return;seen.add(k);s.feedback[k]={...i,kind:"like",updatedAt:Date.now()};recordBehavior("cold_start_like",i)});s.onboarding={completed:true,dismissed:false,completedAt:Date.now()};write(s);invalidateRecommendationCaches();await rebuildTasteProfile();return s}
export function dismissColdStart(){const s=read();s.onboarding={...s.onboarding,dismissed:true};write(s)}
export async function syncIntelligenceForUser(u){
 if(!u)return read();try{const {db,collection,getDocs}=await fb();const [f,t]=await Promise.all([getDocs(collection(db,"users",u.uid,"feedback")),getDocs(collection(db,"users",u.uid,"taste"))]);const s=read();f.docs.forEach(d=>{const x=d.data()||{};if(x.kind==="cleared")delete s.feedback[d.id];else if(!s.feedback[d.id]||Number(x.updatedAt||0)>Number(s.feedback[d.id].updatedAt||0))s.feedback[d.id]=x});const remote=t.docs.find(d=>d.id==="profile")?.data();if(remote&&Number(remote.updatedAt||0)>Number(s.taste.updatedAt||0))s.taste=remote;write(s);invalidateRecommendationCaches();return s}catch(e){console.warn("Vivid intelligence sync unavailable:",e);return read()}}
export function startIntelligenceSync(){if(syncPromise)return syncPromise;syncPromise=(async()=>{try{const {auth,onAuthStateChanged}=await fb();return await new Promise(resolve=>{let done=false;const finish=x=>{if(done)return;done=true;unsub?.();resolve(x)};const unsub=onAuthStateChanged(auth,u=>u?syncIntelligenceForUser(u).then(finish):finish(read()))})}catch{return read()}})();return syncPromise}
