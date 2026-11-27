import { VIVID_CONFIG } from "../../scripts/config.js";

const API_KEY = VIVID_CONFIG.api.tmdbApiKey;
const IMAGE_BASE = VIVID_CONFIG.api.tmdbImageBaseUrl;
const ORIGIN = "https://vivid-cinema.pages.dev";

export function escapeSeoHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function cleanDescription(value, fallback) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return (clean || fallback).slice(0, 300);
}

function setMeta(html, attribute, name, content) {
  const tag = '<meta ' + attribute + '="' + escapeSeoHtml(name) + '" content="' + escapeSeoHtml(content) + '">';
  const matcher = new RegExp("<meta\\b(?=[^>]*\\b" + attribute + "\\s*=\\s*['\"]" + name + "['\"])[^>]*>", "i");
  return matcher.test(html) ? html.replace(matcher, tag) : html.replace(/<\\/head>/i, tag + "</head>");
}

function setTitle(html, title) {
  const tag = "<title>" + escapeSeoHtml(title) + "</title>";
  return /<title[^>]*>[\\s\\S]*?<\\/title>/i.test(html)
    ? html.replace(/<title[^>]*>[\\s\\S]*?<\\/title>/i, tag)
    : html.replace(/<\\/head>/i, tag + "</head>");
}

function setCanonical(html, url) {
  const tag = '<link rel="canonical" href="' + escapeSeoHtml(url) + '">';
  const matcher = /<link\\b(?=[^>]*\\brel\\s*=\\s*['"]canonical['"])[^>]*>/i;
  return matcher.test(html) ? html.replace(matcher, tag) : html.replace(/<\\/head>/i, tag + "</head>");
}

function setJsonLd(html, schema) {
  const tag = '<script id="vivid-edge-seo-jsonld" type="application/ld+json">' +
    JSON.stringify(schema).replace(/</g, "\\u003c") + "</script>";
  const matcher = /<script\\b(?=[^>]*\\bid\\s*=\\s*['"]vivid-edge-seo-jsonld['"])[^>]*>[\\s\\S]*?<\\/script>/i;
  return matcher.test(html) ? html.replace(matcher, tag) : html.replace(/<\\/head>/i, tag + "</head>");
}

function renderTitleContent(details, type, canonical) {
  const title = details.title || details.name || "Untitled";
  const year = String(details.release_date || details.first_air_date || "").slice(0, 4);
  const overview = cleanDescription(details.overview, "Explore " + title + " on Vivid Cinema. Discover cast, release details, ratings and trailers.");
  const image = details.backdrop_path ? IMAGE_BASE + "/w1280" + details.backdrop_path :
    details.poster_path ? IMAGE_BASE + "/w780" + details.poster_path : "";
  const genres = (details.genres || []).map(item => item.name).filter(Boolean);
  const cast = (details.credits?.cast || []).slice(0, 8).map(person => person.name).filter(Boolean);
  const rating = Number(details.vote_average);
  const runtime = Number(details.runtime);
  const seasonCount = Number(details.number_of_seasons);
  const meta = [
    year,
    genres.slice(0, 3).join(" · "),
    Number.isFinite(rating) && rating > 0 ? "TMDB " + rating.toFixed(1) + "/10" : "",
    type === "tv" ? (seasonCount > 0 ? seasonCount + (seasonCount === 1 ? " season" : " seasons") : "TV series") :
      (runtime > 0 ? Math.floor(runtime / 60) + "h " + (runtime % 60) + "m" : "Movie")
  ].filter(Boolean).join(" · ");
  const poster = image ? '<img src="' + escapeSeoHtml(image) + '" alt="' + escapeSeoHtml(title + " poster") + '" fetchpriority="high" decoding="async">' : "";
  const castList = cast.length ? '<section><h2>Cast</h2><ul>' + cast.map(name => "<li>" + escapeSeoHtml(name) + "</li>").join("") + "</ul></section>" : "";
  const schema = {
    "@context": "https://schema.org",
    "@type": type === "tv" ? "TVSeries" : "Movie",
    "name": title,
    "description": overview,
    "url": canonical,
    ...(image ? { "image": image } : {}),
    ...(year ? { "datePublished": (type === "tv" ? details.first_air_date : details.release_date) } : {}),
    "genre": genres,
    "inLanguage": details.original_language || "en",
    ...(rating > 0 && Number(details.vote_count) > 0 ? {
      "aggregateRating": { "@type": "AggregateRating", "ratingValue": rating.toFixed(1), "bestRating": "10", "worstRating": "0", "ratingCount": Number(details.vote_count) }
    } : {}),
    ...(type === "movie" && runtime > 0 ? { "duration": "PT" + Math.floor(runtime / 60) + "H" + (runtime % 60) + "M" } : {})
  };
  return {
    title: title + (year ? " (" + year + ")" : "") + (type === "tv" ? " — TV Series" : " — Movie") + " | Vivid Cinema",
    description: overview,
    image,
    schema,
    body: '<a class="vivid-page-back" href="discover.html">← Back to discovery</a>' +
      '<article class="vivid-seo-prerender" itemscope itemtype="https://schema.org/' + (type === "tv" ? "TVSeries" : "Movie") + '">' +
      '<header>' + poster + '<div><p>' + escapeSeoHtml(type === "tv" ? "TV SERIES" : "MOVIE") + '</p><h1 itemprop="name">' + escapeSeoHtml(title) + '</h1>' +
      (meta ? '<p>' + escapeSeoHtml(meta) + '</p>' : "") + '<p itemprop="description">' + escapeSeoHtml(overview) + '</p></div></header>' +
      (genres.length ? '<section><h2>Genres</h2><p>' + escapeSeoHtml(genres.join(" · ")) + '</p></section>' : "") +
      castList + '<p><a href="' + escapeSeoHtml(canonical) + '">Explore ' + escapeSeoHtml(title) + ' on Vivid Cinema</a></p></article>'
  };
}

export async function buildTitleSeoHtml(html, details, type, canonical) {
  const data = renderTitleContent(details, type, canonical);
  html = setTitle(html, data.title);
  html = setMeta(html, "name", "description", "description", data.description);
  html = setMeta(html, "name", "robots", "robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
  html = setMeta(html, "property", "og:type", "og:type", type === "tv" ? "video.tv_show" : "video.movie");
  html = setMeta(html, "property", "og:site_name", "og:site_name", "Vivid Cinema");
  html = setMeta(html, "property", "og:title", "og:title", data.title);
  html = setMeta(html, "property", "og:description", "og:description", data.description);
  html = setMeta(html, "property", "og:url", "og:url", canonical);
  if (data.image) html = setMeta(html, "property", "og:image", "og:image", data.image);
  html = setMeta(html, "name", "twitter:card", "twitter:card", "summary_large_image");
  html = setMeta(html, "name", "twitter:title", "twitter:title", data.title);
  html = setMeta(html, "name", "twitter:description", "twitter:description", data.description);
  if (data.image) html = setMeta(html, "name", "twitter:image", "twitter:image", data.image);
  html = setCanonical(html, canonical);
  html = setJsonLd(html, data.schema);
  const body = '<main id="title-content" aria-live="polite">' + data.body + "</main>";
  html = html.replace(/<main\\b(?=[^>]*\\bid="title-content")[^>]*>[\\s\\S]*?<\\/main>/i, body);
  return html;
}

export async function onRequest(context) {
  const { request, next } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
  if (!/^\\d{1,12}$/.test(id)) {
    const response = await next();
    const html = await response.text();
    const noindex = setMeta(html, "name", "robots", "robots", "noindex,follow");
    return new Response(request.method === "HEAD" ? null : noindex, { status: response.status, headers: response.headers });
  }

  const canonicalUrl = new URL("/title.html", ORIGIN);
  canonicalUrl.searchParams.set("id", id);
  canonicalUrl.searchParams.set("type", type);
  const cacheKey = new Request(canonicalUrl.href, { method: "GET" });
  try {
    const cached = await caches.default?.match(cacheKey);
    if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;
  } catch {}

  const response = await next();
  if (!response.ok || !/text\\/html/i.test(response.headers.get("content-type") || "")) return response;
  const apiUrl = new URL(VIVID_CONFIG.api.tmdbBaseUrl + "/" + type + "/" + encodeURIComponent(id));
  apiUrl.searchParams.set("api_key", API_KEY);
  apiUrl.searchParams.set("language", VIVID_CONFIG.api.language || "en-US");
  apiUrl.searchParams.set("append_to_response", "credits");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const upstream = await fetch(apiUrl.href, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!upstream.ok) {
      const html = await response.text();
      const notFound = setMeta(html, "name", "robots", "robots", "noindex,follow");
      return new Response(request.method === "HEAD" ? null : notFound, { status: upstream.status === 404 ? 404 : response.status, headers: response.headers });
    }
    const details = await upstream.json();
    if (!details || String(details.id) !== id) return response;
    const original = await response.text();
    const rendered = await buildTitleSeoHtml(original, details, type, canonicalUrl.href);
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    headers.set("X-Robots-Tag", "index, follow, max-image-preview:large");
    headers.set("Link", '<' + canonicalUrl.href + '>; rel="canonical"');
    const result = new Response(request.method === "HEAD" ? null : rendered, { status: 200, headers });
    try { await caches.default?.put(cacheKey, result.clone()); } catch {}
    return result;
  } catch (error) {
    console.warn("Vivid SEO title rendering fallback:", error?.message || error);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}
