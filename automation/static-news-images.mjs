import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const MAX_IDENTICAL = 1;

const decode = value => String(value || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function attribute(attrs, name) {
  const match = String(attrs || "").match(new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"));
  return match ? decode(match[2]).trim() : "";
}

export function sortStoriesNewestFirst(stories = []) {
  const timestamp = value => {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  return [...stories].sort((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt));
}

function safeImageUrl(value, baseUrl = "") {
  if (!value) return "";
  try {
    const url = new URL(decode(value), baseUrl || undefined);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (/(?:^|[\/_-])(?:logo|avatar|favicon|sprite|tracking|pixel|placeholder|blank|gravatar)(?:[\/_-]|\.)/i.test(url.pathname)) return "";
    const host = url.hostname.toLowerCase();
    if (/(?:^|\.)googleusercontent\.com$/i.test(host)) {
      const path = url.pathname.replace(/^\/+/, "");
      if (/^J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrp/i.test(path)) return "";
      // Google News uses short opaque Googleusercontent paths for its generic source icon.
      if (path.length < 40 && !path.includes("/")) return "";
    }
    if (/(?:^|\.)gstatic\.com$/i.test(host) && /(?:icons?|logo|branding|googlelogo|google_logo)/i.test(url.pathname)) return "";
    if (/^(?:news\.)?google\.com$/i.test(url.hostname) &&
        /(?:branding|logo|favicon)/i.test(url.pathname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function isArticleImageUrl(value, baseUrl = "") {
  return Boolean(safeImageUrl(value, baseUrl));
}

function imageExtension(contentType, bytes) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (type === "image/png" && bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (type === "image/webp" && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  if (type === "image/avif" && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" &&
      /^(?:avif|avis)$/.test(String.fromCharCode(...bytes.slice(8, 12)))) return "avif";
  if (type === "image/gif" && /^(?:GIF87a|GIF89a)$/.test(String.fromCharCode(...bytes.slice(0, 6)))) return "gif";
  return "";
}

export async function cacheArticleThumbnails(stories = [], {
  outputDir = "data/news-thumbnails",
  publicPathPrefix = "./data/news-thumbnails",
  fetchImpl = globalThis.fetch,
  maxBytes = 1_500_000
} = {}) {
  await mkdir(outputDir, { recursive: true });
  let cached = 0;
  let remoteFallback = 0;
  let missing = 0;
  const results = [];
  const contentHashes = new Array(stories.length).fill("");
  const cachedFiles = new Array(stories.length).fill("");
  for (let index = 0; index < stories.length; index += 12) {
    const batch = await Promise.all(stories.slice(index, index + 12).map(async (story, offset) => {
      const storyIndex = index + offset;
      const remoteUrl = safeImageUrl(story.imageUrl, story.sourceUrl);
      if (!remoteUrl) { missing += 1; return { ...story, imageUrl: "", imageFallbackUrl: "" }; }
      try {
        const headers = {
          "User-Agent": "Mozilla/5.0 (compatible; VividCinemaNews/1.0; +https://vivid-cinema.web.app/news.html)",
          "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        };
        for (const candidate of [story.sourceUrl, story.publisherUrl]) {
          try {
            const source = new URL(candidate);
            if (source.protocol === "https:" && !/(^|\.)news\.google\.com$/i.test(source.hostname)) {
              headers.Referer = source.href;
              break;
            }
          } catch {}
        }
        const response = await fetchImpl(remoteUrl, {
          redirect: "follow",
          headers,
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) { remoteFallback += 1; return { ...story, imageUrl: remoteUrl, imageFallbackUrl: remoteUrl }; }
        const contentType = response.headers.get("content-type") || "";
        if (!/^image\/(?:jpeg|png|webp|avif|gif)(?:\s*;|$)/i.test(contentType)) {
          remoteFallback += 1; return { ...story, imageUrl: remoteUrl, imageFallbackUrl: remoteUrl };
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        contentHashes[storyIndex] = createHash("sha256").update(bytes).digest("hex");
        if (bytes.length < 1024 || bytes.length > maxBytes) { remoteFallback += 1; return { ...story, imageUrl: remoteUrl, imageFallbackUrl: remoteUrl }; }
        const extension = imageExtension(contentType, bytes);
        if (!extension) { remoteFallback += 1; return { ...story, imageUrl: remoteUrl, imageFallbackUrl: remoteUrl }; }
        const id = String(story.id || "").replace(/[^a-z0-9_-]/gi, "");
        if (!id) return { ...story, imageUrl: "", imageFallbackUrl: "" };
        const filename = id + "." + extension;
        cachedFiles[storyIndex] = join(outputDir, filename);
        await writeFile(cachedFiles[storyIndex], bytes);
        cached += 1;
        return { ...story, imageUrl: publicPathPrefix.replace(/\/$/, "") + "/" + filename, imageFallbackUrl: remoteUrl };
      } catch {
        remoteFallback += 1;
        return { ...story, imageUrl: remoteUrl, imageFallbackUrl: remoteUrl };
      }
    }));
    results.push(...batch);
  }

  const indicesByHash = new Map();
  contentHashes.forEach((digest, index) => {
    if (!digest) return;
    const indices = indicesByHash.get(digest) || [];
    indices.push(index);
    indicesByHash.set(digest, indices);
  });
  const duplicateIndices = [...indicesByHash.values()].filter(indices => indices.length > MAX_IDENTICAL).flat();
  for (const index of duplicateIndices) {
    if (cachedFiles[index]) await rm(cachedFiles[index], { force: true });
    if (cachedFiles[index]) cached -= 1;
    results[index] = { ...results[index], imageUrl: "", imageFallbackUrl: "" };
    missing += 1;
  }
  return { stories: results, cached, remoteFallback, missing };
}

export function extractRssImageUrl(item = "", description = "", baseUrl = "") {
  const xml = String(item || "") + "\n" + String(description || "");
  const candidates = [];
  for (const match of xml.matchAll(/<(?:media:)?(?:content|thumbnail)\b([^>]*)\/?\s*>/gi)) {
    const attrs = match[1];
    candidates.push(attribute(attrs, "url"), attribute(attrs, "href"), attribute(attrs, "src"));
  }
  for (const match of xml.matchAll(/<enclosure\b([^>]*)\/?\s*>/gi)) {
    const attrs = match[1];
    const type = attribute(attrs, "type").toLowerCase();
    const url = attribute(attrs, "url");
    if (type.startsWith("image/") || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(url)) candidates.push(url);
  }
  for (const match of xml.matchAll(/<(?:itunes:)?image\b([^>]*)\/?\s*>/gi)) {
    const attrs = match[1];
    candidates.push(attribute(attrs, "href"), attribute(attrs, "url"), attribute(attrs, "src"));
  }
  for (const match of xml.matchAll(/<(?:img|source)\b([^>]*)>/gi)) {
    const attrs = match[1];
    candidates.push(
      attribute(attrs, "data-src"),
      attribute(attrs, "data-lazy-src"),
      attribute(attrs, "data-original"),
      attribute(attrs, "src")
    );
    const srcset = attribute(attrs, "data-srcset") || attribute(attrs, "srcset");
    if (srcset) {
      const best = srcset.split(",").map(part => part.trim()).filter(Boolean).map(part => {
        const pieces = part.split(/\s+/);
        const score = Number.parseInt(pieces[1], 10) || 0;
        return {url: pieces[0], score};
      }).sort((a, b) => b.score - a.score)[0];
      if (best?.url) candidates.push(best.url);
    }
  }
  for (const candidate of candidates) {
    const image = safeImageUrl(candidate, baseUrl);
    if (image) return image;
  }
  return "";
}

export async function decodeGoogleNewsArticleUrl(articleUrl = "", articleHtml = "", { fetchImpl = globalThis.fetch } = {}) {
  let parsed;
  try { parsed = new URL(articleUrl); } catch { return ""; }
  if (!/(^|\.)news\.google\.com$/i.test(parsed.hostname)) return "";
  const id = parsed.pathname.match(/\/(?:rss\/)?articles\/([^/]+)/i)?.[1] || parsed.pathname.match(/\/read\/([^/]+)/i)?.[1] || "";
  if (!id) return "";
  const markup = String(articleHtml || "");
  const signature = markup.match(/\bdata-n-a-sg\s*=\s*["']([^"']+)["']/i)?.[1] || "";
  const timestamp = Number(markup.match(/\bdata-n-a-ts\s*=\s*["'](\d+)["']/i)?.[1] || 0);
  if (!signature || !Number.isFinite(timestamp) || timestamp <= 0 || typeof fetchImpl !== "function") return "";
  const inner = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, timestamp, signature]);
  const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner]]]));
  try {
    const response = await fetchImpl("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://news.google.com",
        "Referer": "https://news.google.com/",
        "X-Same-Domain": "1",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        "Cookie": "CONSENT=PENDING+987"
      },
      body,
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return "";
    const raw = await response.text();
    const separator = raw.indexOf("\n\n");
    if (separator < 0) return "";
    const frames = JSON.parse(raw.slice(separator + 2).trim());
    const frameList = Array.isArray(frames) && Array.isArray(frames[0]) && Array.isArray(frames[0][0]) ? frames.flat() : frames;
    const frame = Array.isArray(frameList) ? frameList.find(item => Array.isArray(item) && item[0] === "wrb.fr" && item[1] === "Fbv4je" && typeof item[2] === "string") : null;
    if (!frame) return "";
    const decoded = JSON.parse(frame[2]);
    const result = Array.isArray(decoded) && decoded[0] === "garturlres" ? String(decoded[1] || "") : "";
    const url = new URL(result);
    return url.protocol === "https:" && !/(^|\.)news\.google\.com$/i.test(url.hostname) ? url.href : "";
  } catch {
    return "";
  }
}

export function extractPublisherArticleUrl(html = "", baseUrl = "", publisherUrl = "") {
  const markup = String(html || "").slice(0, 1_200_000);
  let publisherHost = "";
  try { publisherHost = new URL(publisherUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch {}
  if (!publisherHost) return "";
  const resolvePublisherUrl = value => {
    try {
      const url = new URL(value, baseUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (url.protocol !== "https:" || url.username || url.password) return "";
      if (!(host === publisherHost || host.endsWith("." + publisherHost))) return "";
      if (url.pathname === "/" || /\/(?:search|feed|rss|tags?|topics?|authors?|privacy|terms)(?:[/.]|$)/i.test(url.pathname)) return "";
      return url.href;
    } catch { return ""; }
  };
  const candidates = [];
  for (const match of markup.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (/canonical/i.test(attribute(attrs, "rel"))) candidates.push(attribute(attrs, "href"));
  }
  for (const match of markup.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1];
    const key = (attribute(attrs, "property") || attribute(attrs, "name") || "").toLowerCase();
    if (key === "og:url") candidates.push(attribute(attrs, "content"));
  }
  for (const match of markup.matchAll(/<a\b([^>]*)>/gi)) candidates.push(attribute(match[1], "href"));
  for (const candidate of candidates) {
    const resolved = resolvePublisherUrl(candidate);
    if (resolved) return resolved;
  }
  return "";
}

export function extractHtmlImageUrl(html = "", baseUrl = "") {
  const markup = String(html || "").slice(0, 1_200_000);
  const wanted = ["og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"];
  const metas = [];
  for (const match of markup.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1];
    const key = (attribute(attrs, "property") || attribute(attrs, "name") || attribute(attrs, "itemprop")).toLowerCase();
    const content = attribute(attrs, "content");
    if (key && content) metas.push({key, content});
  }
  for (const key of wanted) {
    const found = metas.find(meta => meta.key === key);
    const image = safeImageUrl(found?.content, baseUrl);
    if (image) return image;
  }
  for (const match of markup.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (/image_src/i.test(attribute(attrs, "rel"))) {
      const image = safeImageUrl(attribute(attrs, "href"), baseUrl);
      if (image) return image;
    }
  }
  for (const match of markup.matchAll(/"image"\s*:\s*(?:\[\s*)?"([^"]+)"/gi)) {
    const image = safeImageUrl(match[1], baseUrl);
    if (image) return image;
  }
  const candidates = [];
  for (const match of markup.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const context = [
      attribute(attrs, "alt"), attribute(attrs, "class"),
      attribute(attrs, "id"), attribute(attrs, "title")
    ].join(" ").toLowerCase();
    if (/(?:logo|avatar|favicon|icon|sprite|tracking|pixel|placeholder|spinner|emoji|badge|author|profile|social|share)/i.test(context)) continue;
    const width = Number.parseInt(attribute(attrs, "width"), 10) || 0;
    const height = Number.parseInt(attribute(attrs, "height"), 10) || 0;
    if ((width && width < 90) || (height && height < 55)) continue;
    const urls = [
      attribute(attrs, "data-src"),
      attribute(attrs, "data-lazy-src"),
      attribute(attrs, "data-original"),
      attribute(attrs, "src")
    ];
    const srcset = attribute(attrs, "data-srcset") || attribute(attrs, "srcset");
    if (srcset) {
      const best = srcset.split(",").map(part => part.trim()).filter(Boolean).map(part => {
        const pieces = part.split(/\s+/);
        const descriptor = pieces[1] || "";
        const score = Number.parseInt(descriptor, 10) || (descriptor.endsWith("w") ? Number.parseInt(descriptor, 10) : 0);
        return {url: pieces[0], score};
      }).sort((a, b) => b.score - a.score)[0];
      if (best?.url) urls.unshift(best.url);
    }
    const image = urls.map(value => safeImageUrl(value, baseUrl)).find(Boolean);
    if (!image) continue;
    if (/\.(?:svg)(?:[?#]|$)/i.test(new URL(image).pathname)) continue;
    if (/(?:logo|avatar|favicon|icon|sprite|placeholder|blank|pixel|tracking|gravatar)/i.test(new URL(image).pathname)) continue;
    const classScore = /(?:article|story|hero|feature|lead|main|content|thumbnail|thumb|media|image)/i.test(context) ? 10 : 0;
    const sizeScore = Math.min(width || 300, 1200) + Math.min(height || 180, 800);
    candidates.push({image, score: classScore + sizeScore});
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length) return candidates[0].image;
  return "";
}
