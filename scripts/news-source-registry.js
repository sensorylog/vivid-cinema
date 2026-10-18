import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { collection, limit, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const root = document.getElementById("source-registry-list");
const status = document.getElementById("source-registry-status");
let stop = null;

function render(snapshot) {
  const sources = snapshot.docs.map(item => ({ id:item.id, ...item.data() }))
    .sort((a,b) => String(a.publisher || "").localeCompare(String(b.publisher || "")));
  if (status) status.textContent = sources.length + " approved source" + (sources.length === 1 ? "" : "s");
  if (!sources.length) {
    root.innerHTML = '<div class="vivid-source-registry-empty">Approve a publisher above after checking its current terms and source quality.</div>';
    return;
  }
  root.innerHTML = sources.map(source => {
    const region = String(source.defaultRegion || "global").replace(/-/g," ");
    const category = String(source.defaultCategory || "industry").replace(/-/g," ");
    const feedPermission = source.feedApproved === true ? "Feed permission reviewed" : "Manual source only";
    const discovery = source.ingestionEnabled === true ? "Scheduled discovery on" : "Scheduled discovery off";
    const images = source.imageUsageApproved === true ? "Image use approved" : "No image reuse";
    return '<article class="vivid-source-registry-card"><div class="vivid-source-registry-card-head"><div><strong>' +
      escapeHtml(source.publisher || "Unknown publisher") + '</strong><span>' + escapeHtml(source.domain || source.id) +
      '</span></div></div><div class="vivid-source-registry-tags"><span>' + escapeHtml(region) + '</span><span>' +
      escapeHtml(category) + '</span><span>' + escapeHtml(feedPermission) + '</span><span>' + escapeHtml(discovery) +
      '</span><span>' + escapeHtml(images) + '</span></div><p>' + escapeHtml(source.reviewNotes || "No review note recorded.") +
      '</p></article>';
  }).join("");
}

onAuthStateChanged(auth, async user => {
  stop?.(); stop = null;
  if (root) root.innerHTML = "";
  if (!user || !root) return;
  try {
    const token = await user.getIdTokenResult(true);
    if (token.claims.moderator !== true) {
      if (status) status.textContent = "Moderator access required.";
      return;
    }
    stop = onSnapshot(query(collection(db,"newsSources"),where("status","==","approved"),limit(100)),render,error => {
      console.warn("Source registry unavailable",error);
      if (status) status.textContent = "Approved source registry unavailable.";
      root.textContent = "Check moderator permissions and Firestore connectivity.";
    });
  } catch (error) {
    console.warn("Moderator source registry access failed",error);
    if (status) status.textContent = "Moderator access could not be verified.";
  }
});
window.addEventListener("pagehide",()=>stop?.(),{once:true});
