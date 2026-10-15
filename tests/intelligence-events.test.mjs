import test from "node:test";
import assert from "node:assert/strict";
import { mergeBehaviorEvents, removeLegacySearchQueryEvents } from "../scripts/intelligence.js";
import { readFileSync } from "node:fs";

const event = (sessionId, id, occurredAt, extra = {}) => ({
  sessionId, id, occurredAt, type: "title_opened", contentId: "movie:42", ...extra
});

test("merges local and remote events without duplicating session-event identities", () => {
  const merged = mergeBehaviorEvents(
    [event("session-a", "one", 10), event("session-a", "two", 20)],
    [event("session-a", "one", 10), event("session-b", "one", 30)]
  );
  assert.deepEqual(merged.map(item => item.sessionId + "_" + item.id), [
    "session-a_one", "session-a_two", "session-b_one"
  ]);
});

test("keeps the newer version of a duplicate event and caps the newest history", () => {
  const merged = mergeBehaviorEvents(
    [event("session-a", "one", 10, { metadata: { source: "local" } })],
    [event("session-a", "one", 20, { metadata: { source: "remote" } })],
    2
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].occurredAt, 20);
  assert.equal(merged[0].metadata.source, "remote");

  const capped = mergeBehaviorEvents(
    Array.from({ length: 5 }, (_, index) => event("session", String(index), index + 1)),
    [],
    3
  );
  assert.deepEqual(capped.map(item => item.id), ["2", "3", "4"]);
});

test("ignores malformed events that cannot be assigned a stable identity", () => {
  assert.deepEqual(mergeBehaviorEvents([{ id: "missing-session" }, event("s", "valid", 1)], []), [
    event("s", "valid", 1)
  ]);
});


test("removes retired raw search-query events while preserving recommendation signals", () => {
  const kept = removeLegacySearchQueryEvents([
    event("s", "search", 10, { type: "search_query", metadata: { query: "private query" } }),
    event("s", "click", 20, { type: "recommendation_clicked" }),
    event("s", "watch", 30, { type: "watch_completed" })
  ]);
  assert.deepEqual(kept.map(item => item.id), ["click", "watch"]);
});

test("intelligence sync prunes legacy query telemetry and events outside the retained window", () => {
  const source = readFileSync(new URL("../scripts/intelligence.js", import.meta.url), "utf8");
  assert.match(source, /event\.type==="search_query"\|\|!event\.id\|\|!event\.sessionId\|\|!mergedEventIds\.has\(d\.id\)/);
  assert.match(source, /deleteDoc\(eventDoc\.ref\)/);
  assert.match(source, /mergedEventIds\.has\(eventDocId\)/);
  assert.match(source, /ownerIsCurrent\(\)/);
});
