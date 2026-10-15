const STORAGE_KEY="vivid:library:v2";
const COLLECTIONS=["favorites","watchLater","history"];
const emptyLibrary=()=>({favorites:[],watchLater:[],history:[]});
const TOMBSTONE_STORAGE_KEY="vivid:library-tombstones:v1";
const LOCAL_OWNER_KEY="vivid:library-owner:v1";
let localMutationRevision=0;
function accountStorageKey(key,uid){return key+":user:"+String(uid);}
function ensureLocalOwner(uid){
  if(!uid)return;
  try{
    const owner=localStorage.getItem(LOCAL_OWNER_KEY);
    if(!owner){
      // First sign-in claims the existing local library rather than discarding it.
      localStorage.setItem(LOCAL_OWNER_KEY,String(uid));
      return;
    }
    if(owner===String(uid))return;

    // Preserve the previous account's unsynced local data before switching.
    localStorage.setItem(accountStorageKey(STORAGE_KEY,owner),localStorage.getItem(STORAGE_KEY)||JSON.stringify(emptyLibrary()));
    localStorage.setItem(accountStorageKey(TOMBSTONE_STORAGE_KEY,owner),localStorage.getItem(TOMBSTONE_STORAGE_KEY)||"{}");

    // Restore this user's prior device snapshot, or start clean to prevent
    // one signed-in account from seeing another account's local library.
    const nextLibrary=localStorage.getItem(accountStorageKey(STORAGE_KEY,uid));
    const nextTombstones=localStorage.getItem(accountStorageKey(TOMBSTONE_STORAGE_KEY,uid));
    localStorage.setItem(STORAGE_KEY,nextLibrary||JSON.stringify(emptyLibrary()));
    localStorage.setItem(TOMBSTONE_STORAGE_KEY,nextTombstones||"{}");
    localStorage.setItem(LOCAL_OWNER_KEY,String(uid));
    window.dispatchEvent(new CustomEvent("vivid:account-switched",{detail:{uid:String(uid)}}));
  }catch(error){
    console.warn("Vivid could not switch account-local library snapshots:",error);
  }
}

function itemKey(item){return String(item.media_type||item.mediaType||"movie")+":"+String(item.id);}
function tombstoneKey(collection,item){return collection+":"+itemKey(item);}

function readLocal(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {...emptyLibrary(),...(parsed&&typeof parsed==="object"?parsed:{})};
  }catch{
    return emptyLibrary();
  }
}

function readLocalTombstones(){
  try{
    const parsed=JSON.parse(localStorage.getItem(TOMBSTONE_STORAGE_KEY));
    return parsed&&typeof parsed==="object"?parsed:{};
  }catch{
    return {};
  }
}

function saveLocalTombstones(value){
  try{localStorage.setItem(TOMBSTONE_STORAGE_KEY,JSON.stringify(value));}catch{}
}

export function getLocalLibrary(){return readLocal();}

export function saveLocalLibrary(library){
  localStorage.setItem(STORAGE_KEY,JSON.stringify(library));
  window.dispatchEvent(new CustomEvent("vivid:library-changed",{detail:library}));
}

export function hasLibraryItem(collection,item){
  const key=typeof item==="object"?itemKey(item):item;
  return (readLocal()[collection]||[]).some(entry=>itemKey(entry)===key);
}

export function upsertLibraryItem(collection,item){
  localMutationRevision++;
  const library=readLocal();
  const safe={...item,updatedAt:Number(item.updatedAt)||Date.now()};
  const items=Array.isArray(library[collection])?library[collection]:[];
  library[collection]=[safe,...items.filter(entry=>itemKey(entry)!==itemKey(safe))];
  saveLocalLibrary(library);

  const tombstones=readLocalTombstones();
  delete tombstones[tombstoneKey(collection,safe)];
  saveLocalTombstones(tombstones);

  void syncLocalItem(collection,safe);
  return library;
}

export function removeLibraryItem(collection,id,mediaType="movie"){
  localMutationRevision++;
  const library=readLocal();
  const key=String(mediaType)+":"+String(id);
  const removed=(library[collection]||[]).find(entry=>itemKey(entry)===key);
  library[collection]=(library[collection]||[]).filter(entry=>itemKey(entry)!==key);
  saveLocalLibrary(library);

  if(removed){
    const deletedAt=Date.now();
    const tombstones=readLocalTombstones();
    tombstones[tombstoneKey(collection,removed)]={collection,contentId:key,deletedAt};
    saveLocalTombstones(tombstones);
    void removeSyncedLibraryItem(collection,removed,deletedAt);
  }
  return library;
}

export function toggleLibraryItem(collection,item){
  return hasLibraryItem(collection,item)
    ? removeLibraryItem(collection,item.id,item.media_type||item.mediaType||"movie")
    : upsertLibraryItem(collection,item);
}

export function clearLibraryCollection(collection){
  localMutationRevision++;
  const library=readLocal();
  const removed=library[collection]||[];
  library[collection]=[];
  saveLocalLibrary(library);

  const deletedAt=Date.now();
  const tombstones=readLocalTombstones();
  removed.forEach(item=>{
    tombstones[tombstoneKey(collection,item)]={collection,contentId:itemKey(item),deletedAt};
  });
  saveLocalTombstones(tombstones);

  void getFirebaseAuth().then(auth=>{
    if(auth?.currentUser) return Promise.all(removed.map(item=>removeSyncedLibraryItem(collection,item,deletedAt)));
  }).catch(()=>{});
  return library;
}

function cleanItem(item){
  return {
    id:String(item.id),
    media_type:item.media_type||item.mediaType||"movie",
    title:item.title||item.name||"Untitled",
    year:item.year||"",
    poster_path:item.poster_path||"",
    backdrop_path:item.backdrop_path||"",
    updatedAt:Number(item.updatedAt)||Date.now(),
    ...(item.startedAt?{startedAt:Number(item.startedAt)}:{}),
    ...(item.lastWatchedAt?{lastWatchedAt:Number(item.lastWatchedAt)}:{}),
    ...(item.watchedSeconds!=null?{watchedSeconds:Math.max(0,Number(item.watchedSeconds)||0)}:{}),
    ...(item.completion!=null?{completion:Math.max(0,Math.min(100,Number(item.completion)||0))}:{}),
    ...(item.completedAt?{completedAt:Number(item.completedAt)}:{})
  };
}

function cleanTombstone(item){
  return {
    collection:String(item.collection||""),
    contentId:String(item.contentId||""),
    deletedAt:Number(item.deletedAt)||Date.now()
  };
}

let firebasePromise=null;
async function getFirebase(){
  if(!firebasePromise){
    firebasePromise=Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js")
    ]).then(([firebase,authSdk,firestoreSdk])=>({
      ...firebase,
      onAuthStateChanged:authSdk.onAuthStateChanged,
      firestoreCollection:firestoreSdk.collection,
      deleteDoc:firestoreSdk.deleteDoc,
      doc:firestoreSdk.doc,
      getDocs:firestoreSdk.getDocs,
      getDocsFromServer:firestoreSdk.getDocsFromServer,
      setDoc:firestoreSdk.setDoc
    })).catch(error=>{
      firebasePromise=null;
      throw error;
    });
  }
  return firebasePromise;
}

async function getFirebaseAuth(){
  try{
    const {auth}=await getFirebase();
    return auth;
  }catch{
    return null;
  }
}

async function setRemoteItem(uid,collection,item){
  const {db,doc,setDoc,deleteDoc}=await getFirebase();
  const safe=cleanItem(item);
  const id=safe.media_type+":"+safe.id;
  await setDoc(doc(db,"users",uid,collection,id),safe,{merge:true});
  await deleteDoc(doc(db,"users",uid,"libraryTombstones",tombstoneKey(collection,safe)));
}

async function setRemoteTombstone(uid,tombstone){
  const {db,doc,setDoc}=await getFirebase();
  await setDoc(
    doc(db,"users",uid,"libraryTombstones",String(tombstone.collection)+":"+String(tombstone.contentId)),
    cleanTombstone(tombstone),
    {merge:true}
  );
}

async function deleteRemoteItem(uid,collection,item,deletedAt){
  const {db,doc,deleteDoc}=await getFirebase();
  const safe=cleanItem(item);
  const id=safe.media_type+":"+safe.id;
  await setRemoteTombstone(uid,{
    collection,
    contentId:id,
    deletedAt
  });
  await deleteDoc(doc(db,"users",uid,collection,id));
}

async function fetchRemote(uid,collection){
  const {db,firestoreCollection,getDocsFromServer}=await getFirebase();
  const snapshot=await getDocsFromServer(firestoreCollection(db,"users",uid,collection));
  return snapshot.docs.map(item=>item.data());
}

async function fetchTombstones(uid){
  const {db,firestoreCollection,getDocsFromServer}=await getFirebase();
  const snapshot=await getDocsFromServer(firestoreCollection(db,"users",uid,"libraryTombstones"));
  return snapshot.docs.map(item=>({...item.data(),_documentId:item.id}));
}

function mergeTombstones(remote){
  const merged={...readLocalTombstones()};
  remote.forEach(item=>{
    if(!item.collection||!item.contentId)return;
    const key=String(item.collection)+":"+String(item.contentId);
    const existing=merged[key];
    if(!existing || Number(item.deletedAt||0)>Number(existing.deletedAt||0)) {
      merged[key]={collection:item.collection,contentId:item.contentId,deletedAt:Number(item.deletedAt)||0};
    }
  });
  return merged;
}

function mergeCollection(localItems,remoteItems,tombstones,collection){
  const map=new Map();
  const relevant=Object.values(tombstones).filter(item=>item.collection===collection);
  const tombstoneMap=new Map(relevant.map(item=>[String(item.contentId),Number(item.deletedAt)||0]));

  // Prefer the newest version; remote wins ties so equal timestamps don't cause
  // devices to repeatedly overwrite one another.
  [...remoteItems,...localItems].forEach(item=>{
    const key=itemKey(item);
    const deletedAt=tombstoneMap.get(key)||0;
    const updatedAt=Number(item.updatedAt)||0;
    if(deletedAt && deletedAt>=updatedAt)return;
    const current=map.get(key);
    if(!current || updatedAt>Number(current.updatedAt||0)) map.set(key,item);
  });

  return Array.from(map.values()).sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
}

async function mapLimit(items,limit,worker){
  let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){
      const index=next++;
      if(index>=items.length)return;
      await worker(items[index],index);
    }
  });
  await Promise.all(workers);
}

async function performLibrarySyncForUser(user=null){
  if(!user?.uid)return readLocal();
  const auth=await getFirebaseAuth();
  if(!auth?.currentUser)throw new Error("Authentication is unavailable during library sync.");
  if(String(auth.currentUser.uid)!==String(user.uid))throw new Error("The signed-in account changed during library sync. Please retry.");
  ensureLocalOwner(user.uid);
  const local=readLocal();

  // Server-only reads are intentional: a cache-only/offline response must never
  // be reported to the user as a successful cloud sync.
  const [remoteCollections,remoteTombstones]=await Promise.all([
    Promise.all(COLLECTIONS.map(key=>fetchRemote(user.uid,key))),
    fetchTombstones(user.uid)
  ]);
  const tombstones=mergeTombstones(remoteTombstones);
  const merged=emptyLibrary();

  COLLECTIONS.forEach((key,index)=>{
    merged[key]=mergeCollection(local[key]||[],remoteCollections[index]||[],tombstones,key);
  });

  const activeKeys=new Set(
    COLLECTIONS.flatMap(key=>merged[key].map(item=>key+":"+itemKey(item)))
  );
  const remoteTombstoneMap=new Map(remoteTombstones
    .filter(item=>item.collection&&item.contentId)
    .map(item=>[String(item.collection)+":"+String(item.contentId),item]));

  // Apply tombstones before uploading active items. This prevents stale remote
  // copies from reappearing on another device after a deletion.
  const tombstoneEntries=Object.entries(tombstones).filter(([key,item])=>
    item.collection&&item.contentId&&!activeKeys.has(key)
  );
  await mapLimit(tombstoneEntries,8,async([key,tombstone])=>{
    const remote=remoteTombstoneMap.get(key);
    if(!remote || Number(remote.deletedAt||0)<Number(tombstone.deletedAt||0)){
      await setRemoteTombstone(user.uid,tombstone);
    }
    if(!COLLECTIONS.includes(tombstone.collection))return;
    const contentId=String(tombstone.contentId);
    if(!/^(movie|tv):[0-9]+$/.test(contentId))return;
    const {db,doc,deleteDoc}=await getFirebase();
    // A delete of a missing document is safe and idempotent.
    await deleteDoc(doc(db,"users",user.uid,tombstone.collection,contentId));
  });

  const remoteByCollection=Object.fromEntries(COLLECTIONS.map((key,index)=>[
    key,new Map((remoteCollections[index]||[]).map(item=>[itemKey(item),item]))
  ]));
  const writes=[];
  COLLECTIONS.forEach(key=>{
    const remoteMap=remoteByCollection[key];
    for(const item of merged[key]){
      const remote=remoteMap.get(itemKey(item));
      // Remote data already won the merge or is identical/newer; don't rewrite
      // it on every sync. Only upload a local winner or a missing remote item.
      if(!remote || Number(item.updatedAt||0)>Number(remote.updatedAt||0)){
        writes.push({collection:key,item});
      }
    }
  });
  await mapLimit(writes,8,async({collection,item})=>{
    await setRemoteItem(user.uid,collection,item);
  });

  // A tombstone defeated by a newer active item can now be removed remotely.
  const staleTombstones=remoteTombstones.filter(item=>{
    const key=String(item.collection)+":"+String(item.contentId);
    return activeKeys.has(key);
  });
  await mapLimit(staleTombstones,8,async(item)=>{
    const winning=merged[item.collection]?.find(entry=>itemKey(entry)===String(item.contentId));
    if(!winning || Number(winning.updatedAt||0)<=Number(item.deletedAt||0))return;
    const {db,doc,deleteDoc}=await getFirebase();
    await deleteDoc(doc(db,"users",user.uid,"libraryTombstones",String(item.collection)+":"+String(item.contentId)));
  });

  // Do not let a sync started for a previous account overwrite the current
  // account's local snapshot if authentication changed while requests were in flight.
  const activeAuth=await getFirebaseAuth();
  if(!activeAuth?.currentUser)throw new Error("Authentication is unavailable during library sync.");
  if(String(activeAuth.currentUser.uid)!==String(user.uid))throw new Error("The signed-in account changed during library sync. Please retry.");

  // Do not replace local data until all required cloud operations have been
  // acknowledged. Any error propagates so the UI can truthfully offer retry.
  saveLocalLibrary(merged);
  const remainingTombstones=Object.fromEntries(
    Object.entries(tombstones).filter(([key,item])=>{
      if(!activeKeys.has(key))return true;
      const winner=merged[item.collection]?.find(entry=>itemKey(entry)===String(item.contentId));
      return !winner || Number(item.deletedAt||0)>=Number(winner.updatedAt||0);
    })
  );
  saveLocalTombstones(remainingTombstones);
  return merged;
}

const syncInFlight=new Map();
let syncQueue=Promise.resolve();
export function syncLibraryForUser(user=null){
  if(!user?.uid)return Promise.resolve(readLocal());
  const uid=String(user.uid);
  if(syncInFlight.has(uid))return syncInFlight.get(uid);

  // Serialize different accounts, and repeat a pass if local mutations arrive
  // while a snapshot is being reconciled so a fast click cannot be missed.
  const task=syncQueue.catch(()=>{}).then(async()=>{
    let result;
    let syncedRevision;
    do{
      syncedRevision=localMutationRevision;
      result=await performLibrarySyncForUser(user);
    }while(syncedRevision!==localMutationRevision);
    return result;
  }).finally(()=>syncInFlight.delete(uid));
  syncInFlight.set(uid,task);
  syncQueue=task.catch(()=>{});
  return task;
}

export async function syncLocalItem(collection,item){
  try{
    const auth=await getFirebaseAuth();
    if(!auth?.currentUser)return;
    // Reconcile through the same guarded path as manual sync so failed writes
    // remain in local storage and can be retried without stale overwrites.
    await syncLibraryForUser(auth.currentUser);
  }catch(error){
    console.warn("Vivid library remote sync unavailable; local changes are retained for retry:",error);
  }
}

export async function removeSyncedLibraryItem(collection,item,deletedAt=Date.now()){
  try{
    const auth=await getFirebaseAuth();
    if(!auth?.currentUser)return;
    await syncLibraryForUser(auth.currentUser);
  }catch(error){
    console.warn("Vivid library removal sync unavailable; deletion is retained for retry:",error);
  }
}

let authSyncStarted=false;
export async function startLibrarySync(){
  if(authSyncStarted)return;
  authSyncStarted=true;
  try{
    const {auth,onAuthStateChanged}=await getFirebase();
    onAuthStateChanged(auth,user=>{
      if(user){
        void syncLibraryForUser(user).catch(error=>{
          console.warn("Vivid automatic cloud library sync failed; local data is retained:",error);
        });
      }
    });
  }catch(error){
    authSyncStarted=false;
    console.warn("Vivid automatic library sync could not start:",error);
  }
}

if(typeof window!=="undefined"){
  void startLibrarySync();
  window.addEventListener("online",()=>{
    void getFirebaseAuth().then(auth=>{
      if(auth?.currentUser)return syncLibraryForUser(auth.currentUser);
    }).catch(error=>{
      console.warn("Vivid library sync retry after reconnect failed:",error);
    });
  });
}

export function getFollowedTitles(){
  const library=readLocal();
  return [...(library.favorites||[]),...(library.watchLater||[])].filter((item,index,list)=>list.findIndex(entry=>itemKey(entry)===itemKey(item))===index);
}
