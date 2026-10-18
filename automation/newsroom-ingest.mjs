import { createHash } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS_PER_FEED = 30;
const MAX_AGE_DAYS = 14;
const FETCH_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const ALLOWED_REGIONS = new Set(["global", "hollywood", "india", "africa", "asia", "europe", "latin-america", "middle-east", "ghana", "nigeria"]);
const ALLOWED_CATEGORIES = new Set(["film", "television", "streaming", "music", "gaming", "anime", "animation", "box-office", "celebrity", "trailers", "awards", "festivals", "production", "business", "legal", "industry", "comics", "theatre", "podcasts", "creators", "africa", "india", "asia", "hollywood", "europe", "latin-america", "middle-east", "ghana", "nollywood"]);

export function decodeXml(value = "") {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => Object.hasOwn(named, name.toLowerCase()) ? named[name.toLowerCase()] : match);
}

export function cleanExcerpt(value = "", maxLength = 450) {
  const plain = decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  const clipped = plain.slice(0, maxLength - 1);
  const boundary = clipped.lastIndexOf(" ");
  return (boundary > maxLength * 0.65 ? clipped.slice(0, boundary) : clipped).trim() + "…";
}

function tag(block, name) {
  const escaped = name.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp("<(?:[A-Za-z0-9_-]+:)?" + escaped + "\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?" + escaped + "\\s*>", "i"));
  return match ? match[1].trim() : "";
}

function firstTag(block, names) {
  for (const name of names) {
    const value = tag(block, name);
    if (value) return value;
  }
  return "";
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  for (const match of links) {
    const attrs = match[1];
    const rel = (attrs.match(/\brel=["']([^"']+)["']/i) || [])[1] || "alternate";
    const href = (attrs.match(/\bhref=["']([^"']+)["']/i) || [])[1] || "";
    if (href && rel === "alternate") return decodeXml(href);
  }
  return "";
}

export function isAllowedPublisherUrl(value, domain) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const expected = String(domain || "").toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && !url.port && !url.username && !url.password && Boolean(expected) && host === expected;
  } catch {
    return false;
  }
}

export function isAllowedFeedUrl(value, domain) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const expected = String(domain || "").toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && !url.port && !url.username && !url.password && Boolean(expected) && (host === expected || host.endsWith("." + expected));
  } catch {
    return false;
  }
}

export function normalizeStoryUrl(value, domain) {
  if (!isAllowedPublisherUrl(value, domain)) return "";
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

export function parseFeedXml(xml, source) {
  const input = String(xml || "");
  const itemBlocks = [...input.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)].map(match => match[2]);
  const seen = new Set();
  const output = [];
  for (const block of itemBlocks) {
    const headline = cleanExcerpt(firstTag(block, ["title"]), 240);
    const rawLink = firstTag(block, ["link"]) || atomLink(block);
    const sourceUrl = normalizeStoryUrl(decodeXml(rawLink), source.domain);
    const rawDate = firstTag(block, ["pubDate", "published", "updated", "date"]);
    const publishedAt = rawDate ? new Date(rawDate) : null;
    const author = cleanExcerpt(firstTag(block, ["creator", "author"]), 120);
    const excerpt = cleanExcerpt(firstTag(block, ["description", "summary", "content:encoded", "content"]), 450);
    if (!headline || headline.length < 8 || !sourceUrl || !publishedAt || Number.isNaN(publishedAt.getTime())) continue;
    const canonicalUrl = sourceUrl;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    output.push({
      headline,
      publisher: String(source.publisher || "").slice(0, 120),
      author,
      sourceUrl,
      canonicalUrl,
      sourceId: source.domain,
      category: ALLOWED_CATEGORIES.has(source.defaultCategory) ? source.defaultCategory : "industry",
      region: ALLOWED_REGIONS.has(source.defaultRegion) ? source.defaultRegion : "global",
      excerpt,
      publishedAt
    });
    if (output.length >= MAX_ITEMS_PER_FEED) break;
  }
  return output;
}

export function queueDocumentId(sourceId, canonicalUrl) {
  return createHash("sha256").update(String(sourceId) + "\n" + String(canonicalUrl)).digest("hex");
}

async function readResponseLimited(response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_FEED_BYTES) throw new Error("Feed exceeded the 2 MB size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error("Feed exceeded the 2 MB size limit.");
    }
    chunks.push(part.value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

export async function fetchApprovedFeed(feedUrl, domain, fetchImpl = fetch) {
  let current = new URL(feedUrl);
  if (!isAllowedFeedUrl(current.href, domain)) throw new Error("Feed URL must be HTTPS on the approved publisher domain.");
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(current.href, {
      method: "GET",
      headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9", "User-Agent": "VividCinemaNewsroom/1.0 (+editorial source discovery)" },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === MAX_REDIRECTS) throw new Error("Feed exceeded the redirect limit.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Feed redirect omitted its location.");
      current = new URL(location, current);
      if (!isAllowedFeedUrl(current.href, domain)) throw new Error("Feed redirected outside the approved publisher domain.");
      continue;
    }
    if (!response.ok) throw new Error("Feed returned HTTP " + response.status + ".");
    const xml = await readResponseLimited(response);
    if (!/<(?:[A-Za-z0-9_-]+:)?(?:rss|feed|RDF)\b/i.test(xml.slice(0, 12000))) throw new Error("Response did not contain an RSS or Atom feed document.");
    return xml;
  }
  throw new Error("Feed could not be fetched.");
}

function isRecentDate(date, now = new Date()) {
  const age = now.getTime() - date.getTime();
  return age >= -5 * 60 * 1000 && age <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function validSource(source, domain) {
  return source &&
    source.status === "approved" &&
    source.domain === domain &&
    source.feedApproved === true &&
    source.ingestionEnabled === true &&
    typeof source.publisher === "string" &&
    source.publisher.trim().length >= 2 &&
    typeof source.feedUrl === "string" &&
    isAllowedFeedUrl(source.feedUrl, domain);
}

export async function runIngestion({ apply = false, db, fetchImpl = fetch, now = new Date(), log = console.log } = {}) {
  if (!db) throw new Error("A Firestore Admin database instance is required.");
  const sourcesSnapshot = await db.collection("newsSources").where("status", "==", "approved").get();
  const sources = sourcesSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(source => validSource(source, source.id));
  const stats = { enabledSources: sources.length, feedsFetched: 0, candidatesFound: 0, staged: 0, duplicates: 0, skipped: 0, errors: [] };
  const runId = now.toISOString();
  for (const source of sources) {
    try {
      const xml = await fetchApprovedFeed(source.feedUrl, source.id, fetchImpl);
      stats.feedsFetched += 1;
      const candidates = parseFeedXml(xml, source).filter(item => isRecentDate(item.publishedAt, now));
      stats.candidatesFound += candidates.length;
      for (const item of candidates) {
        const id = queueDocumentId(source.id, item.canonicalUrl);
        const ref = db.collection("newsQueue").doc(id);
        const queueData = {
          ...item,
          excerpt: cleanExcerpt(item.excerpt, 450),
          publishedAt: Timestamp.fromDate(item.publishedAt),
          discoveredAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          status: "pending_review",
          ingestRunId: runId
        };
        if (!apply) {
          stats.staged += 1;
          log("[dry-run] candidate " + source.publisher + " | " + item.headline + " | " + item.canonicalUrl);
          continue;
        }
        try {
          await ref.create(queueData);
          stats.staged += 1;
        } catch (error) {
          if (error?.code === 6 || error?.code === "already-exists" || error?.code === "ALREADY_EXISTS") {
            stats.duplicates += 1;
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      stats.errors.push({ source: source.publisher || source.id, message: String(error?.message || error).slice(0, 300) });
      log("[source-error] " + source.id + ": " + String(error?.message || error));
    }
  }
  log(JSON.stringify(stats, null, 2));
  return stats;
}

async function main() {
  const rawCredentials = process.env.VIVID_NEWS_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) throw new Error("Missing VIVID_NEWS_SERVICE_ACCOUNT_JSON. Configure the GitHub Actions repository secret.");
  const credentials = JSON.parse(rawCredentials);
  if (!credentials.project_id || !credentials.client_email || !credentials.private_key) {
    throw new Error("The Firebase service account JSON is missing required fields.");
  }
  const app = initializeApp({ credential: cert(credentials), projectId: credentials.project_id });
  const db = getFirestore(app);
  const apply = process.argv.includes("--apply");
  if (!apply) console.log("Dry run only. Pass --apply to stage candidates in Firestore.");
  const stats = await runIngestion({ apply, db });
  if (stats.errors.length) process.exitCode = 1;
}

if (process.env.VIVID_NEWS_INGESTION_CLI === "true") {
  main().catch(error => {
    console.error("Newsroom ingestion stopped:", String(error?.message || error));
    process.exitCode = 1;
  });
}
