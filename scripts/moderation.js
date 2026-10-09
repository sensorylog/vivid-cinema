import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
const status=document.getElementById("vivid-moderation-status");
const queue=document.getElementById("vivid-moderation-queue");
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const date=value=>{const d=value?.toDate?value.toDate():value?new Date(value):null;return d&&!Number.isNaN(d.getTime())?d.toLocaleString():"Time unavailable";};
let unsubscribe=null, moderator=false;
function message(value){if(status)status.textContent=value;}
function render(snap){
 const reports=snap.docs.map(d=>({id:d.id,...d.data()}));
 if(!reports.length){queue.innerHTML='<div class="vivid-editorial-empty"><h3>No open reports.</h3><p>New reports will appear here when members flag content.</p></div>';return;}
 queue.innerHTML=reports.map(r=>'<article class="vivid-moderation-item"><div class="vivid-moderation-item-head"><span>'+esc(r.targetType||"content")+'</span><time>'+esc(date(r.createdAt))+'</time></div><h2>'+esc(r.reason||"No reason supplied")+'</h2><p>Target: <code>'+esc(r.targetId||"unknown")+'</code></p>'+(r.postId?'<p>Post: <code>'+esc(r.postId)+'</code></p>':"")+(r.articleId?'<p>Article: <code>'+esc(r.articleId)+'</code></p>':"")+'<div class="vivid-moderation-actions"><button type="button" data-hide="'+r.id+'">Hide reported content</button><button type="button" data-resolve="'+r.id+'">Resolve report</button></div></article>').join("");
 queue.querySelectorAll("[data-hide]").forEach(b=>b.addEventListener("click",()=>hideReported(reports.find(r=>r.id===b.dataset.hide))));
 queue.querySelectorAll("[data-resolve]").forEach(b=>b.addEventListener("click",()=>resolveReport(reports.find(r=>r.id===b.dataset.resolve))));
}
async function hideReported(report){
 if(!moderator||!report)return;
 if(!confirm("Hide this content from public view and mark the report resolved?"))return;
 try{
  if(report.targetType==="communityPost")await updateDoc(doc(db,"communityPosts",report.targetId),{status:"hidden",moderatedAt:serverTimestamp(),moderatedBy:auth.currentUser.uid});
  else if(report.targetType==="communityComment"&&report.postId)await updateDoc(doc(db,"communityPosts",report.postId,"comments",report.targetId),{status:"hidden",moderatedAt:serverTimestamp(),moderatedBy:auth.currentUser.uid});
  else if(report.targetType==="articleComment"&&report.articleId)await updateDoc(doc(db,"articles",report.articleId,"comments",report.targetId),{status:"hidden",moderatedAt:serverTimestamp(),moderatedBy:auth.currentUser.uid});
  else {message("This report type needs an account-level or article moderation action not available in this desk yet.");return;}
  await resolveReport(report);
 }catch(error){console.warn(error);message("Moderation action failed. Confirm your moderator claim and Firestore rules.");}
}
async function resolveReport(report){
 if(!moderator||!report)return;
 try{await updateDoc(doc(db,"communityReports",report.id),{status:"resolved",resolvedAt:serverTimestamp(),moderatorUid:auth.currentUser.uid});message("Report resolved.");}
 catch(error){console.warn(error);message("Could not resolve this report. Check moderator access.");}
}
onAuthStateChanged(auth,async user=>{
 if(!user){message("Moderator sign-in required.");queue.innerHTML='<div class="vivid-editorial-empty"><h3>Restricted desk</h3><p>Sign in with an authorized moderator account to continue.</p><a href="auth.html?returnTo=moderator.html">Sign in ↗</a></div>';return;}
 try{
  const token=await user.getIdTokenResult(true);
  moderator=token.claims.moderator===true;
  if(!moderator){message("This account does not have the moderator role.");queue.innerHTML='<div class="vivid-editorial-empty"><h3>Access not granted</h3><p>Moderator access is controlled by trusted Firebase custom claims, not by a profile setting.</p></div>';return;}
  message("Moderator access confirmed. Open reports are listed below.");
  unsubscribe=onSnapshot(query(collection(db,"communityReports"),where("status","==","open"),orderBy("createdAt","desc"),limit(100)),render,error=>{console.warn(error);message("Could not load reports. Verify Firestore rules and moderator claims.");});
 }catch(error){console.warn(error);message("Could not verify moderator access.");}
});
window.addEventListener("pagehide",()=>unsubscribe?.(),{once:true});
