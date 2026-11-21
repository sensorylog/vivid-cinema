import test from "node:test";
import assert from "node:assert/strict";
import {
  getExpectedPlaybackPosition,
  isPlaybackRevisionStale,
  normalizePlaybackTimestamp,
  shouldCorrectPlayback,
  shouldThrottlePlaybackWrite,
  getEstimatedLocalPlaybackPosition,
  classifyPlaybackEvent
} from "../scripts/playback/watch-room-sync.js";

test("playing position advances from the server timestamp and measured clock offset", () => {
  const position = getExpectedPlaybackPosition({
    status: "playing", position: 120, duration: 3600, updatedAt: 10_000
  }, { nowMs: 12_000, clockOffsetMs: 500 });
  assert.equal(position, 122.5);
});

test("paused and ended positions do not advance", () => {
  for (const status of ["paused", "ended"]) {
    assert.equal(getExpectedPlaybackPosition({
      status, position: 120, duration: 3600, updatedAt: 10_000
    }, { nowMs: 90_000 }), 120);
  }
});

test("playback position is clamped to its known duration and global safety bound", () => {
  assert.equal(getExpectedPlaybackPosition({
    status: "playing", position: 3599, duration: 3600, updatedAt: 1
  }, { nowMs: 10_000 }), 3600);
  assert.equal(getExpectedPlaybackPosition({
    status: "paused", position: 90_000, duration: 0, updatedAt: 1
  }), 86400);
});

test("Firestore timestamps and numeric timestamps normalize consistently", () => {
  assert.equal(normalizePlaybackTimestamp({ toMillis: () => 1234 }), 1234);
  assert.equal(normalizePlaybackTimestamp(1234), 1234);
  assert.equal(normalizePlaybackTimestamp("invalid"), 0);
});

test("drift correction uses a bounded tolerance and handles an uninitialized player", () => {
  assert.equal(shouldCorrectPlayback(100, 100.5), false);
  assert.equal(shouldCorrectPlayback(100, 102), true);
  assert.equal(shouldCorrectPlayback(100, null), true);
  assert.equal(shouldCorrectPlayback(-1, 0), false);
});

test("older playback revisions are ignored but equal and newer revisions remain valid", () => {
  assert.equal(isPlaybackRevisionStale(4, 5), true);
  assert.equal(isPlaybackRevisionStale(5, 5), false);
  assert.equal(isPlaybackRevisionStale(6, 5), false);
});

test("only repeated playing heartbeats are rate-limited, never pause or resume transitions", () => {
  assert.equal(shouldThrottlePlaybackWrite("playing", "playing", 1_000, 2_000), true);
  assert.equal(shouldThrottlePlaybackWrite("paused", "playing", 1_000, 1_100), false);
  assert.equal(shouldThrottlePlaybackWrite("playing", "paused", 1_000, 1_100), false);
  assert.equal(shouldThrottlePlaybackWrite("playing", "playing", 1_000, 2_800), false);
  assert.equal(shouldThrottlePlaybackWrite("playing", "playing", 2_000, 1_900), false);
  assert.equal(shouldThrottlePlaybackWrite("ended", "playing", 1_000, 1_100), false);
  assert.equal(shouldThrottlePlaybackWrite("playing", "playing", 1_000, 1_100, 0), false, "a seek control event must bypass the progress heartbeat throttle");
});


test("local playback clock is extrapolated from its last observed position", () => {
  assert.equal(getEstimatedLocalPlaybackPosition({
    position: 100, status: "playing", duration: 500, observedAtMs: 10_000
  }, { nowMs: 12_500 }), 102.5);
  assert.equal(getEstimatedLocalPlaybackPosition({
    position: 100, status: "paused", duration: 500, observedAtMs: 10_000
  }, { nowMs: 12_500 }), 100);
  assert.equal(getEstimatedLocalPlaybackPosition({
    position: 499, status: "playing", duration: 500, observedAtMs: 10_000
  }, { nowMs: 12_500 }), 500);
  assert.equal(getEstimatedLocalPlaybackPosition({ position: null }), null);
});

test("playback event classification separates commands from progress heartbeats", () => {
  assert.equal(classifyPlaybackEvent({ event: "playing", status: "playing", previousStatus: "paused" }), "play");
  assert.equal(classifyPlaybackEvent({ event: "playing", status: "playing", previousStatus: "playing" }), "progress");
  assert.equal(classifyPlaybackEvent({ event: "play", status: "playing", previousStatus: "playing" }), "play");
  assert.equal(classifyPlaybackEvent({ event: "timeupdate", status: "playing", previousStatus: "playing" }), "progress");
  assert.equal(classifyPlaybackEvent({ event: "seeked", status: "seeked", previousStatus: "playing" }), "seek");
  assert.equal(classifyPlaybackEvent({ event: "pause", status: "paused", previousStatus: "playing" }), "pause");
  assert.equal(classifyPlaybackEvent({ event: "ended", status: "ended", previousStatus: "playing" }), "ended");
});
