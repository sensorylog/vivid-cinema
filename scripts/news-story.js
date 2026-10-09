import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const articleId = params.get("id") || "";
const articleRoot = $("news-story-content");
const commentsRoot = $("news-story-comments");
const form = $("news-story-comment-form");
const notice = $("news-story-notice");
let currentUser = null;
let stopComments = null;

function say(message) { if (notice) notice.textContent = message; }
function dateText(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date) : "Publisher date unavailable";
}
function requireUser() {
  if (!currentUser) {
    const returnTo = "news-story.html?id=" + encodeURIComponent(articleId) + "#discussion";
    location.href = "auth.html?returnTo=" + encodeURIComponent(returnTo);
    return false;
  }
  if (currentUser.emailVerified !== true) {
    say("Verify your email before joining the conversation.");
    return false;
  }
  return true;
}
function renderArticle(article) {
  const image = /^https:\/\//i.test(article.imageUrl || "") ? '<img class="vivid-story-image" src="' + escapeHtml(article.imageUrl) + '" alt="" decoding="async">' : "";
  articleRoot.innerHTML = '<div class="vivid-story-kicker">' + escapeHtml(article.regionLabel || article.region || "VIVID NEWS") + ' · ' + escapeHtml(article.category || "Entertainment") + '</div>' +
    '<h1>' + escapeHtml(article.headline || "Untitled story") + '</h1>' +
    '<div class="vivid-story-byline"><span>' + escapeHtml(article.publisher || "Original publisher") + '</span><span>Published ' + escapeHtml(dateText(article.publishedAt)) + '</span>' +
    (article.updatedAt ? '<span>Updated ' + escapeHtml(dateText(article.updatedAt)) + '</span>' : '') + '</div>' + image +
    (article.summary ? '<p class="vivid-story-summary">' + escapeHtml(article.summary) + '</p>' : '') +
    '<div class="vivid-story-source-note">Vivid links to the original publisher. This summary is not a replacement for the original report.</div>' +
    '<div class="vivid-story-actions"><a class="vivid-story-source" href="' + escapeHtml(article.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Read original report ↗</a><button type="button" id="news-story-share">Share story</button><button type="button" id="news-story-report">Report story</button></div>' +
    '<div class="vivid-story-discussion-intro"><span>THE CONVERSATION</span><h2>Talk about the story, not past each other.</h2><p>Be curious, stay respectful, and separate confirmed facts from speculation.</p></div>';
  $("news-story-share")?.addEventListener("click", async () => {
    const shareData = {title:article.headline || "Vivid Cinema News",url:location.href};
    try {
      if (navigator.share) await navigator.share(shareData);
      else { await navigator.clipboard.writeText(location.href); say("Story link copied."); }
    } catch (error) { if (error?.name !== "AbortError") say("Could not share this story from this browser."); }
  });
  $("news-story-report")?.addEventListener("click", async () => {
    if (!requireUser()) return;
    const reason = prompt("Why are you reporting this story? (misinformation, source issue, rights, other)");
    if (!reason) return;
    try {
      await addDoc(collection(db,"communityReports"),{
        reporterId:currentUser.uid,targetType:"article",targetId:articleId,articleId,
        reason:String(reason).trim().slice(0,240),status:"open",createdAt:serverTimestamp()
      });
      say("Story report sent to the moderation team.");
    } catch (error) { console.warn(error); say("Could not report this story. Please try again."); }
  });
}
function renderComments(snapshot) {
  const comments = snapshot.docs.map(item => ({id:item.id,...item.data()}));
  if (!comments.length) {
    commentsRoot.innerHTML = '<div class="vivid-discussion-empty"><strong>Be the first to add context.</strong><span>Good discussion starts with a thoughtful question.</span></div>';
    return;
  }
  commentsRoot.innerHTML = comments.map(comment => '<article class="vivid-comment"><div class="vivid-comment-avatar">' + escapeHtml((comment.authorName || "V").slice(0,1).toUpperCase()) + '</div><div class="vivid-comment-body"><div class="vivid-comment-meta"><strong>' + escapeHtml(comment.authorName || "Vivid member") + '</strong><time>' + escapeHtml(dateText(comment.createdAt)) + '</time></div><p>' + escapeHtml(comment.body || "") + '</p><button type="button" data-report-comment="' + escapeHtml(comment.id) + '">Report</button></div></article>').join("");
  commentsRoot.querySelectorAll("[data-report-comment]").forEach(button => button.addEventListener("click", async () => {
    if (!requireUser()) return;
    const reason = prompt("Why are you reporting this comment? (spam, harassment, misinformation, spoiler, other)");
    if (!reason) return;
    try {
      await addDoc(collection(db,"communityReports"),{reporterId:currentUser.uid,targetType:"articleComment",targetId:button.dataset.reportComment,articleId,reason:String(reason).slice(0,240),status:"open",createdAt:serverTimestamp()});
      say("Report sent to the moderation team.");
    } catch (error) { console.warn(error); say("Could not send report. Please try again."); }
  }));
}
async function loadArticle() {
  if (!articleId || !/^[A-Za-z0-9_-]{1,160}$/.test(articleId)) {
    articleRoot.innerHTML = '<div class="vivid-editorial-empty"><h2>Story not found</h2><p>This story link may be incomplete.</p><a href="news.html">Back to News</a></div>';
    form.hidden = true; return;
  }
  try {
    const snapshot = await getDoc(doc(db,"articles",articleId));
    if (!snapshot.exists() || snapshot.data().status !== "published") throw new Error("Story unavailable");
    const article = snapshot.data();
    if (!/^https:\/\//i.test(article.sourceUrl || "")) throw new Error("Invalid source URL");
    renderArticle(article);
    stopComments = onSnapshot(query(collection(db,"articles",articleId,"comments"),where("status","==","published"),orderBy("createdAt","desc"),limit(60)),renderComments,error => {
      console.warn("Story comments unavailable:",error);
      commentsRoot.textContent = "Discussion is temporarily unavailable.";
    });
  } catch (error) {
    console.warn("Story unavailable:",error);
    articleRoot.innerHTML = '<div class="vivid-editorial-empty"><h2>This story is not available.</h2><p>It may have been removed or the newsroom is not yet connected.</p><a href="news.html">Back to News</a></div>';
    form.hidden = true;
  }
}
onAuthStateChanged(auth,user => {
  currentUser = user;
  const prompt = $("news-story-auth-prompt");
  if (prompt) prompt.hidden = Boolean(user?.emailVerified);
  if (form) form.hidden = !user?.emailVerified;
});
form?.addEventListener("submit",async event => {
  event.preventDefault();
  if (!requireUser()) return;
  const field = $("news-story-comment");
  const body = String(field?.value || "").trim();
  if (body.length < 2 || body.length > 1800) { say("Comments must be between 2 and 1,800 characters."); return; }
  const button = form.querySelector("button[type=submit]");
  if (button) button.disabled = true;
  try {
    await addDoc(collection(db,"articles",articleId,"comments"),{
      authorId:currentUser.uid,authorName:String(currentUser.displayName || "Vivid member").slice(0,80),
      body,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),status:"published"
    });
    field.value = ""; say("Your comment is live.");
  } catch (error) {
    console.warn("Could not post comment:",error);
    say("Comment could not be posted. Please sign in again or try later.");
  } finally { if (button) button.disabled = false; }
});
window.addEventListener("pagehide",()=>stopComments?.(),{once:true});
void loadArticle();
