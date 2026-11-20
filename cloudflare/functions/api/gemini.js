import { verifyFirebaseIdToken } from "../lib/firebase-token-verification.js";

const MODEL = "gemini-3.5-flash-lite";
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
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
  }
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
    const error = new Error("Sign in to your Vivid account before using Gemini.");
    error.status = 401;
    throw error;
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Firebase service-account credentials are not configured for the Gemini API.");
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
      const error = new Error("Sign in with a Vivid account before using Gemini.");
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
  if (request.method !== "POST") return json(405, { ok: false, message: "Use POST for Gemini requests." });
  const origin = request.headers.get("Origin");
  if (origin) {
    const url = new URL(request.url);
    if (origin !== url.origin) return json(403, { ok: false, message: "Cross-origin Gemini requests are not allowed." });
  }
  let claims;
  try {
    claims = await authenticate(request, env);
  } catch (error) {
    const status = error.status || 500;
    console.error("Vivid Gemini authentication/configuration error:", error.message);
    return json(status, {
      ok: false,
      code: status === 401 ? "unauthenticated" : "internal",
      message: status === 401 ? error.message : "The secure Gemini service is not configured correctly."
    });
  }

  if (!takeRateLimit(claims.uid)) {
    return json(429, { ok: false, code: "resource-exhausted", message: "You've reached the short-term Gemini request limit. Please wait a minute and try again." });
  }
  if (!env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not configured as a Cloudflare Pages secret.");
    return json(503, { ok: false, code: "unavailable", message: "The Gemini API key has not been configured on the Vivid server yet." });
  }

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json(413, { ok: false, code: "invalid-argument", message: "The Gemini request is too large." });
    }
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, code: "invalid-argument", message: "A valid Gemini request is required." });
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const maxOutputTokens = Number.isInteger(body?.maxOutputTokens)
    ? Math.max(64, Math.min(MAX_OUTPUT_TOKENS, body.maxOutputTokens))
    : 700;
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return json(400, { ok: false, code: "invalid-argument", message: "The Gemini prompt must contain 1–10,000 characters." });
  }

  try {
    const upstream = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + encodeURIComponent(env.GEMINI_API_KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens
          }
        })
      }
    );
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const upstreamMessage = payload?.error?.message || "Gemini request failed.";
      console.error("Vivid Gemini upstream error:", {
        status: upstream.status,
        message: upstreamMessage,
        model: MODEL,
        uid: claims.uid
      });
      const status = upstream.status === 429 ? 429 : upstream.status === 400 ? 400 : upstream.status === 403 ? 502 : 502;
      return json(status, {
        ok: false,
        code: upstream.status === 429 ? "resource-exhausted" : "upstream-error",
        message: upstream.status === 429
          ? "Gemini's free-tier request limit has been reached. Please wait for its quota window to reset."
          : "Gemini could not complete the request. Please try again shortly."
      });
    }
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map(part => typeof part.text === "string" ? part.text : "")
      .join("") || "";
    if (!text) return json(502, { ok: false, code: "empty-response", message: "Gemini returned an empty response." });
    return json(200, { ok: true, text, model: MODEL });
  } catch (error) {
    console.error("Vivid Gemini network error:", error?.message || String(error));
    return json(502, { ok: false, code: "upstream-error", message: "Vivid could not reach Gemini. Please try again shortly." });
  }
}
