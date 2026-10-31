import test from "node:test";
import assert from "node:assert/strict";
import { createOfflinePlaybackController } from "../scripts/downloads/offline-playback.js";

function makeVideo() {
  const listeners = new Map();
  return {
    src: "",
    currentTime: 0,
    duration: 120,
    controls: false,
    playsInline: false,
    preload: "",
    paused: true,
    loadCount: 0,
    pause() { this.paused = true; },
    load() { this.loadCount += 1; },
    removeAttribute(name) { if (name === "src") this.src = ""; },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    fire(name) {
      const callback = listeners.get(name);
      if (callback) {
        listeners.delete(name);
        callback();
      }
    }
  };
}

test("offline playback accepts only local OPFS assets and uses a local object URL", async () => {
  const video = makeVideo();
  const controller = createOfflinePlaybackController({
    video,
    adapter: { async getAssetUrl() { return "blob:https://vivid.test/offline-1"; } }
  });
  await assert.rejects(
    controller.play({ uri: "https://third-party.example/movie.mp4" }),
    /supported local offline asset/
  );
  assert.equal(await controller.play({ uri: "opfs://vivid-cinema-downloads/job_1" }), true);
  assert.equal(video.src, "blob:https://vivid.test/offline-1");
  assert.equal(video.controls, true);
  assert.equal(video.playsInline, true);
});

test("offline playback restores a saved position after metadata loads", async () => {
  const video = makeVideo();
  const controller = createOfflinePlaybackController({
    video,
    adapter: { async getAssetUrl() { return "blob:https://vivid.test/offline-2"; } }
  });
  await controller.play({ uri: "opfs://vivid-cinema-downloads/job_2" }, { startAt: 42 });
  video.fire("loadedmetadata");
  assert.equal(video.currentTime, 42);
});

test("stopping playback clears the video source and revokes its object URL", async () => {
  const video = makeVideo();
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = value => revoked.push(value);
  try {
    const controller = createOfflinePlaybackController({
      video,
      adapter: { async getAssetUrl() { return "blob:https://vivid.test/offline-3"; } }
    });
    await controller.play({ uri: "opfs://vivid-cinema-downloads/job_3" });
    await controller.stop();
    assert.equal(video.src, "");
    assert.deepEqual(revoked, ["blob:https://vivid.test/offline-3"]);
  } finally {
    URL.revokeObjectURL = originalRevoke;
  }
});

test("a superseded asynchronous asset lookup cannot replace the current playback", async () => {
  const video = makeVideo();
  let resolveAsset;
  const controller = createOfflinePlaybackController({
    video,
    adapter: { getAssetUrl() { return new Promise(resolve => { resolveAsset = resolve; }); } }
  });
  const pending = controller.play({ uri: "opfs://vivid-cinema-downloads/job_4" });
  await controller.stop();
  resolveAsset("blob:https://vivid.test/stale");
  assert.equal(await pending, false);
  assert.equal(video.src, "");
});

test("controller requires an adapter and a video element", () => {
  assert.throws(() => createOfflinePlaybackController({ video: makeVideo() }), /adapter/);
  assert.throws(() => createOfflinePlaybackController({ adapter: { getAssetUrl() {} } }), /video element/);
});
test("offline HLS uses Hls.js for local blob playlists and releases its resources on stop", async () => {
  const originalHls = globalThis.Hls;
  const revoked = [];
  const previousRevoke = URL.revokeObjectURL;
  const instances = [];
  class FakeHls {
    static isSupported() { return true; }
    constructor(config) { this.config = config; this.loaded = null; this.destroyed = false; instances.push(this); }
    attachMedia(video) { this.video = video; }
    loadSource(url) { this.loaded = url; }
    destroy() { this.destroyed = true; }
  }
  globalThis.Hls = FakeHls;
  URL.revokeObjectURL = value => revoked.push(value);
  const video = makeVideo();
  const asset = { uri: "opfs-hls://vivid-cinema-downloads/hls_job", mimeType: "application/vnd.apple.mpegurl", kind: "hls" };
  const adapter = {
    async getAssetUrl() { return "blob:https://vivid.test/offline-manifest"; },
    revokeAssetUrl(value) { revoked.push(value.uri); }
  };
  try {
    const controller = createOfflinePlaybackController({ adapter, video });
    assert.equal(await controller.play(asset), true);
    assert.equal(instances[0].loaded, "blob:https://vivid.test/offline-manifest");
    assert.throws(() => instances[0].config.fetchSetup({ url: "https://media.example.test/segment.ts" }, {}), /non-local media resource/);
    await controller.stop();
    assert.equal(instances[0].destroyed, true);
    assert.ok(revoked.includes(asset.uri));
    assert.equal(video.src, "");
  } finally {
    if (originalHls === undefined) delete globalThis.Hls;
    else globalThis.Hls = originalHls;
    URL.revokeObjectURL = previousRevoke;
  }
});

test("offline HLS falls back to native playback when Hls.js is unsupported", async () => {
  const originalHls = globalThis.Hls;
  class UnsupportedHls { static isSupported() { return false; } }
  globalThis.Hls = UnsupportedHls;
  const video = makeVideo();
  video.canPlayType = type => type === "application/vnd.apple.mpegurl" ? "maybe" : "";
  const controller = createOfflinePlaybackController({
    video,
    adapter: { async getAssetUrl() { return "blob:https://vivid.test/offline-native"; } }
  });
  try {
    assert.equal(await controller.play({ uri: "opfs-hls://vivid-cinema-downloads/native", mimeType: "application/vnd.apple.mpegurl" }), true);
    assert.equal(video.src, "blob:https://vivid.test/offline-native");
  } finally {
    await controller.stop();
    if (originalHls === undefined) delete globalThis.Hls;
    else globalThis.Hls = originalHls;
  }
});
