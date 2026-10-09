import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const feed = $("vivid-community-feed");
const bodyField = $("vivid-post-body");
const submit = $("vivid-post-submit");
const notice = $("vivid-community-compose-notice");
const state = { user:null, posts:[], blocked:new Set(), followedTopics:new Set(), sort:"latest", stop:null };
const topics = {general:"Culture room",ghana:"Ghanaian cinema",nollywood:"Nollywood","african-cinema":"African cinema",film:"Film craft",television:"Television",streaming:"Streaming",celebrity:"People & culture",theory:"Fan theories"};
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const nameOf = user => String(user?.displayName || "Vivid member").trim().slice(0,80) || "Vivid member";
function say(text){ if(notice) notice.textContent=text; }
function dateLabel(value){ const d=value?.toDate?value.toDate():value?new Date(value):null; return d&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(d):"Just now"; }
function participate(){ if(!state.user){location.href="auth.html?returnTo="+encodeURIComponent("community.html");return false;} if(state.user.emailVerified!==true){say("Please verify your email before joining the community.");return false;} return true; }
async function loadBlocked(){state.blocked.clear();state.followedTopics.clear();if(!state.user)return;try{const snap=await getDocs(query(collection(db,"users",state.user.uid,"blockedUsers"),limit(300)));snap.docs.forEach(d=>state.blocked.add(d.id));}catch(e){console.warn("Blocked list unavailable:",e);}try{const snap=await getDocs(query(collection(db,"users",state.user.uid,"followedTopics"),limit(100)));snap.docs.forEach(d=>state.followedTopics.add(d.id));}catch(e){console.warn("Followed topics unavailable:",e);}document.querySelectorAll("[data-follow-topic]").forEach(b=>{const followed=state.followedTopics.has(b.dataset.followTopic);b.textContent=followed?"Following":"Follow";b.setAttribute("aria-pressed",String(followed));});}
function render(){
 if(!feed)return;
 let items=state.posts.filter(p=>!state.blocked.has(p.authorId));
 if(state.sort==="following")items=items.filter(p=>state.followedTopics.has(p.topic));
 if(!items.length){feed.innerHTML='<div class="vivid-community-loading"><strong>The room is open.</strong><p>Start a thoughtful conversation: a question, a film theory or a celebration of work that deserves attention.</p></div>';return;}
 feed.innerHTML=items.slice(0,40).map(p=>{
  const name=esc(p.authorName||"Vivid member"), topic=esc(topics[p.topic]||"Culture room");
  const content=p.spoiler?'<details class="vivid-post-spoiler-content"><summary>Spoiler ahead — reveal post</summary><p class="vivid-post-body">'+esc(p.body)+'</p></details>':'<p class="vivid-post-body">'+esc(p.body)+'</p>';
  return '<article class="vivid-community-post" data-post-id="'+p.id+'"><div class="vivid-post-head"><div class="vivid-post-avatar">'+esc(Array.from(name)[0]||"V")+'</div><div class="vivid-post-author"><strong>'+name+'</strong><small>'+esc(dateLabel(p.createdAt))+' · Vivid member</small></div><button type="button" class="vivid-post-menu" data-post-menu="'+p.id+'">•••</button></div><span class="vivid-post-topic">'+topic+'</span>'+content+'<div class="vivid-post-actions"><button type="button" data-post-like="'+p.id+'">♡ Appreciate</button><button type="button" data-post-replies="'+p.id+'">Open conversation</button><button type="button" data-post-report="'+p.id+'">Report</button></div><div class="vivid-post-replies" id="replies-'+p.id+'" hidden><div class="vivid-replies-list"></div><form class="vivid-reply-form" data-reply-form="'+p.id+'"><input maxlength="700" aria-label="Reply" placeholder="Add a thoughtful reply…" required><button type="submit">Reply</button></form></div></article>';
 }).join("");
 wire();
}
async function report(type,id,postId){
 if(!participate())return;
 const reason=prompt("Why report this? (spam, harassment, hate, misinformation, spoiler, impersonation, other)");
 if(!reason)return;
 try{await addDoc(collection(db,"communityReports"),{reporterId:state.user.uid,targetType:type,targetId:id,postId:postId||null,reason:String(reason).trim().slice(0,240),status:"open",createdAt:serverTimestamp()});say("Report sent to the moderation team.");}
 catch(e){console.warn(e);say("Could not send report. Please try again.");}
}
async function loadReplies(postId){
 const host=$("replies-"+postId);if(!host)return;host.hidden=false;
 const list=host.querySelector(".vivid-replies-list");list.textContent="Loading replies…";
 try{
  const snap=await getDocs(query(collection(db,"communityPosts",postId,"comments"),where("status","==","published"),orderBy("createdAt","asc"),limit(30)));
  const replies=snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>!state.blocked.has(r.authorId));
  list.innerHTML=replies.length?replies.map(r=>'<div class="vivid-post-reply"><strong>'+esc(r.authorName||"Vivid member")+' · '+esc(dateLabel(r.createdAt))+'</strong><p>'+esc(r.body)+'</p><button type="button" data-reply-report="'+r.id+'" data-parent="'+postId+'">Report reply</button></div>').join(""):'<p class="vivid-post-reply">No replies yet. Add context, not heat.</p>';
  list.querySelectorAll("[data-reply-report]").forEach(b=>b.addEventListener("click",()=>report("communityComment",b.dataset.replyReport,b.dataset.parent)));
 }catch(e){console.warn(e);list.textContent="Replies are temporarily unavailable.";}
}
function wire(){
 feed.querySelectorAll("[data-post-like]").forEach(b=>b.addEventListener("click",async()=>{
  if(!participate())return;b.disabled=true;const ref=doc(db,"communityPosts",b.dataset.postLike,"reactions",state.user.uid);
  try{const snap=await getDoc(ref);if(snap.exists()){await deleteDoc(ref);b.classList.remove("is-liked");b.textContent="♡ Appreciate";}else{await setDoc(ref,{userId:state.user.uid,createdAt:serverTimestamp()});b.classList.add("is-liked");b.textContent="♥ Appreciated";}}
  catch(e){console.warn(e);say("Reaction could not be saved. Try again.");}finally{b.disabled=false;}
 }));
 feed.querySelectorAll("[data-post-replies]").forEach(b=>b.addEventListener("click",()=>loadReplies(b.dataset.postReplies)));
 feed.querySelectorAll("[data-post-report]").forEach(b=>b.addEventListener("click",()=>report("communityPost",b.dataset.postReport)));
 feed.querySelectorAll("[data-post-menu]").forEach(b=>b.addEventListener("click",()=>{
  const post=state.posts.find(p=>p.id===b.dataset.postMenu);if(!post)return;
  const choice=prompt("Type REPORT to report this post, BLOCK to hide this member, or FOLLOW to follow them.");
  if(choice?.trim().toLowerCase()==="report")void report("communityPost",post.id);
  if(choice?.trim().toLowerCase()==="block")void block(post.authorId);\n  if(choice?.trim().toLowerCase()==="follow")void followUser(post.authorId);
 }));
 feed.querySelectorAll("[data-reply-form]").forEach(form=>form.addEventListener("submit",async e=>{
  e.preventDefault();if(!participate())return;const input=form.querySelector("input"),text=input.value.trim();
  if(text.length<2||text.length>700){say("Replies must be between 2 and 700 characters.");return;}
  const b=form.querySelector("button");b.disabled=true;
  try{await addDoc(collection(db,"communityPosts",form.dataset.replyForm,"comments"),{authorId:state.user.uid,authorName:nameOf(state.user),body:text,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),status:"published"});input.value="";await loadReplies(form.dataset.replyForm);say("Reply published.");}
  catch(e){console.warn(e);say("Reply could not be posted. Try again.");}finally{b.disabled=false;}
 }));
}
async function block(authorId){
 if(!participate())return;if(!authorId||authorId===state.user.uid){say("You cannot block your own account.");return;}
 if(!confirm("Block this member? Their posts and replies will be hidden from your view."))return;
 try{await setDoc(doc(db,"users",state.user.uid,"blockedUsers",authorId),{blockedUid:authorId,createdAt:serverTimestamp()});state.blocked.add(authorId);render();say("Member blocked.");}
 catch(e){console.warn(e);say("Could not block this member.");}
}

async function followUser(authorId){
 if(!participate())return;if(!authorId||authorId===state.user.uid){say("You cannot follow your own account.");return;}
 try{await setDoc(doc(db,"users",state.user.uid,"following",authorId),{targetUid:authorId,createdAt:serverTimestamp()});say("Member followed.");}
 catch(e){console.warn(e);say("Could not follow this member.");}
}
async function toggleTopic(topic,button){
 if(!participate())return;const ref=doc(db,"users",state.user.uid,"followedTopics",topic);button.disabled=true;
 try{if(state.followedTopics.has(topic)){await deleteDoc(ref);state.followedTopics.delete(topic);button.textContent="Follow";button.setAttribute("aria-pressed","false");}else{await setDoc(ref,{topicId:topic,createdAt:serverTimestamp()});state.followedTopics.add(topic);button.textContent="Following";button.setAttribute("aria-pressed","true");}say(state.followedTopics.has(topic)?"Topic followed. Your feed can use this preference.":"Topic unfollowed.");}
 catch(e){console.warn(e);say("Could not update topic follow. Please try again.");}finally{button.disabled=false;}
}
document.querySelectorAll("[data-follow-topic]").forEach(button=>button.addEventListener("click",()=>void toggleTopic(button.dataset.followTopic,button)));
\nsubmit?.addEventListener("click",async()=>{
 if(!participate())return;const body=String(bodyField?.value||"").trim();
 if(body.length<3||body.length>1600){say("Posts must be between 3 and 1,600 characters.");return;}
 submit.disabled=true;
 try{await addDoc(collection(db,"communityPosts"),{authorId:state.user.uid,authorName:nameOf(state.user),body,topic:$("vivid-post-topic")?.value||"general",spoiler:Boolean($("vivid-post-spoiler")?.checked),status:"published",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});bodyField.value="";$("vivid-post-spoiler").checked=false;say("Your post is live. Keep the conversation thoughtful.");}
 catch(e){console.warn(e);say("Post could not be published. Verify your account and try again.");}finally{submit.disabled=false;}
});
document.querySelectorAll("[data-community-sort]").forEach(b=>b.addEventListener("click",()=>{state.sort=b.dataset.communitySort||"latest";document.querySelectorAll("[data-community-sort]").forEach(x=>{x.classList.toggle("is-active",x===b);x.setAttribute("aria-pressed",x===b?"true":"false");});render();}));
document.querySelectorAll("[data-topic-pick]").forEach(b=>b.addEventListener("click",()=>{if($("vivid-post-topic"))$("vivid-post-topic").value=b.dataset.topicPick||"general";bodyField?.focus();window.scrollTo({top:document.querySelector(".vivid-compose-card")?.offsetTop||0,behavior:"smooth"});}));
onAuthStateChanged(auth,async user=>{state.user=user;const avatar=$("vivid-compose-avatar");if(avatar)avatar.textContent=Array.from(nameOf(user))[0]||"V";await loadBlocked();render();});
state.stop=onSnapshot(query(collection(db,"communityPosts"),where("status","==","published"),orderBy("createdAt","desc"),limit(60)),snap=>{state.posts=snap.docs.map(d=>({id:d.id,...d.data()}));render();},error=>{console.warn("Community feed unavailable:",error);if(feed)feed.innerHTML='<div class="vivid-community-loading"><strong>The culture room could not connect.</strong><p>Community Firestore rules must be deployed before this feed can load.</p></div>';});
window.addEventListener("pagehide",()=>state.stop?.(),{once:true});
