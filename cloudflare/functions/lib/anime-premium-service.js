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
  const projectId = String(env.FIREBASE_PROJECT_ID || serviceAccount.project_id || "");
  if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new AnimePremiumError(503, "firebase-not-configured", "The Vivid membership service is not configured.");
  }
  const app = initializeRestApp({ serviceAccountJson: raw, projectId }, "vivid-anime-premium-" + projectId);
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
const PLAN_INTERVALS = Object.freeze({
  monthly: { interval: "monthly", label: "Monthly", months: 1 },
  biannually: { interval: "biannually", label: "6 months", months: 6 },
  annually: { interval: "annually", label: "Annual", months: 12 }
});
export function addPlanIntervalMillis(planId, from = Date.now()) {
  const plan = PLAN_INTERVALS[String(planId || "monthly")] || PLAN_INTERVALS.monthly;
  const date = new Date(from);
  date.setUTCMonth(date.getUTCMonth() + plan.months);
  return date.getTime();
}
export function parsePlanConfig(env = {}) {
  const defaultCurrency = String(env.ANIME_PREMIUM_DEFAULT_CURRENCY || "GHS").toUpperCase();
  if (!SUPPORTED_PAYSTACK_CURRENCIES.includes(defaultCurrency)) throw new AnimePremiumError(503, "pricing-not-configured", "The default Premium checkout currency is not supported.");
  const result = { monthly: {}, biannually: {}, annually: {} };
  const defaultAmount = Number(env.ANIME_PREMIUM_GHS_MONTHLY_AMOUNT || DEFAULT_GHS_MINOR);
  if (Number.isSafeInteger(defaultAmount) && defaultAmount > 0) {
    result.monthly.GHS = {
      currency: "GHS", amount: defaultAmount,
      planCode: String(env.PAYSTACK_PLAN_GHS_MONTHLY || "").trim(),
      interval: "monthly"
    };
  }
  const raw = String(env.ANIME_PREMIUM_PLANS_JSON || "").trim();
  if (raw) {
    let configured;
    try { configured = JSON.parse(raw); }
    catch { throw new AnimePremiumError(503, "pricing-not-configured", "Premium pricing is not configured correctly."); }
    // Backwards compatibility: the previous shape was a flat currency map for monthly billing.
    const isPeriodMap = Object.keys(PLAN_INTERVALS).some(key => configured?.[key] && typeof configured[key] === "object");
    const periodSource = isPeriodMap ? configured : { monthly: configured };
    for (const [periodValue, currencies] of Object.entries(periodSource || {})) {
      const periodId = String(periodValue).toLowerCase();
      const period = PLAN_INTERVALS[periodId];
      if (!period || !currencies || typeof currencies !== "object") continue;
      for (const [currencyValue, value] of Object.entries(currencies)) {
        const currency = String(currencyValue).toUpperCase();
        const amount = Number(value?.amountMinor ?? value?.amount);
        if (!SUPPORTED_PAYSTACK_CURRENCIES.includes(currency) || !Number.isSafeInteger(amount) || amount < 1) continue;
        result[periodId][currency] = {
          currency, amount,
          planCode: String(value.planCode || value.plan_code || env["PAYSTACK_PLAN_" + currency + "_" + periodId.toUpperCase()] || "").trim(),
          interval: period.interval
        };
      }
    }
  }
  if (!result.monthly[defaultCurrency]) throw new AnimePremiumError(503, "pricing-not-configured", "The default Premium monthly checkout price is not configured.");
  return { defaultCurrency, plans: result };
}
export function resolveCheckoutPlan(country, env = {}, planId = "monthly") {
  const { defaultCurrency, plans } = parsePlanConfig(env);
  const code = String(country || "").trim().toUpperCase();
  const periodId = String(planId || "monthly").toLowerCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new AnimePremiumError(400, "invalid-country", "Choose a valid country.");
  if (!PLAN_INTERVALS[periodId]) throw new AnimePremiumError(400, "invalid-plan", "Choose a valid Premium billing period.");
  const periodPlans = plans[periodId];
  const preferred = COUNTRY_PAYSTACK_CURRENCY[code] || defaultCurrency;
  const currency = periodPlans[preferred] ? preferred : defaultCurrency;
  const selected = periodPlans[currency];
  if (!selected) throw new AnimePremiumError(503, "plan-not-configured", "This Premium billing period is not configured for the selected checkout currency yet.");
  return {
    country: code,
    planId: periodId,
    localCheckoutCurrency: preferred,
    ...selected,
    fallback: currency !== preferred,
    mobileMoneyAvailable: (code === "GH" && currency === "GHS") || (code === "KE" && currency === "KES")
  };
}
export function publicPricing(env = {}) {
  const { defaultCurrency, plans } = parsePlanConfig(env);
  const publicPlans = Object.fromEntries(Object.entries(plans).map(([periodId, currencies]) => [
    periodId,
    Object.fromEntries(Object.entries(currencies).map(([currency, plan]) => [currency, {
      currency,
      amountMinor: plan.amount,
      amountMajor: plan.amount / 100,
      cardAutoRenewAvailable: Boolean(plan.planCode),
      mobileMoneyAvailable: ["GHS", "KES"].includes(currency),
      interval: plan.interval
    }]))
  ]));
  return {
    defaultCurrency,
    checkoutEnabled: env.PAYSTACK_LIVE_ENABLED === "true" && Boolean(env.PAYSTACK_SECRET_KEY),
    supportedCurrencies: SUPPORTED_PAYSTACK_CURRENCIES.filter(currency => Boolean(plans.monthly[currency])),
    mobileMoneyCountries: [...MOBILE_MONEY_COUNTRIES],
    plans: publicPlans
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
  const webhookSecret = String(env.PAYSTACK_WEBHOOK_SECRET || env.PAYSTACK_SECRET_KEY || "").trim();
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
