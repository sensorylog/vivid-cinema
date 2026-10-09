import { db } from "./firebase.js";
import { collection, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const root = document.getElementById("vivid-community-highlights");
if (root) {
  const state = { posts: [], polls: [], stops: [], failed: false };
  const labels = {
    general: "Culture room", ghana: "Ghanaian cinema", nollywood: "Nollywood",
    "african-cinema": "African cinema", film: "Film craft", television: "Television",
    streaming: "Streaming", celebrity: "People & culture", theory: "Fan theories"
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[char]));
  const dateValue = value => {
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  const formatDate = value => {
    const date = dateValue(value);
    return date ? new Intl.DateTimeFormat(undefined, {month:"short",day:"numeric"}).format(date) : "Recently";
  };
  function render() {
    const items = [
      ...state.posts.map(item => ({...item, kind:"Conversation", text:item.body || ""})),
      ...state.polls.map(item => ({...item, kind:"Community poll", text:item.question || ""}))
    ].sort((a,b) => (dateValue(b.createdAt)?.getTime() || 0) - (dateValue(a.createdAt)?.getTime() || 0)).slice(0,6);
    if (!items.length) {
      root.innerHTML = '<div class="vivid-editorial-empty"><h3>The room is warming up.</h3><p>When members start sharing thoughtful takes and polls, their latest conversations will appear here.</p><a href="community.html">Start a conversation ↗</a></div>';
      return;
    }
    root.innerHTML = '<div class="vivid-community-highlight-grid">' + items.map(item =>
      '<article class="vivid-community-highlight-card">' +
        '<div class="vivid-community-highlight-meta"><span>' + escapeHtml(item.kind) + '</span><time>' + escapeHtml(formatDate(item.createdAt)) + '</time></div>' +
        '<span class="vivid-community-highlight-topic">' + escapeHtml(labels[item.topic] || "Culture room") + '</span>' +
        '<h3>' + escapeHtml(item.authorName || "Vivid member") + '</h3>' +
        '<p>' + escapeHtml(item.text).slice(0,240) + (item.text.length > 240 ? "…" : "") + '</p>' +
        '<a href="community.html">Join the conversation ↗</a>' +
      '</article>'
    ).join("") + '</div>';
  }
  const handleError = error => {
    console.warn("Community highlights unavailable:", error);
    if (!state.posts.length && !state.polls.length) {
      root.innerHTML = '<div class="vivid-editorial-empty"><h3>The culture room is temporarily unavailable.</h3><p>You can still visit the community directly.</p><a href="community.html">Open Community ↗</a></div>';
    }
  };
  state.stops.push(onSnapshot(
    query(collection(db,"communityPosts"),where("status","==","published"),orderBy("createdAt","desc"),limit(12)),
    snapshot => { state.posts = snapshot.docs.map(doc => ({id:doc.id,...doc.data()})); render(); },
    handleError
  ));
  state.stops.push(onSnapshot(
    query(collection(db,"communityPolls"),where("status","==","published"),orderBy("createdAt","desc"),limit(12)),
    snapshot => { state.polls = snapshot.docs.map(doc => ({id:doc.id,...doc.data()})); render(); },
    handleError
  ));
  window.addEventListener("pagehide", () => state.stops.forEach(stop => stop?.()), {once:true});
}
