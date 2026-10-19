import test from "node:test";
import assert from "node:assert/strict";
import { extractHtmlImageUrl, extractRssImageUrl } from "../automation/static-news-images.mjs";

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
