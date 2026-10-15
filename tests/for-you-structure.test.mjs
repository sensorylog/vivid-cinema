import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../for-you.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../scripts/for-you.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../scripts/routes.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../scripts/config.js", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");

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
  assert.match(serviceWorker, /"\.\/styles\/vivid-for-you\.css"/);
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
  assert.match(script, /recordBehavior\("recommendation_clicked"/);
});
