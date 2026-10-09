import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const articleId = new URLSearchParams(location.search).get("id");
let user = null, profile = null, article = null;
const dateText = value => { const d = value?.toDate ? value.toDate() : value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString([], {dateStyle:"medium",timeStyle:"short"}) : ""; };
function authLink(){return "login.html";}
function showState(text){const el=$("story-state");if(el)el.textContent=text;}
function renderArticle(data){
  article=data;
  $("story-article").hidden=false;
  $("story-category").textContent=[data.category,data.region].filter(Boolean).join(" · ").toUpperCase()||"VIVID CINEMA";
  $("story-title").textContent=data.headline||"Untitled story";
  $("story-summary").textContent=data.summary||"";
  const byline=[]; if(data.publisher)byline.push("Source: "+data.publisher);if(data.author)byline.push("By "+data.author);if(data.publishedAt)byline.push("Published "+dateText(data.publishedAt));if(data.updatedAt&&data.publishedAt){const updated=data.updatedAt.toDate?data.updatedAt.toDate():new Date(data.updatedAt);const published=data.publishedAt.toDate?data.publishedAt.toDate():new Date(data.publishedAt);if(!Number.isNaN(updated.getTime())&&!Number.isNaN(published.getTime())&&Math.abs(updated-published)>60000)byline.push("Updated "+dateText(data.updatedAt));}
  $("story-byline").textContent=byline.join(" · ");
  const image=$("story-image");if(data.imageUrl && /^https:\/\//i.test(data.imageUrl)){image.src=data.imageUrl;image.alt=data.imageAlt||data.headline||"Story image";image.hidden=false;}
  $("story-body").textContent=data.body||"";
  const source=$("story-source");
  if(data.sourceUrl && /^https:\/\//i.test(data.sourceUrl)){source.innerHTML='<a href="'+escapeHtml(data.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Read the original reporting <i class="bi bi-arrow-up-right"></i></a>';}else{source.textContent="Original source link is not available for this story.";}
  const correction=$("story-correction");if(data.correction){correction.textContent="Correction / update: "+data.correction;correction.hidden=false;}
  document.title=(data.headline||"Story")+" · Vivid Cinema";
  showState("");
}
async function loadComments(){
  const root=$("story-comments");if(!root||!articleId)return;
  try{
    const q=query(collection(db,"articles",articleId,"comments"),where("status","==","published"),orderBy("createdAt","desc"),limit(50));
    const snap=await getDocs(q);
    if(!snap.size){root.innerHTML='<div class="vivid-community-status">No comments yet. Start a thoughtful conversation.</div>';return;}
    root.innerHTML=snap.docs.map(d=>{const c=d.data();const when=c.createdAt?.toDate?c.createdAt.toDate().toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):"Just now";return '<article class="vivid-community-comment"><strong>'+escapeHtml(c.authorName||"Vivid member")+'</strong><time>'+escapeHtml(when)+'</time><p>'+escapeHtml(c.body||"")+'</p>'+(user&&user.emailVerified?'<button type="button" data-story-report="'+escapeHtml(d.id)+'" style="border:0;background:transparent;color:#a7a0c9;font-size:10px;padding:5px 0">Report comment</button>':"")+'</article>';}).join("");
  }catch(error){console.warn("Story comments unavailable:",error);root.innerHTML='<div class="vivid-community-status">Comments are temporarily unavailable.</div>';}
}
async function reportStoryComment(commentId){
  if(!user){location.href=authLink();return;}
  if(!user.emailVerified)return;
  const reason=window.prompt("Reason: harassment, hate, spam, spoiler, impersonation, privacy, misinformation, or other");
  if(!reason)return;
  const allowed=["harassment","hate","spam","spoiler","impersonation","privacy","misinformation","other"];
  const category=allowed.find(item=>reason.trim().toLowerCase()===item)||"other";
  try{
    await addDoc(collection(db,"communityReports"),{reporterId:user.uid,targetType:"article_comment",targetId:articleId+"/"+commentId,reason:category,details:"",status:"open",createdAt:serverTimestamp()});
    $("story-comment-note").textContent="Comment reported to moderators.";
  }catch(error){console.warn("Comment report rejected:",error);$("story-comment-note").textContent="Could not report this comment right now.";}
}
$("story-comments")?.addEventListener("click",event=>{const button=event.target.closest("button[data-story-report]");if(button)void reportStoryComment(button.dataset.storyReport);});
async function submitComment(event){
  event.preventDefault();const input=$("story-comment"),button=$("story-comment-submit"),note=$("story-comment-note");const body=String(input.value||"").trim();
  if(!user){location.href=authLink();return;}if(!user.emailVerified){note.textContent="Verify your email before commenting.";return;}if(!profile?.displayName?.trim()){note.textContent="Add a display name in your Vivid account before commenting.";return;}if(!article){note.textContent="This story is not available for discussion yet.";return;}if(body.length<1||body.length>1000){note.textContent="Comments must be 1–1,000 characters.";return;}
  button.disabled=true;button.textContent="Posting…";
  try{await addDoc(collection(db,"articles",articleId,"comments"),{authorId:user.uid,authorName:profile.displayName.trim().slice(0,100),body,status:"published",createdAt:serverTimestamp(),updatedAt:serverTimestamp()});input.value="";note.textContent="Your comment is live.";await loadComments();}
  catch(error){console.warn("Story comment rejected:",error);note.textContent=error?.code==="permission-denied"?"Your account cannot post this comment. Verify sign-in and try again.":"Could not post right now. Please try again.";}
  finally{button.disabled=false;button.textContent="Post comment";}
}
$("story-comment-form")?.addEventListener("submit",submitComment);
if(!articleId){showState("No story was selected. Return to News and choose a story.");$("story-comment-form").hidden=true;}
else{
  try{const snap=await getDoc(doc(db,"articles",articleId));if(!snap.exists()||snap.data().status!=="published"){showState("This story is not available yet. The Vivid newsroom is preparing its verified publishing feed.");$("story-comment-form").hidden=true;}else{renderArticle(snap.data());await loadComments();}}
  catch(error){console.warn("Story unavailable:",error);showState("Could not load this story. Please try again later.");}
}
onAuthStateChanged(auth,async nextUser=>{user=nextUser||null;profile=null;if(user){try{const snap=await getDoc(doc(db,"users",user.uid));profile=snap.exists()?snap.data():null;}catch(error){console.warn("Story profile unavailable:",error);}}
  const note=$("story-comment-note"),input=$("story-comment"),button=$("story-comment-submit");
  if(!user){note.innerHTML='Reading is open. <a href="'+escapeHtml(authLink())+'">Sign in or create an account</a> to comment.';input.disabled=false;button.disabled=false;}
  else if(!user.emailVerified){note.textContent="Verify your email to comment.";input.disabled=true;button.disabled=true;}
  else if(!profile?.displayName?.trim()){note.textContent="Add a display name in your Vivid account before commenting.";input.disabled=true;button.disabled=true;}
  else{note.textContent="Be curious. Be kind. Keep spoilers clearly marked.";}
});