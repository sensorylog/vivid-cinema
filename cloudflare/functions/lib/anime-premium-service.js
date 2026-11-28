import { verifyFirebaseIdToken } from "./firebase-token-verification.js";
import { initializeApp as initializeRestApp } from "@ljoukov/firebase-admin-cloudflare/app";
import { getFirestore, Timestamp } from "@ljoukov/firebase-admin-cloudflare/firestore";

const SUPPORTED_PAYSTACK_CURRENCIES = Object.freeze(["GHS", "KES", "NGN", "ZAR", "USD"]);
const DEFAULT_GHS_MINOR = 5330;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://vivid-cinema.pages.dev",
  "https://vivid-cinema.web.app",
  "https://vivid-cinema.firebaseapp.com"
]);
const COUNTRY_PAYSTACK_CURRENCY = Object.freeze({
  GH: "GHS", NG: "NGN", KE: "KES", ZA: "ZAR", US: "USD",
  GB: "USD", CA: "USD", AU: "USD", IN: "USD", DE: "USD",
  FR: "USD", ES: "USD", IT: "USD", NL: "USD", BE: "USD",
  IE: "USD", PT: "USD", SE: "USD", NO: "USD", DK: "USD",
  FI: "USD", CH: "USD", AE: "USD", SA: "USD", EG: "USD",
  MA: "USD", BR: "USD", MX: "USD", JP: "USD", KR: "USD",
  SG: "USD", MY: "USD", ID: "USD", PH: "USD", TH: "USD",
  NZ: "USD", UG: "USD", TZ: "USD", RW: "USD", CI: "USD",
  SN: "USD", CM: "USD", ET: "USD"
});
const MOBILE_MONEY_COUNTRIES = new Set(["GH", "KE"]);
let cachedProjectId = "";
let cachedDb = null;
let cachedServiceAccount = null;
let cachedServiceAccountRaw = "";

export function isValidEmailAddress(value) {
  const email = String(value || "").trim();
  if (!email || email.length > 254) return false;
  return /^[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(email);
}


/**
 * Optional, time-limited staff/test entitlements. Configure only as a Cloudflare
 * Pages secret/variable; never put tester addresses in source control.
 * Format: {"verified@example.com":"2026-12-26T00:00:00.000Z"}
 */
export function getPremiumTestAccess(user, env = {}, now = Date.now()) {
  if (!user || user.email_verified !== true || !isValidEmailAddress(user.email)) return null;
  let entries;
  try { entries = JSON.parse(String(env.ANIME_PREMIUM_TEST_ACCESS_JSON || "{}")); }
  catch { return null; }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return null;
  const expiryValue = entries[String(user.email).trim().toLowerCase()];
  if (typeof expiryValue !== "string") return null;
  const expiresAt = Date.parse(expiryValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  return {
    active: true,
    status: "active",
    source: "test-access",
    planId: "tester",
    currency: null,
    renewalMode: "test",
    autoRenew: false,
    canCancelAutoRenew: false,
    currentPeriodEnd: new Date(expiresAt).toISOString(),
    cancelAtPeriodEnd: false
  };
}
export function hasPremiumMembership(user, membership, env = {}, now = Date.now()) {
  const periodEnd = typeof membership?.currentPeriodEnd?.toMillis === "function"
    ? membership.currentPeriodEnd.toMillis()
    : Number(membership?.currentPeriodEnd || 0);
  if (membership && ["active", "past_due"].includes(membership.status) && periodEnd > now) return true;
  return Boolean(getPremiumTestAccess(user, env, now));
}

export class AnimePremiumError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "AnimePremiumError";
    this.status = status;
    this.code = code;
  }
}
export function allowedOrigin(origin, env = {}) {
  if (!origin) return false;
  const extra = String(env.VIVID_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  if (DEFAULT_ALLOWED_ORIGINS.includes(origin) || extra.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "localhost" && ["http:", "https:", "capacitor:"].includes(parsed.protocol)) return true;
    return parsed.protocol === "https:" &&
      (parsed.hostname === "vivid-cinema.pages.dev" || parsed.hostname.endsWith(".vivid-cinema.pages.dev"));
  } catch {
    return false;
  }
}
export function jsonResponse(data, status = 200, origin = "", env = {}) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  if (origin && allowedOrigin(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(data), { status, headers });
}
export function optionsResponse(origin, env = {}) {
  if (!allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    }
  });
}
export function getPremiumServices(env) {
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || "");
  if (!raw) throw new AnimePremiumError(503, "firebase-not-configured", "The Vivid membership service is not configured.");
  if (cachedDb && cachedServiceAccountRaw === raw && cachedProjectId === String(env.FIREBASE_PROJECT_ID || cachedServiceAccount?.project_id || "")) {
    return { db: cachedDb, serviceAccount: cachedServiceAccount, projectId: cachedProjectId };
  }
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); }
  catch { throw new AnimePremiumError(503, "firebase-not-configured", "The Vivid membership service is not configured."); }
  const configuredProjectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  const serviceAccountProjectId = String(serviceAccount.project_id || "").trim();
  const projectId = configuredProjectId || serviceAccountProjectId;
  if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new AnimePremiumError(503, "firebase-not-configured", "The Vivid membership service is not configured.");
  }
  // The adapter validates serviceAccountJson independently and requires its
  // own project_id field. Older deployments may provide FIREBASE_PROJECT_ID
  // separately, so normalize the JSON before handing it to the adapter.
  if (serviceAccountProjectId && configuredProjectId && serviceAccountProjectId !== configuredProjectId) {
    throw new AnimePremiumError(503, "firebase-project-mismatch", "The Firebase project configuration does not match the service account.");
  }
  const normalizedServiceAccountJson = JSON.stringify({
    ...serviceAccount,
    project_id: projectId
  });
  const app = initializeRestApp({
    serviceAccountJson: normalizedServiceAccountJson,
    projectId
  }, "vivid-anime-premium-" + projectId);
  cachedDb = getFirestore(app);
  cachedProjectId = projectId;
  cachedServiceAccount = serviceAccount;
  cachedServiceAccountRaw = raw;
  return { db: cachedDb, serviceAccount, projectId };
}
export async function requirePremiumUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AnimePremiumError(401, "unauthenticated", "Sign in with your Vivid account to continue.");
  const { serviceAccount, projectId } = getPremiumServices(env);
  let claims;
  try { claims = await verifyFirebaseIdToken(match[1], projectId, serviceAccount); }
  catch (error) {
    throw new AnimePremiumError(401, error?.code || "invalid-id-token", "Your Vivid sign-in needs refreshing. Please sign in again.");
  }
  if (!claims.email || claims.email_verified !== true) {
    throw new AnimePremiumError(403, "email-not-verified", "Verify your Vivid email address before continuing.");
  }
  return claims;
}
export function parsePlanConfig(env = {}) {
  const defaultCurrency = String(env.ANIME_PREMIUM_DEFAULT_CURRENCY || "GHS").toUpperCase();
  if (!SUPPORTED_PAYSTACK_CURRENCIES.includes(defaultCurrency)) throw new AnimePremiumError(503, "pricing-not-configured", "The default Premium checkout currency is not supported.");
  const defaultAmount = Number(env.ANIME_PREMIUM_GHS_MONTHLY_AMOUNT || DEFAULT_GHS_MINOR);
  const result = {};
  if (Number.isSafeInteger(defaultAmount) && defaultAmount > 0) {
    result.GHS = {
      currency: "GHS",
      amount: defaultAmount,
      planCode: String(env.PAYSTACK_PLAN_GHS_MONTHLY || "").trim(),
      interval: "monthly"
    };
  }
  const raw = String(env.ANIME_PREMIUM_PLANS_JSON || "").trim();
  if (raw) {
    let configured;
    try { configured = JSON.parse(raw); }
    catch { throw new AnimePremiumError(503, "pricing-not-configured", "Premium pricing is not configured correctly."); }
    const source = configured.monthly && typeof configured.monthly === "object" ? configured.monthly : configured;
    for (const [currencyValue, value] of Object.entries(source || {})) {
      const currency = String(currencyValue).toUpperCase();
      const amount = Number(value?.amountMinor ?? value?.amount);
      if (!SUPPORTED_PAYSTACK_CURRENCIES.includes(currency) || !Number.isSafeInteger(amount) || amount < 1) continue;
      result[currency] = {
        currency,
        amount,
        planCode: String(value.planCode || value.plan_code || env["PAYSTACK_PLAN_" + currency + "_MONTHLY"] || "").trim(),
        interval: "monthly"
      };
    }
  }
  if (!result[defaultCurrency]) throw new AnimePremiumError(503, "pricing-not-configured", "The default Premium checkout currency is not configured.");
  return { defaultCurrency, plans: result };
}
export function resolveCheckoutPlan(country, env = {}) {
  const { defaultCurrency, plans } = parsePlanConfig(env);
  const code = String(country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new AnimePremiumError(400, "invalid-country", "Choose a valid country.");
  const preferred = COUNTRY_PAYSTACK_CURRENCY[code] || defaultCurrency;
  const currency = plans[preferred] ? preferred : defaultCurrency;
  return {
    country: code,
    localCheckoutCurrency: preferred,
    ...plans[currency],
    fallback: currency !== preferred,
    mobileMoneyAvailable: (code === "GH" && currency === "GHS") || (code === "KE" && currency === "KES")
  };
}
export function publicPricing(env = {}) {
  const { defaultCurrency, plans } = parsePlanConfig(env);
  return {
    defaultCurrency,
    checkoutEnabled: Boolean(env.FIREBASE_SERVICE_ACCOUNT_JSON && (env.PAYSTACK_WEBHOOK_SECRET || env.PAYSTACK_SECRET_KEY)),
    checkoutMessage: !env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? "Vivid membership authentication is not configured on this deployment."
      : !(env.PAYSTACK_WEBHOOK_SECRET || env.PAYSTACK_SECRET_KEY)
        ? "Paystack webhook verification is not configured. Add a Paystack webhook signing secret or server-only legacy secret key in Cloudflare."
        : "",
    supportedCurrencies: SUPPORTED_PAYSTACK_CURRENCIES.filter(currency => Boolean(plans[currency])),
    mobileMoneyCountries: [...MOBILE_MONEY_COUNTRIES],
    plans: Object.fromEntries(Object.entries(plans).map(([currency, plan]) => [currency, {
      currency,
      amountMinor: plan.amount,
      amountMajor: plan.amount / 100,
      cardAutoRenewAvailable: Boolean(plan.planCode),
      mobileMoneyAvailable: ["GHS", "KES"].includes(currency)
    }]))
  };
}
export async function paystackRequest(env, path, options = {}) {
  const secret = String(env.PAYSTACK_SECRET_KEY || "").trim();
  if (!secret) throw new AnimePremiumError(503, "paystack-not-configured", "Paystack checkout is not configured yet.");
  const response = await fetch("https://api.paystack.co" + path, {
    method: options.method || "POST",
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json"
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status !== true) {
    const error = new AnimePremiumError(502, "paystack-request-failed", "Paystack could not complete the request. Please try again.");
    error.paystackStatus = response.status;
    throw error;
  }
  return payload.data || {};
}
function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, value instanceof Uint8Array ? value : new TextEncoder().encode(value)));
}
function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}
export async function verifyPaystackSignature(request, rawBody, env = {}) {
  const modern = request.headers.get("Paystack-Signature") || "";
  // The modern timestamped header is signed only with the dedicated whsec_ secret.
  // The legacy X-Paystack-Signature remains signed with the server-side sk_ key.
  const webhookSecret = String(env.PAYSTACK_WEBHOOK_SECRET || "").trim();
  if (modern && webhookSecret) {
    const values = modern.split(",").map(value => value.trim());
    const timestamp = values.find(value => value.startsWith("t="))?.slice(2) || "";
    const time = Number(timestamp);
    if (!Number.isFinite(time) || Math.abs(Date.now() / 1000 - time) > 300) return false;
    const signatures = values.filter(value => value.startsWith("v1=")).map(value => value.slice(3).split(":").pop());
    const prefix = new TextEncoder().encode(timestamp + ".");
    const body = rawBody instanceof Uint8Array ? rawBody : new Uint8Array(rawBody);
    const signed = new Uint8Array(prefix.length + body.length);
    signed.set(prefix, 0);
    signed.set(body, prefix.length);
    const expected = await hmacHex(webhookSecret, signed);
    return signatures.some(signature => constantTimeEqual(signature, expected));
  }
  const legacy = request.headers.get("x-paystack-signature") || "";
  const secret = String(env.PAYSTACK_SECRET_KEY || "").trim();
  if (!legacy || !secret || !/^[0-9a-f]{128}$/i.test(legacy)) return false;
  const expected = await hmacHex(secret, rawBody);
  return constantTimeEqual(legacy.toLowerCase(), expected);
}
export function timestampFromMillis(value) {
  return Timestamp.fromMillis(value);
}
export function addDaysMillis(days, from = Date.now()) {
  return from + Number(days) * 24 * 60 * 60 * 1000;
}
export function safeReference(value) {
  return typeof value === "string" && /^[A-Za-z0-9.=-]{6,120}$/.test(value);
}

export async function enforceRateLimit(db, uid, action, limit, windowMs) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const reference = String(uid) + "_" + String(action).replace(/[^A-Za-z0-9_-]/g, "") + "_" + bucket;
  const ref = db.collection("animePremiumRateLimits").doc(reference);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const count = snapshot.exists ? Number(snapshot.data()?.count || 0) : 0;
    if (count >= limit) throw new AnimePremiumError(429, "rate-limited", "Too many requests. Please wait a moment and try again.");
    transaction.set(ref, {
      uid, action, count: count + 1,
      windowStart: Timestamp.fromMillis(bucket * windowMs),
      expiresAt: Timestamp.fromMillis((bucket + 2) * windowMs)
    }, { merge: true });
  });
}
