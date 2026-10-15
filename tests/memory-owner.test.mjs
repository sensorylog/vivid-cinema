import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { switchAccountStorage } from "../scripts/account-storage.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); }
  };
}

test("first sign-in claims anonymous memory without discarding it", () => {
  const storage = createStorage({ "vivid:progress:v1": '{"movie:11":{"progress":45}}' });
  const result = switchAccountStorage({
    storage, ownerKey: "vivid:progress-owner:v1", keys: ["vivid:progress:v1"], uid: "alice"
  });
  assert.equal(result.claimedAnonymousState, true);
  assert.equal(storage.getItem("vivid:progress-owner:v1"), "alice");
  assert.equal(storage.getItem("vivid:progress:v1"), '{"movie:11":{"progress":45}}');
});

test("switching accounts snapshots outgoing state and never exposes it to the next account", () => {
  const storage = createStorage({
    "vivid:progress-owner:v1": "alice",
    "vivid:progress:v1": '{"movie:11":{"progress":45}}',
    "vivid:progress:v1:user:bob": '{"tv:22:1:3":{"progress":120}}',
    "vivid:for-you:v1": "stale-cache"
  });
  const result = switchAccountStorage({
    storage,
    ownerKey: "vivid:progress-owner:v1",
    keys: ["vivid:progress:v1"],
    clearKeys: ["vivid:for-you:v1"],
    uid: "bob"
  });
  assert.equal(result.changed, true);
  assert.equal(result.previousOwner, "alice");
  assert.equal(storage.getItem("vivid:progress:v1:user:alice"), '{"movie:11":{"progress":45}}');
  assert.equal(storage.getItem("vivid:progress:v1"), '{"tv:22:1:3":{"progress":120}}');
  assert.equal(storage.getItem("vivid:for-you:v1"), null);
  assert.equal(storage.getItem("vivid:progress-owner:v1"), "bob");
});

test("switching back restores the original account snapshot", () => {
  const storage = createStorage({
    "vivid:progress-owner:v1": "bob",
    "vivid:progress:v1": '{"tv:22:1:3":{"progress":120}}',
    "vivid:progress:v1:user:alice": '{"movie:11":{"progress":45}}'
  });
  switchAccountStorage({
    storage, ownerKey: "vivid:progress-owner:v1", keys: ["vivid:progress:v1"], uid: "alice"
  });
  assert.equal(storage.getItem("vivid:progress:v1"), '{"movie:11":{"progress":45}}');
  assert.equal(storage.getItem("vivid:progress:v1:user:bob"), '{"tv:22:1:3":{"progress":120}}');
});

test("an account with no local snapshot starts clean", () => {
  const storage = createStorage({
    "vivid:progress-owner:v1": "alice",
    "vivid:progress:v1": '{"movie:11":{"progress":45}}'
  });
  switchAccountStorage({
    storage, ownerKey: "vivid:progress-owner:v1", keys: ["vivid:progress:v1"], uid: "bob"
  });
  assert.equal(storage.getItem("vivid:progress:v1"), null);
  assert.equal(storage.getItem("vivid:progress:v1:user:alice"), '{"movie:11":{"progress":45}}');
});

test("playback and intelligence modules use account-scoped snapshots", () => {
  const progress = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  const intelligence = readFileSync(new URL("../scripts/intelligence.js", import.meta.url), "utf8");
  assert.match(progress, /switchAccountStorage\(/);
  assert.match(intelligence, /switchAccountStorage\(/);
  assert.match(progress, /localStorage\.getItem\(LOCAL_OWNER_KEY\) !== String\(user\.uid\)/);
  assert.match(intelligence, /localStorage\.getItem\(LOCAL_OWNER_KEY\)!==String\(u\.uid\)/);
});

test("playback sync uploads local-only records and keeps auth listeners for later account changes", () => {
  const progress = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
  const intelligence = readFileSync(new URL("../scripts/intelligence.js", import.meta.url), "utf8");
  assert.match(progress, /if \(!remoteIds\.has\(contentId\)\) queueRemoteProgress\(contentId, item\)/);
  assert.match(progress, /onAuthStateChanged\(auth, user =>/);
  assert.match(intelligence, /onAuthStateChanged\(auth,u=>/);
  assert.doesNotMatch(progress.slice(progress.indexOf("export function startPlaybackSync"), progress.indexOf("export function getLatestPlaybackProgress")), /unsubscribe/);
  assert.doesNotMatch(intelligence.slice(intelligence.indexOf("export function startIntelligenceSync")), /unsub\?\./);
});

test("intelligence writes and taste rebuilds are guarded against account switches", () => {
  const intelligence = readFileSync(new URL("../scripts/intelligence.js", import.meta.url), "utf8");
  assert.match(intelligence, /ownerAtWrite=localStorage\\.getItem\(LOCAL_OWNER_KEY\)/);
  assert.match(intelligence, /auth\?\.currentUser\|\|String\(auth\.currentUser\.uid\)!==String\(u\.uid\)/);
  assert.match(intelligence, /ownerAtStart&&localStorage\.getItem\(LOCAL_OWNER_KEY\)!==ownerAtStart/);
  assert.match(intelligence, /localFeedbackWrites\.push\(setDoc\(/);
});
