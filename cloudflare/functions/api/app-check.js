import { createFirebaseAppCheckToken } from "../lib/firebase-token-verification.js";
import { verifyTurnstileToken } from "../lib/turnstile.js";

const FIREBASE_WEB_APP_ID = "1:1016345599146:web:bc00fd2f6ac15486ba44d3";
const FIREBASE_PROJECT_ID = "vivid-cinema";
const APP_CHECK_TTL_MS = 60 * 60 * 1000;
let serviceAccount;
let projectId;

function initialize(env) {
  if (serviceAccount) return;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  }
  serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  projectId = env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (
    projectId !== FIREBASE_PROJECT_ID ||
    serviceAccount.project_id !== FIREBASE_PROJECT_ID ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error("Firebase service-account configuration does not match Vivid Cinema.");
  }
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const allowed = new Set([
    "https://vivid-cinema.pages.dev",
    "https://vivid-cinema.web.app",
    "https://vivid-cinema.firebaseapp.com",
    ...(env.VIVID_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)
  ]);
  if (allowed.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".vivid-cinema.pages.dev");
  } catch {
    return false;
  }
}

function json(status, payload, origin = "") {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function options(origin) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return new Response(null, { status: 204, headers });
}

export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  // Browsers commonly omit Origin on same-origin GET requests. The GET route
  // exposes only the public site key; the proof-exchange POST must carry an
  // explicitly allowed Origin and is checked against Turnstile's signed host.
  if (origin && !isAllowedOrigin(origin, env)) {
    return json(403, { ok: false, code: "permission-denied", message: "This Vivid origin is not allowed." });
  }
  if (request.method === "POST" && !isAllowedOrigin(origin, env)) {
    return json(403, { ok: false, code: "permission-denied", message: "This Vivid origin is not allowed." });
  }
  if (request.method === "OPTIONS") return options(origin);

  try {
    initialize(env);
    if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) {
      return json(503, {
        ok: false,
        code: "turnstile-not-configured",
        message: "Secure browser verification is not configured yet."
      }, origin);
    }

    if (request.method === "GET") {
      return json(200, { ok: true, siteKey: env.TURNSTILE_SITE_KEY }, origin);
    }
    if (request.method !== "POST") {
      return json(405, { ok: false, code: "method-not-allowed", message: "Use POST for this endpoint." }, origin);
    }

    const raw = await request.text();
    if (raw.length > 8192) {
      return json(400, { ok: false, code: "invalid-argument", message: "The verification request is too large." }, origin);
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { ok: false, code: "invalid-argument", message: "A valid verification request is required." }, origin);
    }
    const turnstileToken = body?.turnstileToken;
    await verifyTurnstileToken(
      turnstileToken,
      env.TURNSTILE_SECRET_KEY,
      new URL(origin).hostname,
      "vivid_app_check",
      request.headers.get("CF-Connecting-IP") || ""
    );

    const appCheckToken = await createFirebaseAppCheckToken(
      FIREBASE_WEB_APP_ID,
      projectId,
      serviceAccount,
      APP_CHECK_TTL_MS
    );
    return json(200, {
      ok: true,
      token: appCheckToken.token,
      expireTimeMillis: Date.now() + appCheckToken.ttlMillis
    }, origin);
  } catch (error) {
    console.error("Vivid Cloudflare App Check exchange failed:", {
      code: error?.code || "unknown",
      message: error?.message || String(error)
    });
    const status = error?.code === "turnstile/invalid-token" ||
      error?.code === "turnstile/verification-failed" ||
      error?.code === "turnstile/claims-mismatch" ? 403 : 503;
    return json(status, {
      ok: false,
      code: error?.code || "app-check/unavailable",
      message: status === 403
        ? "Cloudflare couldn't verify this browser. Please try again."
        : "Secure browser verification is temporarily unavailable. Please retry."
    }, origin);
  }
}
