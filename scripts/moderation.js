import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const sourceForm = $("source-form");
const editorialForm = $("editorial-form");
const sourcePanel = $("source-registry-panel");
const editorialPanel = editorialForm?.closest(".vivid-editorial-publish");
let moderator = false;
let activeReports = [];
const labelReason = { harassment:"Harassment", hate:"Hate or hateful content", spam:"Spam", spoiler:"Spoiler", impersonation:"Impersonation", privacy:"Privacy concern", misinformation:"Potential misinformation", other:"Other" };

function setStatus(message) { const el=$("moderation-status"); if(el) el.textContent=message; }
function setSourceFeedback(message) { const el=$("source-feedback"); if(el) el.textContent=message; }
function setEditorialFeedback(message) { const el=$("editorial-feedback"); if(el) el.textContent=message; }
function localDateTimeValue(date=new Date()) { const pad=n=>String(n).padStart(2,"0"); return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"T"+pad(date.getHours())+":"+pad(date.getMinutes()); }
function timeLabel(value) { const d=value?.toDate?value.toDate():value?new Date(value):null; return d&&!Number.isNaN(d.getTime())?d.toLocaleString([],{dateStyle:"medium",timeStyle:"short"}):"Time unavailable"; }

function setEditorialAccess(allowed) {
  if(sourcePanel) sourcePanel.hidden=!allowed;
  if(editorialPanel) editorialPanel.hidden=!allowed;
}
async function approveSource(event) {
  event.preventDefault();
  if(!moderator) { setSourceFeedback("Source approval requires trusted moderator permission."); return; }
  const publisher=$("source-publisher").value.trim();
  const domain=$("source-domain").value.trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"");
  const reviewNotes=$("source-review-notes").value.trim();
  const feedUrl=$("source-feed-url").value.trim();
  const feedApproved=$("source-feed-approved").checked;
  const imageUsageApproved=$("source-image-approved").checked;
  const domainPattern=/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  if(!publisher||publisher.length>120||!domainPattern.test(domain)) { setSourceFeedback("Enter a valid publisher name and domain only, such as example.com."); return; }
  if(reviewNotes.length<10) { setSourceFeedback("Add meaningful review notes before approving a source."); return; }
  if(feedUrl&&!feedApproved) { setSourceFeedback("Confirm feed-use permission or remove the feed URL."); return; }
  if(!feedUrl&&feedApproved) { setSourceFeedback("Add a feed URL or uncheck feed permission."); return; }
  if(feedUrl) {
    try { const feed=new URL(feedUrl); if(feed.protocol!=="https:"||feed.hostname==="localhost"||feed.hostname.endsWith(".local")||feed.hostname.endsWith(".internal")||/^[0-9.]+$/.test(feed.hostname)||feed.hostname.startsWith("[")) throw new Error("Feed must be a public HTTPS URL."); }
    catch { setSourceFeedback("Feed URL must be a public HTTPS URL. Check the official feed host and its usage terms before approval."); return; }
  }
  const button=$("source-submit"); button.disabled=true; button.textContent="Approving…";
  try {
    await setDoc(doc(db,"newsSources",domain),{publisher,domain,status:"approved",defaultRegion:$("source-region").value,defaultCategory:$("source-category").value,feedUrl,feedApproved,imageUsageApproved,verifiedAt:serverTimestamp(),verifiedBy:auth.currentUser.uid,reviewNotes,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    setSourceFeedback("Approved source: "+publisher+" ("+domain+").");
    sourceForm.reset();
  } catch(error) {
    console.warn("Source approval rejected:",error);
    setSourceFeedback(error?.code==="permission-denied"?"Firestore denied source approval. Check moderator permissions and rules.":"Could not save the source approval.");
  } finally { button.disabled=false; button.textContent="Approve publisher"; }
}
sourceForm?.addEventListener("submit",approveSource);

$("editorial-source")?.addEventListener("change",async event=>{
  try {
    const url=new URL(event.currentTarget.value.trim());
    if(url.protocol!=="https:") return;
    const sourceDomain=url.hostname.toLowerCase().replace(/^www\./,"");const snap=await getDoc(doc(db,"newsSources",sourceDomain));
    if(snap.exists()&&snap.data().status==="approved") {
      $("editorial-publisher").value=snap.data().publisher;
      setEditorialFeedback("Approved source recognized: "+snap.data().publisher+".");
    } else setEditorialFeedback("This domain is not approved yet. Add it to the source registry after review.");
  } catch {}
});

async function publishArticle(event) {
  event.preventDefault();
  if(!moderator) { setEditorialFeedback("Publishing requires trusted moderator permission."); return; }
  const headline=$("editorial-headline").value.trim();
  const publisher=$("editorial-publisher").value.trim();
  const sourceUrl=$("editorial-source").value.trim();
  const publishedValue=$("editorial-published").value;
  const summary=$("editorial-summary").value.trim();
  const body=$("editorial-body").value.trim();
  const imageUrl=$("editorial-image").value.trim();
  let source;
  try { source=new URL(sourceUrl); if(source.protocol!=="https:") throw new Error("HTTPS required"); }
  catch { setEditorialFeedback("Use a valid HTTPS source URL."); return; }
  const publishedDate=new Date(publishedValue);
  if(!publishedValue||Number.isNaN(publishedDate.getTime())||publishedDate>Date.now()+60000) {
    setEditorialFeedback("Enter the publisher’s real publication date and time, not a future date."); return;
  }
  if(!headline||headline.length>240||!publisher||!summary||summary.length>700) {
    setEditorialFeedback("Check the headline, publisher and summary lengths."); return;
  }
  if(imageUrl) { try { if(new URL(imageUrl).protocol!=="https:") throw new Error("HTTPS required"); } catch { setEditorialFeedback("Image URLs must use HTTPS, or leave the image blank."); return; } }
  const button=$("editorial-submit"); button.disabled=true; button.textContent="Publishing…"; setEditorialFeedback("Saving verified story…");
  const publishedAt=Timestamp.fromDate(publishedDate);
  try {
    const sourceDomain=source.hostname.toLowerCase().replace(/^www\./,"");
    const sourceRecord=await getDoc(doc(db,"newsSources",sourceDomain));
    if(!sourceRecord.exists()||sourceRecord.data().status!=="approved"||sourceRecord.data().publisher!==publisher||!(source.hostname.toLowerCase()===sourceDomain||source.hostname.toLowerCase().endsWith("."+sourceDomain))) {
      setEditorialFeedback("This publisher/domain is not approved or the publisher name does not match the registry.");
      return;
    }
    const ref=await addDoc(collection(db,"articles"),{
      headline,publisher,author:$("editorial-author").value.trim().slice(0,120),
      sourceUrl,canonicalUrl:source.href,sourceId:sourceDomain,
      category:$("editorial-category").value,region:$("editorial-region").value,
      summary,body,imageUrl,imageAlt:headline,publishedAt,updatedAt:publishedAt,
      ingestedAt:serverTimestamp(),status:"published",origin:"editorial",featured:$("editorial-featured").checked,correction:"",
      topics:[$("editorial-category").value,$("editorial-region").value]
    });
    setEditorialFeedback("Published successfully. Story ID: "+ref.id);
    editorialForm.reset();
    $("editorial-published").value=localDateTimeValue();
  } catch(error) {
    console.warn("Editorial publish rejected:",error);
    setEditorialFeedback(error?.code==="permission-denied"?"Firestore denied publishing. Verify the source is approved and your moderator claim is active.":"Could not publish the story. Check the connection and try again.");
  } finally { button.disabled=false; button.textContent="Publish to Newsroom"; }
}
editorialForm?.addEventListener("submit",publishArticle);

function renderReports() {
  const root=$("moderation-reports"); if(!root)return;
  if(!activeReports.length) {
    root.innerHTML='<div class="vivid-community-empty"><i class="bi bi-shield-check"></i><h3>No open reports</h3><p>New community reports will appear here for authorized moderators.</p></div>';
    return;
  }
  root.innerHTML=activeReports.map(r=>'<article class="vivid-moderation-report" data-report-id="'+escapeHtml(r.id)+'"><header><strong>'+escapeHtml(labelReason[r.reason]||r.reason||"Report")+'</strong><span>'+escapeHtml(r.status||"open")+'</span></header><p>Target: '+escapeHtml(r.targetType||"unknown")+' · '+escapeHtml(r.targetId||"unknown")+'</p><small>Submitted '+escapeHtml(timeLabel(r.createdAt))+'</small><div class="vivid-moderation-actions"><button data-action="review" data-id="'+escapeHtml(r.id)+'">Mark reviewing</button><button data-action="resolve" data-id="'+escapeHtml(r.id)+'">Resolve</button><button class="danger" data-action="hide" data-id="'+escapeHtml(r.id)+'">Hide target</button><button class="danger" data-action="suspend" data-id="'+escapeHtml(r.id)+'">Hide & suspend author</button></div></article>').join("");
}
async function loadReports() {
  setStatus("Loading reports…");
  try {
    const q=query(collection(db,"communityReports"),where("status","in",["open","reviewing"]),orderBy("createdAt","desc"),limit(50));
    const snap=await getDocs(q); activeReports=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderReports(); setStatus(activeReports.length+" report(s) require review.");
  } catch(error) {
    console.warn("Moderation queue unavailable:",error);
    setStatus(error?.code==="permission-denied"?"Access denied. Moderator permissions are assigned by trusted Firebase administration, never from this page.":"Could not load the queue. Check the connection and Firestore indexes.");
  }
}
async function markReport(reportId,status,resolution) {
  await updateDoc(doc(db,"communityReports",reportId),{status,moderatedBy:auth.currentUser.uid,moderatedAt:serverTimestamp(),resolution});
  activeReports=activeReports.filter(r=>r.id!==reportId); renderReports();
}
function commentPath(report) {
  const [parentId,commentId]=String(report.targetId).split("/");
  if(!parentId||!commentId) throw new Error("Comment target is invalid.");
  return report.targetType==="community_comment"?["communityPosts",parentId,"comments",commentId]:["articles",parentId,"comments",commentId];
}
async function hideTarget(report) {
  if(report.targetType==="post") {
    await updateDoc(doc(db,"communityPosts",report.targetId),{status:"hidden",moderatedAt:serverTimestamp(),moderationNote:"Hidden after community report review"}); return;
  }
  if(report.targetType==="community_comment"||report.targetType==="article_comment") {
    await updateDoc(doc(db,...commentPath(report)),{status:"hidden",moderatedAt:serverTimestamp(),moderationNote:"Hidden after community report review"}); return;
  }
  throw new Error("This report target needs manual review before action.");
}
async function suspendAuthor(report) {
  let authorId="";
  if(report.targetType==="post") {
    const snap=await getDoc(doc(db,"communityPosts",report.targetId)); authorId=snap.exists()?snap.data().authorId:"";
  } else if(report.targetType==="community_comment"||report.targetType==="article_comment") {
    const snap=await getDoc(doc(db,...commentPath(report))); authorId=snap.exists()?snap.data().authorId:"";
  }
  if(!authorId) throw new Error("Could not resolve the target author.");
  if(report.targetType==="post"||report.targetType==="community_comment"||report.targetType==="article_comment") await hideTarget(report);
  await setDoc(doc(db,"communityUsers",authorId),{status:"suspended",reason:"Suspended after report "+report.id,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});
}
$("moderation-reports")?.addEventListener("click",async event=>{
  const button=event.target.closest("button[data-action]"); if(!button||!moderator)return;
  const report=activeReports.find(r=>r.id===button.dataset.id); if(!report)return;
  button.disabled=true;
  try {
    if(button.dataset.action==="review") await markReport(report.id,"reviewing","Report acknowledged; review in progress.");
    else if(button.dataset.action==="resolve") await markReport(report.id,"resolved","Reviewed; no further action recorded.");
    else if(button.dataset.action==="hide") { await hideTarget(report); await markReport(report.id,"action_taken","Target hidden by moderator."); }
    else if(button.dataset.action==="suspend") { await suspendAuthor(report); await markReport(report.id,"action_taken","Target hidden and author suspended by moderator."); }
    setStatus("Moderation action saved.");
  } catch(error) {
    console.warn("Moderation action failed:",error);
    setStatus(error?.code==="permission-denied"?"Action denied by Firestore security rules.":"Action failed: "+(error.message||"unknown error"));
    button.disabled=false;
  }
});

$("editorial-published").value=localDateTimeValue();
onAuthStateChanged(auth,async user=>{
  if(!user) {
    moderator=false; setEditorialAccess(false);
    setStatus("Sign in with an authorized moderator account to open this private queue."); return;
  }
  try {
    const token=await user.getIdTokenResult(true);
    moderator=token.claims.moderator===true;
    if(moderator) { setEditorialAccess(true); await loadReports(); }
    else { setEditorialAccess(false); setStatus("This account does not have the trusted moderator permission."); }
  } catch(error) {
    console.warn("Moderator claims unavailable:",error); moderator=false; setEditorialAccess(false); setStatus("Could not verify moderator access.");
  }
});