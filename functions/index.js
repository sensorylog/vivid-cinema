import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import Parser from "rss-parser";

initializeApp();
const db = getFirestore();
const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "VividCinemaNewsBot/1.0 (+https://vivid-cinema.web.app/news.html)" },
  customFields: { item: [["media:content", "mediaContent"], ["content:encoded", "contentEncoded"]] }
});
const MAX_ITEMS_PER_SOURCE = 25;
const MAX_SUMMARY_LENGTH = 280;
const MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function cleanText(value, max) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function canonicalUrl(value, source) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== source.domain && !url.hostname.endsWith("." + source.domain)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function categoryFor(source, item) {
  const text = (String(item.title || "") + " " + String(item.contentSnippet || "")).toLowerCase();
  if (source.region === "ghana") return "ghana";
  if (/nollywood|nigerian film|nigerian actor|lagos box office/.test(text)) return "nollywood";
  if (/ghana|ghanai|kumawood|accra/.test(text)) return "ghana";
  if (/african cinema|african film|afrobeats|africa/.test(text)) return "africa";
  if (/streaming|netflix|prime video|disney\+|hbo|max /.test(text)) return "streaming";
  if (/award|oscar|emmy|bafta|golden globe|cannes/.test(text)) return "awards";
  if (/television|tv series|season finale|showrunner/.test(text)) return "television";
  if (/trailer|teaser/.test(text)) return "trailers";
  if (/actor|actress|celebrity|singer|star |married|dating/.test(text)) return "celebrity";
  if (/box office|film|movie|director|cinema/.test(text)) return "film";
  return source.category || "industry";
}

function stableId(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 40);
}

function parsePublishedAt(item) {
  const raw = item.isoDate || item.pubDate || item.published || item.date;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  if (date.getTime() > now + FUTURE_SKEW_MS || now - date.getTime() > MAX_AGE_MS) return null;
  return date;
}


async function fetchFeedText(source, initialUrl) {
  let current = new URL(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const host = current.hostname.toLowerCase();
    if (current.protocol !== "https:" || !(host === source.domain || host.endsWith("." + source.domain))) {
      throw new Error("Feed redirect left the approved HTTPS publisher domain: " + source.id);
    }
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^\d+(?:\.\d+){3}$/.test(host) || host.startsWith("[")) {
      throw new Error("Feed host is not a permitted public publisher hostname: " + source.id);
    }
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "VividCinemaNewsBot/1.0 (+https://vivid-cinema.web.app/news.html)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.9"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("Feed redirected too many times or omitted its redirect target: " + source.id);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error("Feed request failed with HTTP " + response.status + ": " + source.id);
    const contentType = response.headers.get("content-type") || "";
    if (!/(xml|rss|atom|text\/plain)/i.test(contentType)) throw new Error("Publisher feed returned an unexpected content type: " + source.id);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 2_000_000) throw new Error("Publisher feed exceeded the 2 MB limit: " + source.id);
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new Error("Publisher feed exceeded the 2 MB limit: " + source.id);
      return text;
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) {
        await reader.cancel();
        throw new Error("Publisher feed exceeded the 2 MB limit: " + source.id);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("Feed redirect handling failed: " + source.id);
}

async function ingestSource(source) {
  if (!source.approvedForUse || !source.feedUrl) return { source: source.id, skipped: true, reason: "not approved" };
  const feedUrl = new URL(source.feedUrl);
  if (feedUrl.protocol !== "https:" || (feedUrl.hostname !== source.domain && !feedUrl.hostname.endsWith("." + source.domain))) {
    throw new Error("Feed host is not on the approved source domain: " + source.id);
  }
  const xml = await fetchFeedText(source, feedUrl.toString());
  const feed = await parser.parseString(xml);
  let written = 0;
  for (const item of (feed.items || []).slice(0, MAX_ITEMS_PER_SOURCE)) {
    const sourceUrl = canonicalUrl(item.link, source);
    const headline = cleanText(item.title, 240);
    const publishedDate = parsePublishedAt(item);
    if (!sourceUrl || headline.length < 8 || !publishedDate) continue;
    const id = stableId(sourceUrl);
    const articleRef = db.collection("articles").doc(id);
    const summary = cleanText(item.contentSnippet || item.summary || item.content || "", MAX_SUMMARY_LENGTH);
    const tags = [categoryFor(source, item), source.region].filter(Boolean);
    const payload = {
      publisher: source.publisher,
      publisherId: source.id,
      sourceDomain: source.domain,
      sourceUrl,
      headline,
      summary,
      category: categoryFor(source, item),
      region: source.region,
      regionLabel: source.regionLabel,
      tags,
      publishedAt: Timestamp.fromDate(publishedDate),
      ingestedAt: Timestamp.now(),
      status: "published",
      attribution: "Publisher-provided feed metadata",
      imageUrl: null
    };
    // Never download or republish full articles. No feed-provided image is copied
    // until the publisher's image-use terms are explicitly reviewed.
    await articleRef.set(payload, { merge: true });
    written++;
  }
  return { source: source.id, written };
}

export const ingestVividNews = onSchedule({
  schedule: "every 30 minutes",
  timeZone: "UTC",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  maxInstances: 1
}, async () => {
  // This opt-in prevents a deployment from syndicating any feed before source
  // reuse/display terms have been reviewed and the owner explicitly enables it.
  if (process.env.VIVID_NEWS_INGESTION_ENABLED !== "true") {
    logger.info("Vivid News ingestion is disabled; source approval is required.");
    return;
  }
  const sourceSnapshot = await db.collection("newsSources")
    .where("status", "==", "approved")
    .where("feedApproved", "==", true)
    .get();
  const regionLabels = { global: "Global", ghana: "Ghana", nigeria: "Nigeria / Nollywood", africa: "Wider Africa" };
  const approved = sourceSnapshot.docs.map(document => {
    const source = document.data();
    return {
      ...source,
      id: document.id,
      region: source.defaultRegion,
      regionLabel: regionLabels[source.defaultRegion] || "Global",
      category: source.defaultCategory || "industry",
      approvedForUse: source.feedApproved === true
    };
  }).filter(source => source.feedUrl && source.domain && source.publisher);
  if (!approved.length) {
    logger.info("News ingestion has no approved feed sources in the moderator registry.");
    return;
  }
  const results = await Promise.allSettled(approved.map(ingestSource));
  results.forEach((result, index) => {
    if (result.status === "rejected") logger.error("News source ingestion failed", {
      source: approved[index].id,
      message: String(result.reason?.message || result.reason)
    });
    else logger.info("News source ingestion finished", result.value);
  });
});
