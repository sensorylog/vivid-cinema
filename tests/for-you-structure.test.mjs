import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../for-you.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../scripts/for-you.js", import.meta.url), "utf8");

test("For You page is registered as a real, accessible destination", () => {
  assert.match(html, /data-vivid-page="for-you"/);
  assert.match(html, /href="for-you\.html" aria-current="page"/);
  assert.match(html, /aria-label="Primary"/);
  assert.match(html, /id="intent-query"/);
  assert.match(html, /id="recommendation-grid"/);
  assert.match(html, /id="recommendation-status"[^>]*role="status"/);
});

test("For You provides loading, empty, retry and secondary Memory states", () => {
  for (const id of ["recommendation-status", "recommendation-empty", "recommendation-error", "retry-recommendations", "continue-section", "because-section", "intent-summary"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing UI state: " + id);
  }
});

test("For You wires deterministic intent parsing and canonical recommendation/feedback helpers", () => {
  assert.match(script, /from "\.\/intent-parser\.js"/);
  assert.match(script, /getIntentRecommendations/);
  assert.match(script, /getPersonalRecommendations/);
  assert.match(script, /getContinueWatching/);
  assert.match(script, /setFeedback/);
  assert.match(script, /recordBehavior\("recommendation_clicked"/);
});
