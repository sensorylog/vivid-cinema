import test from "node:test";
import assert from "node:assert/strict";
import { describeLoadedMedia, getContainerInfo, probePlaybackCapabilities } from "../scripts/downloads/media-capabilities.js";

test("container detection uses the filename extension without claiming codec support", () => {
  assert.deepEqual(getContainerInfo("Feature.MKV"), { extension: "mkv", label: "Matroska", mime: "video/x-matroska" });
  assert.equal(getContainerInfo("clip.mp4").label, "MP4");
  assert.equal(getContainerInfo("clip.unknown").label, "UNKNOWN (unrecognised)");
  assert.equal(getContainerInfo("no-extension").label, "Unknown container");
});

test("loaded media details report dimensions and duration but never invent a codec", () => {
  const result = describeLoadedMedia({ duration: 125.7, videoWidth: 1920, videoHeight: 1080 }, "film.mkv");
  assert.equal(result.resolution, "1920 × 1080");
  assert.equal(result.duration, 125.7);
  assert.equal(result.container.label, "Matroska");
  assert.match(result.codec, /Not exposed/);
});

test("capability probe combines canPlayType and MediaCapabilities without failing unsupported APIs", async () => {
  const calls = [];
  const video = { canPlayType: type => type.includes("avc1") ? "probably" : "" };
  const mediaCapabilities = {
    async decodingInfo(config) {
      calls.push(config);
      return { supported: config.video?.contentType.includes("avc1") || config.audio?.contentType.includes("mp4a"), smooth: true, powerEfficient: false };
    }
  };
  const report = await probePlaybackCapabilities({ video, mediaCapabilities, userAgent: "Test Chromium", platform: "Win32" });
  assert.equal(report.engine, "Chromium HTMLMediaElement");
  assert.equal(report.userAgent, "Test Chromium");
  assert.equal(report.videoProfiles.find(item => item.id === "h264").supported, true);
  assert.equal(report.audioProfiles.find(item => item.id === "aac").supported, true);
  assert.equal(report.videoProfiles.find(item => item.id === "hevc").supported, false);
  assert.equal(calls.length, 9);
  assert.match(report.note, /not a scan/);
});

test("capability probe remains useful when MediaCapabilities is unavailable", async () => {
  const report = await probePlaybackCapabilities({
    video: { canPlayType: type => type.includes("vp09") ? "maybe" : "" },
    mediaCapabilities: null,
    userAgent: "Test",
    platform: "Win32"
  });
  assert.equal(report.videoProfiles.find(item => item.id === "vp9").supported, true);
  assert.equal(report.videoProfiles.find(item => item.id === "av1").supported, false);
  assert.equal(report.audioProfiles.every(item => item.supported === false), true);
});
