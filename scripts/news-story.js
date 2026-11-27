import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { escapeHtml } from "./utils.js";
import { setPageSeo } from "./seo.js";
const $ = id => document.getElementById(id);
const articleId = new URLSearchParams(location.search).get("id") || "";
const articleRoot = $("news-story-content");
const notice = $("news-story-notice");
function isoDate(value) {
  try {
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
  } catch { return undefined; }
}
function dateText(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date) : "Publisher date unavailable";
}
function renderArticle(article) {
  const headline = String(article.headline || "Vivid Cinema News").trim();
  const description = String(article.summary || article.headline || "Read the latest entertainment story on Vivid Cinema.").trim().slice(0, 260);
  const canonical = new URL(location.href);
  canonical.hash = "";
  const imageUrl = /^https:\/\//i.test(article.imageUrl || "") ? article.imageUrl : undefined;
  const published = isoDate(article.publishedAt);
  const modified = isoDate(article.updatedAt) || published;
  setPageSeo({
    title: headline + " | Vivid Cinema News",
    description,
    canonicalUrl: canonical.href,
    image: imageUrl,
    type: "article",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      "headline": headline,
      "description": description,
      "url": canonical.href,
      "datePublished": published,
      "dateModified": modified,
      "image": imageUrl ? [imageUrl] : undefined,
      "publisher": { "@type": "Organization", "name": "Vivid Cinema" },
      "author": { "@type": "Organization", "name": "Vivid Cinema News" },
      ...(article.publisher ? { "sourceOrganization": { "@type": "Organization", "name": String(article.publisher) } } : {}),
      "articleSection": String(article.category || "Entertainment")
    }
  });
  const image = /^https:\/\//i.test(article.imageUrl || "") ? '<img class="vivid-story-image" src="' + escapeHtml(article.imageUrl) + '" alt="" decoding="async">' : "";
  articleRoot.innerHTML = '<div class="vivid-story-kicker">' + escapeHtml(article.regionLabel || article.region || "VIVID NEWS") + ' · ' + escapeHtml(article.category || "Entertainment") + '</div>' +
    '<h1>' + escapeHtml(article.headline || "Untitled story") + '</h1><div class="vivid-story-byline"><span>' + escapeHtml(article.publisher || "Original publisher") + '</span><span>Published ' + escapeHtml(dateText(article.publishedAt)) + '</span>' +
    (article.updatedAt ? '<span>Updated ' + escapeHtml(dateText(article.updatedAt)) + '</span>' : '') + '</div>' + image +
    (article.summary ? '<p class="vivid-story-summary">' + escapeHtml(article.summary) + '</p>' : '') +
    (article.body ? '<div class="vivid-story-body">' + escapeHtml(article.body).replace(/\n/g,'<br>') + '</div>' : '') +
    '<div class="vivid-story-source-note">Vivid links to the original publisher. This summary is not a replacement for the original report.</div>' +
    '<div class="vivid-story-actions"><a class="vivid-story-source" href="' + escapeHtml(article.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Read original report ↗</a><button type="button" id="news-story-share">Share story</button></div>';
  $("news-story-share")?.addEventListener("click", async () => {
    try { if(navigator.share) await navigator.share({title:article.headline || "Vivid Cinema News",url:location.href}); else {await navigator.clipboard.writeText(location.href);if(notice)notice.textContent="Story link copied.";} }
    catch(error){if(error?.name!=="AbortError"&&notice)notice.textContent="Could not share this story from this browser.";}
  });
}
async function loadArticle() {
  if(!articleId||!/^[A-Za-z0-9_-]{1,160}$/.test(articleId)){articleRoot.innerHTML='<div class="vivid-editorial-empty"><h2>Story not found</h2><p>This story link may be incomplete.</p><a href="news.html">Back to News</a></div>';return;}
  try {const snapshot=await getDoc(doc(db,"articles",articleId));if(!snapshot.exists()||snapshot.data().status!=="published")throw new Error("Story unavailable");const article=snapshot.data();if(!/^https:\/\//i.test(article.sourceUrl||""))throw new Error("Invalid source URL");renderArticle(article);}
  catch(error){console.warn("Story unavailable:",error);articleRoot.innerHTML='<div class="vivid-editorial-empty"><h2>This story is not available.</h2><p>It may have been removed or the newsroom is not yet connected.</p><a href="news.html">Back to News</a></div>';}
}
void loadArticle();
