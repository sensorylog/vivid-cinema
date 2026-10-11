const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const ALLOWED_MEDIA_TYPES = new Set(["movie", "tv", "anime"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BODY_BYTES = 16 * 1024;
const TOKEN_CLOCK_SKEW_SECONDS = 300;

let cachedJwks;
let cachedJwksUntil = 0;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

async function getFirebaseJwks(fetchImpl = fetch) {
  const now = Date.now();
  if (cachedJwks && cachedJwksUntil > now) return cachedJwks;
  const response = await fetchImpl(FIREBASE_JWKS_URL, { redirect: "error" });
  if (!response.ok) throw new Error("Firebase signing keys are unavailable.");
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error("Firebase signing keys are invalid.");
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 3600);
  cachedJwks = body.keys;
  cachedJwksUntil = now + Math.min(Math.max(maxAge, 60), 21600) * 1000;
  return cachedJwks;
}

export async function verifyFirebaseIdToken(token, projectId, fetchImpl = fetch, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== "string" || token.length > 8192 || typeof projectId !== "string" || !projectId) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header;
  let claims;
  try {
    header = decodeJsonSegment(parts[0]);
    claims = decodeJsonSegment(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
  if (claims.aud !== projectId || claims.iss !== "https://securetoken.google.com/" + projectId) return null;
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 128) return null;
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds) return null;
  if (!Number.isFinite(claims.iat) || claims.iat > nowSeconds + TOKEN_CLOCK_SKEW_SECONDS) return null;
  if (!Number.isFinite(claims.auth_time) || claims.auth_time > nowSeconds + TOKEN_CLOCK_SKEW_SECONDS) return null;

  try {
    const keys = await getFirebaseJwks(fetchImpl);
    const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256");
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    return valid ? { uid: claims.sub, claims } : null;
  } catch {
    return null;
  }
}

function validateMediaPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (!ID_PATTERN.test(String(payload.mediaId || "")) || !ALLOWED_MEDIA_TYPES.has(payload.mediaType)) return false;
  if (payload.mediaType === "tv" || payload.mediaType === "anime") {
    return Number.isSafeInteger(payload.season) && payload.season >= 1 && payload.season <= 999 &&
      Number.isSafeInteger(payload.episode) && payload.episode >= 1 && payload.episode <= 9999;
  }
  return true;
}

async function readSmallJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    const origin = request.headers.get("Origin");
    if (origin && (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN)) {
      return json({ error: "origin_not_allowed" }, 403);
    }

    if (request.method === "OPTIONS") {
      if (!origin || !cors["Access-Control-Allow-Origin"]) return json({ error: "origin_not_allowed" }, 403);
      return new Response(null, { status: 204, headers: cors });
    }

    if ((url.pathname === "/health" || url.pathname === "/api/v1/health") && request.method === "GET") {
      return json({
        ok: true,
        service: "vivid-mediaforge-api",
        backendConfigured: false,
        storageBindingConfigured: Boolean(env.MEDIA_BUCKET)
      }, 200, cors);
    }

    if (url.pathname === "/api/v1/stream/resolve" && request.method === "POST") {
      const payload = await readSmallJson(request);
      if (!validateMediaPayload(payload)) return json({ error: "invalid_media_request" }, 400, cors);
    } else if (url.pathname === "/api/v1/downloads" && request.method === "POST") {
      const payload = await readSmallJson(request);
      if (!validateMediaPayload(payload)) return json({ error: "invalid_media_request" }, 400, cors);
    } else if (/^\/api\/v1\/downloads\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname) && request.method === "GET") {
      // Job ownership is checked by the real job store once the worker is deployed.
    } else {
      return json({ error: "not_found" }, 404, cors);
    }

    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "unauthorized" }, 401, cors);
    const identity = await verifyFirebaseIdToken(match[1], env.FIREBASE_PROJECT_ID);
    if (!identity) return json({ error: "unauthorized" }, 401, cors);

    // Deliberately fail closed until a real resolver/worker is configured. Never
    // create fake queued jobs or return a stream URL that cannot actually work.
    return json({
      error: "media_backend_not_configured",
      message: "The Cloudflare API is deployed without a MediaForge processing worker."
    }, 503, cors);
  }
};
