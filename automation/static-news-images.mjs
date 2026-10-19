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

function safeImageUrl(value, baseUrl = "") {
  if (!value) return "";
  try {
    const url = new URL(decode(value), baseUrl || undefined);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (/^(?:news\.)?google\.com$/i.test(url.hostname) &&
        /(?:branding|logo|favicon)/i.test(url.pathname)) return "";
    return url.href;
  } catch {
    return "";
  }
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
  for (const match of xml.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    candidates.push(attribute(attrs, "src"), attribute(attrs, "data-src"));
    const srcset = attribute(attrs, "srcset");
    if (srcset) candidates.push(srcset.split(",")[0].trim().split(/\s+/)[0]);
  }
  for (const candidate of candidates) {
    const image = safeImageUrl(candidate, baseUrl);
    if (image) return image;
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
  return "";
}
