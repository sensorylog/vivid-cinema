const ORIGIN = "https://vivid-cinema.pages.dev";

function xmlEscape(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function decodeValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("booleanValue" in value) return value.booleanValue;
  return undefined;
}

export function mergePublishedArticlesIntoSitemap(xml, documents, origin = ORIGIN) {
  const urls = [];
  for (const document of documents || []) {
    const fields = document.fields || {};
    const status = decodeValue(fields.status);
    const sourceUrl = decodeValue(fields.sourceUrl);
    if (status !== "published" || !/^https:\/\//i.test(sourceUrl || "")) continue;
    const id = String(document.name || "").split("/").pop();
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) continue;
    const publishedAt = decodeValue(fields.publishedAt);
    const updatedAt = decodeValue(fields.updatedAt);
    const date = updatedAt || publishedAt;
    const lastmod = date && !Number.isNaN(new Date(date).getTime())
      ? "<lastmod>" + new Date(date).toISOString() + "</lastmod>" : "";
    urls.push("<url><loc>" + xmlEscape(origin + "/news-story.html?id=" + encodeURIComponent(id)) +
      "</loc>" + lastmod + "</url>");
  }
  if (!urls.length) return xml;
  return xml.replace("</urlset>", urls.join("") + "</urlset>");
}

export async function onRequest(context) {
  const { request, next } = context;
  const base = await next();
  if (!base.ok || request.method !== "GET") return base;
  try {
    const configResponse = await fetch(new URL("/init.json", request.url).href, { headers: { Accept: "application/json" } });
    if (!configResponse.ok) return base;
    const config = await configResponse.json();
    if (!config.apiKey || !config.projectId) return base;
    const endpoint = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(config.projectId) +
      "/databases/(default)/documents:runQuery?key=" + encodeURIComponent(config.apiKey);
    const query = {
      structuredQuery: {
        from: [{ collectionId: "articles" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: "published" }
          }
        },
        limit: 1000
      }
    };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(query)
    });
    if (!response.ok) return base;
    const rows = await response.json();
    const documents = rows.map(row => row.document).filter(Boolean);
    const xml = mergePublishedArticlesIntoSitemap(await base.text(), documents);
    const headers = new Headers(base.headers);
    headers.delete("Content-Length");
    headers.set("Content-Type", "application/xml; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=3600");
    return new Response(xml, { status: 200, headers });
  } catch (error) {
    console.warn("Vivid dynamic article sitemap fallback:", error?.message || error);
    return base;
  }
}
