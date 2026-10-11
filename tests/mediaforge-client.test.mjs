import test from "node:test";
import assert from "node:assert/strict";
import { createMediaForgeClient } from "../scripts/mediaforge-client.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json; charset=utf-8" },
    json: async () => body
  };
}

function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

const baseUrl = "https://media-api.example.test/";

test("client requires a configured HTTPS backend and a signed-in token provider", () => {
  assert.throws(() => createMediaForgeClient({ getIdToken: async () => "token" }), /not configured/);
  assert.throws(() => createMediaForgeClient({ baseUrl: "http://media-api.example.test", getIdToken: async () => "token" }), /HTTPS/);
  assert.throws(() => createMediaForgeClient({ baseUrl, getIdToken: "token" }), /token provider/);
});

test("resolveStream sends authenticated movie requests and accepts same-origin streams", async () => {
  const mock = mockFetch([jsonResponse({ stream: {
    url: "/media/session123/master.m3u8",
    type: "hls",
    audioTracks: [{ language: "en" }],
    subtitleTracks: []
  } })]);
  const client = createMediaForgeClient({ baseUrl, getIdToken: async () => "signed-token", fetchImpl: mock.fetchImpl });
  const stream = await client.resolveStream({ id: "550", type: "movie" });
  assert.equal(stream.url, "https://media-api.example.test/media/session123/master.m3u8");
  assert.equal(stream.type, "hls");
  assert.equal(mock.calls[0].options.headers.Authorization, "Bearer signed-token");
  assert.deepEqual(JSON.parse(mock.calls[0].options.body), { mediaId: "550", mediaType: "movie" });
  assert.equal(mock.calls[0].options.redirect, "error");
});

test("TV and anime require valid episode identity and send season/episode fields", async () => {
  const mock = mockFetch([jsonResponse({ stream: { url: "/anime/episode.m3u8", type: "hls" } })]);
  const client = createMediaForgeClient({ baseUrl, getIdToken: async () => "token", fetchImpl: mock.fetchImpl });
  await assert.rejects(client.resolveStream({ id: "show1", type: "tv" }, { season: 1 }), /season and episode/);
  assert.equal(mock.calls.length, 0);
  const stream = await client.resolveStream({ id: "show1", type: "anime" }, { season: 1, episode: 2 });
  assert.equal(stream.type, "hls");
  assert.deepEqual(JSON.parse(mock.calls[0].options.body), {
    mediaId: "show1", mediaType: "anime", season: 1, episode: 2
  });
});

test("rejects streams and download links on untrusted origins", async () => {
  const mock = mockFetch([
    jsonResponse({ stream: { url: "https://evil.example/stream.m3u8", type: "hls" } }),
    jsonResponse({ jobId: "job_1", status: "queued" }),
    jsonResponse({ status: "ready", progress: 100, downloadUrl: "https://evil.example/file.mp4" })
  ]);
  const client = createMediaForgeClient({ baseUrl, getIdToken: async () => "token", fetchImpl: mock.fetchImpl });
  await assert.rejects(client.resolveStream({ id: "550", type: "movie" }), /configured backend origin/);
  const job = await client.startDownload({ id: "550", type: "movie" });
  assert.equal(job.jobId, "job_1");
  await assert.rejects(client.getDownload(job.jobId), /configured backend origin/);
});

test("download progress is bounded and ready downloads return a safe same-origin URL", async () => {
  const mock = mockFetch([
    jsonResponse({ jobId: "job_2", status: "queued" }),
    jsonResponse({ status: "ready", progress: 180, filename: "movie.mp4", downloadUrl: "/downloads/job_2" })
  ]);
  const client = createMediaForgeClient({ baseUrl, getIdToken: async () => "token", fetchImpl: mock.fetchImpl });
  const job = await client.startDownload({ id: "550", type: "movie" });
  const result = await client.getDownload(job.jobId);
  assert.equal(result.status, "ready");
  assert.equal(result.progress, 100);
  assert.equal(result.downloadUrl, "https://media-api.example.test/downloads/job_2");
});

test("invalid IDs and media types are rejected before making network requests", async () => {
  const mock = mockFetch([]);
  const client = createMediaForgeClient({ baseUrl, getIdToken: async () => "token", fetchImpl: mock.fetchImpl });
  await assert.rejects(client.resolveStream({ id: "../secret", type: "movie" }), /valid media ID/);
  await assert.rejects(client.resolveStream({ id: "1", type: "other" }), /Media type/);
  await assert.rejects(client.getDownload("../secret"), /valid download job ID/);
  assert.equal(mock.calls.length, 0);
});

test("auth failures and backend outages produce safe user-facing errors", async () => {
  const authMock = mockFetch([jsonResponse({}, 401)]);
  const authClient = createMediaForgeClient({ baseUrl, getIdToken: async () => "token", fetchImpl: authMock.fetchImpl });
  await assert.rejects(authClient.resolveStream({ id: "1", type: "movie" }), /Sign in again/);
  const outageMock = mockFetch([new Error("secret upstream URL")]);
  const outageClient = createMediaForgeClient({ baseUrl, getIdToken: async () => "token", fetchImpl: outageMock.fetchImpl });
  await assert.rejects(outageClient.resolveStream({ id: "1", type: "movie" }), /Could not reach/);
});
