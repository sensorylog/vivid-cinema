const SUBS_COLLECTION="pushSubscriptions";
const REMINDERS_COLLECTION="cinemaReminders";
const PUSH_SERVICE_WORKER="/service-worker.js";
const VAPID_PUBLIC_KEY="BMNW0k1P89YhNVPP4NJYa4mDOw2arwbEJUPJ3mDcV6UpcSn-WP_T2PqJc6ANEkvtzUe9LacEMJ4com85M4w-eN8";
const ENSURE_STAMP_KEY="vivid_push_checked_at";
const ENSURE_INTERVAL_MS=30*60*1000;
const OPTOUT_KEY="vivid:push-optout:v1";
const LEGACY_OPTOUT_KEY="nn_web_push_optout";
let firebasePromise=null;

function keyId(endpoint){
  let hash=0;
  for(let i=0;i<endpoint.length;i++)hash=((hash<<5)-hash+endpoint.charCodeAt(i))|0;
  return Math.abs(hash).toString(36);
}
function base64UrlToBytes(value){
  const normalized=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const padded=normalized+"=".repeat((4-normalized.length%4)%4);
  const raw=window.atob(padded);
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
}
function sameApplicationServerKey(subscription,key){
  const existing=subscription?.options?.applicationServerKey;
  if(!existing)return false;
  const a=new Uint8Array(existing);
  return a.length===key.length&&a.every((byte,index)=>byte===key[index]);
}
async function getFirebase(){
  if(!firebasePromise){
    firebasePromise=Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")
    ]).then(([firebase,authSdk,fs])=>({...firebase,onAuthStateChanged:authSdk.onAuthStateChanged,doc:fs.doc,setDoc:fs.setDoc,deleteDoc:fs.deleteDoc,collection:fs.collection,getDocs:fs.getDocs}))
      .catch(error=>{firebasePromise=null;throw error});
  }
  return firebasePromise;
}
export async function getPushSupport(){
  return "serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
}
function storageWritable(){
  try{const probe="__vivid_push_probe__";window.localStorage.setItem(probe,"1");window.localStorage.removeItem(probe);return true;}
  catch{return false;}
}
function optedOut(){
  try{return window.localStorage.getItem(OPTOUT_KEY)==="1"||window.localStorage.getItem(LEGACY_OPTOUT_KEY)==="1";}
  catch{return false;}
}
function markEnsureAttempt(){
  try{window.localStorage.setItem(ENSURE_STAMP_KEY,String(Date.now()));}catch{}
}
function ensureAttemptedRecently(){
  try{const at=Number(window.localStorage.getItem(ENSURE_STAMP_KEY)||0);return Number.isFinite(at)&&at>0&&Date.now()-at<ENSURE_INTERVAL_MS;}
  catch{return false;}
}
async function getRegistration(){
  await navigator.serviceWorker.register(PUSH_SERVICE_WORKER,{scope:"./",updateViaCache:"none"});
  return navigator.serviceWorker.ready;
}
async function getCurrentUser(){
  const {auth}=await getFirebase();
  return auth.currentUser||null;
}
async function saveSubscription(user,subscription){
  const json=subscription.toJSON();
  if(!json?.endpoint||!json?.keys?.p256dh||!json?.keys?.auth)throw Error("The browser returned an incomplete push subscription.");
  const {db,doc,setDoc}=await getFirebase();
  await setDoc(doc(db,"users",user.uid,SUBS_COLLECTION,keyId(json.endpoint)),{
    endpoint:json.endpoint,
    expirationTime:json.expirationTime||null,
    keys:{p256dh:json.keys.p256dh,auth:json.keys.auth},
    userAgent:String(navigator.userAgent||"").slice(0,500),
    updatedAt:Date.now()
  },{merge:true});
}
async function subscribeCurrentBrowser({allowCreate=true}={}){
  if(!(await getPushSupport()))throw Error("Background notifications are not supported in this browser.");
  const user=await getCurrentUser();
  if(!user)throw Error("Sign in to Vivid Cinema before enabling notifications.");
  const registration=await getRegistration();
  const key=base64UrlToBytes(VAPID_PUBLIC_KEY);
  if(key.length!==65||key[0]!==4)throw Error("Vivid's push public key is invalid. Please contact support.");
  let subscription=await registration.pushManager.getSubscription();
  if(subscription&&!sameApplicationServerKey(subscription,key)){
    await subscription.unsubscribe();
    subscription=null;
  }
  if(!subscription){
    if(!allowCreate)return null;
    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  }
  await saveSubscription(user,subscription);
  return subscription;
}
export async function enableCinemaPush(){
  if(!(await getPushSupport()))throw Error("Background notifications are not supported in this browser.");
  if(window.Notification.permission==="default"){
    const permission=await Notification.requestPermission();
    if(permission!=="granted")throw Error(permission==="denied"?"Notifications are blocked for this site in your browser settings.":"Notification permission was not granted.");
  }else if(window.Notification.permission!=="granted"){
    throw Error("Notifications are blocked for this site in your browser settings.");
  }
  try{window.localStorage.removeItem(OPTOUT_KEY);window.localStorage.removeItem(LEGACY_OPTOUT_KEY);}catch{}
  const subscription=await subscribeCurrentBrowser();
  markEnsureAttempt();
  return {deviceId:keyId(subscription.endpoint)};
}
export async function ensureCinemaPush(){
  try{
    if(!(await getPushSupport())||window.Notification.permission!=="granted"||optedOut()||!storageWritable()||ensureAttemptedRecently()){
      return {ok:false,status:"skipped",deviceId:null};
    }
    const user=await getCurrentUser();
    if(!user)return {ok:false,status:"skipped",deviceId:null};
    const subscription=await subscribeCurrentBrowser();
    markEnsureAttempt();
    return {ok:true,status:"enabled",deviceId:keyId(subscription.endpoint)};
  }catch(error){
    markEnsureAttempt();
    console.warn("Vivid background notification refresh skipped:",error);
    return {ok:false,status:"failed",message:String(error?.message||error),deviceId:null};
  }
}
export async function disableCinemaPush(){
  let subscription=null;
  try{
    if("serviceWorker"in navigator){
      const registration=await navigator.serviceWorker.ready;
      subscription=await registration.pushManager?.getSubscription()||null;
    }
  }catch(error){
    console.warn("Vivid push subscription lookup failed:",error);
    return false;
  }
  try{window.localStorage.setItem(OPTOUT_KEY,"1");window.localStorage.setItem(LEGACY_OPTOUT_KEY,"1");}catch{}
  let remoteRemovalSucceeded=true;
  try{
    const user=await getCurrentUser();
    if(user&&subscription?.endpoint){
      const {db,doc,deleteDoc}=await getFirebase();
      await deleteDoc(doc(db,"users",user.uid,SUBS_COLLECTION,keyId(subscription.endpoint)));
    }
  }catch(error){
    remoteRemovalSucceeded=false;
    console.warn("Vivid push subscription cleanup failed:",error);
  }
  try{if(subscription)await subscription.unsubscribe();}
  catch(error){
    console.warn("Vivid browser push unsubscribe failed:",error);
    return false;
  }
  return remoteRemovalSucceeded;
}
export async function disableBackgroundPush(){
  const ok=await disableCinemaPush();
  return {ok,status:ok?"disabled":"failed",deviceId:null};
}

export async function getServerReleaseAlerts(){
  try{
    const {auth}=await getFirebase();
    if(!auth.currentUser)return [];
    const {db,collection,getDocs}=await getFirebase();
    const snapshot=await getDocs(collection(db,"users",auth.currentUser.uid,"releaseAlerts"));
    return snapshot.docs.map(item=>({...item.data(),docId:item.id,media_type:item.data().mediaType,source:"server",pending:true})).sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
  }catch(error){
    console.warn("Vivid server release alerts unavailable:",error);
    return [];
  }
}
export async function dismissServerReleaseAlert(id){
  try{
    const {auth}=await getFirebase();
    if(!auth.currentUser)return false;
    const {db,doc,deleteDoc}=await getFirebase();
    await deleteDoc(doc(db,"users",auth.currentUser.uid,"releaseAlerts",String(id)));
    return true;
  }catch{return false;}
}

export async function savePushReminder(reminder){
  const {auth}=await getFirebase();
  if(!auth.currentUser)return false;
  const {db,doc,setDoc}=await getFirebase();
  await setDoc(doc(db,"users",auth.currentUser.uid,REMINDERS_COLLECTION,String(reminder.id)),{
    id:String(reminder.id),
    title:String(reminder.title||"Vivid Cinema reminder").slice(0,180),
    note:String(reminder.note||"").slice(0,500),
    when:String(reminder.when),
    contentId:String(reminder.contentId||""),
    mediaType:reminder.mediaType==="tv"?"tv":"movie",
    kind:String(reminder.kind||"release"),
    createdAt:Number(reminder.createdAt)||Date.now(),
    sent:false
  },{merge:true});
  return true;
}
export async function removePushReminder(reminderId){
  const {auth}=await getFirebase();
  if(!auth.currentUser)return false;
  const {db,doc,deleteDoc}=await getFirebase();
  await deleteDoc(doc(db,"users",auth.currentUser.uid,REMINDERS_COLLECTION,String(reminderId)));
  return true;
}
