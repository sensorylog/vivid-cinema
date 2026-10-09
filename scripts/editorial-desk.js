import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const sourcePanel = $("source-registry-panel");
const editorialPanel = $("editorial-publish-panel");
const sourceForm = $("source-form");
const editorialForm = $("editorial-form");
let moderator = false;

function message(id, value) { const el=$(id); if(el) el.textContent=value; }
function normalizedDomain(value) { return String(value||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/$/,""); }
function domainFromUrl(value) { const url=new URL(value); return url.hostname.toLowerCase().replace(/^www\./,""); }
function validStoryHost(url, domain) { const host=url.hostname.toLowerCase().replace(/^www\./,""); return host===domain || host.endsWith("."+domain); }
function localDateTimeValue(date=new Date()) { const pad=n=>String(n).padStart(2,"0"); return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"T"+pad(date.getHours())+":"+pad(date.getMinutes()); }

sourceForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if(!moderator || !auth.currentUser) return message("source-feedback","Trusted moderator access is required.");
  const publisher=$("source-publisher").value.trim();
  const domain=normalizedDomain($("source-domain").value);
  const reviewNotes=$("source-review-notes").value.trim();
  const feedUrl=$("source-feed-url").value.trim();
  const feedApproved=$("source-feed-approved").checked;
  const imageUsageApproved=$("source-image-approved").checked;
  if(!publisher || publisher.length>120 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return message("source-feedback","Enter a valid publisher name and domain.");
  if(reviewNotes.length<10) return message("source-feedback","Add meaningful source-review notes before approval.");
  if(feedUrl) {
    try {
      const url=new URL(feedUrl);
      if(url.protocol!=="https:" || !validStoryHost(url,domain) || !feedApproved) throw new Error("Feed host or permission check failed.");
    } catch { return message("source-feedback","Feed URL must use HTTPS, belong to this publisher, and have explicit feed-use approval."); }
  } else if(feedApproved) return message("source-feedback","Add a feed URL or turn off feed-use approval.");
  const button=$("source-submit"); button.disabled=true;
  try {
    const ref=doc(db,"newsSources",domain);
    const previous=await getDoc(ref);
    const now=serverTimestamp();
    await setDoc(ref,{
      publisher,domain,status:"approved",
      defaultRegion:$("source-region").value,
      defaultCategory:$("source-category").value,
      feedUrl,feedApproved,imageUsageApproved,
      reviewNotes,verifiedBy:auth.currentUser.uid,
      verifiedAt:now,updatedAt:now,
      createdAt:previous.exists() ? previous.data().createdAt : now
    });
    message("source-feedback","Publisher approved: "+publisher+". Feed and image permissions are stored separately.");
    sourceForm.reset();
  } catch(error) {
    console.warn("Source approval failed",error);
    message("source-feedback",error?.code==="permission-denied"?"Firestore denied this source approval. Check the moderator claim and rules.":"Could not save this publisher.");
  } finally { button.disabled=false; }
});

$("editorial-source")?.addEventListener("change", async event => {
  try {
    const url=new URL(event.currentTarget.value.trim());
    if(url.protocol!=="https:") throw new Error("HTTPS required");
    const domain=url.hostname.toLowerCase().replace(/^www\./,"");
    const snap=await getDoc(doc(db,"newsSources",domain));
    if(snap.exists() && snap.data().status==="approved") {
      $("editorial-publisher").value=snap.data().publisher;
      message("editorial-feedback","Approved publisher recognized. Verify the story before publishing.");
    } else message("editorial-feedback","Publisher domain is not approved. Review it in the source registry first.");
  } catch { message("editorial-feedback","Enter a valid HTTPS source URL."); }
});

editorialForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if(!moderator || !auth.currentUser) return message("editorial-feedback","Trusted moderator access is required.");
  const headline=$("editorial-headline").value.trim();
  const publisher=$("editorial-publisher").value.trim();
  const sourceUrl=$("editorial-source").value.trim();
  const publishedValue=$("editorial-published").value;
  const summary=$("editorial-summary").value.trim();
  const body=$("editorial-body").value.trim();
  const imageUrl=$("editorial-image").value.trim();
  let url, publishedDate;
  try { url=new URL(sourceUrl); if(url.protocol!=="https:") throw new Error("HTTPS required"); }
  catch { return message("editorial-feedback","The original source URL must use HTTPS."); }
  publishedDate=new Date(publishedValue);
  if(!publishedValue || Number.isNaN(publishedDate.getTime()) || publishedDate.getTime()>Date.now()+60000) return message("editorial-feedback","Use the publisher's real publication date, not a future date.");
  if(headline.length<8 || headline.length>240 || !publisher || !summary || summary.length>700 || body.length>4000) return message("editorial-feedback","Check the headline, publisher, summary and context lengths.");
  const domain=domainFromUrl(sourceUrl);
  if(imageUrl) {
    try {
      const img=new URL(imageUrl);
      const imageHost=img.hostname.toLowerCase().replace(/^www\\./,"");
      if(img.protocol!=="https:" || imageHost!==domain) throw new Error("Publisher-hosted image required");
    } catch { return message("editorial-feedback","Use an HTTPS image hosted on the approved publisher's domain, or leave the image blank."); }
  }
  const button=$("editorial-submit"); button.disabled=true;
  try {
    const sourceSnap=await getDoc(doc(db,"newsSources",domain));
    if(!sourceSnap.exists() || sourceSnap.data().status!=="approved" || sourceSnap.data().publisher!==publisher || !validStoryHost(url,sourceSnap.data().domain)) {
      message("editorial-feedback","This publisher/domain is not approved or the publisher name does not match its registry record."); return;
    }
    if(imageUrl && sourceSnap.data().imageUsageApproved!==true) {
      message("editorial-feedback","This source has not approved image reuse. Leave the image blank unless rights have been reviewed and recorded."); return;
    }
    const publishedAt=Timestamp.fromDate(publishedDate);
    const category=$("editorial-category").value;
    const region=$("editorial-region").value;
    const ref=await addDoc(collection(db,"articles"),{
      headline,publisher,author:$("editorial-author").value.trim().slice(0,120),
      sourceUrl,canonicalUrl:url.href,sourceId:domain,
      category,region,summary,body,imageUrl,imageAlt:headline,
      publishedAt,updatedAt:publishedAt,ingestedAt:serverTimestamp(),
      status:"published",origin:"editorial",featured:$("editorial-featured").checked,
      editorialReviewed:$("editorial-reviewed").checked,correction:"",topics:[category,region]
    });
    message("editorial-feedback","Published successfully. Story ID: "+ref.id);
    editorialForm.reset(); $("editorial-published").value=localDateTimeValue();
  } catch(error) {
    console.warn("Editorial publish failed",error);
    message("editorial-feedback",error?.code==="permission-denied"?"Firestore denied publication. Check source approval, image rights and moderator permissions.":"Could not publish this story.");
  } finally { button.disabled=false; }
});

onAuthStateChanged(auth, async user => {
  moderator=false;
  if(sourcePanel) sourcePanel.hidden=true;
  if(editorialPanel) editorialPanel.hidden=true;
  if(!user) return;
  try {
    const token=await user.getIdTokenResult(true);
    moderator=token.claims.moderator===true;
    if(moderator) {
      if(sourcePanel) sourcePanel.hidden=false;
      if(editorialPanel) editorialPanel.hidden=false;
      $("editorial-published").value=localDateTimeValue();
    }
  } catch(error) { console.warn("Moderator claim check failed",error); }
});
