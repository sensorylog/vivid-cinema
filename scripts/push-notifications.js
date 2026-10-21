import { NN_APP_ID, NN_WEB_KEY } from "../native-notify/web/nativeNotifyIds.js";
import { disableNativeNotifyWebPush, enableNativeNotifyWebPush, ensureNativeNotifyWebPush } from "../native-notify/web/native-notify-web-push.js";

const SUBS_COLLECTION="pushSubscriptions";
const REMINDERS_COLLECTION="cinemaReminders";
// Vivid already owns the site's only service worker scope, so Native Notify
// registers through the existing root worker (service-worker.js) instead of a
// second worker. Its push and notificationclick listeners live there.
const PUSH_SERVICE_WORKER="/service-worker.js";
let firebasePromise=null;
function keyId(endpoint){
  let hash=0;
  for(let i=0;i<endpoint.length;i++)hash=((hash<<5)-hash+endpoint.charCodeAt(i))|0;
  return Math.abs(hash).toString(36);
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
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
// Native Notify options for this site. The VAPID public key is fetched by the
// client at subscribe time (GET /api/universal/web-push/keys/...), so a rotated
// key is picked up automatically and no key is hardcoded here.
function nativeNotifyOptions(){
  return {appId:NN_APP_ID,webKey:NN_WEB_KEY,serviceWorkerPath:PUSH_SERVICE_WORKER};
}
// scripts/pwa.js registers this worker with { scope: "./", updateViaCache: "none" }.
// The Native Notify client re-registers the same script (a browser allows one
// worker per scope), and a plain register() call resets updateViaCache to its
// default — which would weaken the PWA's update check. Put the site's own
// options back immediately after the client has run.
async function restoreWorkerRegistration(){
  try{
    await navigator.serviceWorker.register(PUSH_SERVICE_WORKER,{scope:"./",updateViaCache:"none"});
  }catch(error){
    console.warn("Vivid service worker registration refresh skipped:",error);
  }
}
// The silent re-register costs two API calls (VAPID key + device register), so it
// runs at most once per browser per window instead of on every page load.
const ENSURE_STAMP_KEY="nn_web_push_checked_at";
const ENSURE_INTERVAL_MS=30*60*1000;
// Without storage the device id below would be regenerated on every load and pile
// up duplicate devices on the server, so the silent path stays off there.
function storageWritable(){
  try{
    const probe="__vivid_push_probe__";
    window.localStorage.setItem(probe,"1");
    window.localStorage.removeItem(probe);
    return true;
  }catch{return false}
}
function ensureAttemptedRecently(){
  try{
    const at=Number(window.localStorage.getItem(ENSURE_STAMP_KEY)||0);
    return Number.isFinite(at)&&at>0&&Date.now()-at<ENSURE_INTERVAL_MS;
  }catch{return false}
}
function markEnsureAttempt(){
  try{window.localStorage.setItem(ENSURE_STAMP_KEY,String(Date.now()))}catch{}
}
export async function enableCinemaPush(){
  if(!(await getPushSupport()))throw Error("Background notifications are not supported in this browser.");
  // Ask for permission while the click's user gesture is still fresh. The
  // Native Notify helper re-reads the granted state, so it does not prompt again.
  if(window.Notification?.permission==="default"){
    const permission=await Notification.requestPermission();
    if(permission!=="granted")throw Error(permission==="denied"?"Notifications are blocked for this site in your browser settings.":"Notification permission was not granted.");
  }
  const result=await enableNativeNotifyWebPush(nativeNotifyOptions());
  await restoreWorkerRegistration();
  markEnsureAttempt();
  if(!result.ok)throw Error(result.message||"Background notifications could not be enabled.");
  return {deviceId:result.deviceId};
}
// Silent re-register on page load: a browser that already allowed notifications
// but lost its subscription is restored without a prompt or a click. It never
// asks for permission, never runs twice in a row, and stays out of the way when
// the browser has no storage.
export async function ensureCinemaPush(){
  try{
    if(!storageWritable()||ensureAttemptedRecently())return {ok:false,status:"skipped",deviceId:null};
    const result=await ensureNativeNotifyWebPush(nativeNotifyOptions());
    if(result.status==="skipped")return result;
    markEnsureAttempt();
    await restoreWorkerRegistration();
    return result;
  }catch(error){
    markEnsureAttempt();
    console.warn("Vivid background notification refresh skipped:",error);
    return {ok:false,status:"failed",message:String(error?.message||error)};
  }
}
export async function disableBackgroundPush(){
  return disableNativeNotifyWebPush(nativeNotifyOptions());
}
export async function disableCinemaPush(){
  let subscription=null;
  try{
    if("serviceWorker" in navigator){
      const registration=await navigator.serviceWorker.ready;
      subscription=await registration.pushManager?.getSubscription()||null;
    }
  }catch(error){
    console.warn("Vivid push subscription lookup failed:",error);
    return false;
  }

  // A browser can have several devices registered to the same account.
  // Remove only this browser's endpoint; never erase the user's other devices.
  let remoteRemovalSucceeded=true;
  try{
    const {auth}=await getFirebase();
    const user=auth.currentUser;
    if(user&&subscription?.endpoint){
      const {db,doc,deleteDoc}=await getFirebase();
      await deleteDoc(doc(db,"users",user.uid,SUBS_COLLECTION,keyId(subscription.endpoint)));
    }
  }catch(error){
    remoteRemovalSucceeded=false;
    console.warn("Vivid push subscription cleanup failed:",error);
  }

  try{
    if(subscription)await subscription.unsubscribe();
  }catch(error){
    console.warn("Vivid browser push unsubscribe failed:",error);
    return false;
  }
  return remoteRemovalSucceeded;
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
