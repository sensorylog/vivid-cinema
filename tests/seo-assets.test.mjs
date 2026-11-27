import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateSeoAssets } from "../automation/generate-seo-assets.mjs";

test("static SEO build emits canonical metadata, structured data and a curated sitemap", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vivid-seo-"));
  try {
    await mkdir(path.join(directory, "icons"), { recursive: true });
    await writeFile(path.join(directory, "index.html"), '<!doctype html><html><head><title>Old title</title><meta name="description" content="Old description"><script type="application/ld+json">{}</script></head><body><footer>Footer</footer></body></html>');
    await writeFile(path.join(directory, "home.html"), '<!doctype html><html><head><title>Old home</title></head><body></body></html>');
    await writeFile(path.join(directory, "title.html"), '<!doctype html><html><head><title>Dynamic title</title></head><body></body></html>');
    await writeFile(path.join(directory, "library.html"), '<!doctype html><html><head><title>Library</title></head><body></body></html>');
    await writeFile(path.join(directory, "free-movies.html"), '<!doctype html><html><head><title>Free Movies</title></head><body></body></html>');
    await writeFile(path.join(directory, "tv-shows.html"), '<!doctype html><html><head><title>TV Shows</title></head><body></body></html>');
    await writeFile(path.join(directory, "anime-streaming.html"), '<!doctype html><html><head><title>Anime</title></head><body></body></html>');
    await writeFile(path.join(directory, "offline-downloads.html"), '<!doctype html><html><head><title>Offline</title></head><body></body></html>');
    await writeFile(path.join(directory, "live.html"), '<!doctype html><html><head><title>Live TV</title></head><body></body></html>');

    const result = await generateSeoAssets(directory, "https://cinema.example/");
    const index = await readFile(path.join(directory, "index.html"), "utf8");
    const home = await readFile(path.join(directory, "home.html"), "utf8");
    const title = await readFile(path.join(directory, "title.html"), "utf8");
    const library = await readFile(path.join(directory, "library.html"), "utf8");
    const sitemap = await readFile(path.join(directory, "sitemap.xml"), "utf8");
    const robots = await readFile(path.join(directory, "robots.txt"), "utf8");
    const freeMovies = await readFile(path.join(directory, "free-movies.html"), "utf8");

    assert.equal(result.origin, "https://cinema.example");
    assert.ok(result.indexedPages >= 7);
    assert.match(index, /Vivid Cinema — Discover Movies/);
    assert.match(index, /rel="canonical" href="https:\/\/cinema\.example\//);
    assert.match(index, /name="twitter:card" content="summary_large_image"/);
    assert.match(index, /application\/ld\+json/);
    assert.match(home, /Discover Movies, TV Shows & Anime/);
    assert.match(title, /Dynamic title/);
    assert.doesNotMatch(title, /noindex/);
    assert.match(library, /name="robots" content="noindex,follow"/);
    assert.match(sitemap, /https:\/\/cinema\.example\//);
    assert.doesNotMatch(sitemap, /title\.html|library\.html/);
    assert.match(robots, /Sitemap: https:\/\/cinema\.example\/sitemap\.xml/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
