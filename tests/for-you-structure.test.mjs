import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../for-you.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../scripts/for-you.js", import.meta.url), "utf8");
const recommendations = readFileSync(new URL("../scripts/recommendations.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../scripts/routes.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../scripts/config.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../scripts/app-shell.js", import.meta.url), "utf8");

test("For You page is registered as a real, accessible destination", () => {
  assert.match(html, /data-vivid-page="for-you"/);
  assert.match(html, /href="for-you\.html" aria-current="page"/);
  assert.match(html, /aria-label="Primary"/);
  assert.match(html, /id="intent-query"/);
  assert.match(html, /id="recommendation-grid"/);
  assert.match(routes, /forYou: \{ path: VIVID_CONFIG\.routes\.forYou, page: "for-you" \}/);
  assert.match(config, /forYou: "for-you\.html"/);
  assert.match(serviceWorker, /"\.\/for-you\.html"/);
  assert.match(serviceWorker, /"\.\/scripts\/intent-parser\.js"/);
  assert.match(serviceWorker, /"\.\/scripts\/plot-search\.js"/);
  assert.doesNotMatch(serviceWorker, /gemini-plot-search/);
  assert.match(serviceWorker, /"\.\/styles\/vivid-for-you\.css"/);
  assert.match(appShell, /navLink\("for-you\.html", "bi-stars", "For You", page === "for-you"\)/);
  assert.equal((appShell.match(/navLink\("for-you\.html", "bi-stars", "For You", page === "for-you"\)/g) || []).length, 2, "For You is available in desktop and mobile navigation");
  assert.match(serviceWorker, /vivid-cinema-shell-v\d+/);
  assert.match(html, /id="recommendation-status"[^>]*role="status"/);
});

test("For You provides loading, empty, retry and secondary Memory states", () => {
  for (const id of ["recommendation-status", "recommendation-empty", "recommendation-error", "retry-recommendations", "feedback-undo", "undo-feedback", "continue-section", "because-section", "intent-summary"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing UI state: " + id);
  }
});

test("For You wires deterministic intent parsing and canonical recommendation/feedback helpers", () => {
  assert.match(script, /from "\.\/intent-parser\.js"/);
  assert.match(script, /getIntentRecommendations/);
  assert.match(script, /getPersonalRecommendations/);
  assert.match(script, /getContinueWatching/);
  assert.match(script, /setFeedback/);
  assert.match(script, /data-remove-filter/);
  assert.match(script, /expectedRequestId !== requestId/);
  assert.match(script, /vivid:account-switched/);
  assert.match(script, /becauseItems = \[\]/);
  assert.match(script, /thisSecondaryRequest !== secondaryRequestId/);
  assert.match(script, /vivid:account-switched/);
  assert.match(script, /TV episodes ≤ /);
  assert.match(script, /parsed.anime && parsed.mediaType !== "movie"/);
  assert.match(script, /recordBehavior\("recommendation_clicked"/);
});

test("For You avoids undeclared intent state and consolidates account-switch recovery", () => {
  assert.doesNotMatch(script, /\bcurrentIntent\s*=/, "unused undeclared currentIntent assignment must not crash strict-mode modules");
  assert.equal((script.match(/window\.addEventListener\("vivid:account-switched"/g) || []).length, 1, "account switching must have one coordinated handler");
  assert.match(script, /requestId\+\+;\s*secondaryRequestId\+\+;/);
  assert.match(script, /showStatus\("Refreshing recommendations for this account…"\);\s*void loadRecommendations\(\);/);
  assert.match(script, /lastDismissedItem = null;/);
});

test("For You routes remembered-plot descriptions to deterministic catalogue matching", () => {
  assert.match(script, /isPlotDescriptionQuery\(intent\.query\)/);
  assert.match(script, /getPlotMatchRecommendations\(intent, 16\)/);
  assert.match(script, /Ranked by matching story clues/i);
});


test("For You records impressions only after a recommendation is actually viewable", () => {
  assert.match(script, /new IntersectionObserver\(/);
  assert.match(script, /entry\.intersectionRatio < 0\.5/);
  assert.match(script, /data-impression-index/);
  assert.match(script, /visibility: "at_least_50_percent"/);
  assert.doesNotMatch(script, /items\.slice\(0, 12\)\.forEach\(item => recordBehavior\("recommendation_impression"/);
});

test("For You exposes AI-assisted status and retains local Vivid Recall fallback", () => {
  assert.match(recommendations, /localOnly:\s*true/);
  assert.match(recommendations, /Vivid Recall is using local clue extraction and catalogue matching/);
  assert.match(recommendations, /AI clue expansion is active/);
  assert.match(script, /VIVID RECALL · Local clue matching is active/);
  assert.match(script, /AI clue expansion/);
  assert.match(script, /Using Vivid Recall’s local catalogue matcher/);
  assert.match(script, /showStatus\(recallStatusMessage \|\| \(items\.length/);
  assert.doesNotMatch(recommendations, /findSemanticPlotMatches|gemini-plot-search/i);
  assert.doesNotMatch(script, /Gemini interprets|vivid:gemini-plot-search-status/i);
});

