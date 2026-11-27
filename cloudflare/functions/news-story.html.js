const ORIGIN = "https://vivid-cinema.pages.dev";

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function firestoreValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValue);
  if ("mapValue" in value) return firestoreFields(value.mapValue.fields || {});
  return undefined;
}

function firestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]));
}

function replaceMeta(html, attribute, key, value) {
  const tag = '<meta ' + attribute + '="' + esc(key) + '" content="' + esc(value) + '">';
  const matcher = new RegExp("<meta\\b(?=[^>]*\\b" + attribute + "\\s*=\\s*['\"]" + key + "['\"])[^>]*>", "i");
  return matcher.test(html) ? html.replace(matcher, tag) : html.replace(/<\/head>/i, tag + "</head>");
}

function replaceTitle(html, value) {
  const tag = "<title>" + esc(value) + "</title>";
  return /<title[^>]*>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, tag)
    : html.replace(/<\/head>/i, tag + "</head>");
}

function replaceCanonical(html, value) {
  const tag = '<link rel="canonical" href="' + esc(value) + '">';
  const matcher = /<link\b(?=[^>]*\brel\s*=\s*['"]canonical['"])[^>]*>/i;
  return matcher.test(html) ? html.replace(matcher, tag) : html.replace(/<\/head>/i, tag + "</head>");
}

function replaceSchema(html, schema) {
  const tag = '<script id="vivid-edge-news-jsonld" type="application/ld+json">' +
    JSON.stringify(schema).replace(/</g, "\\u003c") + "</script>";
  const matcher = /<script\b(?=[^>]*\bid\s*=\s*['"]vivid-edge-news-jsonld['"])[^>]*>[\s\S]*?<\/script>/i;
  return matcher.test(html) ? html.replace(matcher, tag) : html.replace(/<\/head>/i, tag + "</head>");
}

function isoDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function renderNewsStoryHtml(html, article, articleId) {
  const headline = String(article.headline || "Vivid Cinema News").trim().slice(0, 240);
  const description = String(article.summary || article.headline || "Read the latest entertainment story on Vivid Cinema.")
    .replace(/\s+/g, " ").trim().slice(0, 300);
  const canonical = new URL("/news-story.html", ORIGIN);
  canonical.searchParams.set("id", articleId);
  const image = /^https:\/\//i.test(article.imageUrl || "") ? article.imageUrl : "";
  const published = isoDate(article.publishedAt);
  const modified = isoDate(article.updatedAt) || published;
  const source = /^https:\/\//i.test(article.sourceUrl || "") ? article.sourceUrl : "";
  const schema = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    "headline": headline,
    "description": description,
    "url": canonical.href,
    ...(published ? { "datePublished": published } : {}),
    ...(modified ? { "dateModified": modified } : {}),
    ...(image ? { "image": [image] } : {}),
    "publisher": { "@type": "Organization", "name": "Vivid Cinema" },
    "author": { "@type": "Organization", "name": "Vivid Cinema News" },
    ...(article.publisher ? { "sourceOrganization": { "@type": "Organization", "name": String(article.publisher) } } : {}),
    "articleSection": String(article.category || "Entertainment")
  };
  const body = '<article class="vivid-story-prerender"><p>' + esc(article.regionLabel || article.region || "VIVID NEWS") +
    ' · ' + esc(article.category || "Entertainment") + '</p><h1>' + esc(headline) + '</h1>' +
    (article.publisher ? '<p>Reported source: ' + esc(article.publisher) + '</p>' : "") +
    (published ? '<time datetime="' + esc(published) + '">' + esc(published.slice(0, 10)) + '</time>' : "") +
    (image ? '<img src="' + esc(image) + '" alt="' + esc(headline) + '" fetchpriority="high" decoding="async">' : "") +
    '<p>' + esc(description) + '</p>' +
    (article.body ? '<div>' + esc(article.body).replace(/\r?\n/g, "<br>") + '</div>' : "") +
    (source ? '<p><a href="' + esc(source) + '" rel="noopener noreferrer">Read the original report</a></p>' : "") +
    '</article>';

  html = replaceTitle(html, headline + " | Vivid Cinema News");
  html = replaceMeta(html, "name", "description", description);
  html = replaceMeta(html, "name", "robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
  html = replaceMeta(html, "property", "og:type", "article");
  html = replaceMeta(html, "property", "og:site_name", "Vivid Cinema");
  html = replaceMeta(html, "property", "og:title", headline + " | Vivid Cinema News");
  html = replaceMeta(html, "property", "og:description", description);
  html = replaceMeta(html, "property", "og:url", canonical.href);
  if (image) html = replaceMeta(html, "property", "og:image", image);
  html = replaceMeta(html, "name", "twitter:card", "summary_large_image");
  html = replaceMeta(html, "name", "twitter:title", headline + " | Vivid Cinema News");
  html = replaceMeta(html, "name", "twitter:description", description);
  if (image) html = replaceMeta(html, "name", "twitter:image", image);
  html = replaceCanonical(html, canonical.href);
  html = replaceSchema(html, schema);
  return html.replace(/<article\b(?=[^>]*\bid="news-story-content")[^>]*>[\s\S]*?<\/article>/i, body);
}

async function firebaseConfig(request) {
  const response = await fetch(new URL("/init.json", request.url).href, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Firebase public config is unavailable.");
  const config = await response.json();
  if (!config.apiKey || !config.projectId) throw new Error("Firebase public config is incomplete.");
  return config;
}

export async function onRequest(context) {
  const { request, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
    const response = await next();
    const html = replaceMeta(await response.text(), "name", "robots", "noindex,follow");
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.set("X-Robots-Tag", "noindex, follow");
    return new Response(request.method === "HEAD" ? null : html, { status: response.status, headers });
  }

  const canonical = new URL("/news-story.html", ORIGIN);
  canonical.searchParams.set("id", id);
  const cacheKey = new Request(canonical.href, { method: "GET" });
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return request.method === "HEAD" ? new Response(null, { status: cached.status, headers: cached.headers }) : cached;
  } catch {}

  const base = await next();
  if (!base.ok || !/text\/html/i.test(base.headers.get("content-type") || "")) return base;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const config = await firebaseConfig(request);
    const endpoint = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(config.projectId) +
      "/databases/(default)/documents/articles/" + encodeURIComponent(id) + "?key=" + encodeURIComponent(config.apiKey);
    const upstream = await fetch(endpoint, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!upstream.ok) {
      const html = replaceMeta(await base.text(), "name", "robots", "noindex,follow");
      const headers = new Headers(base.headers);
      headers.delete("Content-Length");
      headers.set("X-Robots-Tag", "noindex, follow");
      return new Response(request.method === "HEAD" ? null : html, { status: upstream.status === 404 ? 404 : base.status, headers });
    }
    const document = await upstream.json();
    const article = firestoreFields(document.fields || {});
    if (article.status !== "published" || !/^https:\/\//i.test(article.sourceUrl || "")) {
      const html = replaceMeta(await base.text(), "name", "robots", "noindex,follow");
      const headers = new Headers(base.headers);
      headers.delete("Content-Length");
      headers.set("X-Robots-Tag", "noindex, follow");
      return new Response(request.method === "HEAD" ? null : html, { status: 404, headers });
    }
    const html = renderNewsStoryHtml(await base.text(), article, id);
    const headers = new Headers(base.headers);
    headers.delete("Content-Length");
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=1800");
    headers.set("X-Robots-Tag", "index, follow, max-image-preview:large");
    headers.set("Link", "<" + canonical.href + '>; rel="canonical"');
    const result = new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
    try { await caches.default.put(cacheKey, result.clone()); } catch {}
    return result;
  } catch (error) {
    console.warn("Vivid SEO news rendering fallback:", error?.message || error);
    return base;
  } finally {
    clearTimeout(timeout);
  }
}
