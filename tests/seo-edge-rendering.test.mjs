import test from "node:test";
import assert from "node:assert/strict";
import { buildTitleSeoHtml } from "../cloudflare/functions/title.html.js";
import { renderNewsStoryHtml } from "../cloudflare/functions/news-story.html.js";
import { buildPersonSeoHtml } from "../cloudflare/functions/person.html.js";
import { mergePublishedArticlesIntoSitemap } from "../cloudflare/functions/sitemap.xml.js";
import { buildMediaSitemapEntries } from "../automation/generate-seo-assets.mjs";

test("movie title pages are edge-rendered with unique metadata, semantic content and Movie JSON-LD", () => {
  const html = '<html><head><title>Fallback</title><meta name="description" content="Fallback"></head><body><main id="title-content"><div>Loading</div></main></body></html>';
  const details = {
    id: 550, title: "Fight Club", overview: "A ticking-time-bomb insomniac and a slippery soap salesman.",
    release_date: "1999-10-15", original_language: "en", runtime: 139,
    vote_average: 8.4, vote_count: 27000, poster_path: "/poster.jpg", backdrop_path: "/backdrop.jpg",
    genres: [{ name: "Drama" }, { name: "Thriller" }],
    credits: { cast: [{ name: "Brad Pitt" }, { name: "Edward Norton" }] }
  };
  const result = buildTitleSeoHtml(html, details, "movie", "https://vivid-cinema.pages.dev/title.html?id=550&type=movie");
  assert.match(result, /Fight Club \(1999\) — Movie \| Vivid Cinema/);
  assert.match(result, /name="description" content="A ticking-time-bomb/);
  assert.match(result, /property="og:type" content="video.movie"/);
  assert.match(result, /rel="canonical" href="https:\/\/vivid-cinema\.pages\.dev\/title\.html\?id=550&amp;type=movie"/);
  assert.match(result, /<h1>Fight Club<\/h1>/);
  assert.match(result, /Brad Pitt/);
  assert.match(result, /"@type":"Movie"/);
  assert.match(result, /"ratingValue":"8.4"/);
  assert.doesNotMatch(result, /Loading/);
});

test("TV title pages use TVSeries metadata and omit movie-only runtime", () => {
  const html = '<head><title>Fallback</title></head><body><main id="title-content">Loading</main></body>';
  const details = { id: 1399, name: "Game of Thrones", overview: "Nine noble families fight for control.", first_air_date: "2011-04-17", number_of_seasons: 8, genres: [{ name: "Drama" }] };
  const result = buildTitleSeoHtml(html, details, "tv", "https://vivid-cinema.pages.dev/title.html?id=1399&type=tv");
  assert.match(result, /Game of Thrones \(2011\) — TV Series/);
  assert.match(result, /video\.tv_show/);
  assert.match(result, /"@type":"TVSeries"/);
  assert.match(result, /8 seasons/);
  assert.doesNotMatch(result, /"duration"/);
});

test("published news articles render article metadata and safe visible content", () => {
  const html = '<head><title>News Story</title></head><body><article id="news-story-content">Loading</article></body>';
  const article = {
    headline: "Major studio announces new film slate",
    summary: "The studio has announced a new slate of upcoming films.",
    body: "First paragraph.\nSecond paragraph.",
    publisher: "Example Publisher", sourceUrl: "https://publisher.example/story",
    imageUrl: "https://images.example/story.jpg", category: "Film", region: "global",
    publishedAt: "2026-11-26T10:00:00.000Z"
  };
  const result = renderNewsStoryHtml(html, article, "article_123");
  assert.match(result, /Major studio announces new film slate \| Vivid Cinema News/);
  assert.match(result, /"@type":"NewsArticle"/);
  assert.match(result, /article_123/);
  assert.match(result, /The studio has announced/);
  assert.match(result, /First paragraph\.<br>Second paragraph\./);
  assert.match(result, /Read the original report/);
  assert.doesNotMatch(result, /<script>alert/);
});

test("media sitemap includes unique valid movie and TV title URLs", async () => {
  const fakeFetch = async url => {
    const parsed = new URL(url);
    const results = parsed.pathname.endsWith("/all/week")
      ? [{ id: 1, media_type: "movie", title: "Movie One", backdrop_path: "/one.jpg" }, { id: 2, media_type: "tv", name: "Series Two" }]
      : parsed.pathname.endsWith("/movie/popular")
        ? [{ id: 1, title: "Duplicate Movie" }, { id: 3, title: "Movie Three" }]
        : [{ id: 2, name: "Duplicate Series" }, { id: 4, name: "Series Four" }];
    return { ok: true, json: async () => ({ results }) };
  };
  const entries = await buildMediaSitemapEntries(fakeFetch, "test-key");
  assert.equal(entries.length, 4);
  assert.ok(entries.some(item => item.url.endsWith("/title.html?id=1&type=movie")));
  assert.ok(entries.some(item => item.url.endsWith("/title.html?id=2&type=tv")));
  assert.ok(entries.some(item => item.image.endsWith("/one.jpg")));
  assert.deepEqual(await buildMediaSitemapEntries(fakeFetch, ""), []);
});


test("cast and crew profiles are edge-rendered with Person schema and filmography", () => {
  const html = '<head><title>Person</title></head><body><main id="person-content">Loading</main></body>';
  const person = {
    id: 287, name: "Brad Pitt", biography: "An American actor and film producer.",
    known_for_department: "Acting", profile_path: "/brad.jpg",
    combined_credits: { cast: [{ id: 550, media_type: "movie", title: "Fight Club", popularity: 90 }] }
  };
  const result = buildPersonSeoHtml(html, person, "https://vivid-cinema.pages.dev/person.html?id=287");
  assert.match(result, /Brad Pitt — Movies, TV Shows &amp; Biography/);
  assert.match(result, /"@type":"Person"/);
  assert.match(result, /Fight Club/);
  assert.match(result, /title\.html\?id=550&amp;type=movie/);
  assert.doesNotMatch(result, /Loading/);
});

test("dynamic sitemap includes published stories only and escapes XML", () => {
  const base = '<?xml version="1.0"?><urlset></urlset>';
  const docs = [
    { name: "projects/vivid/databases/(default)/documents/articles/story_1", fields: {
      status: { stringValue: "published" }, sourceUrl: { stringValue: "https://publisher.example/story" },
      publishedAt: { timestampValue: "2026-11-25T10:00:00Z" }
    }},
    { name: "projects/vivid/databases/(default)/documents/articles/private_1", fields: {
      status: { stringValue: "draft" }, sourceUrl: { stringValue: "https://publisher.example/private" }
    }},
    { name: "projects/vivid/databases/(default)/documents/articles/unsafe_1", fields: {
      status: { stringValue: "published" }, sourceUrl: { stringValue: "javascript:alert(1)" }
    }}
  ];
  const result = mergePublishedArticlesIntoSitemap(base, docs);
  assert.match(result, /news-story\.html\?id=story_1/);
  assert.match(result, /2026-11-25T10:00:00\.000Z/);
  assert.doesNotMatch(result, /private_1|unsafe_1/);
});
