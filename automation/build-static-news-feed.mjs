import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const OUTPUT = "data/news-feed.json";
const FEEDS = [
  { region: "hollywood", category: "film", q: "Hollywood movie film studio entertainment news when:7d" },
  { region: "hollywood", category: "television", q: "US television series TV entertainment news when:7d" },
  { region: "hollywood", category: "streaming", q: "Netflix Disney+ Max Prime Video streaming news when:7d" },
  { region: "hollywood", category: "celebrity", q: "Hollywood actors celebrities entertainment news when:7d" },
  { region: "global", category: "music", q: "film soundtrack music industry artist entertainment news when:7d" },
  { region: "global", category: "gaming", q: "video game industry gaming entertainment news when:7d" },
  { region: "asia", category: "anime", q: "anime manga Japanese animation entertainment news when:7d" },
  { region: "asia", category: "television", q: "K-drama Korean television entertainment news when:7d" },
  { region: "global", category: "box-office", q: "global box office weekend film industry news when:7d" },
  { region: "global", category: "festivals", q: "film festival premieres cinema festival news when:7d" },
  { region: "global", category: "awards", q: "film television awards entertainment industry news when:7d" },
  { region: "global", category: "business", q: "Hollywood film studio streaming entertainment business industry deals news when:7d" },
  { region: "india", category: "film", q: "Bollywood Indian cinema entertainment news when:7d" },
  { region: "india", category: "music", q: "Indian film music Bollywood music industry news when:7d" },
  { region: "africa", category: "film", q: "Nollywood Nigerian film entertainment news when:7d" },
  { region: "africa", category: "celebrity", q: "Ghana entertainment movie music celebrity news when:7d" },
  { region: "africa", category: "film", q: "African cinema film festival entertainment news when:7d" },
  { region: "europe", category: "film", q: "European cinema film production entertainment news when:7d" },
  { region: "europe", category: "television", q: "UK European television streaming entertainment news when:7d" },
  { region: "latin-america", category: "film", q: "Latin American cinema Mexican Brazilian film entertainment news when:7d" },
  { region: "middle-east", category: "film", q: "Middle East Arab cinema film entertainment news when:7d" }
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
    const imageMatch = rawDescription.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    let imageUrl = "";
    try {
      const candidate = new URL(imageMatch?.[1] || "");
      if (candidate.protocol === "https:") imageUrl = candidate.href;
    } catch {}
    const summary = rawDescription.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, " ").trim().slice(0, 1800);
    if (!title || !/^https?:\/\//i.test(url)) return null;
    const cleanTitle = title.replace(/\s+-\s+[^-]+$/, "").trim() || title;
    const timestamp = Date.parse(publishedAt);
    return {
      id: stableId(url, cleanTitle), headline: cleanTitle, publisher, publisherUrl,
      sourceUrl: url, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      region: feed.region, category: feed.category, summary, imageUrl
    };
  }).filter(Boolean);
}

const batches = await Promise.allSettled(FEEDS.map(fetchFeed));
const failed = batches.filter(x => x.status === "rejected");
const stories = batches.filter(x => x.status === "fulfilled").flatMap(x => x.value);
if (!stories.length) {
  throw new Error("Every news RSS query failed; refusing to overwrite the last working feed. Failures: " + failed.map(x => String(x.reason)).join(" | "));
}
const seen = new Set();
const unique = stories.filter(story => {
  const key = story.headline.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).sort((a,b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
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
const finalStories = selected.slice(0, 120);
const payload = JSON.stringify({ generatedAt: new Date().toISOString(), source: "Google News RSS search feeds", count: finalStories.length, failedQueries: failed.length, feedCount: FEEDS.length, articles: finalStories }, null, 2) + "\n";
await mkdir(dirname(OUTPUT), { recursive: true });
let previous = "";
try { previous = await readFile(OUTPUT, "utf8"); } catch {}
await writeFile(OUTPUT, payload);
console.log("Built " + unique.length + " attributed headlines from " + (FEEDS.length - failed.length) + "/" + FEEDS.length + " RSS queries.");
console.log("Updated feed: " + (payload !== previous));
