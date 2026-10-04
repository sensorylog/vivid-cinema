const VAPID_PUBLIC_KEY="BGZNNqdOPr-XJjdPnJMKPHvErIXftdRM0P8VxpjElqRs5AwpyY94lownEeUE2W-8GnFyvNd3-u7tmRu2b-5dEIg";
const SUBS_COLLECTION="pushSubscriptions";
const REMINDERS_COLLECTION="cinemaReminders";
let firebasePromise=null;

function base64ToBytes(value){
  const padding="=".repeat((4-value.length%4)%4);
  const raw=atob(value.replace(/-/g,"+").replace(/_/g,"/")+padding);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function keyId(endpoint){
  let hash=0;
  for(let i=0;i<endpoint.length;i++)hash=((hash<<5)-hash+endpoint.charCodeAt(i))|0;
  return Math.abs(hash).toString(36);
}
async function getFirebase(){
  if(!firebasePromise){
    firebasePromise=Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js")
    ]).then(([firebase,authSdk,fs])=>({...firebase,onAuthStateChanged:authSdk.onAuthStateChanged,doc:fs.doc,setDoc:fs.setDoc,deleteDoc:fs.deleteDoc}))
      .catch(error=>{firebasePromise=null;throw error});
  }
  return firebasePromise;
}
export async function getPushSupport(){
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export async function enableCinemaPush(){
  if(!(await getPushSupport()))throw Error("Background notifications are not supported in this browser.");
  const {auth}=await getFirebase();
  const user=auth.currentUser;
  if(!user)throw Error("Sign in to enable Vivid background notifications.");
  const permission=Notification.permission==="default"?await Notification.requestPermission():Notification.permission;
  if(permission!=="granted")throw Error("Notification permission was not granted.");
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){
    subscription=await registration.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:base64ToBytes(VAPID_PUBLIC_KEY)
    });
  }
  const json=subscription.toJSON();
  if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth)throw Error("The browser did not return a valid push subscription.");
  const id=keyId(json.endpoint);
  const {db,doc,setDoc}=await getFirebase();
  await setDoc(doc(db,"users",user.uid,SUBS_COLLECTION,id),{
    endpoint:json.endpoint,
    expirationTime:json.expirationTime||null,
    keys:{p256dh:json.keys.p256dh,auth:json.keys.auth},
    userAgent:navigator.userAgent.slice(0,500),
    updatedAt:Date.now()
  },{merge:true});
  return {subscription,userId:user.uid};
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
