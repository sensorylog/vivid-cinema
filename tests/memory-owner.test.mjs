import test from "node:test";
import assert from "node:assert/strict";
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
