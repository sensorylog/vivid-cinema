import test from "node:test";
import assert from "node:assert/strict";
import { decodeGoogleNewsArticleUrl, extractHtmlImageUrl, extractPublisherArticleUrl, extractRssImageUrl, sortStoriesNewestFirst } from "../automation/static-news-images.mjs";

test("RSS thumbnail extraction supports media, enclosure, and description images", () => {
  assert.equal(
    extractRssImageUrl('<item><media:thumbnail url="https://cdn.example.com/thumb.jpg" /></item>'),
    "https://cdn.example.com/thumb.jpg"
  );
  assert.equal(
    extractRssImageUrl('<item><enclosure url="https://cdn.example.com/story.webp" type="image/webp" /></item>'),
    "https://cdn.example.com/story.webp"
  );
  assert.equal(
    extractRssImageUrl('<item><description><![CDATA[<img src="https://cdn.example.com/story.png">]]></description></item>'),
    "https://cdn.example.com/story.png"
  );
  assert.equal(
    extractRssImageUrl('<item><description><![CDATA[<img data-lazy-src="/lazy.jpg">]]></description></item>', "", "https://publisher.example/rss"),
    "https://publisher.example/lazy.jpg"
  );
  assert.equal(
    extractRssImageUrl('<item><description><![CDATA[<source srcset="/small.jpg 320w, /large.jpg 1280w">]]></description></item>', "", "https://publisher.example/rss"),
    "https://publisher.example/large.jpg"
  );
});

test("RSS image extraction rejects insecure and non-image enclosure URLs", () => {
  assert.equal(extractRssImageUrl('<item><media:content url="http://cdn.example.com/a.jpg" /></item>'), "");
  assert.equal(extractRssImageUrl('<item><enclosure url="https://cdn.example.com/audio.mp3" type="audio/mpeg" /></item>'), "");
});

test("article HTML image extraction supports Open Graph, Twitter, image_src, and relative URLs", () => {
  assert.equal(
    extractHtmlImageUrl('<meta property="og:image" content="/images/story.jpg">', "https://publisher.example/article"),
    "https://publisher.example/images/story.jpg"
  );
  assert.equal(
    extractHtmlImageUrl('<meta name="twitter:image" content="https://cdn.example.com/story.png">'),
    "https://cdn.example.com/story.png"
  );
  assert.equal(
    extractHtmlImageUrl('<link rel="image_src" href="https://cdn.example.com/story.webp">'),
    "https://cdn.example.com/story.webp"
  );
});

test("HTML image extraction ignores insecure image metadata", () => {
  assert.equal(extractHtmlImageUrl('<meta property="og:image" content="http://cdn.example.com/story.jpg">'), "");
});


test("article HTML falls back to a real content image when metadata is absent", () => {
  const html = '<img class="site-logo" src="/logo.png" width="40" height="40"><img class="article-hero" alt="Film still" src="/images/film-still.jpg" width="1200" height="675">';
  assert.equal(
    extractHtmlImageUrl(html, "https://publisher.example/news/story"),
    "https://publisher.example/images/film-still.jpg"
  );
});

test("article HTML image fallback supports lazy-loaded images and ignores tiny tracking pixels", () => {
  const html = '<img src="/pixel.gif" width="1" height="1"><img data-src="/images/story.webp" class="story-image" width="640" height="360">';
  assert.equal(
    extractHtmlImageUrl(html, "https://publisher.example/story"),
    "https://publisher.example/images/story.webp"
  );
});


test("thumbnail cache only publishes verified local image files", async () => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { cacheArticleThumbnails } = await import("../automation/static-news-images.mjs");
  const directory = await mkdtemp(join(tmpdir(), "vivid-news-thumbs-"));
  try {
    const bytes = new Uint8Array(2048);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    const result = await cacheArticleThumbnails([{
      id: "story-1",
      sourceUrl: "https://publisher.example/story",
      imageUrl: "https://cdn.example/story.jpg"
    }], {
      outputDir: directory,
      publicPathPrefix: "./data/news-thumbnails",
      fetchImpl: async () => new Response(bytes, { headers: { "content-type": "image/jpeg" } })
    });
    assert.equal(result.cached, 1);
    assert.equal(result.stories[0].imageUrl, "./data/news-thumbnails/story-1.jpg");
    assert.equal(result.stories[0].imageFallbackUrl, "https://cdn.example/story.jpg");
    assert.deepEqual(new Uint8Array(await readFile(join(directory, "story-1.jpg"))), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("thumbnail cache preserves a remote fallback when the publisher blocks caching", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { cacheArticleThumbnails } = await import("../automation/static-news-images.mjs");
  const directory = await mkdtemp(join(tmpdir(), "vivid-news-thumbs-"));
  try {
    const result = await cacheArticleThumbnails([{
      id: "blocked-story",
      sourceUrl: "https://publisher.example/story",
      imageUrl: "https://cdn.example/story.jpg"
    }], {
      outputDir: directory,
      fetchImpl: async () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } })
    });
    assert.equal(result.cached, 0);
    assert.equal(result.remoteFallback, 1);
    assert.equal(result.stories[0].imageUrl, "https://cdn.example/story.jpg");
    assert.equal(result.stories[0].imageFallbackUrl, "https://cdn.example/story.jpg");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("news stories are always sorted newest first with invalid dates last", () => {
  const stories = [
    { id: "old", publishedAt: "2026-10-16T10:00:00Z" },
    { id: "invalid", publishedAt: null },
    { id: "newest", publishedAt: "2026-10-19T02:00:00Z" },
    { id: "middle", publishedAt: "2026-10-18T20:00:00Z" }
  ];
  assert.deepEqual(sortStoriesNewestFirst(stories).map(story => story.id), ["newest", "middle", "old", "invalid"]);
  assert.equal(stories[0].id, "old", "sorting does not mutate the input array");
});


test("Google News wrapper HTML resolves only article URLs on the publisher domain", () => {
  const html = '<link rel="canonical" href="https://www.example.com/entertainment/story-123"><a href="https://news.google.com/">Google News</a><a href="https://other.example/story">Other site</a>';
  assert.equal(extractPublisherArticleUrl(html, "https://news.google.com/rss/articles/example", "https://example.com"), "https://www.example.com/entertainment/story-123");
  assert.equal(extractPublisherArticleUrl('<a href="https://other.example/story">Story</a>', "https://news.google.com/", "https://example.com"), "");
});


test("Google News URL decoding uses the article signature and safely parses the publisher URL", async () => {
  let request;
  const inner = JSON.stringify(["garturlres", "https://publisher.example/film/story-1"]);
  const payload = [[["wrb.fr", "Fbv4je", inner, null, null, null]]];
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(")]}'\n\n" + JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const html = '<div data-n-a-sg="signature-value" data-n-a-ts="1770000000"></div>';
  const result = await decodeGoogleNewsArticleUrl(
    "https://news.google.com/rss/articles/CBMiExampleId?oc=5",
    html,
    { fetchImpl }
  );
  assert.equal(result, "https://publisher.example/film/story-1");
  assert.equal(request.options.method, "POST");
  assert.match(request.options.headers["Content-Type"], /application\/x-www-form-urlencoded/);
  assert.match(request.options.body, /Fbv4je/);
});

test("Google News URL decoding skips pages without signature metadata", async () => {
  let called = false;
  const result = await decodeGoogleNewsArticleUrl(
    "https://news.google.com/rss/articles/CBMiExampleId",
    "<html><title>Google News</title></html>",
    { fetchImpl: async () => { called = true; return new Response(""); } }
  );
  assert.equal(result, "");
  assert.equal(called, false);
});
