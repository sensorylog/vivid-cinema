import admin from "firebase-admin";
import webpush from "web-push";

const serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||"");
const vapidPrivateKey=process.env.VAPID_PRIVATE_KEY||"";
if(!serviceAccount.project_id)throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
if(!vapidPrivateKey)throw new Error("Missing VAPID_PRIVATE_KEY");

admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
const db=admin.firestore();
webpush.setVapidDetails("mailto:notifications@vividcinema.app","BGZNNqdOPr-XJjdPnJMKPHvErIXftdRM0P8VxpjElqRs5AwpyY94lownEeUE2W-8GnFyvNd3-u7tmRu2b-5dEIg",vapidPrivateKey);

const now=Date.now();
const snapshot=await db.collectionGroup("cinemaReminders")
  .where("sent","==",false)
  .where("when","<=",new Date(now).toISOString())
  .limit(100)
  .get();

let sent=0,failed=0;
for(const reminderDoc of snapshot.docs){\n  const reminderDate=Date.parse(String(reminderDoc.data().when||""));\n  if(!Number.isFinite(reminderDate)||reminderDate>now)continue;
  const reminder=reminderDoc.data();
  const userRef=reminderDoc.ref.parent.parent;
  if(!userRef)continue;
  const subscriptions=await userRef.collection("pushSubscriptions").get();
  let delivered=false;
  for(const subDoc of subscriptions.docs){
    const sub=subDoc.data();
    if(!sub.endpoint||!sub.keys?.p256dh||!sub.keys?.auth){await subDoc.ref.delete();continue;}
    try{
      await webpush.sendNotification({
        endpoint:sub.endpoint,
        expirationTime:sub.expirationTime||null,
        keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}
      },JSON.stringify({
        title:"Vivid Cinema",
        body=(reminder.title||"Your Vivid Cinema reminder")+" is now available.",
        tag:"vivid-"+reminder.id,
        url:"./title.html?id="+encodeURIComponent(reminder.contentId||"")+"&type="+encodeURIComponent(reminder.mediaType||"movie")
      }),{TTL:86400});
      delivered=true;
      sent++;
    }catch(error){
      failed++;
      if(error?.statusCode===404||error?.statusCode===410)await subDoc.ref.delete();
    }
  }
  await reminderDoc.ref.set({
    sent:true,
    sentAt:admin.firestore.FieldValue.serverTimestamp(),
    deliveryStatus:delivered?"delivered":"no-active-subscription"
  },{merge:true});
}
console.log(JSON.stringify({checked:snapshot.size,sent,failed}));
