import { verifyFirebaseIdToken } from "../lib/firebase-token-verification.js";

const MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_BODY_BYTES = 16_000;
const MAX_PROMPT_CHARS = 10_000;
const MAX_OUTPUT_TOKENS = 900;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 12;
const requestWindows = new Map();

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function takeRateLimit(uid) {
  const now = Date.now();
  let bucket = requestWindows.get(uid);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  requestWindows.set(uid, bucket);
  if (requestWindows.size > 5000) {
    for (const [key, value] of requestWindows) {
      if (now - value.startedAt >= WINDOW_MS) requestWindows.delete(key);
    }
  }
  return bucket.count <= MAX_REQUESTS_PER_WINDOW;
}

async function authenticate(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("Sign in to your Vivid account before using Vivid AI.");
    error.status = 401;
    throw error;
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Firebase service-account credentials are not configured for the Vivid AI API.");
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("Firebase service-account credentials are invalid.");
  }
  const projectId = env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service-account credentials are incomplete.");
  }
  try {
    const claims = await verifyFirebaseIdToken(match[1], projectId, serviceAccount);
    if (!claims.uid || claims.firebase?.sign_in_provider === "anonymous") {
      const error = new Error("Sign in with a Vivid account before using Vivid AI.");
      error.status = 401;
      throw error;
    }
    return claims;
  } catch (error) {
    if (error.status === 401) throw error;
    const invalid = ["auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled"];
    if (invalid.includes(error.code)) {
      const authError = new Error("Your Vivid sign-in has expired. Sign in again and retry.");
      authError.status = 401;
      throw authError;
    }
    throw error;
  }
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json(405, { ok: false, message: "Use POST for Vivid AI requests." });
  const origin = request.headers.get("Origin");
  if (origin) {
    const url = new URL(request.url);
    if (origin !== url.origin) return json(403, { ok: false, message: "Cross-origin Vivid AI requests are not allowed." });
  }

  let claims;
  try {
    claims = await authenticate(request, env);
  } catch (error) {
    const status = error.status || 500;
    console.error("Vivid AI authentication/configuration error:", error.message);
    return json(status, {
      ok: false,
      code: status === 401 ? "unauthenticated" : "internal",
      message: status === 401 ? error.message : "The secure Vivid AI service could not verify your account."
    });
  }

  if (!takeRateLimit(claims.uid)) {
    return json(429, { ok: false, code: "resource-exhausted", message: "You've reached the short-term Vivid AI request limit. Please wait a minute and try again." });
  }
  if (!env.AI || typeof env.AI.run !== "function") {
    console.error("Cloudflare Workers AI binding AI is missing from the Pages environment.");
    return json(503, { ok: false, code: "unavailable", message: "Vivid AI is not connected to Cloudflare Workers AI yet. The AI binding must be enabled for this Pages environment." });
  }

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json(413, { ok: false, code: "invalid-argument", message: "The Vivid AI request is too large." });
    }
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, code: "invalid-argument", message: "A valid Vivid AI request is required." });
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const maxTokens = Number.isInteger(body?.maxOutputTokens)
    ? Math.max(64, Math.min(MAX_OUTPUT_TOKENS, body.maxOutputTokens))
    : 700;
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return json(400, { ok: false, code: "invalid-argument", message: "The Vivid AI prompt must contain 1–10,000 characters." });
  }

  try {
    const result = await env.AI.run(MODEL, {
      prompt,
      max_tokens: maxTokens,
      temperature: 0.25,
      user: claims.uid
    });
    const text = typeof result?.response === "string"
      ? result.response
      : typeof result === "string" ? result : "";
    if (!text.trim()) {
      console.error("Cloudflare Workers AI returned an empty response.", { model: MODEL, uid: claims.uid });
      return json(502, { ok: false, code: "empty-response", message: "Cloudflare Workers AI returned an empty response. Please try again." });
    }
    return json(200, { ok: true, text, model: MODEL });
  } catch (error) {
    const detail = String(error?.message || error || "");
    const upstreamStatus = Number(error?.status || error?.statusCode || 0);
    const limited = upstreamStatus === 429 || /\b429\b|too many requests|quota|daily limit|rate.?limit|neurons exhausted/i.test(detail);
    console.error("Vivid Workers AI inference error:", {
      status: upstreamStatus || null,
      message: detail.slice(0, 500),
      model: MODEL,
      uid: claims.uid
    });
    return json(limited ? 429 : 502, {
      ok: false,
      code: limited ? "resource-exhausted" : "upstream-error",
      message: limited
        ? "Vivid AI has reached its Cloudflare usage limit for now. Please try again after the daily allowance resets."
        : "Cloudflare Workers AI could not complete this request. Please try again shortly."
    });
  }
}
