import { getLocalLibrary } from "./library.js";
import { switchLocalOwner } from "./local-owner.js";
import { ACHIEVEMENTS } from "./achievement-catalog.js";

const STORAGE_KEY = "vivid:achievements:v1";
const OWNER_KEY = "vivid:achievements-owner:v1";
const VERSION = 1;
const $ = (id) => document.getElementById(id);
const list = (library, key) => Array.isArray(library?.[key]) ? library[key] : [];
const count = (library, key) => list(library, key).length;
const typeOf = (item) => item?.media_type || item?.mediaType || "movie";



let currentUid = null, initialized = false, remoteVersion = 0, modalOpen = false, lastFocus = null;

function emptyStore(){return {version:VERSION,earned:{},sparkHistory:[]}}
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
  const firstTitle=contextFor(library).favorites[0]?.title;
  const sparks={
    "first-favorite":"Film history has a survival bias: what we can watch today is only a fraction of what was made. Early prints were often discarded or lost to deterioration, so preserving and finding stories matters.",
    "favorites-5":"Editors create meaning between shots. Place the same neutral face beside a meal, then beside a coffin, and viewers can infer different emotions. This is the Kuleshov effect: context changes what we think we see.",
    "favorites-10":"A film's color can act like a quiet second script. Costumes, sets, and lighting may repeat or shift a palette to hint at a character's change before anyone explains it in dialogue.",
    "favorites-25":"Cinema isn't preserved by popularity alone. Many silent films are lost because prints were discarded, reused, or deteriorated; what survives shapes what later generations call film history.",
    "queue-first":"The 180-degree rule helps viewers track where characters are in a scene. Directors sometimes break it deliberately to make a moment feel unstable, unfamiliar, or emotionally off-balance.",
    "queue-5":"A watchlist solves a small decision-design problem: it moves the question from “What exists?” to “Which of these fits tonight?” A little curation can make choosing feel easier than endless browsing.",
    "queue-10":"Finished-film sound is layered. Dialogue, room tone, effects, footsteps, and music may be recorded separately and mixed later; the realism you hear is often carefully assembled, not simply captured.",
    "history-first":"Motion pictures did not emerge from one lone inventor. Cinema grew through several experiments in photography, sequential images, cameras, and projection—a useful reminder that big creative leaps are usually networks of ideas.",
    "history-5":"A jump cut removes a portion of continuous action, making time visibly leap forward. Editors use that break to create speed, tension, or the feeling that a character's world is unstable.",
    "history-10":"The familiar 24-frames-per-second cinema standard became widely established with synchronized sound. Silent-era projection speeds varied, which is one reason some older films can look unusually fast today.",
    "completion-first":"An ending can change how earlier scenes feel. Once you know the outcome, small details can suddenly look like clues; a strong story often gives its earlier moments a second meaning on the way out.",
    "completion-5":"Film editing does more than shorten footage: it shapes causality. When one shot follows another, viewers instinctively search for a relationship—even when the images were filmed separately.",
    "whole-picture":"A personal film library answers three different questions: what moved you, what you might explore, and what you've actually experienced. Keeping those intentions distinct can make future recommendations more useful.",
    "feature-focus":"Genre labels are promises to the audience. Filmmakers can satisfy, bend, or break those expectations; surprise often works best when a story first teaches you what rules to expect.",
    "series-scout":"A series can let character change accumulate through small choices over many episodes. That longer runway is one reason a detail that seems minor early on can become meaningful much later.",
    "library-25":"A soundtrack can change how the same scene feels because sound guides attention and expectation. A gentle melody over an image of danger can create unease precisely because the signals disagree."
  };
  if(firstTitle&&a.id==="favorites-5")return "The Kuleshov effect shows how editing changes what a face seems to express. Your shelf began with “"+firstTitle+"”; notice how the stories around a favorite can change what you see in it.";
  return sparks[a.id]||"A useful cinema lesson: what we notice depends not only on what is shown, but on the context, timing, and details that guide our attention.";
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
  if(modalOpen||!document.body)return;modalOpen=true;lastFocus=document.activeElement;const ownerAtStart=currentUid;
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
    const store=readStore();
    const recentSparks=(Array.isArray(store.sparkHistory)?store.sparkHistory:[]).slice(-6).map(item=>String(item?.spark||"").slice(0,240)).filter(Boolean);
    const result=await generateAchievementSpark({achievement:{title:a.title,description:a.description,category:a.category},library:contextFor(library),recentSparks});
    const spark=modal.isConnected&&currentUid===ownerAtStart?modal.querySelector("#vivid-achievement-spark"):null;
    if(spark&&result?.spark){
      spark.textContent=result.spark;
      modal.querySelector(".vivid-spark-panel")?.classList.add("is-personalized");
      store.sparkHistory=[...(Array.isArray(store.sparkHistory)?store.sparkHistory:[]),{achievementId:a.id,spark:result.spark,at:Date.now()}].slice(-8);
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(store))}catch{}
    }
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
  window.addEventListener("vivid:account-switched",()=>{if(modalOpen)closeModal();evaluate({notify:false})});
  window.addEventListener("vivid:achievements-changed",render);
  window.addEventListener("storage",event=>{if(event.key===STORAGE_KEY||event.key==="vivid:library:v2")render()});
  void (async()=>{try{
    const [{auth},{onAuthStateChanged}]=await Promise.all([import("./firebase.js"),import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")]);
    onAuthStateChanged(auth,user=>{currentUid=user?.uid||null;ensureOwner(currentUid);if(currentUid){const version=++remoteVersion;void loadRemote(currentUid,version)}else{remoteVersion++;evaluate({notify:false})}});
  }catch(error){console.warn("Vivid achievements are running locally until account state is available:",error?.code||error?.message||error);evaluate({notify:false})}})();
}
if(typeof document!=="undefined"){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init()}
