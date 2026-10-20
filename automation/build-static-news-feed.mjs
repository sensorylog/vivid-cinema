import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cacheArticleThumbnails, decodeGoogleNewsArticleUrl, extractHtmlImageUrl, extractPublisherArticleUrl, extractRssImageUrl, isArticleImageUrl, sortStoriesNewestFirst } from "./static-news-images.mjs";
import { dirname } from "node:path";

const OUTPUT = "data/news-feed.json";
const FEEDS = [
  { region: "hollywood", category: "film", q: "Hollywood movie film studio entertainment news when:3d" },
  { region: "hollywood", category: "television", q: "US television series TV entertainment news when:3d" },
  { region: "hollywood", category: "streaming", q: "Netflix Disney+ Max Prime Video streaming news when:3d" },
  { region: "hollywood", category: "celebrity", q: "Hollywood actors celebrities entertainment news when:3d" },
  { region: "global", category: "music", q: "film soundtrack music industry artist entertainment news when:3d" },
  { region: "global", category: "gaming", q: "video game industry gaming entertainment news when:3d" },
  { region: "asia", category: "anime", q: "anime manga Japanese animation entertainment news when:3d" },
  { region: "asia", category: "television", q: "K-drama Korean television entertainment news when:3d" },
  { region: "global", category: "box-office", q: "global box office weekend film industry news when:3d" },
  { region: "global", category: "festivals", q: "film festival premieres cinema festival news when:3d" },
  { region: "global", category: "awards", q: "film television awards entertainment industry news when:3d" },
  { region: "global", category: "business", q: "Hollywood film studio streaming entertainment business industry deals news when:3d" },
  { region: "india", category: "film", q: "Bollywood Indian cinema entertainment news when:3d" },
  { region: "india", category: "music", q: "Indian film music Bollywood music industry news when:3d" },
  { region: "africa", category: "film", q: "Nollywood Nigerian film entertainment news when:3d" },
  { region: "africa", category: "celebrity", q: "Ghana entertainment movie music celebrity news when:3d" },
  { region: "africa", category: "film", q: "African cinema film festival entertainment news when:3d" },
  { region: "europe", category: "film", q: "European cinema film production entertainment news when:3d" },
  { region: "europe", category: "television", q: "UK European television streaming entertainment news when:3d" },
  { region: "latin-america", category: "film", q: "Latin American cinema Mexican Brazilian film entertainment news when:3d" },
  { region: "middle-east", category: "film", q: "Middle East Arab cinema film entertainment news when:3d" }
];

function decode(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}
function rawTag(xml, name) {
  const match = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return match ? decode(match[1]).trim() : "";
}
function tag(xml, name) {
  return rawTag(xml, name).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function attr(xml, name) {
  const match = xml.match(new RegExp("\\b" + name + '="([^"]*)"', "i"));
  return match ? decode(match[1]) : "";
}
function stableId(url, title) {
  let hash = 2166136261;
  for (const char of (url || title)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
async function fetchFeed(feed) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(feed.q) + "&hl=en-GH&gl=GH&ceid=GH:en";
  const response = await fetch(url, { headers: { "User-Agent": "VividCinemaNews/1.0 (+https://vivid-cinema.web.app/news.html)", "Accept": "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("RSS HTTP " + response.status + " for " + feed.region + "/" + feed.category);
  const xml = await response.text();
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([, item]) => {
    const title = tag(item, "title");
    const url = tag(item, "link");
    const sourceTag = item.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const publisher = sourceTag ? decode(sourceTag[2]).replace(/<[^>]+>/g, "").trim() : "News publisher";
    const publisherUrl = sourceTag ? attr(sourceTag[1], "url") : "";
    const publishedAt = tag(item, "pubDate");
    const rawDescription = rawTag(item, "description");
    const imageUrl = extractRssImageUrl(item, rawDescription, url);
    const summary = rawDescription.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|#160|#xA0);/gi, " ")
      .replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const cleanedSummary = publisher && summary.toLowerCase().endsWith(publisher.toLowerCase())
      ? summary.slice(0, -publisher.length).replace(/[\s|–—-]+$/, "").trim()
      : summary;
    if (!title || !/^https?:\/\//i.test(url)) return null;
    const cleanTitle = title.replace(/\s+-\s+[^-]+$/, "").trim() || title;
    const timestamp = Date.parse(publishedAt);
    return {
      id: stableId(url, cleanTitle), headline: cleanTitle, publisher, publisherUrl,
      sourceUrl: url, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      region: feed.region, category: feed.category, summary: cleanedSummary.slice(0, 1800), imageUrl
    };
  }).filter(Boolean);
}


function metaValue(html, names) {
  const wanted = new Set(names.map(value => value.toLowerCase()));
  for (const meta of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = meta.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!key || !wanted.has(key)) continue;
    const value = meta.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (value) return decode(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function isPublisherArticleUrl(value, publisherUrl) {
  try {
    const candidate = new URL(value);
    const publisher = new URL(publisherUrl);
    const host = candidate.hostname.toLowerCase().replace(/^www\./, "");
    const publisherHost = publisher.hostname.toLowerCase().replace(/^www\./, "");
    return candidate.protocol === "https:" &&
      (host === publisherHost || host.endsWith("." + publisherHost));
  } catch {
    return false;
  }
}

const MAX_GOOGLE_URL_RESOLVE_ATTEMPTS = 12;
let googleUrlResolveAttempts = 0;

async function enrichArticle(story) {
  const baseSummary = story.summary || "";
  const hasUsefulSummary = baseSummary.length > 100 &&
    baseSummary.toLowerCase() !== String(story.headline || "").toLowerCase();
  const imageHost = (() => {
    try { return new URL(story.imageUrl).hostname.toLowerCase(); } catch { return ""; }
  })();
  const isGoogleHostedImage = /(?:^|\.)(?:googleusercontent\.com|gstatic\.com|google\.com)$/.test(imageHost);
  const needsImage = !isArticleImageUrl(story.imageUrl, story.sourceUrl) || isGoogleHostedImage;
  if (hasUsefulSummary && !needsImage) return story;
  try {
    const response = await fetch(story.sourceUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VividCinemaNews/1.0; +https://vivid-cinema.web.app/news.html)",
        "Accept": "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) return story;
    let html = (await response.text()).slice(0, 1200000);
    let sourceUrl = story.sourceUrl;
    let landedOnGoogleNews = false;
    try {
      const finalUrl = new URL(response.url);
      landedOnGoogleNews = /(^|\.)news\.google\.com$/i.test(finalUrl.hostname);
      if (finalUrl.protocol === "https:" && !landedOnGoogleNews) sourceUrl = finalUrl.href;
    } catch {}

    // Google News RSS links can land on a wrapper page rather than the publisher article.
    if (landedOnGoogleNews) {
      let publisherArticleUrl = "";
      const hasGoogleSignature = /\bdata-n-a-sg\s*=\s*["'][^"']+["']/i.test(html) &&
        /\bdata-n-a-ts\s*=\s*["']\d+["']/i.test(html);
      if (hasGoogleSignature && googleUrlResolveAttempts < MAX_GOOGLE_URL_RESOLVE_ATTEMPTS) {
        googleUrlResolveAttempts += 1;
        const decodedUrl = await decodeGoogleNewsArticleUrl(story.sourceUrl, html);
        if (isPublisherArticleUrl(decodedUrl, story.publisherUrl)) publisherArticleUrl = decodedUrl;
      }
      if (!publisherArticleUrl) {
        publisherArticleUrl = extractPublisherArticleUrl(html, response.url || story.sourceUrl, story.publisherUrl);
      }
      if (publisherArticleUrl) {
        try {
          const publisherResponse = await fetch(publisherArticleUrl, {
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; VividCinemaNews/1.0; +https://vivid-cinema.web.app/news.html)",
              "Accept": "text/html,application/xhtml+xml"
            },
            signal: AbortSignal.timeout(5000)
          });
          if (publisherResponse.ok && /text\/html|application\/xhtml\+xml/i.test(publisherResponse.headers.get("content-type") || "")) {
            html = (await publisherResponse.text()).slice(0, 1200000);
            const finalPublisherUrl = new URL(publisherResponse.url || publisherArticleUrl);
            if (finalPublisherUrl.protocol === "https:" && !/(^|\.)news\.google\.com$/i.test(finalPublisherUrl.hostname)) {
              sourceUrl = finalPublisherUrl.href;
              landedOnGoogleNews = false;
            }
          }
        } catch {}
      }
    }

    const description = metaValue(html, ["og:description", "twitter:description", "description"]);
    const imageValue = extractHtmlImageUrl(html, sourceUrl);
    let imageUrl = needsImage ? (isGoogleHostedImage ? (story.imageUrl || "") : "") : (story.imageUrl || "");
    try {
      const candidate = new URL(imageValue, sourceUrl);
      const candidateHost = candidate.hostname.toLowerCase();
      const googleHostedCandidate = /(?:^|\.)(?:googleusercontent\.com|gstatic\.com|google\.com)$/.test(candidateHost);
      if (candidate.protocol === "https:" && !(landedOnGoogleNews && googleHostedCandidate)) imageUrl = candidate.href;
    } catch {}
    const usefulDescription = description.length > 40 &&
      description.toLowerCase() !== String(story.headline || "").toLowerCase();
    return {
      ...story,
      sourceUrl,
      summary: usefulDescription ? description.slice(0, 700) : baseSummary,
      imageUrl
    };
  } catch {
    return story;
  }
}
async function enrichStories(stories) {
  const enriched = [];
  for (let index = 0; index < stories.length; index += 12) {
    const batch = await Promise.all(stories.slice(index, index + 12).map(enrichArticle));
    enriched.push(...batch);
  }
  return enriched;
}

const batches = await Promise.allSettled(FEEDS.map(fetchFeed));
const failed = batches.filter(x => x.status === "rejected");
const stories = batches.filter(x => x.status === "fulfilled").flatMap(x => x.value);
if (!stories.length) {
  throw new Error("Every news RSS query failed; refusing to overwrite the last working feed. Failures: " + failed.map(x => String(x.reason)).join(" | "));
}
const seen = new Set();
const freshnessCutoff = Date.now() - 72 * 60 * 60 * 1000;
const unique = sortStoriesNewestFirst(stories).filter(story => {
  const timestamp = Date.parse(story.publishedAt || "");
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60 * 1000 && timestamp >= freshnessCutoff;
}).filter(story => {
  const key = story.headline.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
if (!unique.length) {
  throw new Error("No valid headlines from the last 72 hours; refusing to overwrite the previous feed.");
}
// Reserve space for every topic/region before filling remaining slots by recency.
const selected = [];
const selectedIds = new Set();
for (const feed of FEEDS) {
  const batch = unique.filter(story => story.region === feed.region && story.category === feed.category && !selectedIds.has(story.id)).slice(0, 4);
  for (const story of batch) { selected.push(story); selectedIds.add(story.id); }
}
for (const story of unique) {
  if (selected.length >= 120) break;
  if (!selectedIds.has(story.id)) { selected.push(story); selectedIds.add(story.id); }
}
const enrichedStories = await enrichStories(sortStoriesNewestFirst(selected).slice(0, 120));
const { stories: cachedStories, cached: cachedImageCount, remoteFallback: remoteFallbackCount, missing: missingImageCount } = await cacheArticleThumbnails(enrichedStories);
const finalStories = sortStoriesNewestFirst(cachedStories);
const payload = JSON.stringify({ generatedAt: new Date().toISOString(), source: "Google News RSS search feeds", count: finalStories.length, failedQueries: failed.length, feedCount: FEEDS.length, articles: finalStories }, null, 2) + "\n";
await mkdir(dirname(OUTPUT), { recursive: true });
let previous = "";
try { previous = await readFile(OUTPUT, "utf8"); } catch {}
await writeFile(OUTPUT, payload);
console.log("Built " + unique.length + " attributed headlines from " + (FEEDS.length - failed.length) + "/" + FEEDS.length + " RSS queries.");
console.log("Article thumbnails: " + cachedImageCount + " cached locally, " + remoteFallbackCount + " remote fallback, " + missingImageCount + " without an image source (of " + finalStories.length + ").");
console.log("Updated feed: " + (payload !== previous));
