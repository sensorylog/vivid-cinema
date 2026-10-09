const { createHash } = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  trimValues: true
});

const MAX_SOURCES_PER_RUN = 40;
const MAX_ITEMS_PER_SOURCE = 20;
const MAX_ARTICLE_AGE_DAYS = 30;
const MAX_FEED_BYTES = 2_000_000;
const FEED_TIMEOUT_MS = 12_000;

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
function textOf(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (value && typeof value === "object") return textOf(value["#text"] ?? value["#cdata"] ?? "");
  return "";
}
function cleanExcerpt(value) {
  return textOf(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}
function parseDate(value) {
  const raw = textOf(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}
function sourceDomainMatches(hostname, domain) {
  const host = String(hostname || "").toLowerCase();
  const base = String(domain || "").toLowerCase();
  return host === base || host.endsWith("." + base);
}
function safeArticleUrl(raw, feedUrl, domain) {
  try {
    const url = new URL(textOf(raw), feedUrl);
    if (url.protocol !== "https:" || !sourceDomainMatches(url.hostname, domain)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return null;
  }
}
function itemLink(item, feedUrl, domain) {
  const links = asArray(item?.link);
  const alternate = links.find(link => link && typeof link === "object" && (!link["@_rel"] || link["@_rel"] === "alternate"));
  const raw = alternate ? alternate["@_href"] : links.length ? textOf(links[0]) : "";
  return safeArticleUrl(raw, feedUrl, domain);
}
function itemImage(item, allowed) {
  if (!allowed || !item) return "";
  const candidates = [
    item.enclosure?.["@_url"],
    item["media:content"]?.["@_url"],
    item["media:thumbnail"]?.["@_url"],
    item.image?.url,
    item.image
  ];
  for (const candidate of candidates) {
    try {
      const url = new URL(textOf(candidate));
      if (url.protocol === "https:") return url.href;
    } catch {}
  }
  return "";
}
function getItems(parsed) {
  if (parsed?.rss?.channel) return asArray(parsed.rss.channel.item);
  if (parsed?.feed) return asArray(parsed.feed.entry);
  return [];
}
function sourceDates(item) {
  const publishedAt = parseDate(item.pubDate || item.published || item.date);
  const updatedAt = parseDate(item.updated || item["dcterms:modified"] || item["dc:date"]);
  return { publishedAt, updatedAt: updatedAt && publishedAt && updatedAt > publishedAt ? updatedAt : publishedAt };
}
function articleId(canonicalUrl) {
  return createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 40);
}
async function fetchFeed(source) {
  const domain = String(source.domain || "").toLowerCase();
  const feedUrl = String(source.feedUrl || "");
  if (!domain || !feedUrl || source.feedApproved !== true) return { source: domain, skipped: true };
  let parsedUrl;
  try {
    parsedUrl = new URL(feedUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname === "localhost" || parsedUrl.hostname.endsWith(".local") || parsedUrl.hostname.endsWith(".internal") || /^[0-9.]+$/.test(parsedUrl.hostname) || parsedUrl.hostname.startsWith("[")) {
      throw new Error("Feed URL must use a public HTTPS host.");
    }
  } catch (error) {
    logger.warn("Approved source has an invalid feed URL", { domain, message: error.message });
    return { source: domain, error: "invalid-feed-url" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        "user-agent": "VividCinemaNewsBot/1.0 (+https://github.com/sensorylog/vivid-cinema)"
      }
    });
    if (!response.ok) throw new Error("Feed returned HTTP " + response.status);
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || !sourceDomainMatches(finalUrl.hostname, parsedUrl.hostname)) {
      throw new Error("Feed redirected outside the approved feed host.");
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_FEED_BYTES) throw new Error("Feed exceeds the size limit.");
    const xml = await response.text();
    if (Buffer.byteLength(xml, "utf8") > MAX_FEED_BYTES) throw new Error("Feed exceeds the size limit.");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Feed contains a disallowed document type declaration.");
    const parsed = parser.parse(xml);
    const items = getItems(parsed).slice(0, MAX_ITEMS_PER_SOURCE);
    const now = Date.now();
    const oldestAllowed = now - MAX_ARTICLE_AGE_DAYS * 86_400_000;
    let created = 0, updated = 0, skipped = 0;

    for (const item of items) {
      const headline = cleanExcerpt(item.title).slice(0, 240);
      const sourceUrl = itemLink(item, finalUrl.href, domain);
      const dates = sourceDates(item);
      if (dates.updatedAt && dates.updatedAt.getTime() > now + 5 * 60_000) dates.updatedAt = dates.publishedAt;
      if (!headline || headline.length < 5 || !sourceUrl || !dates.publishedAt) { skipped++; continue; }
      if (dates.publishedAt.getTime() > now + 5 * 60_000 || dates.publishedAt.getTime() < oldestAllowed) { skipped++; continue; }

      const summary = cleanExcerpt(item.description || item.summary || item["content:encoded"] || item.content || "") ||
        "Open the original report for full details.";
      const id = articleId(sourceUrl);
      const ref = db.collection("articles").doc(id);
      const existing = await ref.get();
      const publishedAt = Timestamp.fromDate(dates.publishedAt);
      const sourceUpdatedAt = Timestamp.fromDate(dates.updatedAt || dates.publishedAt);
      const base = {
        headline,
        publisher: String(source.publisher || "Publisher").slice(0, 120),
        author: cleanExcerpt(item.author || item["dc:creator"] || item.creator).slice(0, 120),
        sourceUrl,
        canonicalUrl: sourceUrl,
        sourceId: domain,
        summary: summary.slice(0, 600),
        body: "",
        imageUrl: itemImage(item, source.imageUsageApproved === true),
        imageAlt: headline,
        category: source.defaultCategory || "film-tv",
        region: source.defaultRegion || "global",
        publishedAt,
        updatedAt: sourceUpdatedAt,
        sourceUpdatedAt,
        ingestedAt: FieldValue.serverTimestamp(),
        status: "published",
        featured: false,
        correction: "",
        topics: [source.defaultCategory || "film-tv", source.defaultRegion || "global"],
        origin: "feed"
      };

      if (existing.exists) {
        const previous = existing.data();
        if (previous.origin !== "feed" || previous.sourceId !== domain) { skipped++; continue; }
        const previousDate = previous.sourceUpdatedAt?.toDate?.() || previous.publishedAt?.toDate?.();
        if (previousDate && dates.updatedAt && dates.updatedAt.getTime() <= previousDate.getTime()) { skipped++; continue; }
        await ref.set(base, { merge: true });
        updated++;
      } else {
        await ref.set(base);
        created++;
      }
    }
    return { source: domain, fetched: items.length, created, updated, skipped };
  } catch (error) {
    logger.warn("Approved feed fetch failed", { domain, message: error?.message || String(error) });
    return { source: domain, error: error?.name === "AbortError" ? "timeout" : "fetch-or-parse-failed" };
  } finally {
    clearTimeout(timeout);
  }
}

exports.syncApprovedNewsFeeds = onSchedule({
  schedule: "every 30 minutes",
  timeZone: "UTC",
  region: "us-central1",
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 1
}, async () => {
  const snapshot = await db.collection("newsSources").where("status", "==", "approved").where("feedApproved", "==", true).limit(MAX_SOURCES_PER_RUN).get();
  const sources = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(source => source.feedApproved === true && typeof source.feedUrl === "string" && source.feedUrl.length > 0);
  const results = [];
  for (const source of sources) results.push(await fetchFeed(source));
  logger.info("Vivid News ingestion run complete", {
    approvedFeeds: sources.length,
    created: results.reduce((n, r) => n + (r.created || 0), 0),
    updated: results.reduce((n, r) => n + (r.updated || 0), 0),
    errors: results.filter(r => r.error).length,
    sources: results
  });
});