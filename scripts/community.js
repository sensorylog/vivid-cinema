import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy,
  query, serverTimestamp, setDoc, startAfter, updateDoc, where
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const state = { user: null, profile: null, topic: "all", sort: "latest", posts: [], cursor: null, pageSize: 12, loading: false, blockedIds: new Set(), followedTopics: new Set(), suspended: false };
const topicNames = { film: "FILM & TV", ghana: "GHANAIAN CINEMA", nollywood: "NOLLYWOOD", african: "AFRICAN CINEMA", anime: "ANIME", theories: "FAN THEORIES", streaming: "STREAMING" };
const safeTime = value => {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }) : "Just now";
};
function toast(message) {
  const el = $("community-toast"); if (!el) return;
  el.textContent = message; el.hidden = false;
  window.setTimeout(() => { el.hidden = true; }, 3200);
}
function authHref() { return "login.html"; }
function setFollowTopicButton() {
  const button=$("community-follow-topic");if(!button)return;
  if(state.topic==="all"){button.hidden=true;return;}
  button.hidden=false;
  const following=state.followedTopics.has(state.topic);
  button.textContent=following?"Following "+(topicNames[state.topic]||state.topic)+" · Unfollow":"Follow "+(topicNames[state.topic]||state.topic);
  button.disabled=state.loading;
}
async function toggleFollowTopic(){
  if(!state.user){window.location.href=authHref();return;}
  if(!state.user.emailVerified){toast("Verify your email before following topics.");return;}
  if(state.suspended){toast("Community participation is suspended for this account.");return;}
  if(state.topic==="all")return;
  const ref=doc(db,"users",state.user.uid,"followingTopics",state.topic);
  try{if(state.followedTopics.has(state.topic)){await deleteDoc(ref);state.followedTopics.delete(state.topic);toast("Topic unfollowed.");}else{await setDoc(ref,{topicId:state.topic,createdAt:serverTimestamp()});state.followedTopics.add(state.topic);toast("Topic followed.");}setFollowTopicButton();}
  catch(error){console.warn("Topic follow rejected:",error);toast("Could not update topic follows.");}
}
function setComposeState() {
  const button = $("community-post-submit"), textarea = $("community-post-body"), note = $("community-compose-note");
  if (!button || !textarea || !note) return;
  const canPost = !!state.user && !!state.user.emailVerified && !!state.profile?.displayName?.trim() && !state.suspended;
  button.disabled = !canPost || state.loading;
  textarea.disabled = !canPost;
  if (!state.user) note.innerHTML = 'Reading is open to everyone. <a href="' + authHref() + '">Sign in or create an account</a> to post, like or reply.';
  else if (!state.user.emailVerified) note.textContent = "Please verify your email address before participating in the community.";
  else if (state.suspended) note.textContent = "Community participation is suspended for this account. You can still read public conversations.";
  else if (!state.profile?.displayName?.trim()) note.textContent = "Set a display name in your Vivid account before posting.";
  else note.textContent = "Posts are public. Keep it thoughtful, avoid spoilers without warning, and report abuse.";
}
function postMarkup(post) {
  const id = escapeHtml(post.id);
  const topic = topicNames[post.topic] || "COMMUNITY";
  const canAct = !!state.user && state.user.emailVerified;
  return '<article class="vivid-community-post" data-post-id="' + id + '">' +
    '<header class="vivid-community-post-head"><span class="vivid-community-post-avatar" aria-hidden="true"><i class="bi bi-person-fill"></i></span>' +
    '<div class="vivid-community-post-identity"><strong>' + escapeHtml(post.authorName || "Vivid member") + '</strong><span>' + escapeHtml(safeTime(post.createdAt)) + '</span></div>' +
    '<span class="vivid-community-post-topic">' + escapeHtml(topic) + '</span></header>' +
    '<div class="vivid-community-post-body">' + escapeHtml(post.body || "") + '</div>' +
    '<div class="vivid-community-post-actions"><button type="button" data-action="like" data-id="' + id + '" ' + (!canAct ? 'aria-label="Sign in to like"' : "") + '><i class="bi bi-heart"></i> Like</button>' +
    '<button type="button" data-action="comments" data-id="' + id + '"><i class="bi bi-chat"></i> Join the conversation</button>' +
    '<button type="button" data-action="report" data-id="' + id + '"><i class="bi bi-flag"></i> Report</button>' +
    (state.user?.uid === post.authorId ? '<button type="button" data-action="edit" data-id="' + id + '"><i class="bi bi-pencil"></i> Edit</button><button type="button" data-action="delete" data-id="' + id + '"><i class="bi bi-trash3"></i> Delete</button>' : (state.user && state.user.uid !== post.authorId ? '<button type="button" data-action="block" data-id="' + id + '"><i class="bi bi-person-slash"></i> Block author</button>' : "")) +
    '</div><div class="vivid-community-comments" id="comments-' + id + '" hidden></div></article>';
}
async function fetchPosts(reset = true) {
  if (state.loading) return;
  state.loading = true;
  const status = $("community-status"), button = $("community-load-more");
  if (status) status.textContent = "Finding thoughtful conversations…";
  if (reset) { state.posts = []; state.cursor = null; }
  try {
    const constraints = [where("status", "==", "published"), orderBy("createdAt", "desc"), limit(state.pageSize)];
    if (state.topic !== "all") constraints.unshift(where("topic", "==", state.topic));
    if (!reset && state.cursor) constraints.splice(constraints.length - 1, 0, startAfter(state.cursor));
    // Query by time; pagination uses the last document snapshot when available.
    const q = query(collection(db, "communityPosts"), ...constraints);
    const snap = await getDocs(q);
    const docs = snap.docs.map(item => ({ id:item.id, ...item.data() }));
    state.posts = reset ? docs : [...state.posts, ...docs];
    state.cursor = snap.docs.at(-1) || null;
    renderPosts();
    if (status) status.textContent = state.posts.length ? state.posts.length + " conversations in view" : "No conversations in this corner yet. Start one.";
    if (button) button.hidden = snap.size < state.pageSize;
  } catch (error) {
    console.warn("Community feed could not load:", error);
    if (status) status.textContent = "The community feed could not load right now. Please refresh and try again.";
    if (button) button.hidden = true;
  } finally {
    state.loading = false; setComposeState();
  }
}
function renderPosts() {
  const root = $("community-posts"); if (!root) return;
  let posts = [...state.posts];
  posts = posts.filter(post => !state.blockedIds.has(post.authorId));
  if (!posts.length) {
    root.innerHTML = '<div class="vivid-community-empty"><i class="bi bi-chat-square-heart"></i><h3>Make the first good conversation.</h3><p>Ask a question, share a theory or tell the community which story deserves more attention.</p></div>';
    return;
  }
  root.innerHTML = posts.map(postMarkup).join("");
}
function dateValue(value) { return value?.toMillis ? value.toMillis() : value ? new Date(value).getTime() : 0; }
async function publishPost() {
  const textarea = $("community-post-body"), topic = $("community-post-topic"), button = $("community-post-submit");
  const body = String(textarea?.value || "").trim();
  if (!state.user) { window.location.href = authHref(); return; }
  if (!state.user.emailVerified) { toast("Verify your email before participating."); return; }
  if (state.suspended) { toast("Community participation is suspended for this account."); return; }
  if (!state.profile?.displayName?.trim()) { toast("Add a display name to your Vivid account first."); return; }
  if (body.length < 2 || body.length > 2000) { toast("Write between 2 and 2,000 characters."); return; }
  if (button) { button.disabled = true; button.innerHTML = '<i class="bi bi-arrow-repeat"></i> Publishing…'; }
  try {
    await addDoc(collection(db, "communityPosts"), {
      authorId: state.user.uid, authorName: state.profile.displayName.trim().slice(0,100),
      body, topic: topic?.value || "film", status: "published",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), commentCount: 0
    });
    textarea.value = ""; toast("Your conversation is live.");
    await fetchPosts(true);
  } catch (error) {
    console.warn("Community post rejected:", error);
    toast(error?.code === "permission-denied" ? "Vivid could not authorize that post. Check your verified account and profile." : "Could not publish right now. Please try again.");
  } finally {
    if (button) button.innerHTML = '<i class="bi bi-send-fill"></i> Publish post';
    setComposeState();
  }
}
async function toggleLike(postId, button) {
  if (!state.user) { window.location.href = authHref(); return; }
  if (!state.user.emailVerified) { toast("Verify your email before reacting."); return; }
  if (state.suspended) { toast("Community participation is suspended for this account."); return; }
  const ref = doc(db, "communityPosts", postId, "reactions", state.user.uid);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) { await deleteDoc(ref); button.classList.remove("is-active"); button.innerHTML = '<i class="bi bi-heart"></i> Like'; }
    else { await setDoc(ref, { userId:state.user.uid, type:"like", createdAt:serverTimestamp() }); button.classList.add("is-active"); button.innerHTML = '<i class="bi bi-heart-fill"></i> Liked'; }
  } catch (error) {
    console.warn("Reaction rejected:", error);
    toast(error?.code === "permission-denied" ? "Sign in with a verified account to react." : "Could not save your reaction.");
  }
}
async function openComments(postId) {
  const panel = $("comments-" + postId); if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = '<div class="vivid-community-status">Loading replies…</div>';
  try {
    const q = query(collection(db, "communityPosts", postId, "comments"), where("status", "==", "published"), orderBy("createdAt", "asc"), limit(30));
    const snap = await getDocs(q);
    const comments = snap.docs.map(d => ({id:d.id,...d.data()}));
    panel.innerHTML = '<div class="vivid-community-comment-list">' + (comments.length ? comments.map(c=>'<div class="vivid-community-comment"><strong>' + escapeHtml(c.authorName || "Vivid member") + '</strong><time>' + escapeHtml(safeTime(c.createdAt)) + '</time><p>' + escapeHtml(c.body || "") + '</p>' + (state.user && state.user.emailVerified ? '<button type="button" data-action="report-comment" data-id="' + escapeHtml(postId) + '" data-comment-id="' + escapeHtml(c.id) + '" style="border:0;background:transparent;color:#a7a0c9;font-size:10px;padding:5px 0">Report reply</button>' : "") + '</div>').join("") : '<div class="vivid-community-status">Be the first to reply.</div>') + '</div>' +
      '<form class="vivid-community-comment-form" data-comment-form="' + escapeHtml(postId) + '"><label class="sr-only" for="comment-input-' + escapeHtml(postId) + '">Write a reply</label><input id="comment-input-' + escapeHtml(postId) + '" name="body" maxlength="1000" placeholder="' + (state.user ? "Add something thoughtful…" : "Sign in to reply…") + '" required ' + (!state.user || !state.user.emailVerified ? "disabled" : "") + '><button type="submit" ' + (!state.user || !state.user.emailVerified ? "disabled" : "") + '>Reply</button></form>' +
      (!state.user ? '<p class="vivid-community-note"><a href="' + authHref() + '">Sign in</a> to join this discussion.</p>' : !state.user.emailVerified ? '<p class="vivid-community-note">Verify your email to reply.</p>' : "");
  } catch (error) {
    console.warn("Community comments could not load:", error);
    panel.innerHTML = '<div class="vivid-community-status">Replies are temporarily unavailable.</div>';
  }
}
async function addComment(postId, body) {
  if (!state.user || !state.user.emailVerified) { window.location.href = authHref(); return; }
  if (state.suspended) { toast("Community participation is suspended for this account."); return; }
  if (!state.profile?.displayName?.trim()) { toast("Add a display name to your Vivid account first."); return; }
  const text = String(body || "").trim();
  if (text.length < 1 || text.length > 1000) { toast("Replies must be 1–1,000 characters."); return; }
  try {
    await addDoc(collection(db, "communityPosts", postId, "comments"), {
      authorId:state.user.uid, authorName:state.profile.displayName.trim().slice(0,100),
      body:text, status:"published", createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    await openComments(postId); await openComments(postId);
    toast("Reply posted.");
  } catch (error) {
    console.warn("Reply rejected:", error);
    toast(error?.code === "permission-denied" ? "Vivid could not authorize that reply." : "Could not post your reply.");
  }
}
async function reportPost(postId) {
  if (!state.user) { window.location.href = authHref(); return; }
  if (!state.user.emailVerified) { toast("Verify your email before reporting."); return; }
  const reason = window.prompt("Why are you reporting this post?\nChoose a reason: harassment, hate, spam, spoiler, impersonation, privacy, other");
  if (!reason) return;
  const allowed = ["harassment","hate","spam","spoiler","impersonation","privacy","other"];
  const normalized = reason.trim().toLowerCase();
  const category = allowed.find(item => normalized.includes(item)) || "other";
  try {
    await addDoc(collection(db, "communityReports"), {
      reporterId:state.user.uid, targetType:"post", targetId:postId, reason:category,
      details:"", status:"open", createdAt:serverTimestamp()
    });
    toast("Report sent to the moderation queue.");
  } catch (error) { console.warn("Report rejected:",error); toast("Could not send the report right now."); }
}
async function blockAuthor(postId) {
  if (!state.user) { window.location.href = authHref(); return; }
  const post = state.posts.find(item => item.id === postId);
  if (!post || post.authorId === state.user.uid) return;
  if (!window.confirm("Block this author? Their posts will be hidden from your community feed.")) return;
  try { await setDoc(doc(db, "users", state.user.uid, "blockedUsers", post.authorId), { targetId: post.authorId, createdAt: serverTimestamp() }); state.blockedIds.add(post.authorId); renderPosts(); toast("Author blocked for your account."); }
  catch (error) { console.warn("Block rejected:", error); toast("Could not block this author right now."); }
}
async function reportComment(postId, commentId) {
  if (!state.user) { window.location.href = authHref(); return; }
  if (!state.user.emailVerified) { toast("Verify your email before reporting."); return; }
  const reason = window.prompt("Reason: harassment, hate, spam, spoiler, impersonation, privacy, misinformation, or other");
  if (!reason) return;
  const allowed = ["harassment","hate","spam","spoiler","impersonation","privacy","misinformation","other"];
  const category = allowed.find(item => reason.trim().toLowerCase() === item) || "other";
  try { await addDoc(collection(db,"communityReports"), { reporterId:state.user.uid, targetType:"community_comment", targetId:postId + "/" + commentId, reason:category, details:"", status:"open", createdAt:serverTimestamp() }); toast("Reply reported to moderators."); }
  catch (error) { console.warn("Comment report rejected:",error); toast("Could not send the report right now."); }
}
async function editOwnPost(postId) {
  if(!state.user)return;
  const post=state.posts.find(item=>item.id===postId);if(!post||post.authorId!==state.user.uid)return;
  const body=window.prompt("Edit your post (2,000 characters max):",post.body||"");if(body===null)return;
  const clean=body.trim();if(clean.length<2||clean.length>2000){toast("Posts must be 2–2,000 characters.");return;}
  try{await updateDoc(doc(db,"communityPosts",postId),{body:clean,updatedAt:serverTimestamp()});post.body=clean;post.updatedAt=new Date();renderPosts();toast("Post updated.");}
  catch(error){console.warn("Post edit rejected:",error);toast("Could not edit this post.");}
}
async function deleteOwnPost(postId) {
  if (!state.user || !window.confirm("Delete this post? This cannot be undone.")) return;
  try { await deleteDoc(doc(db,"communityPosts",postId)); toast("Post deleted."); await fetchPosts(true); }
  catch(error) { console.warn("Post deletion rejected:",error); toast("Could not delete this post."); }
}
$("community-post-submit")?.addEventListener("click", () => void publishPost());
$("community-follow-topic")?.addEventListener("click", () => void toggleFollowTopic());
$("community-load-more")?.addEventListener("click", () => void fetchPosts(false));
$("community-topics")?.addEventListener("click", event => {
  const button = event.target.closest("button[data-topic]"); if (!button) return;
  state.topic = button.dataset.topic;
  $("community-topics").querySelectorAll("button").forEach(item=>item.classList.toggle("is-active",item===button));
  void fetchPosts(true);
});
document.querySelector(".vivid-community-sort")?.addEventListener("click",event=>{
  const button=event.target.closest("button[data-sort]");if(!button)return;
  state.sort=button.dataset.sort;
  document.querySelectorAll(".vivid-community-sort button").forEach(item=>item.classList.toggle("is-active",item===button));
  renderPosts();
});
$("community-posts")?.addEventListener("click",event=>{
  const button=event.target.closest("button[data-action]");if(!button)return;
  const id=button.dataset.id;
  if(button.dataset.action==="like")void toggleLike(id,button);
  if(button.dataset.action==="comments")void openComments(id);
  if(button.dataset.action==="report")void reportPost(id);
  if(button.dataset.action==="report-comment")void reportComment(id,button.dataset.commentId);
  if(button.dataset.action==="block")void blockAuthor(id);
  if(button.dataset.action==="edit")void editOwnPost(id);
  if(button.dataset.action==="delete")void deleteOwnPost(id);
});
$("community-posts")?.addEventListener("submit",event=>{
  const form=event.target.closest("form[data-comment-form]");if(!form)return;
  event.preventDefault();
  const input=form.elements.body; const body=input.value; input.disabled=true;
  void addComment(form.dataset.commentForm,body).finally(()=>{input.disabled=false;});
});
onAuthStateChanged(auth, async user => {
  state.user = user || null; state.profile = null; state.blockedIds = new Set(); state.followedTopics = new Set(); state.suspended = false;
  const nav = $("community-auth");
  if (user) {
    try { const snap = await getDoc(doc(db,"users",user.uid)); state.profile = snap.exists() ? snap.data() : null; const blocked = await getDocs(collection(db,"users",user.uid,"blockedUsers")); state.blockedIds = new Set(blocked.docs.map(item=>item.id)); const followed = await getDocs(collection(db,"users",user.uid,"followingTopics")); state.followedTopics = new Set(followed.docs.map(item=>item.id)); const communityStatus=await getDoc(doc(db,"communityUsers",user.uid)); state.suspended=communityStatus.exists()&&communityStatus.data().status==="suspended"; }
    catch(error) { console.warn("Community profile unavailable:",error); }
    if (nav) { nav.href = "account.html"; nav.textContent = state.profile?.displayName || "My account"; }
  } else if (nav) { nav.href = authHref(); nav.textContent = "Sign in"; }
  setComposeState();
  renderPosts();
});
void fetchPosts(true);