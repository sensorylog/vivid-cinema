import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const title = read("../scripts/title.js");
const watch = read("../scripts/watch.js");
const intelligence = read("../scripts/intelligence.js");
const recommendations = read("../scripts/recommendations.js");
const forYou = read("../scripts/for-you.js");
const home = read("../script.js");
const serviceWorker = read("../service-worker.js");

test("title detail opens and trailer starts feed bounded Intelligence signals", () => {
  assert.match(title, /import \{ recordBehavior \} from "\.\/intelligence\.js"/);
  assert.match(title, /recordBehavior\("title_opened", media, \{ surface: "title" \}\)/);
  assert.match(title, /recordBehavior\("trailer_started", media, \{ surface: "title" \}\)/);
  assert.match(title, /recordBehavior\("recommendation_clicked", item, \{ surface: "title" \}\)/);
});

test("playback start, progress and completion still feed the canonical Memory stores", () => {
  assert.match(watch, /recordBehavior\("watch_started", media/);
  assert.match(watch, /recordBehavior\("playback_progress", media/);
  assert.match(watch, /recordBehavior\("watch_completed", media/);
  assert.match(watch, /completePlaybackProgress\(progressKey\(\)/);
  assert.match(watch, /upsertLibraryItem\("history"/);
});

test("meaningful viewing signals stale the taste profile and can seed it", () => {
  assert.match(intelligence, /TASTE_SIGNAL_TYPES=new Set/);
  assert.match(intelligence, /if\(TASTE_SIGNAL_TYPES\.has\(type\)\)s\.taste\.updatedAt=0/);
  assert.match(intelligence, /const behavioralItems=new Map/);
  assert.match(intelligence, /all\.push\(\.\.\.eventBoosted,\.\.\.behavioralItems\.values\(\)\)/);
});

test("behavior deduplication is bounded and events remain capped", () => {
  assert.match(intelligence, /duplicateWindow=.*title_opened.*trailer_started.*watch_started/);
  assert.match(intelligence, /s\.events\.length>300/);
});

test("recommendation cache fingerprint includes all observed library collections and progress", () => {
  assert.match(recommendations, /"library:" \+ observed\.map/);
  assert.match(recommendations, /"recommendationMemory:" \+ recommendationMemoryFingerprint/);
  assert.match(recommendations, /"taste:" \+ Number\(taste\.updatedAt \|\| 0\)/);
  assert.match(recommendations, /"rotation:" \+ new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test("For You rejects stale overlapping requests and reacts to canonical change events", () => {
  assert.match(forYou, /const thisRequest = \+\+requestId/);
  assert.match(forYou, /if \(thisRequest !== requestId\) return/);
  assert.match(forYou, /vivid:recommendations-invalidated/);
  assert.match(forYou, /vivid:library-changed/);
  assert.match(forYou, /vivid:progress-changed/);
});

test("Home clears and refreshes personalized shelves on owner changes and guards stale requests", () => {
  assert.match(home, /homeRecommendationRequestId/);
  assert.match(home, /tonightPickRequestId/);
  assert.match(home, /expectedRequestId !== homeRecommendationRequestId/);
  assert.match(home, /vivid:account-switched/);
  assert.match(home, /vivid:library-changed/);
  assert.match(recommendations, /const ownerAtStart = currentProgressOwner\(\)/);
  assert.match(recommendations, /if \(currentProgressOwner\(\) !== ownerAtStart\) return \[\]/);
});

test("service worker keeps the integration shell versioned and For You assets precached", () => {
  assert.match(serviceWorker, /const CACHE_NAME = "vivid-cinema-shell-v\d+"/);
  assert.match(serviceWorker, /"\.\/for-you\.html"/);
  assert.match(serviceWorker, /"\.\/scripts\/for-you\.js"/);
  assert.match(serviceWorker, /"\.\/scripts\/intelligence\.js"/);
});
