import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { collection as firestoreCollection, deleteDoc, doc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const STORAGE_KEY="vivid:library:v2";
const COLLECTIONS=["favorites","watchLater","history"];
const emptyLibrary=()=>({favorites:[],watchLater:[],history:[]});
function itemKey(item){return String(item.media_type||item.mediaType||"movie")+":"+String(item.id);}
function readLocal(){try{const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY));return {...emptyLibrary(),...(parsed&&typeof parsed==="object"?parsed:{})};}catch{return emptyLibrary();}}
export function getLocalLibrary(){return readLocal();}
export function saveLocalLibrary(library){localStorage.setItem(STORAGE_KEY,JSON.stringify(library));window.dispatchEvent(new CustomEvent("vivid:library-changed",{detail:library}));}
export function hasLibraryItem(collection,item){const key=typeof item==="object"?itemKey(item):item;return (readLocal()[collection]||[]).some(entry=>itemKey(entry)===key);}
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
export function toggleLibraryItem(collection,item){return hasLibraryItem(collection,item)?removeLibraryItem(collection,item.id,item.media_type||item.mediaType||"movie"):upsertLibraryItem(collection,item);}
export function clearLibraryCollection(collection){
  const library=readLocal();
  const removed=library[collection]||[];
  library[collection]=[];
  saveLocalLibrary(library);
  if(auth.currentUser)void Promise.all(removed.map(item=>removeSyncedLibraryItem(collection,item)));
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
async function waitForUser(){if(auth.currentUser)return auth.currentUser;return new Promise(resolve=>{const unsubscribe=onAuthStateChanged(auth,user=>{unsubscribe();resolve(user);});});}
async function setRemoteItem(uid,collection,item){
  const safe=cleanItem(item);
  await setDoc(doc(db,"users",uid,collection,safe.media_type+":"+safe.id),safe,{merge:true});
}
async function deleteRemoteItem(uid,collection,item){const safe=cleanItem(item);await deleteDoc(doc(db,"users",uid,collection,safe.media_type+":"+safe.id));}
async function fetchRemote(uid,collection){const snapshot=await getDocs(firestoreCollection(db,"users",uid,collection));return snapshot.docs.map(item=>item.data());}
export async function syncLibraryForUser(user=auth.currentUser){
  if(!user)return readLocal();
  const local=readLocal();
  const remote=await Promise.all(COLLECTIONS.map(key=>fetchRemote(user.uid,key)));
  const merged=emptyLibrary();
  COLLECTIONS.forEach((key,index)=>{
    const map=new Map();
    [...remote[index],...(local[key]||[])].forEach(item=>map.set(itemKey(item),item));
    merged[key]=Array.from(map.values()).sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
  });
  await Promise.all(COLLECTIONS.flatMap(key=>merged[key].map(item=>setRemoteItem(user.uid,key,item))));
  saveLocalLibrary(merged);
  return merged;
}
export async function syncLocalItem(collection,item){const user=auth.currentUser;if(!user)return;await setRemoteItem(user.uid,collection,item);}
export async function removeSyncedLibraryItem(collection,item){const user=auth.currentUser;if(!user)return;await deleteRemoteItem(user.uid,collection,item);}
let syncPromise=null;
export function startLibrarySync(){
  if(syncPromise)return syncPromise;
  syncPromise=new Promise(resolve=>{
    const unsubscribe=onAuthStateChanged(auth,async user=>{
      unsubscribe();
      if(!user){resolve(readLocal());return;}
      try{resolve(await syncLibraryForUser(user));}catch(error){console.error("Vivid library sync failed:",error);resolve(readLocal());}
    });
  });
  return syncPromise;
}
