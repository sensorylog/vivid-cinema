import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const OUTPUT = "data/news-feed.json";
const FEEDS = [
  { region: "hollywood", category: "film", q: "Hollywood movie film entertainment news when:7d" },
  { region: "hollywood", category: "streaming", q: "Netflix Disney+ streaming television entertainment news when:7d" },
  { region: "india", category: "film", q: "Bollywood Indian cinema entertainment news when:7d" },
  { region: "africa", category: "film", q: "Nollywood Nigerian film entertainment news when:7d" },
  { region: "africa", category: "celebrity", q: "Ghana entertainment movie music celebrity news when:7d" },
  { region: "africa", category: "film", q: "African cinema film festival entertainment news when:7d" },
  { region: "asia", category: "anime", q: "anime manga Japanese animation entertainment news when:7d" },
  { region: "asia", category: "television", q: "K-drama Korean television entertainment news when:7d" },
  { region: "global", category: "box-office", q: "global box office film industry entertainment news when:7d" },
  { region: "global", category: "awards", q: "film television awards entertainment industry news when:7d" }
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
function tag(xml, name) {
  const match = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return match ? decode(match[1]).replace(/<[^>]+>/g, "").trim() : "";
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
    if (!title || !/^https?:\/\//i.test(url)) return null;
    const cleanTitle = title.replace(/\s+-\s+[^-]+$/, "").trim() || title;
    const timestamp = Date.parse(publishedAt);
    return {
      id: stableId(url, cleanTitle), headline: cleanTitle, publisher, publisherUrl,
      sourceUrl: url, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      region: feed.region, category: feed.category
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
}).sort((a,b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)).slice(0, 100);
const payload = JSON.stringify({ generatedAt: new Date().toISOString(), source: "Google News RSS search feeds", count: unique.length, failedQueries: failed.length, articles: unique }, null, 2) + "\n";
await mkdir(dirname(OUTPUT), { recursive: true });
let previous = "";
try { previous = await readFile(OUTPUT, "utf8"); } catch {}
await writeFile(OUTPUT, payload);
console.log("Built " + unique.length + " attributed headlines from " + (FEEDS.length - failed.length) + "/" + FEEDS.length + " RSS queries.");
console.log("Updated feed: " + (payload !== previous));
