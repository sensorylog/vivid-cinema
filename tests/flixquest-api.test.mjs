import test from "node:test";
import assert from "node:assert/strict";
import { createFlixQuestApi } from "../scripts/downloads/flixquest-api.js";

const response = (body, extra = {}) => ({ ok: true, status: 200, json: async () => body, ...extra });

test("requires a clean HTTPS API base URL and appends v2 exactly once", async () => {
  assert.throws(() => createFlixQuestApi({ baseUrl: "http://localhost:3000" }), /HTTPS/);
  assert.throws(() => createFlixQuestApi({ baseUrl: "https://user:pass@example.com" }), /HTTPS/);
  assert.throws(() => createFlixQuestApi({ baseUrl: "https://example.com?token=x" }), /HTTPS/);
  for (const baseUrl of ["https://scraper.example", "https://scraper.example/", "https://scraper.example/api/v2/"]) {
    let requested;
    const api = createFlixQuestApi({ baseUrl, fetchImpl: async url => { requested = new URL(url); return response({ providers: [] }); } });
    await api.getProviders();
    assert.equal(requested.pathname, "/api/v2/providers");
  }
});

test("lists enabled providers and sends requests without credentials", async () => {
  let requested;
  const api = createFlixQuestApi({
    baseUrl: "https://scraper.example/api/v2/",
    fetchImpl: async (url, init) => { requested = { url, init }; return response({ providers: [{ id: "alpha", name: "Alpha", enabled: true }, { id: "off", enabled: false }] }); }
  });
  assert.deepEqual(await api.getProviders(), [{ id: "alpha", name: "Alpha" }]);
  assert.match(requested.url, /\/api\/v2\/providers$/);
  assert.equal(requested.init.credentials, "omit");
  assert.equal(requested.init.redirect, "error");
});

test("builds documented movie and TV resolver requests", async () => {
  const urls = [];
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async url => { urls.push(new URL(url)); return response({ links: [] }); } });
  await api.getStreams({ mediaType: "movie", tmdbId: 123, providerId: "alpha" });
  await api.getStreams({ mediaType: "tv", tmdbId: 456, providerId: "alpha", season: 2, episode: 4 });
  assert.equal(urls[0].pathname, "/api/v2/stream-movie");
  assert.equal(urls[0].searchParams.get("tmdbId"), "123");
  assert.equal(urls[1].pathname, "/api/v2/stream-tv");
  assert.equal(urls[1].searchParams.get("season"), "2");
  assert.equal(urls[1].searchParams.get("episode"), "4");
});

test("never treats ordinary stream links as downloadable files, even with an offline flag", async () => {
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async () => response({ links: [
    { url: "https://cdn.example/video.m3u8", quality: "1080p", isM3U8: true, offlineDownload: true, mimeType: "video/mp4" },
    { url: "https://cdn.example/movie.mp4", quality: "720p", mimeType: "video/mp4", offlineDownload: true }
  ] }) });
  const args = { mediaType: "movie", tmdbId: 1, providerId: "alpha" };
  assert.deepEqual(await api.getDownloadOptions(args), []);
  await assert.rejects(api.resolveDownload(args, "0"), /did not explicitly authorize/);
});

test("accepts only explicit offline direct-file metadata and rejects unsafe URLs", async () => {
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async () => response({ links: [
    { id: "file", downloadUrl: "https://cdn.example/a.mp4", quality: "1080p", offlineDownload: true, mimeType: "video/mp4" },
    { id: "manifest", downloadUrl: "https://cdn.example/a.m3u8", offlineDownload: true, mimeType: "application/vnd.apple.mpegurl" },
    { id: "wrong", downloadUrl: "https://cdn.example/a.mp4", offlineDownload: false, mimeType: "video/mp4" },
    { id: "http", downloadUrl: "http://cdn.example/a.mp4", offlineDownload: true, mimeType: "video/mp4" },
    { id: "query", downloadUrl: "https://cdn.example/a.mp4?token=secret", offlineDownload: true, mimeType: "video/mp4" }
  ] }) });
  const args = { mediaType: "movie", tmdbId: 1, providerId: "alpha" };
  assert.deepEqual(await api.getDownloadOptions(args), [{ id: "file", quality: "1080p", mimeType: "video/mp4" }]);
  assert.deepEqual(await api.resolveDownload(args, "file"), { url: "https://cdn.example/a.mp4", mimeType: "video/mp4" });
  await assert.rejects(api.resolveDownload(args, "http"), /did not explicitly authorize/);
});

test("propagates API errors and rejects redirected responses", async () => {
  const failing = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async () => response({ message: "Unavailable" }, { ok: false, status: 503 }) });
  await assert.rejects(failing.getProviders(), /Unavailable/);
  const redirected = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async () => response({}, { redirected: true, url: "https://other.example/providers" }) });
  await assert.rejects(redirected.getProviders(), /redirected/);
});
