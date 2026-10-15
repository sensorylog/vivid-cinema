import test from "node:test";
import assert from "node:assert/strict";

const { savePlaybackProgress, getPlaybackProgress, completePlaybackProgress } =
  await import("../scripts/recommendations.js");

const values = new Map();
const timers = new Map();
let timerId = 0;
globalThis.localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); },
  clear() { values.clear(); }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
globalThis.window = {
  dispatchEvent() {},
  setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
  clearTimeout(id) { timers.delete(id); },
  addEventListener() {}
};

function reset() {
  values.clear();
  timers.clear();
  localStorage.setItem("vivid:progress:v1", "{}");
  localStorage.setItem("vivid:progress-owner:v1", "guest");
}

test("saved playback progress remains resumable and calculates a bounded percentage", () => {
  reset();
  savePlaybackProgress("movie:101", { id: "101", media_type: "movie", progress: 250, duration: 1000, title: "Example" });
  const progress = getPlaybackProgress("movie:101");
  assert.equal(progress.progress, 250);
  assert.equal(progress.percentage, 25);
  assert.equal(progress.completed, false);
});

test("explicit completion removes a title from resume progress without deleting its record", () => {
  reset();
  savePlaybackProgress("movie:102", { id: "102", media_type: "movie", progress: 950, duration: 1000, title: "Finished" });
  completePlaybackProgress("movie:102", { duration: 1000 });
  assert.equal(getPlaybackProgress("movie:102"), null);
  const saved = JSON.parse(localStorage.getItem("vivid:progress:v1"))["movie:102"];
  assert.equal(saved.completed, true);
  assert.equal(saved.percentage, 100);
  assert.ok(saved.completedAt > 0);
});

test("separate TV episode keys retain independent resume points", () => {
  reset();
  savePlaybackProgress("tv:42:1:1", { id: "42", media_type: "tv", season: 1, episode: 1, progress: 100, duration: 1200 });
  savePlaybackProgress("tv:42:1:2", { id: "42", media_type: "tv", season: 1, episode: 2, progress: 500, duration: 1200 });
  assert.equal(getPlaybackProgress("tv:42:1:1").percentage, 100 / 12);
  assert.equal(getPlaybackProgress("tv:42:1:2").percentage, 500 / 12);
  const saved = JSON.parse(localStorage.getItem("vivid:progress:v1"));
  assert.equal(Object.keys(saved).length, 2);
});
