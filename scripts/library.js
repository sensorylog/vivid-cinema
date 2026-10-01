const STORAGE_KEY="vivid:library:v2";
const COLLECTIONS=["favorites","watchLater","history"];
const emptyLibrary=()=>({favorites:[],watchLater:[],history:[]});

function itemKey(item){return String(item.media_type||item.mediaType||"movie")+":"+String(item.id);}

function readLocal(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {...emptyLibrary(),...(parsed&&typeof parsed==="object"?parsed:{})};
  }catch{
    return emptyLibrary();
  }
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
  void syncLocalItem(collection,safe);
  return library;
}

export function removeLibraryItem(collection,id,mediaType="movie"){
  const library=readLocal();
  const removed=(library[collection]||[]).find(entry=>itemKey(entry)===String(mediaType)+":"+String(id));
  library[collection]=(library[collection]||[]).filter(entry=>itemKey(entry)!==String(mediaType)+":"+String(id));
  saveLocalLibrary(library);
  if(removed)void removeSyncedLibraryItem(collection,removed);
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
  void getFirebaseAuth().then(auth=>{
    if(auth?.currentUser) return Promise.all(removed.map(item=>removeSyncedLibraryItem(collection,item)));
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
    updatedAt:Number(item.updatedAt)||Date.now()
  };
}

let firebasePromise=null;
async function getFirebase(){
  if(!firebasePromise){
    firebasePromise=Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js")
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
  const {db,doc,setDoc}=await getFirebase();
  const safe=cleanItem(item);
  await setDoc(doc(db,"users",uid,collection,safe.media_type+":"+safe.id),safe,{merge:true});
}

async function deleteRemoteItem(uid,collection,item){
  const {db,doc,deleteDoc}=await getFirebase();
  const safe=cleanItem(item);
  await deleteDoc(doc(db,"users",uid,collection,safe.media_type+":"+safe.id));
}

async function fetchRemote(uid,collection){
  const {db,firestoreCollection,getDocs}=await getFirebase();
  const snapshot=await getDocs(firestoreCollection(db,"users",uid,collection));
  return snapshot.docs.map(item=>item.data());
}

export async function syncLibraryForUser(user=null){
  const local=readLocal();
  if(!user)return local;

  try{
    const remote=await Promise.all(COLLECTIONS.map(key=>fetchRemote(user.uid,key)));
    const merged=emptyLibrary();

    COLLECTIONS.forEach((key,index)=>{
      const map=new Map();
      [...remote[index],...(local[key]||[])].forEach(item=>map.set(itemKey(item),item));
      merged[key]=Array.from(map.values()).sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
    });

    await Promise.all(
      COLLECTIONS.flatMap(key=>merged[key].map(item=>setRemoteItem(user.uid,key,item)))
    );

    saveLocalLibrary(merged);
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

export async function removeSyncedLibraryItem(collection,item){
  try{
    const auth=await getFirebaseAuth();
    if(!auth?.currentUser)return;
    await deleteRemoteItem(auth.currentUser.uid,collection,item);
  }catch(error){
    console.warn("Vivid library remote removal unavailable:",error);
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
