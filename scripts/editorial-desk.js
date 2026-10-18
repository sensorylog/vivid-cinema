import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { addDoc, collection, doc, getDoc, limit, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";

const $ = id => document.getElementById(id);
const sourcePanel = $("source-registry-panel");
const editorialPanel = $("editorial-publish-panel");
const sourceForm = $("source-form");
const editorialForm = $("editorial-form");
const discoveryPanel = $("news-discovery-panel");
const discoveryRoot = $("news-discovery-queue");
const discoveryStatus = $("news-discovery-status");
let moderator = false;
let queueUnsubscribe = null;
let queueCandidates = [];
const ALLOWED_CATEGORIES = ["film","television","streaming","music","gaming","anime","animation","box-office","celebrity","trailers","awards","festivals","production","business","legal","industry","comics","theatre","podcasts","creators","africa","india","asia","hollywood","europe","latin-america","middle-east","ghana","nollywood"];
const ALLOWED_REGIONS = ["global","hollywood","india","africa","asia","europe","latin-america","middle-east","ghana","nigeria"];
const REGION_LABELS = {global:"Global",hollywood:"Hollywood / Americas",india:"India",africa:"Africa",asia:"Asia & Asia-Pacific",europe:"Europe","latin-america":"Latin America","middle-east":"Middle East",ghana:"Ghana",nigeria:"Nigeria"};

function message(id, value) { const el=$(id); if(el) el.textContent=value; }
function normalizedDomain(value) { return String(value||"").trim().toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/$/,""); }
function domainFromUrl(value) { const url=new URL(value); return url.hostname.toLowerCase().replace(/^www\./,""); }
function validStoryHost(url, domain) { const host=url.hostname.toLowerCase().replace(/^www\./,""); return url.protocol==="https:" && !url.port && !url.username && !url.password && host===domain; }
function validFeedHost(url, domain) { const host=url.hostname.toLowerCase().replace(/^www\./,""); return url.protocol==="https:" && !url.port && !url.username && !url.password && (host===domain || host.endsWith("."+domain)); }
function localDateTimeValue(date=new Date()) { const pad=n=>String(n).padStart(2,"0"); return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"T"+pad(date.getHours())+":"+pad(date.getMinutes()); }

sourceForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if(!moderator || !auth.currentUser) return message("source-feedback","Trusted moderator access is required.");
  const publisher=$("source-publisher").value.trim();
  const domain=normalizedDomain($("source-domain").value);
  const reviewNotes=$("source-review-notes").value.trim();
  const feedUrl=$("source-feed-url").value.trim();
  const feedApproved=$("source-feed-approved").checked;
  const ingestionEnabled=$("source-ingestion-enabled").checked;
  const imageUsageApproved=$("source-image-approved").checked;
  if(!publisher || publisher.length>120 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return message("source-feedback","Enter a valid publisher name and domain.");
  if(reviewNotes.length<10) return message("source-feedback","Add meaningful source-review notes before approval.");
  if(feedUrl) {
    try {
      const url=new URL(feedUrl);
      if(url.protocol!=="https:" || !validFeedHost(url,domain) || !feedApproved) throw new Error("Feed host or permission check failed.");
    } catch { return message("source-feedback","Feed URL must use HTTPS, belong to this publisher, and have explicit feed-use approval."); }
  } else if(feedApproved) return message("source-feedback","Add a feed URL or turn off feed-use approval.");
  if(ingestionEnabled && (!feedUrl || !feedApproved)) return message("source-feedback","Automated discovery requires a feed URL and verified feed-use permission.");
  const button=$("source-submit"); button.disabled=true;
  try {
    const ref=doc(db,"newsSources",domain);
    const previous=await getDoc(ref);
    const now=serverTimestamp();
    await setDoc(ref,{
      publisher,domain,status:"approved",
      defaultRegion:$("source-region").value,
      defaultCategory:$("source-category").value,
      feedUrl,feedApproved,ingestionEnabled,imageUsageApproved,
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


function dateValue(value) {
  const date = value && typeof value.toDate === "function" ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}
function queueDate(value) {
  const date = dateValue(value);
  return date ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date) : "Publisher date unavailable";
}
function optionMarkup(values, selected, labels = {}) {
  return values.map(value => '<option value="' + escapeHtml(value) + '"' + (value === selected ? " selected" : "") + '>' + escapeHtml(labels[value] || value.replace(/-/g," ")) + '</option>').join("");
}
function sourceLinkMarkup(item) {
  try {
    const url = new URL(item.sourceUrl);
    const domain = String(item.sourceId || "").toLowerCase().replace(/^www\./,"");
    if (url.protocol === "https:" && url.hostname.toLowerCase().replace(/^www\./,"") === domain) {
      return '<a href="' + escapeHtml(url.href) + '" target="_blank" rel="noopener noreferrer">Open original report ↗</a>';
    }
  } catch {}
  return '<span>Source URL needs verification</span>';
}
function renderDiscoveryQueue() {
  if (!discoveryRoot) return;
  const items = [...queueCandidates].sort((a,b) => {
    const left = dateValue(a.discoveredAt)?.getTime() || 0;
    const right = dateValue(b.discoveredAt)?.getTime() || 0;
    return right - left;
  });
  if (discoveryStatus) discoveryStatus.textContent = items.length ? items.length + " candidate" + (items.length === 1 ? "" : "s") + " awaiting review" : "No candidates waiting for review.";
  if (!items.length) {
    discoveryRoot.innerHTML = '<div class="vivid-news-discovery-empty"><strong>You are all caught up.</strong><span>New items from explicitly enabled sources will appear here after the next scheduled scan.</span></div>';
    return;
  }
  discoveryRoot.innerHTML = items.map(item => {
    const id = escapeHtml(item.id);
    const publisher = escapeHtml(item.publisher || "Unknown publisher");
    const headline = escapeHtml(item.headline || "Untitled candidate");
    const excerpt = escapeHtml(item.excerpt || "No feed excerpt supplied. Open the original report to verify the facts.");
    const category = ALLOWED_CATEGORIES.includes(item.category) ? item.category : "industry";
    const region = ALLOWED_REGIONS.includes(item.region) ? item.region : "global";
    return '<article class="vivid-news-discovery-card" data-queue-card="' + id + '">' +
      '<div class="vivid-news-discovery-meta"><span>' + publisher + '</span><span>' + escapeHtml(queueDate(item.publishedAt)) + '</span></div>' +
      '<h3>' + headline + '</h3><p class="vivid-news-discovery-excerpt"><strong>Feed excerpt — reference only:</strong> ' + excerpt + '</p>' +
      '<div class="vivid-news-discovery-source">' + sourceLinkMarkup(item) + '</div>' +
      '<div class="vivid-news-discovery-fields"><label>News category<select data-category>' + optionMarkup(ALLOWED_CATEGORIES,category) + '</select></label>' +
      '<label>Region<select data-region>' + optionMarkup(ALLOWED_REGIONS,region,REGION_LABELS) + '</select></label></div>' +
      '<label>Original Vivid summary<textarea data-summary rows="3" maxlength="700" placeholder="Write a fresh, accurate summary in Vivid’s own words (30–700 characters)." required></textarea></label>' +
      '<label>Verification note<textarea data-review-notes rows="2" maxlength="500" placeholder="What did you verify? Source, publication date, key facts… (10+ characters)" required></textarea></label>' +
      '<div class="vivid-news-discovery-actions"><button type="button" data-publish-queue="' + id + '">Publish verified story</button><button type="button" class="vivid-news-discovery-dismiss" data-dismiss-queue="' + id + '">Dismiss</button></div>' +
      '<div class="vivid-news-discovery-feedback" data-feedback role="status" aria-live="polite"></div></article>';
  }).join("");
  discoveryRoot.querySelectorAll("[data-publish-queue]").forEach(button => button.addEventListener("click", () => publishDiscoveredStory(button.dataset.publishQueue)));
  discoveryRoot.querySelectorAll("[data-dismiss-queue]").forEach(button => button.addEventListener("click", () => dismissDiscoveredStory(button.dataset.dismissQueue)));
}
function queueFeedback(card, text) {
  const target = card?.querySelector("[data-feedback]");
  if (target) target.textContent = text;
}
async function publishDiscoveredStory(id) {
  const card = discoveryRoot?.querySelector('[data-queue-card="' + id + '"]');
  const item = queueCandidates.find(candidate => candidate.id === id);
  if (!moderator || !auth.currentUser || !card || !item) return;
  const summary = String(card.querySelector("[data-summary]")?.value || "").trim();
  const reviewNotes = String(card.querySelector("[data-review-notes]")?.value || "").trim();
  const category = String(card.querySelector("[data-category]")?.value || "");
  const region = String(card.querySelector("[data-region]")?.value || "");
  if (summary.length < 30 || summary.length > 700) return queueFeedback(card,"Write an original summary between 30 and 700 characters.");
  if (reviewNotes.length < 10 || reviewNotes.length > 500) return queueFeedback(card,"Add a verification note between 10 and 500 characters.");
  if (!ALLOWED_CATEGORIES.includes(category) || !ALLOWED_REGIONS.includes(region)) return queueFeedback(card,"Choose a valid category and region.");
  const publishedAt = dateValue(item.publishedAt);
  if (!publishedAt || publishedAt.getTime() > Date.now() + 60000 || Date.now() - publishedAt.getTime() > 14 * 24 * 60 * 60 * 1000) {
    return queueFeedback(card,"The source date is invalid or too old for this discovery queue. Verify and publish manually if appropriate.");
  }
  let sourceUrl, canonicalUrl;
  try {
    sourceUrl = new URL(item.sourceUrl);
    canonicalUrl = new URL(item.canonicalUrl);
    const domain = String(item.sourceId || "").toLowerCase().replace(/^www\./,"");
    if (sourceUrl.protocol !== "https:" || canonicalUrl.protocol !== "https:" || sourceUrl.port || canonicalUrl.port || sourceUrl.username || canonicalUrl.username || sourceUrl.password || canonicalUrl.password ||
        sourceUrl.hostname.toLowerCase().replace(/^www\./,"") !== domain ||
        canonicalUrl.hostname.toLowerCase().replace(/^www\./,"") !== domain) throw new Error("Publisher domain mismatch");
  } catch {
    return queueFeedback(card,"The original URL does not match the approved publisher domain.");
  }
  const button = card.querySelector("[data-publish-queue]");
  if (button) button.disabled = true;
  try {
    const sourceSnap = await getDoc(doc(db,"newsSources",item.sourceId));
    if (!sourceSnap.exists() || sourceSnap.data().status !== "approved" ||
        sourceSnap.data().domain !== item.sourceId || sourceSnap.data().publisher !== item.publisher) {
      throw new Error("Publisher approval changed or no longer matches this candidate.");
    }
    const articleRef = doc(collection(db,"articles"));
    const batch = writeBatch(db);
    batch.set(articleRef,{
      headline:String(item.headline || "").trim().slice(0,240),
      publisher:String(item.publisher || "").trim().slice(0,120),
      author:String(item.author || "").trim().slice(0,120),
      sourceUrl:sourceUrl.href,canonicalUrl:canonicalUrl.href,sourceId:item.sourceId,
      category,region,summary,body:"",imageUrl:"",imageAlt:String(item.headline || "").trim().slice(0,240),
      publishedAt:item.publishedAt,updatedAt:item.publishedAt,ingestedAt:serverTimestamp(),
      status:"published",origin:"editorial",featured:false,editorialReviewed:true,correction:"",
      topics:[category,region]
    });
    batch.update(doc(db,"newsQueue",id),{
      status:"published",articleId:articleRef.id,reviewedAt:serverTimestamp(),
      reviewedBy:auth.currentUser.uid,reviewNotes
    });
    await batch.commit();
    queueFeedback(card,"Published successfully. Story ID: " + articleRef.id);
  } catch (error) {
    console.warn("Could not publish discovered story",error);
    queueFeedback(card,error?.code === "permission-denied" ? "Publishing was denied by Firestore rules. Check moderator claims, source approval and the queue transaction." : String(error?.message || "Could not publish this story."));
  } finally {
    if (button) button.disabled = false;
  }
}
async function dismissDiscoveredStory(id) {
  const card = discoveryRoot?.querySelector('[data-queue-card="' + id + '"]');
  if (!moderator || !auth.currentUser || !card) return;
  const reason = String(card.querySelector("[data-review-notes]")?.value || "").trim();
  if (reason.length < 10) return queueFeedback(card,"Add a verification note (at least 10 characters) before dismissing.");
  const button = card.querySelector("[data-dismiss-queue]");
  if (button) button.disabled = true;
  try {
    await updateDoc(doc(db,"newsQueue",id),{
      status:"dismissed",reviewedAt:serverTimestamp(),reviewedBy:auth.currentUser.uid,reviewNotes:reason
    });
    queueFeedback(card,"Candidate dismissed and review decision recorded.");
  } catch (error) {
    console.warn("Could not dismiss discovered story",error);
    queueFeedback(card,"Could not dismiss this candidate. Check moderator access and try again.");
  } finally {
    if (button) button.disabled = false;
  }
}
function startDiscoveryQueue() {
  if (!discoveryPanel || !discoveryRoot || !moderator) return;
  discoveryPanel.hidden = false;
  queueUnsubscribe?.();
  queueUnsubscribe = onSnapshot(query(collection(db,"newsQueue"),where("status","==","pending_review"),limit(80)),snapshot => {
    queueCandidates = snapshot.docs.map(item => ({id:item.id,...item.data()}));
    renderDiscoveryQueue();
  },error => {
    console.warn("News discovery queue unavailable",error);
    if (discoveryStatus) discoveryStatus.textContent = "Review queue unavailable.";
    discoveryRoot.textContent = "Firestore could not load the review queue. Check moderator permissions and the connection.";
  });
}

onAuthStateChanged(auth, async user => {
  moderator=false;
  queueUnsubscribe?.(); queueUnsubscribe=null; queueCandidates=[];
  if(sourcePanel) sourcePanel.hidden=true;
  if(editorialPanel) editorialPanel.hidden=true;
  if(discoveryPanel) discoveryPanel.hidden=true;
  if(!user) return;
  try {
    const token=await user.getIdTokenResult(true);
    moderator=token.claims.moderator===true;
    if(moderator) {
      if(sourcePanel) sourcePanel.hidden=false;
      if(editorialPanel) editorialPanel.hidden=false;
      if(discoveryPanel) discoveryPanel.hidden=false;
      $("editorial-published").value=localDateTimeValue();
      startDiscoveryQueue();
    }
  } catch(error) { console.warn("Moderator claim check failed",error); }
});

window.addEventListener("pagehide", () => queueUnsubscribe?.(), {once:true});
