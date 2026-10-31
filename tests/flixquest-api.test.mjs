import test from "node:test";
import assert from "node:assert/strict";
import { createFlixQuestApi } from "../scripts/downloads/flixquest-api.js";
const response = (body, extra = {}) => ({ ok: true, status: 200, json: async () => body, ...extra });

test("requires a clean HTTPS API base URL and appends v2 exactly once", async () => {
  assert.throws(() => createFlixQuestApi({ baseUrl: "http://localhost:3000" }), /HTTPS/);
  assert.throws(() => createFlixQuestApi({ baseUrl: "https://user:pass@example.com" }), /HTTPS/);
  for (const baseUrl of ["https://scraper.example", "https://scraper.example/", "https://scraper.example/api/v2/"]) {
    let requested;
    const api = createFlixQuestApi({ baseUrl, fetchImpl: async url => { requested = new URL(url); return response({ providers: [] }); } });
    await api.getProviders();
    assert.equal(requested.pathname, "/api/v2/providers");
  }
});

test("lists enabled FlixQuest providers and sends credential-free requests", async () => {
  let requested;
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async (url, init) => {
    requested = { url, init }; return response({ providers: [{ id: "alpha", name: "Alpha", enabled: true }, { id: "off", enabled: false }] });
  }});
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
  assert.equal(urls[0].searchParams.get("full"), "true");
});

test("maps FlixQuest HLS and direct-file stream links to quality options without offline flags", async () => {
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async url => {
    if (String(url).endsWith("/providers")) return response({ providers: [{ id: "alpha", name: "Alpha", enabled: true }] });
    return response({ links: [
      { server: "Server A", url: "https://scraper.example/proxy?token=abc", isM3U8: true, quality: "1080p", sizeToken: "signed-size-token" },
      { server: "Server B", url: "https://cdn.example/movie.mp4", quality: "720p" },
      { server: "Server C", url: "https://cdn.example/movie.mpd", isDASH: true, quality: "4K" },
      { server: "Server D", url: "https://cdn.example/embed/page", quality: "1080p" },
      { server: "Unsafe", url: "http://cdn.example/movie.mp4", quality: "1080p" }
    ] });
  }});
  const options = await api.getDownloadOptions({ media_type: "movie", id: 1 });
  assert.deepEqual(options.map(item => [item.id, item.label, item.format]), [
    ["alpha::0", "1080p · Server A", "hls"],
    ["alpha::1", "720p · Server B", "file"]
  ]);
  const source = await api.resolveDownload({ media_type: "movie", id: 1 }, "alpha::0");
  assert.equal(source.type, "hls");
  assert.equal(source.url, "https://scraper.example/proxy?token=abc");
  assert.deepEqual(source.allowedHosts, ["scraper.example"]);
});

test("resolves TV episode links with season and episode and keeps request headers browser-safe", async () => {
  const urls = [];
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async url => {
    urls.push(new URL(url));
    if (String(url).includes("/providers")) return response({ providers: [{ id: "alpha", enabled: true }] });
    return response({ links: [{ server: "One", url: "https://scraper.example/episode.m3u8", isM3U8: true, quality: "1080p",
      headers: { Accept: "*/*", Origin: "https://player.example", Referer: "https://player.example/", "User-Agent": "ignored" } }] });
  }});
  const options = await api.getDownloadOptions({ media_type: "tv", id: 99, season: 3, episode: 8 });
  const source = await api.resolveDownload({ media_type: "tv", id: 99, season: 3, episode: 8 }, options[0].id);
  assert.equal(urls.some(url => url.pathname.endsWith("/stream-tv") && url.searchParams.get("season") === "3" && url.searchParams.get("episode") === "8"), true);
  assert.deepEqual(source.headers, { Accept: "*/*" });
});

test("uses the signed stream-size endpoint without submitting arbitrary stream URLs", async () => {
  let captured;
  const api = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async (url, init) => {
    captured = { url, init }; return response({ success: true, estimatedBytes: 1024 });
  }});
  const result = await api.getStreamSize("size-token");
  assert.equal(result.estimatedBytes, 1024);
  assert.equal(new URL(captured.url).pathname, "/api/v2/stream-size");
  assert.deepEqual(JSON.parse(captured.init.body), { token: "size-token" });
  assert.equal(captured.init.method, "POST");
});

test("propagates API errors and rejects redirected responses", async () => {
  const failing = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async () => response({ message: "Unavailable" }, { ok: false, status: 503 }) });
  await assert.rejects(failing.getProviders(), /Unavailable/);
  const redirected = createFlixQuestApi({ baseUrl: "https://scraper.example", fetchImpl: async () => response({}, { redirected: true, url: "https://other.example/providers" }) });
  await assert.rejects(redirected.getProviders(), /redirected/);
});
