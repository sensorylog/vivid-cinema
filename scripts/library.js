const STORAGE_KEY="vivid:library:v2";
const COLLECTIONS=["favorites","watchLater","history"];
const emptyLibrary=()=>({favorites:[],watchLater:[],history:[]});
const TOMBSTONE_STORAGE_KEY="vivid:library-tombstones:v1";
const LOCAL_OWNER_KEY="vivid:library-owner:v1";
function ensureLocalOwner(uid){
  if(!uid)return;
  try{
    const owner=localStorage.getItem(LOCAL_OWNER_KEY);
    if(!owner){localStorage.setItem(LOCAL_OWNER_KEY,String(uid));return;}
    if(owner===String(uid))return;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(emptyLibrary()));
    localStorage.setItem(TOMBSTONE_STORAGE_KEY,JSON.stringify({}));
    localStorage.setItem(LOCAL_OWNER_KEY,String(uid));
    window.dispatchEvent(new CustomEvent("vivid:account-switched",{detail:{uid:String(uid)}}));
  }catch{}
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
  const {db,firestoreCollection,getDocs}=await getFirebase();
  const snapshot=await getDocs(firestoreCollection(db,"users",uid,collection));
  return snapshot.docs.map(item=>item.data());
}

async function fetchTombstones(uid){
  const {db,firestoreCollection,getDocs}=await getFirebase();
  const snapshot=await getDocs(firestoreCollection(db,"users",uid,"libraryTombstones"));
  return snapshot.docs.map(item=>item.data());
}

function mergeTombstones(remote){
  const merged={...readLocalTombstones()};
  remote.forEach(item=>{
    if(!item.collection||!item.contentId)return;
    const key=String(item.collection)+":"+String(item.contentId);
    const existing=merged[key];
    if(!existing || Number(item.deletedAt||0)>Number(existing.deletedAt||0)) merged[key]=item;
  });
  return merged;
}

function mergeCollection(localItems,remoteItems,tombstones,collection){
  const map=new Map();
  const relevant=Object.values(tombstones).filter(item=>item.collection===collection);
  const tombstoneMap=new Map(relevant.map(item=>[String(item.contentId),Number(item.deletedAt)||0]));

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

export async function syncLibraryForUser(user=null){
  if(user?.uid)ensureLocalOwner(user.uid);
  const local=readLocal();
  if(!user)return local;

  try{
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

    const tombstoneEntries=Object.values(tombstones).filter(item=>item.collection&&item.contentId);
    await Promise.all(tombstoneEntries.map(tombstone=>{
      const key=tombstone.collection+":"+tombstone.contentId;
      if(activeKeys.has(key)) return Promise.resolve();
      return setRemoteTombstone(user.uid,tombstone);
    }));

    await Promise.all(
      COLLECTIONS.flatMap(key=>merged[key].map(item=>setRemoteItem(user.uid,key,item)))
    );

    saveLocalLibrary(merged);
    saveLocalTombstones(
      Object.fromEntries(
        Object.entries(tombstones).filter(([key])=>!activeKeys.has(key))
      )
    );
    return merged;
  }catch(error){
    console.error("Vivid library sync failed:",error);
    return local;
  }
}

export async function syncLocalItem(collection,item){
  try{
    const auth=await getFirebaseAuth();
    if(!auth?.currentUser)return;
    await setRemoteItem(auth.currentUser.uid,collection,item);
  }catch(error){
    console.warn("Vivid library remote sync unavailable:",error);
  }
}

export async function removeSyncedLibraryItem(collection,item,deletedAt=Date.now()){
  try{
    const auth=await getFirebaseAuth();
    if(!auth?.currentUser)return;
    await deleteRemoteItem(auth.currentUser.uid,collection,item,deletedAt);
  }catch(error){
    console.warn("Vivid remote library removal unavailable:",error);
  }
}

let syncPromise=null;
export function startLibrarySync(){
  if(syncPromise)return syncPromise;

  syncPromise=(async()=>{
    try{
      const {auth,onAuthStateChanged}=await getFirebase();
      return await new Promise(resolve=>{
        let settled=false;
        const finish=value=>{
          if(settled)return;
          settled=true;
          unsubscribe?.();
          resolve(value);
        };
        const unsubscribe=onAuthStateChanged(auth,async user=>{
          if(!user){
            finish(readLocal());
            return;
          }
          finish(await syncLibraryForUser(user));
        });
      });
    }catch(error){
      console.warn("Vivid Firebase library sync unavailable:",error);
      return readLocal();
    }
  })();

  return syncPromise;
}

export function getFollowedTitles(){
  const library=readLocal();
  return [...(library.favorites||[]),...(library.watchLater||[])].filter((item,index,list)=>list.findIndex(entry=>itemKey(entry)===itemKey(item))===index);
}
