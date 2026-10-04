const STORAGE_KEY="vivid:library:v2";
const COLLECTIONS=["favorites","watchLater","history"];
const emptyLibrary=()=>({favorites:[],watchLater:[],history:[]});
const TOMBSTONE_PREFIX="vivid:library-tombstones:v1";

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
    const parsed=JSON.parse(localStorage.getItem(TOMBSTONE_PREFIX));
    return parsed&&typeof parsed==="object"?parsed:{};
  }catch{
    return {};
  }
}

function saveLocalTombstones(value){
  try{localStorage.setItem(TOMBSTONE_PREFIX,JSON.stringify(value));}catch{}
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
  const removed=(library[collection]||[]).find(entry=>itemKey(entry)===String(mediaType)+":"+String(id));
  library[collection]=(library[collection]||[]).filter(entry=>itemKey(entry)!==String(mediaType)+":"+String(id));
  saveLocalLibrary(library);
  if(removed){
    const tombstone={collection,contentId:itemKey(removed),deletedAt:Date.now()};
    const tombstones=readLocalTombstones();
    tombstones[tombstoneKey(collection,removed)]=tombstone;
    saveLocalTombstones(tombstones);
    void removeSyncedLibraryItem(collection,removed,tombstone.deletedAt);
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

function cleanTombstone(tombstone){
  return {
    collection:String(tombstone.collection||""),
    contentId:String(tombstone.contentId||""),
    deletedAt:Number(tombstone.deletedAt)||Date.now()
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
  await setDoc(doc(db,"users",uid,collection,safe.media_type+":"+safe.id),safe,{merge:true});
  await deleteDoc(doc(db,"users",uid,"libraryTombstones",tombstoneKey(collection,safe)));
}

async function deleteRemoteItem(uid,collection,item,deletedAt){
  const {db,doc,setDoc}=await getFirebase();
  const safe=cleanItem(item);
  const tombstone={collection,contentId:itemKey(safe),deletedAt:Number(deletedAt)||Date.now()};
  await setDoc(doc(db,"users",uid,"libraryTombstones",tombstoneKey(collection,safe)),cleanTombstone(tombstone));
  await import("https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js").then(({deleteDoc})=>
    deleteDoc(doc(db,"users",uid,collection,safe.media_type+":"+safe.id))
  );
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

function mergeCollection(localItems,remoteItems,tombstones,collection){
  const map=new Map();
  const relevant=tombstones.filter(item=>item.collection===collection);
  const tombstoneMap=new Map(relevant.map(item=>[String(item.contentId),Number(item.deletedAt)||0]));

  [...remoteItems,...localItems].forEach(item=>{
    const key=itemKey(item);
    const deletedAt=tombstoneMap.get(key)||0;
    const updatedAt=Number(item.updatedAt)||0;
    if(deletedAt && deletedAt>=updatedAt)return;
    const current=map.get(key);
    if(!current || Number(item.updatedAt||0)>Number(current.updatedAt||0))map.set(key,item);
  });

  return Array.from(map.values()).sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
}

export async function syncLibraryForUser(user=null){
  const local=readLocal();
  if(!user)return local;

  try{
    const [remote,tombstones]=await Promise.all([
      Promise.all(COLLECTIONS.map(key=>fetchRemote(user.uid,key))),
      fetchTombstones(user.uid)
    ]);
    const merged=emptyLibrary();
    const localTombstones=readLocalTombstones();
    const remoteTombstoneKeys=new Set(tombstones.map(item=>String(item.collection)+":"+String(item.contentId)));

    COLLECTIONS.forEach((key,index)=>{
      merged[key]=mergeCollection(local[key]||[],remote[index]||[],tombstones,key);
    });

    COLLECTIONS.forEach(key=>{
      const currentKeys=new Set(merged[key].map(item=>key+" :"+itemKey(item)).map(key=>key.replace(" : ",":")));
      (localTombstones && Object.entries(localTombstones)||[]).forEach(([tombstoneId,tombstone])=>{
        if(!tombstone || tombstone.collection!==key || !tombstone.contentId)return;
        const remoteDeleted=Number(tombstone.deletedAt)||0;
        const contentKey=key+":"+tombstone.contentId;
        if(!currentKeys.has(contentKey) && !remoteTombstoneKeys.has(contentKey)){
          void setRemoteTombstone(user.uid,tombstone);
        }
      });
    });

    const localByKey=new Map(COLLECTIONS.map(key=>[key,new Set((local[key]||[]).map(item=>itemKey(item)))]);

    await Promise.all(
      COLLECTIONS.flatMap(key=>merged[key].map(item=>setRemoteItem(user.uid,key,item)))
    );

    const remoteTombstoneMap=new Map(tombstones.map(item=>[String(item.collection)+":"+String(item.contentId),Number(item.deletedAt)||0]));
    for(const key of COLLECTIONS){
      for(const item of local[key]||[]){
        const id=key+":"+itemKey(item);
        const remoteDeleted=remoteTombstoneMap.get(id)||0;
        if(remoteDeleted && remoteDeleted>=Number(item.updatedAt||0))continue;
      }
    }

    saveLocalLibrary(merged);
    const nextTombstones={...readLocalTombstones()};
    tombstones.forEach(item=>{
      if(item.collection&&item.contentId)nextTombstones[item.collection+":"+item.contentId]=item;
    });
    merged && saveLocalTombstones(nextTombstones);
    return merged;
  }catch(error){
    console.error("Vivid library sync failed:",error);
    return local;
  }
}

async function setRemoteTombstone(uid,tombstone){
  try{
    const {db,doc,setDoc}=await getFirebase();
    await setDoc(doc(db,"users",uid,"libraryTombstones",tombstoneKey(tombstone.collection,{media_type:String(tombstone.contentId).split(":")[0],id:String(tombstone.contentId).split(":")[1]})),cleanTombstone(tombstone));
  }catch(error){
    console.warn("Vivid library tombstone sync unavailable:",error);
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
