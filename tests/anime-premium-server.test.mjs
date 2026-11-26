import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  allowedOrigin, jsonResponse, parsePlanConfig, publicPricing,
  resolveCheckoutPlan, safeReference, verifyPaystackSignature
} from "../cloudflare/functions/lib/anime-premium-service.js";

globalThis.crypto ||= webcrypto;
const playback = await readFile(new URL("../cloudflare/functions/api/anime-premium/playback.js", import.meta.url), "utf8");

async function sign(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const result = await crypto.subtle.sign("HMAC", key, value instanceof Uint8Array ? value : new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

test("Premium pricing has a configurable GHS default and does not expose Paystack plan codes", () => {
  const config = parsePlanConfig({ PAYSTACK_PLAN_GHS_MONTHLY: "PLN_PRIVATE_CODE" });
  assert.equal(config.defaultCurrency, "GHS");
  assert.equal(config.plans.monthly.GHS.amount, 5330);
  assert.equal(config.plans.monthly.GHS.planCode, "PLN_PRIVATE_CODE");
  const publicData = publicPricing({ PAYSTACK_PLAN_GHS_MONTHLY: "PLN_PRIVATE_CODE" });
  assert.equal(publicData.plans.monthly.GHS.amountMinor, 5330);
  assert.equal(publicData.plans.monthly.GHS.cardAutoRenewAvailable, true);
  assert.equal(publicData.plans.monthly.GHS.mobileMoneyAvailable, true);
  assert.deepEqual(publicData.mobileMoneyCountries, ["GH", "KE"]);
  assert.equal(publicData.checkoutEnabled, false);
  assert.doesNotMatch(JSON.stringify(publicData), /PLN_PRIVATE_CODE/);
});

test("country checkout mapping selects configured Paystack currencies and safe fallback", () => {
  const env = {
    ANIME_PREMIUM_PLANS_JSON: JSON.stringify({
      GHS: { amountMinor: 5330, planCode: "PLN_GHS" },
      NGN: { amountMinor: 500000, planCode: "PLN_NGN" },
      KES: { amountMinor: 70000, planCode: "PLN_KES" },
      USD: { amountMinor: 399, planCode: "PLN_USD" }
    })
  };
  assert.equal(resolveCheckoutPlan("GH", env).currency, "GHS");
  assert.equal(resolveCheckoutPlan("NG", env).currency, "NGN");
  assert.equal(resolveCheckoutPlan("KE", env).currency, "KES");
  assert.equal(resolveCheckoutPlan("GB", env).currency, "USD");
  assert.equal(resolveCheckoutPlan("GH", env).mobileMoneyAvailable, true);
  assert.equal(resolveCheckoutPlan("KE", env).mobileMoneyAvailable, true);
  assert.equal(resolveCheckoutPlan("NG", env).mobileMoneyAvailable, false);
  assert.equal(resolveCheckoutPlan("KE", { ANIME_PREMIUM_GHS_MONTHLY_AMOUNT: "5330" }).mobileMoneyAvailable, false);
  assert.throws(() => resolveCheckoutPlan("GHA", env), /valid country/i);
});

test("Premium supports monthly, biannual and annual Paystack plans with server-owned totals", () => {
  const env = {
    ANIME_PREMIUM_PLANS_JSON: JSON.stringify({
      monthly: { GHS: { amountMinor: 5330, planCode: "PLN_MONTHLY" } },
      biannually: { GHS: { amountMinor: 28000, planCode: "PLN_SIX_MONTHS" } },
      annually: { GHS: { amountMinor: 50000, planCode: "PLN_ANNUAL" } }
    })
  };
  const config = parsePlanConfig(env);
  assert.equal(config.plans.monthly.GHS.interval, "monthly");
  assert.equal(config.plans.biannually.GHS.interval, "biannually");
  assert.equal(config.plans.annually.GHS.interval, "annually");
  assert.equal(resolveCheckoutPlan("GH", env, "biannually").amount, 28000);
  assert.equal(resolveCheckoutPlan("GH", env, "biannually").planCode, "PLN_SIX_MONTHS");
  assert.equal(resolveCheckoutPlan("GH", env, "annually").amount, 50000);
  assert.throws(() => resolveCheckoutPlan("GH", env, "weekly"), /billing period/i);
  const published = publicPricing(env);
  assert.equal(published.plans.biannually.GHS.amountMinor, 28000);
  assert.equal(published.plans.annually.GHS.cardAutoRenewAvailable, true);
  assert.doesNotMatch(JSON.stringify(published), /PLN_SIX_MONTHS|PLN_ANNUAL/);
  const now = Date.UTC(2026, 0, 31);
  assert.equal(new Date(addPlanIntervalMillis("biannually", now)).toISOString(), "2026-07-31T00:00:00.000Z");
  assert.equal(new Date(addPlanIntervalMillis("annually", now)).toISOString(), "2027-01-31T00:00:00.000Z");
});

test("unconfigured country currencies fall back to the configured default checkout currency", () => {
  const plan = resolveCheckoutPlan("GB", { ANIME_PREMIUM_GHS_MONTHLY_AMOUNT: "5330" });
  assert.equal(plan.currency, "GHS");
  assert.equal(plan.fallback, true);
});

test("Paystack references are restricted to safe server-generated characters", () => {
  assert.equal(safeReference("VAP123456789ABC"), true);
  assert.equal(safeReference("VAP/123456"), false);
  assert.equal(safeReference("VAP 123456"), false);
  assert.equal(safeReference("short"), false);
});

test("legacy x-paystack-signature validates the raw request body", async () => {
  const secret = "paystack-test-secret";
  const body = new TextEncoder().encode('{"event":"charge.success","data":{"reference":"VAP123456"}}');
  const signature = await sign(secret, body);
  const request = new Request("https://vivid-cinema.pages.dev/api/anime-premium/webhook", {
    method: "POST", headers: { "x-paystack-signature": signature }
  });
  assert.equal(await verifyPaystackSignature(request, body, { PAYSTACK_SECRET_KEY: secret }), true);
  const tampered = new TextEncoder().encode('{"event":"charge.success","data":{"reference":"VAP654321"}}');
  assert.equal(await verifyPaystackSignature(request, tampered, { PAYSTACK_SECRET_KEY: secret }), false);
});

test("timestamped Paystack-Signature validates v1 and rejects stale webhook requests", async () => {
  const secret = "paystack-webhook-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = new TextEncoder().encode('{"event":"charge.success","data":{"reference":"VAP123456"}}');
  const signature = await sign(secret, new TextEncoder().encode(timestamp + "." + new TextDecoder().decode(body)));
  const request = new Request("https://vivid-cinema.pages.dev/api/anime-premium/webhook", {
    method: "POST", headers: { "Paystack-Signature": "t=" + timestamp + ",v1=key-1:" + signature }
  });
  assert.equal(await verifyPaystackSignature(request, body, { PAYSTACK_WEBHOOK_SECRET: secret }), true);
  const stale = String(Math.floor(Date.now() / 1000) - 600);
  const staleSignature = await sign(secret, new TextEncoder().encode(stale + "." + new TextDecoder().decode(body)));
  const staleRequest = new Request("https://vivid-cinema.pages.dev/api/anime-premium/webhook", {
    method: "POST", headers: { "Paystack-Signature": "t=" + stale + ",v1=key-1:" + staleSignature }
  });
  assert.equal(await verifyPaystackSignature(staleRequest, body, { PAYSTACK_WEBHOOK_SECRET: secret }), false);
});

test("Premium API responses are no-store and CORS is limited to Vivid origins", () => {
  assert.equal(allowedOrigin("https://vivid-cinema.pages.dev"), true);
  assert.equal(allowedOrigin("https://feat-vivid-anime-premium.vivid-cinema.pages.dev"), true);
  assert.equal(allowedOrigin("https://vivid-cinema.pages.dev.attacker.example"), false);
  assert.equal(allowedOrigin("https://attacker.example"), false);
  assert.equal(allowedOrigin("https://preview.example", { VIVID_ALLOWED_ORIGINS: "https://preview.example" }), true);
  const response = jsonResponse({ ok: true }, 200, "https://vivid-cinema.pages.dev");
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://vivid-cinema.pages.dev");
});

test("Premium playback endpoint checks membership and issues an expiring third-party embed session", () => {
  assert.match(playback, /requirePremiumUser/);
  assert.match(playback, /animePremiumMemberships/);
  assert.match(playback, /\["active", "past_due"\]/);
  assert.match(playback, /animePremiumPlaybackSessions/);
  assert.match(playback, /providerMode: "vivid-third-party-embeds"/);
  assert.match(playback, /expiresAt: timestampFromMillis\(expiresAt\)/);
  assert.match(playback, /2 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(playback, /animePremiumSources|ANIME_PREMIUM_STREAM_RESOLVER|ANIME_PREMIUM_PROVIDER_RESOLVERS_JSON/);
});

test("Premium playback validates the requested TMDB title and episode bounds", () => {
  assert.match(playback, /invalid-title/);
  assert.match(playback, /invalid-episode/);
  assert.match(playback, /titleId = String\(body\.titleId \|\| ""\)/);
  assert.match(playback, /season < 1 \|\| season > 100/);
  assert.match(playback, /episode < 1 \|\| episode > 10000/);
});

test("Premium progress requires a live session owned by the signed-in user", async () => {
  const progress = await readFile(new URL("../cloudflare/functions/api/anime-premium/progress.js", import.meta.url), "utf8");
  assert.match(progress, /animePremiumPlaybackSessions/);
  assert.match(progress, /session\.uid !== user\.uid/);
  assert.match(progress, /sessionExpiry <= Date\.now\(\)/);
  assert.match(progress, /animePremiumProfiles/);
});
