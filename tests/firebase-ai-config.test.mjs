import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiSource = await readFile(path.join(root, "scripts/firebase-ai.js"), "utf8");
const chatSource = await readFile(path.join(root, "scripts/vivid-recall-chat.js"), "utf8");
const workerSource = await readFile(path.join(root, "service-worker.js"), "utf8");

test("Vivid Recall uses the stable, lower-cost Gemini Flash-Lite model", () => {
  assert.match(aiSource, /const RECALL_MODEL = "gemini-3\.5-flash-lite"/);
  assert.match(aiSource, /ThinkingLevel\.MINIMAL/);
  assert.doesNotMatch(aiSource, /gemini-3\.8-flash/);
});

test("Gemini request timeouts attempt to abort the underlying browser request", () => {
  assert.match(aiSource, /model\.generateContent\(prompt, \{ signal: controller\.signal \}\)/);
  assert.match(aiSource, /controller\.abort\(\)/);
  assert.match(aiSource, /CLUE_TIMEOUT_MS = 12000/);
  assert.match(aiSource, /CHAT_TIMEOUT_MS = 30000/);
});

test("Recall keeps detailed quota and provider errors visible for diagnosis", () => {
  assert.match(chatSource, /error\?\.customData/);
  assert.match(chatSource, /errorDiagnostic\(error\)/);
  assert.match(chatSource, /quotaFailure/);
  assert.match(chatSource, /full diagnostic/);
  assert.match(chatSource, /Gemini 429/);
});

test("service worker cache version changes with the updated AI modules", () => {
  assert.match(workerSource, /vivid-cinema-shell-v\d+/);
});

test("achievement Sparks reuse the existing Recall model and App Check protections", () => {
  assert.match(aiSource, /export async function generateAchievementSpark/);
  assert.match(aiSource, /const SPARK_TIMEOUT_MS = 10000/);
  assert.match(aiSource, /const model = await getRecallModel\(\)/);
  assert.match(aiSource, /if \(appCheckSkippedReason\)/);
  assert.match(aiSource, /if \(appCheckError\)/);
  assert.match(aiSource, /Never fabricate historical claims, dates, quotations, statistics/);
  assert.match(aiSource, /35 to 65 words maximum/);
  assert.match(aiSource, /payload\?\.confidence !== "high"/);
  assert.match(aiSource, /recentSparks/);
  assert.match(aiSource, /wordCount < 28 \|\| wordCount > 70/);
  assert.match(aiSource, /export async function getRecallClues/);
  assert.match(aiSource, /export async function sendRecallChatMessage/);
});

test("Vivid Recall retries only transient App Check token startup failures once", () => {
  assert.match(aiSource, /function isTransientAppCheckError\(error\)/);
  assert.match(aiSource, /attempt !== 0 \|\| !isTransientAppCheckError\(error\)/);
  assert.match(aiSource, /retrying once after a transient App Check token startup failure/);
  assert.ok(aiSource.includes("resource.exhausted|quota"));
  assert.match(aiSource, /controller\.abort\(\)/);
});
