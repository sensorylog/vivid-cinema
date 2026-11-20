import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiSource = await readFile(path.join(root, "scripts/firebase-ai.js"), "utf8");
const chatSource = await readFile(path.join(root, "scripts/vivid-recall-chat.js"), "utf8");
const workerSource = await readFile(path.join(root, "service-worker.js"), "utf8");
const firebaseSource = await readFile(path.join(root, "scripts/firebase.js"), "utf8");
const apiSource = await readFile(path.join(root, "cloudflare/functions/api/gemini.js"), "utf8");

test("Vivid Recall keeps Gemini Flash-Lite as its model", () => {
  assert.match(aiSource, /const RECALL_MODEL = "gemini-3\.5-flash-lite"/);
  assert.match(aiSource, /Gemini runs through Vivid's authenticated Cloudflare Pages API/);
});

test("browser Gemini requests require a signed-in Firebase user and send an ID token", () => {
  assert.match(aiSource, /auth\.currentUser/);
  assert.match(aiSource, /user\.isAnonymous/);
  assert.match(aiSource, /getIdToken\(user\)/);
  assert.match(aiSource, /fetch\("\/api\/gemini"/);
  assert.match(aiSource, /Authorization/);
  assert.doesNotMatch(aiSource, /getAI\(|GoogleAIBackend|firebase-ai\.js/);
});

test("Gemini credentials stay server-side and the Cloudflare route verifies Firebase identity", () => {
  assert.match(apiSource, /env\.GEMINI_API_KEY/);
  assert.match(apiSource, /verifyFirebaseIdToken/);
  assert.match(apiSource, /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(apiSource, /sign_in_provider === "anonymous"/);
  assert.match(apiSource, /MAX_PROMPT_CHARS/);
  assert.match(apiSource, /MAX_REQUESTS_PER_WINDOW/);
  assert.match(apiSource, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(apiSource, /X-Firebase-AppCheck|verifyAppCheckToken/);
});

test("Gemini proxy keeps request payloads bounded and rate limits authenticated users", () => {
  assert.match(apiSource, /MAX_BODY_BYTES/);
  assert.match(apiSource, /takeRateLimit\(claims\.uid\)/);
  assert.match(apiSource, /status === 429/);
  assert.match(apiSource, /Cache-Control.*no-store/);
});

test("Recall keeps useful provider and quota diagnostics", () => {
  assert.match(chatSource, /errorDiagnostic\(error\)/);
  assert.match(chatSource, /quotaFailure/);
  assert.match(chatSource, /Gemini 429/);
  assert.match(chatSource, /Gemini 401/);
});

test("App Check remains initialized for Firebase services outside the Gemini proxy", () => {
  assert.match(firebaseSource, /initializeAppCheck/);
  assert.match(firebaseSource, /ReCaptchaEnterpriseProvider/);
});

test("service worker cache version changes with the authenticated Gemini proxy", () => {
  assert.match(workerSource, /vivid-cinema-shell-v293/);
});

test("achievement Sparks, Recall chat and clue extraction still share the Gemini client", () => {
  assert.match(aiSource, /export async function generateAchievementSpark/);
  assert.match(aiSource, /export async function getRecallClues/);
  assert.match(aiSource, /export async function sendRecallChatMessage/);
});
