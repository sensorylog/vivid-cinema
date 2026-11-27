import { VIVID_CONFIG } from "../../scripts/config.js";

const ORIGIN = "https://vivid-cinema.pages.dev";
const API_KEY = VIVID_CONFIG.api.tmdbApiKey;
const IMAGE_BASE = VIVID_CONFIG.api.tmdbImageBaseUrl;

const esc = value => String(value || "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

function meta(html, attribute, key, value) {
  const tag = '<meta ' + attribute + '="' + esc(key) + '" content="' + esc(value) + '">';
  const matcher = new RegExp("<meta\\b(?=[^>]*\\b" + attribute + "\\s*=\\s*['\"]" + key + "['\"])[^>]*>", "i");
  return matcher.test(html) ? html.replace(matcher, tag) : html.replace(/<\/head>/i, tag + "</head>");
}

export function buildPersonSeoHtml(html, person, canonical) {
  const name = String(person.name || "Cast and crew").trim();
  const department = String(person.known_for_department || "Film and television").trim();
  const biography = String(person.biography || "").replace(/\s+/g, " ").trim().slice(0, 300) ||
    "Explore " + name + "'s filmography, acting credits, television work and career on Vivid Cinema.";
  const profilePath = person.profile_path || person.images?.profiles?.[0]?.file_path || "";
  const image = profilePath ? IMAGE_BASE + "/w780" + profilePath : "";
  const credits = [...(person.combined_credits?.cast || []), ...(person.combined_credits?.crew || [])]
    .filter(item => item && item.id && (item.title || item.name))
    .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
    .slice(0, 12);
  const schema = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": name,
    "description": biography,
    "url": canonical,
    "jobTitle": department,
    ...(image ? { "image": image } : {})
  };
  const cards = credits.map(item => {
    const title = item.title || item.name;
    const kind = item.media_type === "tv" ? "TV series" : "Movie";
    return '<li><a href="title.html?id=' + encodeURIComponent(item.id) + '&amp;type=' + (item.media_type === "tv" ? "tv" : "movie") + '">' +
      esc(title) + ' <span>· ' + kind + '</span></a></li>';
  }).join("");
  const body = '<article class="vivid-person-prerender">' +
    (image ? '<img src="' + esc(image) + '" alt="' + esc(name) + '" fetchpriority="high" decoding="async">' : "") +
    '<div><p>' + esc(department) + '</p><h1>' + esc(name) + '</h1><p>' + esc(biography) + '</p></div>' +
    (cards ? '<section><h2>Filmography</h2><ul>' + cards + '</ul></section>' : "") +
    '</article>';
  const title = name + " — Movies, TV Shows & Biography | Vivid Cinema";
  html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, "<title>" + esc(title) + "</title>");
  html = meta(html, "name", "description", biography);
  html = meta(html, "name", "robots", "index,follow,max-image-preview:large");
  html = meta(html, "property", "og:type", "profile");
  html = meta(html, "property", "og:title", title);
  html = meta(html, "property", "og:description", biography);
  html = meta(html, "property", "og:url", canonical);
  if (image) html = meta(html, "property", "og:image", image);
  html = meta(html, "name", "twitter:card", "summary_large_image");
  html = meta(html, "name", "twitter:title", title);
  html = meta(html, "name", "twitter:description", biography);
  if (image) html = meta(html, "name", "twitter:image", image);
  const jsonld = '<script id="vivid-edge-person-jsonld" type="application/ld+json">' + JSON.stringify(schema).replace(/</g, "\\u003c") + "</script>";
  html = html.replace(/<\/head>/i, jsonld + "</head>");
  html = html.replace(/<main\b(?=[^>]*\bid="person-content")[^>]*>[\s\S]*?<\/main>/i,
    '<main id="person-content" aria-live="polite">' + body + "</main>");
  return html;
}

export async function onRequest(context) {
  const { request, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!/^\d{1,12}$/.test(id)) return next();
  const canonical = new URL("/person.html", ORIGIN);
  canonical.searchParams.set("id", id);
  const cacheKey = new Request(canonical.href);
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return request.method === "HEAD" ? new Response(null, { status: cached.status, headers: cached.headers }) : cached;
  } catch {}
  const base = await next();
  if (!base.ok || !/text\/html/i.test(base.headers.get("content-type") || "")) return base;
  const endpoint = new URL(VIVID_CONFIG.api.tmdbBaseUrl + "/person/" + encodeURIComponent(id));
  endpoint.searchParams.set("api_key", API_KEY);
  endpoint.searchParams.set("language", VIVID_CONFIG.api.language || "en-US");
  endpoint.searchParams.set("append_to_response", "combined_credits,images");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(endpoint.href, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return base;
    const person = await response.json();
    if (String(person.id) !== id || !person.name) return base;
    const html = buildPersonSeoHtml(await base.text(), person, canonical.href);
    const headers = new Headers(base.headers);
    headers.delete("Content-Length");
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    headers.set("X-Robots-Tag", "index, follow, max-image-preview:large");
    headers.set("Link", "<" + canonical.href + '>; rel="canonical"');
    const result = new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
    try { await caches.default.put(cacheKey, result.clone()); } catch {}
    return result;
  } catch (error) {
    console.warn("Vivid SEO person rendering fallback:", error?.message || error);
    return base;
  } finally {
    clearTimeout(timeout);
  }
}
