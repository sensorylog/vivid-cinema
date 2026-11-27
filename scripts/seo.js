const SITE_ORIGIN = "https://vivid-cinema.pages.dev";
const DEFAULT_IMAGE = SITE_ORIGIN + "/icons/vivid-og.svg";

function absoluteUrl(value) {
  try { return new URL(value || "/", SITE_ORIGIN).href; }
  catch { return DEFAULT_IMAGE; }
}

function upsertMeta(attribute, key, content) {
  if (!content) return;
  let element = document.head.querySelector('meta[' + attribute + '="' + key + '"]');
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", String(content).replace(/[\u0000-\u001f]/g, " ").trim());
}

function upsertLink(rel, href) {
  let element = document.head.querySelector('link[rel="' + rel + '"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = rel;
    document.head.appendChild(element);
  }
  element.href = href;
}

export function setPageSeo({
  title,
  description,
  canonicalUrl = window.location.href,
  image = DEFAULT_IMAGE,
  type = "website",
  robots = "index,follow",
  structuredData = null
} = {}) {
  const pageTitle = String(title || "Vivid Cinema").trim();
  const pageDescription = String(description || "Discover movies, TV series, anime and entertainment stories on Vivid Cinema.").trim().slice(0, 300);
  const canonical = new URL(canonicalUrl, window.location.href);
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) canonical.searchParams.delete(key);
  }
  const canonicalHref = canonical.href;
  const imageHref = absoluteUrl(image);

  document.title = pageTitle;
  upsertMeta("name", "description", pageDescription);
  upsertMeta("name", "robots", robots);
  upsertMeta("name", "googlebot", robots);
  upsertMeta("property", "og:type", type);
  upsertMeta("property", "og:site_name", "Vivid Cinema");
  upsertMeta("property", "og:title", pageTitle);
  upsertMeta("property", "og:description", pageDescription);
  upsertMeta("property", "og:url", canonicalHref);
  upsertMeta("property", "og:image", imageHref);
  upsertMeta("property", "og:image:width", "1200");
  upsertMeta("property", "og:image:height", "630");
  upsertMeta("property", "og:image:alt", pageTitle + " — Vivid Cinema");
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", pageTitle);
  upsertMeta("name", "twitter:description", pageDescription);
  upsertMeta("name", "twitter:image", imageHref);
  upsertLink("canonical", canonicalHref);

  let schema = document.getElementById("vivid-seo-jsonld");
  if (!structuredData) {
    schema?.remove();
  } else {
    if (!schema) {
      schema = document.createElement("script");
      schema.id = "vivid-seo-jsonld";
      schema.type = "application/ld+json";
      document.head.appendChild(schema);
    }
    schema.textContent = JSON.stringify(structuredData).replace(/</g, "\\u003c");
  }
}
