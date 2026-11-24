import test from "node:test";
import { onRequest as vividAiRoute } from "../cloudflare/functions/api/ai.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiSource = await readFile(path.join(root, "scripts/cloudflare-ai.js"), "utf8");
const chatSource = await readFile(path.join(root, "scripts/vivid-recall-chat.js"), "utf8");
const workerSource = await readFile(path.join(root, "service-worker.js"), "utf8");
const firebaseSource = await readFile(path.join(root, "scripts/firebase.js"), "utf8");
const apiSource = await readFile(path.join(root, "cloudflare/functions/api/ai.js"), "utf8");
const wranglerSource = await readFile(path.join(root, "wrangler.toml"), "utf8");
const recommendationsSource = await readFile(path.join(root, "scripts/recommendations.js"), "utf8");
const achievementsSource = await readFile(path.join(root, "scripts/achievements.js"), "utf8");

test("Recall uses lightweight Granite; achievement Sparks stay local", () => {
  assert.ok(apiSource.includes('const MODEL = "@cf/ibm-granite/granite-4.0-h-micro"'));
  assert.match(aiSource, /Cloudflare Workers AI/);
  assert.doesNotMatch(achievementsSource, /cloudflare-ai\.js|generateAchievementSpark/);
  assert.doesNotMatch(aiSource, /firebase-ai\.js|GoogleAIBackend|getAI\(/);
});

test("browser AI requests require a signed-in Firebase user and send an ID token", () => {
  assert.match(aiSource, /getRestoredSignedInUser/);
  assert.match(aiSource, /user\.isAnonymous/);
  assert.match(aiSource, /getIdToken\(user, forceRefresh\)/);
  assert.match(aiSource, /fetch\("\/api\/ai"/);
  assert.match(aiSource, /Authorization/);
  assert.doesNotMatch(aiSource, /GEMINI_API_KEY|generativelanguage\.googleapis\.com/);
});

test("Cloudflare AI route verifies Firebase identity and uses the AI binding", () => {
  assert.match(apiSource, /verifyFirebaseIdToken/);
  assert.match(apiSource, /provider: "cloudflare-workers-ai"/);
  assert.match(apiSource, /aiBinding: Boolean\(env\.AI/);
  assert.match(apiSource, /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(apiSource, /sign_in_provider === "anonymous"/);
  assert.match(apiSource, /env\.AI\.run/);
  assert.match(apiSource, /const messages = \[/);
  assert.match(apiSource, /role: "system"/);
  assert.match(apiSource, /prompt: systemPrompt/);
  assert.match(apiSource, /attempts\.push\(\{ input: "prompt"/);
  assert.match(apiSource, /responseKeys/);
  assert.match(chatSource, /inferenceAttempts/);
  assert.match(apiSource, /MAX_PROMPT_CHARS/);
  assert.match(apiSource, /MAX_REQUESTS_PER_WINDOW = 6/);
  assert.match(apiSource, /MAX_OUTPUT_TOKENS = 384/);
  assert.doesNotMatch(apiSource, /GEMINI_API_KEY|generativelanguage\.googleapis\.com|X-Firebase-AppCheck/);
});

test("Workers AI binding is declared for the Pages Functions runtime", () => {
  assert.match(wranglerSource, /\[ai\]/);
  assert.match(wranglerSource, /binding\s*=\s*"AI"/);
});

test("Cloudflare AI proxy bounds requests and rate limits authenticated users", () => {
  assert.match(apiSource, /MAX_BODY_BYTES/);
  assert.match(apiSource, /takeRateLimit\(claims\.uid\)/);
  assert.match(apiSource, /upstreamStatus === 429/);
  assert.match(apiSource, /Cache-Control.*no-store/);
});

test("For You invokes cloud AI only when local clue extraction is weak", () => {
  assert.match(recommendationsSource, /localSignalStrength = localClues\.length \+ recognizedConcepts\.length \* 2/);
  assert.match(recommendationsSource, /shouldUseAi = !options\.localOnly && localSignalStrength < 6/);
});

test("Recall keeps useful provider and quota diagnostics", () => {
  assert.match(chatSource, /errorDiagnostic\(error\)/);
  assert.match(chatSource, /quotaFailure/);
  assert.match(chatSource, /Vivid AI 429/);
  assert.match(chatSource, /Vivid AI 401/);
});

test("App Check initializes lazily instead of triggering verification on every public page", () => {
  assert.match(firebaseSource, /export async function ensureAppCheck\(\)/);
  assert.match(firebaseSource, /initializeAppCheck\(app/);
  assert.match(firebaseSource, /CustomProvider/);
  assert.match(firebaseSource, /getTurnstileAppCheckToken/);
  assert.match(firebaseSource, /Do not initialize App Check during ordinary page startup/);
});

test("service worker cache version changes with the Cloudflare AI client", () => {
  assert.match(workerSource, /vivid-cinema-shell-v303/);
  assert.match(workerSource, /scripts\/cloudflare-ai\.js/);
});

test("only explicit Recall clue expansion and chat expose AI operations", () => {
  assert.match(aiSource, /export async function getRecallClues/);
  assert.match(aiSource, /export async function sendRecallChatMessage/);
});

test("production AI health route reports only safe binding configuration", async () => {
  const response = await vividAiRoute({
    request: new Request("https://vivid.test/api/ai", { method: "GET" }),
    env: { AI: { run() {} }, FIREBASE_SERVICE_ACCOUNT_JSON: "{\"project_id\":\"vivid-cinema\"}" }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "cloudflare-workers-ai");
  assert.equal(payload.checks.aiBinding, true);
  assert.equal(payload.checks.firebaseServiceAccount, true);
  assert.equal(payload.checks.firebaseProject, true);
  assert.equal(Object.hasOwn(payload, "privateKey"), false);
});

