import test from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, achievementProgress } from "../scripts/achievement-catalog.js";

const byId = id => ACHIEVEMENTS.find(item => item.id === id);

test("achievement catalog has stable, unique ids and meaningful targets", () => {
  assert.equal(ACHIEVEMENTS.length, 16);
  assert.equal(new Set(ACHIEVEMENTS.map(item => item.id)).size, ACHIEVEMENTS.length);
  for (const item of ACHIEVEMENTS) {
    assert.ok(item.id && item.title && item.description && item.category);
    assert.ok(Number.isInteger(item.target) && item.target > 0);
    assert.equal(typeof item.metric, "function");
  }
});

test("favorite and Watch Later milestones only use their own collections", () => {
  const library = {
    favorites: Array.from({ length: 5 }, (_, i) => ({ id: String(i + 1), media_type: "movie" })),
    watchLater: [{ id: "8", media_type: "movie" }],
    history: []
  };
  assert.equal(byId("favorites-5").metric(library), 5);
  assert.equal(byId("queue-first").metric(library), 1);
  assert.equal(byId("history-first").metric(library), 0);
  assert.equal(byId("completion-first").metric(library), 0);
});

test("completion milestones require explicit completion evidence", () => {
  const library = { favorites: [], watchLater: [], history: [
    { id: "1", media_type: "movie", completion: 42 },
    { id: "2", media_type: "movie", completion: 90 },
    { id: "3", media_type: "tv", completedAt: 1234 },
    { id: "4", media_type: "movie", completed: true }
  ] };
  assert.equal(byId("completion-first").metric(library), 3);
  assert.equal(byId("completion-5").metric(library), 3);
});

test("distinct-library milestone deduplicates the same title across shelves", () => {
  const library = {
    favorites: [{ id: "1", media_type: "movie" }, { id: "2", media_type: "movie" }],
    watchLater: [{ id: "1", media_type: "movie" }, { id: "3", media_type: "tv" }],
    history: [{ id: "2", media_type: "movie" }, { id: "3", media_type: "tv" }]
  };
  assert.equal(byId("library-25").metric(library), 3);
  assert.equal(byId("whole-picture").metric(library), 1);
});

test("progress remains bounded and reaches 100 percent at the target", () => {
  const items = achievementProgress({
    favorites: Array.from({ length: 100 }, (_, i) => ({ id: String(i), media_type: "movie" })),
    watchLater: [], history: []
  });
  const ten = items.find(item => item.id === "favorites-10");
  assert.equal(ten.percentage, 100);
  assert.equal(ten.progress, 10);
  const untouched = items.find(item => item.id === "queue-first");
  assert.equal(untouched.percentage, 0);
  assert.equal(untouched.progress, 0);
});
