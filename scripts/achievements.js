import { getLocalLibrary } from "./library.js";
import { switchLocalOwner } from "./local-owner.js";

const STORAGE_KEY = "vivid:achievements:v1";
const OWNER_KEY = "vivid:achievements-owner:v1";
const VERSION = 1;
const $ = (id) => document.getElementById(id);
const list = (library, key) => Array.isArray(library?.[key]) ? library[key] : [];
const count = (library, key) => list(library, key).length;
const typeOf = (item) => item?.media_type || item?.mediaType || "movie";
const unique = (items) => [...new Map(items.map((item) => [typeOf(item) + ":" + item.id, item])).values()];
const allItems = (library) => ["favorites", "watchLater", "history"].flatMap((key) => list(library, key).filter((item) => item?.id != null));
const completed = (library) => list(library, "history").filter((item) => Number(item?.completion || 0) >= 90 || Number(item?.completedAt || 0) > 0 || item?.completed === true);

export const ACHIEVEMENTS = [
  { id:"first-favorite", title:"First Love", category:"Your library", description:"Save a title you want to keep close.", icon:"♥", target:1, unit:"favorite", metric:l=>count(l,"favorites") },
  { id:"favorites-5", title:"A Personal Shelf", category:"Your library", description:"Five titles, chosen by you.", icon:"✦", target:5, unit:"favorites", metric:l=>count(l,"favorites") },
  { id:"favorites-10", title:"The Collector", category:"Your library", description:"Build a collection of ten favorites.", icon:"◈", target:10, unit:"favorites", metric:l=>count(l,"favorites") },
  { id:"favorites-25", title:"Curator in Chief", category:"Your library", description:"Give twenty-five stories a place on your shelf.", icon:"✧", target:25, unit:"favorites", metric:l=>count(l,"favorites") },
  { id:"queue-first", title:"One for Later", category:"Watch Later", description:"Save something for a future movie night.", icon:"◷", target:1, unit:"saved title", metric:l=>count(l,"watchLater") },
  { id:"queue-5", title:"Future Plans", category:"Watch Later", description:"Line up five possibilities for later.", icon:"⌁", target:5, unit:"saved titles", metric:l=>count(l,"watchLater") },
  { id:"queue-10", title:"The Night Planner", category:"Watch Later", description:"Keep ten options ready for the right mood.", icon:"☾", target:10, unit:"saved titles", metric:l=>count(l,"watchLater") },
  { id:"history-first", title:"The First Frame", category:"Your journey", description:"Your first title has made it into your history.", icon:"▶", target:1, unit:"logged title", metric:l=>count(l,"history") },
  { id:"history-5", title:"The Story Continues", category:"Your journey", description:"Log five titles in your cinema journey.", icon:"▸", target:5, unit:"logged titles", metric:l=>count(l,"history") },
  { id:"history-10", title:"A Few Stories In", category:"Your journey", description:"Ten titles are now part of your story.", icon:"▰", target:10, unit:"logged titles", metric:l=>count(l,"history") },
  { id:"completion-first", title:"Stay for the Credits", category:"Finished stories", description:"Finish a title and mark the ending.", icon:"✺", target:1, unit:"completed title", metric:l=>completed(l).length },
  { id:"completion-5", title:"Credits Roll", category:"Finished stories", description:"Finish five titles in your history.", icon:"✹", target:5, unit:"completed titles", metric:l=>completed(l).length },
  { id:"whole-picture", title:"The Whole Picture", category:"Your library", description:"Use Favorites, Watch Later, and History together.", icon:"◉", target:1, unit:"of 3 shelves", metric:l=>["favorites","watchLater","history"].every(k=>count(l,k)>0)?1:0 },
  { id:"feature-focus", title:"Feature Focus", category:"Your taste", description:"Save five movies to your Favorites.", icon:"▣", target:5, unit:"favorite movies", metric:l=>list(l,"favorites").filter(i=>typeOf(i)==="movie").length },
  { id:"series-scout", title:"Series Scout", category:"Your taste", description:"Collect three TV series across your library.", icon:"▤", target:3, unit:"series", metric:l=>unique(allItems(l).filter(i=>typeOf(i)==="tv")).length },
  { id:"library-25", title:"A Library of Your Own", category:"Your library", description:"Collect twenty-five distinct titles across your shelves.", icon:"▥", target:25, unit:"distinct titles", metric:l=>unique(allItems(l)).length }
];

let currentUid = null, initialized = false, remoteVersion = 0, modalOpen = false, lastFocus = null;

function emptyStore(){return {version:VERSION,earned:{}}}
function readStore(){try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");return {...emptyStore(),...(value||{}),earned:{...(value?.earned||{})}}}catch{return emptyStore()}}
function snapshot(library=getLocalLibrary()){
  const store=readStore();
  const items=ACHIEVEMENTS.map(a=>{const current=Math.max(0,Number(a.metric(library))||0);const earned=store.earned[a.id];return {...a,current,progress:Math.min(current,a.target),earned:Boolean(earned),unlockedAt:Number(earned?.unlockedAt||0),percentage:Math.min(100,Math.round(current/a.target*100))}});
  return {earnedCount:items.filter(i=>i.earned).length,totalCount:items.length,items,next:items.filter(i=>!i.earned).sort((a,b)=>b.percentage-a.percentage).slice(0,3)};
}
export function getAchievementSnapshot(library){return snapshot(library||getLocalLibrary())}
function render(){
  const grid=$("achievement-grid");if(!grid)return;
  const data=snapshot(),summary=$("achievement-summary"),progress=$("achievement-progress");
  if(summary)summary.textContent=data.earnedCount+" of "+data.totalCount+" milestones unlocked";
  if(progress){const pct=Math.round(data.earnedCount/data.totalCount*100);progress.style.setProperty("--achievement-progress",pct+"%");progress.setAttribute("aria-valuenow",String(pct))}
  const all=grid.dataset.showAll==="true";
  const sorted=[...data.items].sort((a,b)=>Number(b.earned)-Number(a.earned)||b.percentage-a.percentage||a.title.localeCompare(b.title));
  grid.replaceChildren();
  (all?sorted:sorted.slice(0,6)).forEach(item=>{
    const card=document.createElement("article");card.className="achievement-tile"+(item.earned?" is-earned":"");
    const icon=document.createElement("span");icon.className="achievement-tile-icon";icon.setAttribute("aria-hidden","true");icon.textContent=item.earned?item.icon:"✧";
    const body=document.createElement("div");body.className="achievement-tile-body";
    const title=document.createElement("h3");title.textContent=item.title;
    const desc=document.createElement("p");desc.textContent=item.description;
    const footer=document.createElement("div");footer.className="achievement-tile-footer";
    const state=document.createElement("span");state.textContent=item.earned?"Unlocked":item.current+" / "+item.target+" "+item.unit;
    const track=document.createElement("span");track.className="achievement-tile-track";const fill=document.createElement("span");fill.style.width=item.percentage+"%";track.append(fill);footer.append(state,track);
    body.append(title,desc,footer);card.append(icon,body);grid.append(card);
  });
  const toggle=$("achievement-view-all");if(toggle){toggle.hidden=data.items.length<=6;toggle.textContent=all?"Show less":"View all";toggle.setAttribute("aria-expanded",String(all))}
}
function writeStore(store){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(store))}catch{}
  render();window.dispatchEvent(new CustomEvent("vivid:achievements-changed",{detail:snapshot()}));
}
function contextFor(library){
  const compact=items=>list({items},"items").slice(0,5).map(i=>({title:String(i?.title||i?.name||"Untitled").slice(0,80),type:typeOf(i)==="tv"?"series":"movie",year:String(i?.year||"").slice(0,4)}));
  return {counts:{favorites:count(library,"favorites"),watchLater:count(library,"watchLater"),history:count(library,"history")},favorites:compact(library.favorites),watchLater:compact(library.watchLater),history:compact(library.history)};
}
function fallbackSpark(a,library){
  const title=contextFor(library).favorites[0]?.title;
  if(title&&a.id==="favorites-5")return "Your shelf started with “"+title+"”. The fun part now is noticing which future favorites feel like its distant cousins.";
  const messages={
    "first-favorite":"Every personal cinema starts with one story you want to keep close. Your shelf has its first anchor.",
    "favorites-5":"Five favorites is less a ranking than a tiny map of stories you may want to return to.",
    "favorites-10":"Your favorites are becoming a taste fingerprint: not just what is popular, but what keeps calling you back.",
    "favorites-25":"You have enough saved stories to start spotting your own patterns. Your next great find may sit beside an old favorite.",
    "queue-first":"A good watchlist is a promise to your future mood. You just made the first one.",
    "queue-5":"Your next movie night has options before it even has a mood. That is a very Vivid kind of preparation.",
    "queue-10":"Ten possibilities means you can choose by feeling, not endless scrolling. Your future self says thanks.",
    "history-first":"One title can be the start of a surprisingly personal cinema timeline. This is frame one.",
    "history-5":"Your history is starting to look less like a record and more like a trail of choices about what moves you.",
    "history-10":"Ten titles in, you are building a private map of stories you chose to spend time with.",
    "completion-first":"There is a particular satisfaction in reaching an ending on purpose. One more story now has a full stop.",
    "completion-5":"Five endings reached. You are collecting complete experiences, not just posters and possibilities.",
    "whole-picture":"You have a place for what you love, what you might watch, and what you have seen. That is your own small cinema system.",
    "feature-focus":"Your movie shelf has a point of view now. Keep an eye on the kinds of stories that earn a second look.",
    "series-scout":"Series have a different rhythm from films. Your collection is making room for stories that stay with you longer.",
    "library-25":"Twenty-five distinct titles is a real personal catalogue. The interesting part is the connections between them."
  };return messages[a.id]||"Your cinema collection is taking on a shape that belongs to you.";
}
function ensureStyles(){
  if(document.querySelector('link[data-vivid-achievement-styles]'))return;
  const link=document.createElement("link");link.rel="stylesheet";link.href="./styles/vivid-achievements.css?v=20261018-achievements-1";link.dataset.vividAchievementStyles="true";document.head.append(link);
}
function closeModal(){
  $("vivid-achievement-modal")?.remove();modalOpen=false;document.removeEventListener("keydown",onModalKey);
  if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
}
function onModalKey(event){
  if(event.key==="Escape"){event.preventDefault();closeModal();return}
  if(event.key!=="Tab")return;
  const buttons=[...($("vivid-achievement-modal")?.querySelectorAll("button:not([disabled])")||[])];
  if(!buttons.length)return;
  if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1).focus()}
  else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0].focus()}
}
async function showUnlock(a,others,library){
  if(modalOpen||!document.body)return;modalOpen=true;lastFocus=document.activeElement;
  const modal=document.createElement("div");modal.id="vivid-achievement-modal";modal.className="vivid-achievement-overlay";
  modal.innerHTML='<section class="vivid-achievement-dialog" role="dialog" aria-modal="true" aria-labelledby="vivid-achievement-title" aria-describedby="vivid-achievement-description"><button class="vivid-achievement-close" type="button" aria-label="Close achievement moment">×</button><div class="vivid-achievement-mark" aria-hidden="true"></div><span class="vivid-achievement-eyebrow">VIVID MILESTONE UNLOCKED</span><h2 id="vivid-achievement-title"></h2><p id="vivid-achievement-description"></p><div class="vivid-spark-panel"><span class="vivid-spark-label"><span aria-hidden="true">✦</span> VIVID SPARK</span><p id="vivid-achievement-spark" aria-live="polite"></p></div><p class="vivid-achievement-extra" id="vivid-achievement-extra"></p><button class="vivid-achievement-continue" type="button">Keep exploring <span aria-hidden="true">↗</span></button></section>';
  modal.querySelector(".vivid-achievement-mark").textContent=a.icon;
  modal.querySelector("#vivid-achievement-title").textContent=a.title;
  modal.querySelector("#vivid-achievement-description").textContent=a.description;
  modal.querySelector("#vivid-achievement-spark").textContent=fallbackSpark(a,library);
  if(others.length)modal.querySelector("#vivid-achievement-extra").textContent=others.length+" more milestone"+(others.length===1?"":"s")+" unlocked with this one.";
  const close=()=>closeModal();modal.querySelector(".vivid-achievement-close").addEventListener("click",close);modal.querySelector(".vivid-achievement-continue").addEventListener("click",close);
  modal.addEventListener("click",event=>{if(event.target===modal)close()});document.body.append(modal);document.addEventListener("keydown",onModalKey);modal.querySelector(".vivid-achievement-continue").focus({preventScroll:true});
  try{
    const {generateAchievementSpark}=await import("./firebase-ai.js");
    const result=await generateAchievementSpark({achievement:{title:a.title,description:a.description,category:a.category},library:contextFor(library)});
    const live=$("vivid-achievement-modal"),spark=live?.querySelector("#vivid-achievement-spark");
    if(spark&&result?.spark){spark.textContent=result.spark;live.querySelector(".vivid-spark-panel")?.classList.add("is-personalized")}
  }catch(error){console.info("Vivid Spark stayed in local fallback mode:",error?.code||error?.message||error)}
}
function persistRemote(record){
  const uid=currentUid;if(!uid||!record?.id)return;
  void (async()=>{try{
    const [{db},fs]=await Promise.all([import("./firebase.js"),import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")]);
    if(currentUid!==uid)return;
    await fs.setDoc(fs.doc(db,"users",uid,"achievements",record.id),{id:record.id,unlockedAt:record.unlockedAt,schemaVersion:VERSION},{merge:true});
  }catch(error){console.warn("Vivid achievement cloud sync deferred; local unlock is safe:",error?.code||error?.message||error)}})();
}
function evaluate({notify=false}={}){
  const library=getLocalLibrary(),store=readStore(),newly=[];
  for(const a of ACHIEVEMENTS){if(store.earned[a.id]||Number(a.metric(library)||0)<a.target)continue;const record={id:a.id,unlockedAt:Date.now(),schemaVersion:VERSION};store.earned[a.id]=record;newly.push(a);persistRemote(record)}
  if(newly.length)writeStore(store);else render();
  if(notify&&newly.length)void showUnlock(newly[0],newly.slice(1),library);
  return snapshot(library);
}
function ensureOwner(uid){
  try{switchLocalOwner({storage:localStorage,ownerKey:OWNER_KEY,activeKeys:[STORAGE_KEY],uid,emptyValues:{[STORAGE_KEY]:JSON.stringify(emptyStore())}})}
  catch(error){console.warn("Vivid could not switch achievement snapshots safely:",error)}
}
async function loadRemote(uid,version){
  try{
    const [{db},fs]=await Promise.all([import("./firebase.js"),import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")]);
    const remote=await fs.getDocsFromServer(fs.collection(db,"users",uid,"achievements"));
    if(version!==remoteVersion||currentUid!==uid)return;
    const store=readStore();
    remote.docs.forEach(doc=>{const data=doc.data()||{},id=String(data.id||doc.id);if(!ACHIEVEMENTS.some(a=>a.id===id))return;const at=Number(data.unlockedAt)||Date.now();if(!store.earned[id]||at<Number(store.earned[id].unlockedAt||Infinity))store.earned[id]={id,unlockedAt:at,schemaVersion:VERSION}});
    writeStore(store);evaluate({notify:false});
  }catch(error){console.warn("Vivid achievement cloud read deferred; local progress remains available:",error?.code||error?.message||error);evaluate({notify:false})}
}
function init(){
  if(initialized||typeof window==="undefined")return;initialized=true;ensureStyles();render();
  $("achievement-view-all")?.addEventListener("click",()=>{const grid=$("achievement-grid");if(!grid)return;grid.dataset.showAll=grid.dataset.showAll==="true"?"false":"true";render()});
  window.addEventListener("vivid:library-changed",()=>evaluate({notify:true}));
  window.addEventListener("vivid:account-switched",()=>evaluate({notify:false}));
  window.addEventListener("vivid:achievements-changed",render);
  window.addEventListener("storage",event=>{if(event.key===STORAGE_KEY||event.key==="vivid:library:v2")render()});
  void (async()=>{try{
    const [{auth},{onAuthStateChanged}]=await Promise.all([import("./firebase.js"),import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")]);
    onAuthStateChanged(auth,user=>{currentUid=user?.uid||null;ensureOwner(currentUid);if(currentUid){const version=++remoteVersion;void loadRemote(currentUid,version)}else{remoteVersion++;evaluate({notify:false})}});
  }catch(error){console.warn("Vivid achievements are running locally until account state is available:",error?.code||error?.message||error);evaluate({notify:false})}})();
}
if(typeof document!=="undefined"){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init()}
