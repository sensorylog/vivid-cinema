import test from "node:test";
import assert from "node:assert/strict";
import { createShakaOfflineAdapter } from "../scripts/downloads/shaka-offline-adapter.js";

function fakeShaka() {
  const state = { config: null, loaded: null, removed: [], stored: [], filter: null, destroyed: false };
  class Player {
    static isBrowserSupported() { return true; }
    constructor(video) { this.video = video; this.engine = {
      registerRequestFilter(fn) { state.filter = fn; },
      unregisterRequestFilter(fn) { if (state.filter === fn) state.filter = null; }
    }; }
    getNetworkingEngine() { return this.engine; }
    async load(uri) { state.loaded = uri; }
    async unload() { state.loaded = null; }
    async destroy() { state.destroyed = true; }
  }
  class Storage {
    constructor(player) { this.player = player; }
    configure(config) { state.config = config; }
    store(url, metadata, mime) {
      state.stored.push({ url, metadata, mime });
      const stored = { offlineUri: "offline:17", appMetadata: metadata };
      state.config.offline.progressCallback(stored, 0.5);
      return { promise: Promise.resolve(stored), abort() {} };
    }
    async list() { return state.stored.map(item => ({ offlineUri: "offline:17", appMetadata: item.metadata })); }
    async remove(uri) { state.removed.push(uri); }
    async destroy() {}
  }
  return { api: { polyfill: { installAll() {} }, Player, offline: { Storage } }, state };
}

const video = { playsInline: false, controls: false, preload: "" };

test("Shaka adapter stores authorized HLS/DASH manifests and reports progress", async () => {
  const { api, state } = fakeShaka();
  const progress = [];
  const adapter = createShakaOfflineAdapter({
    video,
    allowedHosts: ["media.example.test"],
    shakaLoader: async () => api,
    resolve: async () => ({
      type: "dash",
      url: "https://media.example.test/movie/manifest.mpd",
      allowedHosts: ["media.example.test"],
      size: 1000
    })
  });
  const asset = await adapter.download({
    id: "job-1", quality: "720p",
    media: { title: "Example", media_type: "movie" }
  }, { onProgress: value => progress.push(value) });
  assert.equal(asset.uri, "offline:17");
  assert.equal(state.stored[0].mime, "application/dash+xml");
  assert.equal(state.stored[0].metadata.vividJobId, "job-1");
  assert.equal(progress[0].bytesDownloaded, 500);
  assert.equal(progress[0].totalBytes, 1000);
  const chosen = state.config.offline.trackSelectionCallback([
    { id: 1, type: "variant", height: 1080, bandwidth: 900 },
    { id: 2, type: "variant", height: 720, bandwidth: 500 },
    { id: 3, type: "text", language: "en" }
  ]);
  assert.deepEqual(chosen.map(track => track.id), [2, 3]);
});

test("Shaka adapter rejects unapproved hosts and non-adaptive formats", async () => {
  const { api } = fakeShaka();
  const adapter = createShakaOfflineAdapter({
    video, allowedHosts: ["media.example.test"], shakaLoader: async () => api,
    resolve: async () => ({ type: "hls", url: "https://evil.example/movie.m3u8" })
  });
  await assert.rejects(adapter.download({ id: "job-2", media: {} }), /not HTTPS or its host is not authorized/);
  const direct = createShakaOfflineAdapter({
    video, allowedHosts: ["media.example.test"], shakaLoader: async () => api,
    resolve: async () => ({ type: "file", url: "https://media.example.test/movie.mp4" })
  });
  await assert.rejects(direct.download({ id: "job-3", media: {} }), /HLS or DASH VOD/);
});

test("Shaka adapter can play, stop and remove an offline asset", async () => {
  const { api, state } = fakeShaka();
  const adapter = createShakaOfflineAdapter({
    video, allowedHosts: ["media.example.test"], shakaLoader: async () => api,
    resolve: async () => ({ type: "hls", url: "https://media.example.test/movie.m3u8" })
  });
  await adapter.playAsset({ uri: "offline:17" });
  assert.equal(state.loaded, "offline:17");
  await adapter.stopAsset();
  assert.equal(state.loaded, null);
  await adapter.removeAsset({ asset: { uri: "offline:17" } });
  assert.deepEqual(state.removed, ["offline:17"]);
  await adapter.destroy();
  assert.equal(state.destroyed, true);
});
