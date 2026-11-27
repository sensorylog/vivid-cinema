import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ORIGIN = "https://vivid-cinema.pages.dev";
const PUBLIC_PAGES = {
  "index.html": {
    path: "/",
    title: "Vivid Cinema — Discover Movies, TV Shows & Stories Worth Watching",
    description: "Discover movies, TV series, anime and entertainment stories. Explore trending titles, watch trailers, find cast details and build your personal watchlist."
  },
  "home.html": {
    path: "/home.html",
    title: "Discover Movies, TV Shows & Anime | Vivid Cinema",
    description: "Explore movies, TV shows and anime by popularity, rating, genre and release date. Find trailers, cast details and your next great watch on Vivid Cinema."
  },
  "discover.html": {
    path: "/discover.html",
    title: "Discover Movies & TV Shows | Vivid Cinema",
    description: "Discover films and television series across genres, countries, eras and moods. Find popular, top-rated and newly released titles on Vivid Cinema."
  },
  "anime.html": {
    path: "/anime.html",
    title: "Discover Anime Series & Films | Vivid Cinema",
    description: "Explore anime series and films, discover popular titles, browse by genre and find your next anime watch with Vivid Cinema."
  },
  "anime-premium.html": {
    path: "/anime-premium.html",
    title: "Vivid Anime Premium — Discover Anime Series & Films",
    description: "Explore a dedicated anime destination with curated collections, popular series, anime films, ratings and a purpose-built discovery experience."
  },
  "anime-premium-membership.html": {
    path: "/anime-premium-membership.html",
    title: "Vivid Anime Premium Membership | Vivid Cinema",
    description: "Learn about Vivid Anime Premium membership, account access and the benefits available across the Vivid Cinema experience."
  },
  "news.html": {
    path: "/news.html",
    title: "Entertainment News, Film & TV Culture | Vivid Cinema",
    description: "Follow entertainment news, film and television releases, streaming, anime, African cinema, festivals, awards and stories shaping screen culture."
  },
  "about.html": {
    path: "/about.html",
    title: "About Vivid Cinema — Movie & TV Discovery",
    description: "Learn about Vivid Cinema, a discovery platform built to help people explore movies, TV series, anime and stories worth watching."
  },
  "help.html": {
    path: "/help.html",
    title: "Vivid Cinema Help Centre & FAQ",
    description: "Get help with Vivid Cinema, accounts, discovery, watchlists, downloads, playback features and common questions."
  },
  "contact.html": {
    path: "/contact.html",
    title: "Contact Vivid Cinema",
    description: "Contact the Vivid Cinema team for support, feedback, partnerships, press enquiries and other questions."
  },
  "accessibility.html": {
    path: "/accessibility.html",
    title: "Accessibility at Vivid Cinema",
    description: "Read about accessibility features and the steps Vivid Cinema takes to make its movie and TV discovery experience more inclusive."
  },
  "downloads.html": {
    path: "/downloads.html",
    title: "Download Vivid Cinema for Your Devices",
    description: "Get Vivid Cinema on supported devices and take your movie, TV and anime discovery experience with you."
  },
  "terms.html": {
    path: "/terms.html",
    title: "Terms of Service | Vivid Cinema",
    description: "Read the terms and conditions that apply when using Vivid Cinema and its discovery services."
  },
  "privacy.html": {
    path: "/privacy.html",
    title: "Privacy Policy | Vivid Cinema",
    description: "Learn how Vivid Cinema handles information, account data, privacy choices and your use of the platform."
  },
  "cookies.html": {
    path: "/cookies.html",
    title: "Cookie Policy | Vivid Cinema",
    description: "Learn how cookies and similar technologies are used across the Vivid Cinema website."
  },
  "donate.html": {
    path: "/donate.html",
    title: "Support Vivid Cinema",
    description: "Find out how to support the continued development of Vivid Cinema and its entertainment discovery experience."
  },
  "community.html": {
    path: "/community.html",
    title: "Vivid Cinema Community",
    description: "Explore the Vivid Cinema community and connect around movies, television, anime and screen culture."
  }
};

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

export async function buildMediaSitemapEntries(fetchImpl, apiKey, origin = DEFAULT_ORIGIN) {
  if (!apiKey) return [];
  const endpoints = [
    ["trending/all/week", null],
    ["movie/popular", "movie"],
    ["tv/popular", "tv"]
  ];
  const pages = await Promise.all(endpoints.map(async ([endpoint, fixedType]) => {
    const url = new URL("https://api.themoviedb.org/3/" + endpoint);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", "en-US");
    url.searchParams.set("page", "1");
    try {
      const response = await fetchImpl(url.href, { headers: { Accept: "application/json" } });
      if (!response.ok) return [];
      const payload = await response.json();
      return (payload.results || []).map(item => ({
        id: String(item.id || ""),
        type: fixedType || (item.media_type === "tv" ? "tv" : item.media_type === "movie" ? "movie" : ""),
        title: String(item.title || item.name || "").trim(),
        image: item.backdrop_path || item.poster_path || ""
      })).filter(item => /^\d{1,12}$/.test(item.id) && ["movie", "tv"].includes(item.type) && item.title);
    } catch { return []; }
  }));
  const unique = new Map();
  for (const item of pages.flat()) {
    const key = item.type + ":" + item.id;
    const existing = unique.get(key);
    if (!existing) unique.set(key, item);
    else if (!existing.image && item.image) existing.image = item.image;
  }
  return [...unique.values()].map(item => ({
    url: origin + "/title.html?id=" + encodeURIComponent(item.id) + "&type=" + item.type,
    title: item.title,
    image: item.image ? TMDB_IMAGE_BASE + item.image : ""
  }));
}

const NOINDEX_PAGES = [
  "account.html", "auth.html", "auth-diagnostics.html", "login.html", "forgot-password.html",
  "verify-email.html", "library.html", "my-downloads.html", "for-you.html", "watch.html",
  "watch-rooms.html", "watch-room-cinema.html", "offline.html", "moderator.html",
  "african-stories-admin.html", "african-stories-submit.html", "african-stories-watch.html",
  "anime-premium-admin.html", "anime-premium-library.html", "anime-premium-return.html",
  "donation-success.html", "african-stories.html",
  "live.html", "search.html"
];

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function insertBeforeHeadEnd(html, tag) {
  return html.replace(new RegExp("</head>", "i"), tag + "</head>");
}

function setMeta(html, attribute, key, value) {
  const escaped = escapeAttribute(value);
  const matcher = new RegExp("<meta\\b(?=[^>]*\\b" + attribute + "\\s*=\\s*['\\\"]" + key + "['\\\"])[^>]*>", "i");
  const replacement = '<meta ' + attribute + '="' + key + '" content="' + escaped + '">';
  return matcher.test(html) ? html.replace(matcher, replacement) : insertBeforeHeadEnd(html, replacement);
}

function setCanonical(html, href) {
  const tag = '<link rel="canonical" href="' + escapeAttribute(href) + '">';
  const matcher = new RegExp("<link\\b(?=[^>]*\\brel\\s*=\\s*['\\\"]canonical['\\\"])[^>]*>", "i");
  return matcher.test(html) ? html.replace(matcher, tag) : insertBeforeHeadEnd(html, tag);
}

function setTitle(html, title) {
  const matcher = new RegExp("<title[^>]*>[\\s\\S]*?<\\/title>", "i");
  return matcher.test(html)
    ? html.replace(matcher, "<title>" + title + "</title>")
    : insertBeforeHeadEnd(html, "<title>" + title + "</title>");
}

function addStructuredData(html, schema) {
  const tag = '<script id="vivid-static-seo-jsonld" type="application/ld+json">' +
    JSON.stringify(schema).replace(/</g, "\\u003c") + "</script>";
  const matcher = new RegExp("<script\\b(?=[^>]*\\bid\\s*=\\s*['\\\"]vivid-static-seo-jsonld['\\\"])[^>]*>[\\s\\S]*?<\\/script>", "i");
  return matcher.test(html) ? html.replace(matcher, tag) : insertBeforeHeadEnd(html, tag);
}

export async function generateSeoAssets(directory, siteOrigin = process.env.VIVID_SITE_URL || DEFAULT_ORIGIN) {
  const origin = new URL(siteOrigin).origin;
  const sitemapEntries = [];

  for (const [filename, page] of Object.entries(PUBLIC_PAGES)) {
    const filePath = path.join(directory, filename);
    let html;
    try { html = await readFile(filePath, "utf8"); }
    catch { continue; }

    const canonical = origin + page.path;
    const image = origin + "/icons/vivid-og.svg";
    html = setTitle(html, page.title);
    html = setMeta(html, "name", "description", page.description);
    html = setMeta(html, "name", "robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
    html = setMeta(html, "name", "googlebot", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
    html = setMeta(html, "property", "og:type", filename === "news.html" ? "website" : "website");
    html = setMeta(html, "property", "og:site_name", "Vivid Cinema");
    html = setMeta(html, "property", "og:title", page.title);
    html = setMeta(html, "property", "og:description", page.description);
    html = setMeta(html, "property", "og:url", canonical);
    html = setMeta(html, "property", "og:image", image);
    html = setMeta(html, "property", "og:image:width", "1200");
    html = setMeta(html, "property", "og:image:height", "630");
    html = setMeta(html, "property", "og:image:alt", page.title);
    html = setMeta(html, "name", "twitter:card", "summary_large_image");
    html = setMeta(html, "name", "twitter:title", page.title);
    html = setMeta(html, "name", "twitter:description", page.description);
    html = setMeta(html, "name", "twitter:image", image);
    html = setCanonical(html, canonical);

    const schema = filename === "index.html"
      ? {
          "@context": "https://schema.org",
          "@type": "WebSite",
          "name": "Vivid Cinema",
          "url": origin + "/",
          "description": page.description,
          "potentialAction": {
            "@type": "SearchAction",
            "target": { "@type": "EntryPoint", "urlTemplate": origin + "/home.html?search={search_term_string}" },
            "query-input": "required name=search_term_string"
          }
        }
      : {
          "@context": "https://schema.org",
          "@type": filename === "news.html" ? "CollectionPage" : "WebPage",
          "name": page.title,
          "description": page.description,
          "url": canonical,
          "isPartOf": { "@type": "WebSite", "name": "Vivid Cinema", "url": origin + "/" }
        };
    if (!(filename === "index.html" && html.includes('application/ld+json'))) html = addStructuredData(html, schema);
    await writeFile(filePath, html, "utf8");
    sitemapEntries.push(canonical);
  }

  for (const filename of NOINDEX_PAGES) {
    const filePath = path.join(directory, filename);
    let html;
    try { html = await readFile(filePath, "utf8"); }
    catch { continue; }
    html = setMeta(html, "name", "robots", "noindex,follow");
    html = setMeta(html, "name", "googlebot", "noindex,follow");
    await writeFile(filePath, html, "utf8");
  }

  let tmdbApiKey = process.env.VIVID_TMDB_API_KEY || "";
  if (!tmdbApiKey) {
    try {
      const configSource = await readFile(path.resolve(directory, "../scripts/config.js"), "utf8");
      tmdbApiKey = (configSource.match(/tmdbApiKey:\s*["']([^"']+)["']/) || [])[1] || "";
    } catch {}
  }
  const mediaEntries = await buildMediaSitemapEntries(fetch, tmdbApiKey, origin);
  const staticXml = sitemapEntries.map(url => "  <url><loc>" + url + "</loc></url>");
  const mediaXml = mediaEntries.map(item =>
    "  <url><loc>" + item.url + "</loc>" +
    (item.image ? '<image:image><image:loc>' + item.image + "</image:loc><image:title>" + escapeAttribute(item.title) + "</image:title></image:image>" : "") +
    "</url>"
  );
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...staticXml,
    ...mediaXml,
    "</urlset>",
    ""
  ].join("\n");
  await writeFile(path.join(directory, "sitemap.xml"), sitemap, "utf8");
  await writeFile(path.join(directory, "robots.txt"),
    "User-agent: *\nAllow: /\n\nSitemap: " + origin + "/sitemap.xml\n", "utf8");

  return { indexedPages: sitemapEntries.length, mediaPages: mediaEntries.length, noindexPages: NOINDEX_PAGES.length, origin };
}
