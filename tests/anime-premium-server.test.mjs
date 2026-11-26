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
  assert.equal(config.plans.GHS.amount, 5330);
  assert.equal(config.plans.GHS.planCode, "PLN_PRIVATE_CODE");
  const publicData = publicPricing({ PAYSTACK_PLAN_GHS_MONTHLY: "PLN_PRIVATE_CODE" });
  assert.equal(publicData.plans.GHS.amountMinor, 5330);
  assert.equal(publicData.plans.GHS.cardAutoRenewAvailable, true);
  assert.equal(publicData.plans.GHS.mobileMoneyAvailable, true);
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

test("server playback requires an active membership and a resolver-approved host", () => {
  assert.match(playback, /animePremiumMemberships/);
  assert.match(playback, /animePremiumSources/);
  assert.match(playback, /ANIME_PREMIUM_STREAM_RESOLVER_TOKEN/);
  assert.match(playback, /ANIME_PREMIUM_STREAM_HOSTS/);
  assert.match(playback, /url\.protocol !== "https:"/);
  assert.match(playback, /expiresAt > Date\.now\(\) \+ 60 \* 60 \* 1000/);
  assert.match(playback, /application\/vnd\.apple\.mpegurl/);
});

test("playback resolver supports isolated server-side adapters per approved provider", () => {
  assert.match(playback, /ANIME_PREMIUM_PROVIDER_RESOLVERS_JSON/);
  assert.match(playback, /providers\?\.\[providerId\]/);
  assert.match(playback, /providerResolver\(env, candidate\.provider\)/);
  assert.match(playback, /provider\.url\.toString\(\)/);
  assert.match(playback, /provider\.token/);
  assert.match(playback, /provider\.hosts\.has\(url\.hostname\.toLowerCase\(\)\)/);
  assert.match(playback, /settings\?\.allowedHosts/);
  assert.match(playback, /url\.protocol !== "https:"/);
});

test("playback enforces verified territory and licence-window rights before resolving a provider", () => {
  assert.match(playback, /request\.cf\?\.country/);
  assert.match(playback, /candidate\.rightsVerified !== true/);
  assert.match(playback, /candidate\.allowedTerritories\.includes\(territory\)/);
  assert.match(playback, /licenseStartsAt > Date\.now\(\)/);
  assert.match(playback, /licenseEndsAt <= Date\.now\(\)/);
  assert.match(playback, /territory-or-rights-unavailable/);
});


test("playback walks multiple licensed source candidates in priority order and fails closed", () => {
  assert.match(playback, /Array\.isArray\(source\.candidates\)/);
  assert.match(playback, /candidates\.slice\(0, 8\)/);
  assert.match(playback, /for \(const candidate of candidates\)/);
  assert.match(playback, /candidate\.rightsVerified !== true/);
  assert.match(playback, /candidate\.allowedTerritories\.includes\(territory\)/);
  assert.match(playback, /redirect: "error"/);
  assert.match(playback, /AbortSignal\.timeout\(12000\)/);
  assert.match(playback, /No authorised streaming server could open this episode/);
  assert.match(playback, /selected\.candidate\.provider/);
});

test("admin source registry stores and sorts up to eight independent authorised server candidates", async () => {
  const adminSources = await readFile(new URL("../cloudflare/functions/api/anime-premium/admin/sources.js", import.meta.url), "utf8");
  assert.match(adminSources, /existing\.candidates/);
  assert.match(adminSources, /candidateId/);
  assert.match(adminSources, /candidates\.sort/);
  assert.match(adminSources, /candidates\.length > 8/);
  assert.match(adminSources, /rightsVerified: true/);
});


test("playback endpoint validates skip lists and excludes failed candidates without weakening rights checks", () => {
  assert.match(playback, /invalid-server-fallback/);
  assert.match(playback, /excludedRaw\.length > 8/);
  assert.match(playback, /excludedCandidates\.has/);
  assert.match(playback, /candidate\.rightsVerified !== true/);
  assert.match(playback, /candidateId: String\(selected\.candidate\.candidateId/);
});


test("multi-server resolver fallback has a bounded total deadline", () => {
  assert.match(playback, /const resolverDeadline = Date\.now\(\) \+ 25000/);
  assert.match(playback, /if \(Date\.now\(\) >= resolverDeadline\) break/);
  assert.match(playback, /AbortSignal\.timeout\(Math\.min\(12000, Math\.max\(1, resolverDeadline - Date\.now\(\)\)\)\)/);
});


test("title-level source mappings are considered after episode-specific licensed candidates", () => {
  assert.match(playback, /lookupKeys = mediaType === "tv" \? \[sourceKey, "tv_" \+ titleId\]/);
  assert.match(playback, /sourceRecords\.flatMap/);
  assert.match(playback, /registryRank/);
  assert.match(playback, /left\.registryRank - right\.registryRank/);
  assert.match(playback, /sourceKey: selected\.candidate\.registryKey/);
});

test("admin source registry supports episode-level and whole-title mappings", async () => {
  const adminSources = await readFile(new URL("../cloudflare/functions/api/anime-premium/admin/sources.js", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../anime-premium-admin.html", import.meta.url), "utf8");
  const adminScript = await readFile(new URL("../scripts/anime-premium-admin.js", import.meta.url), "utf8");
  assert.match(adminSources, /body\.scope === "title"/);
  assert.match(adminSources, /mediaType \+ "_" \+ titleId/);
  assert.match(adminPage, /vap-admin-source-scope/);
  assert.match(adminScript, /scope: mediaType === "tv" \?/);
  assert.match(adminScript, /addEventListener\("change", updateSourceScope\)/);
});


test("admin form defaults an empty candidate ID to the approved provider ID", async () => {
  const adminScript = await readFile(new URL("../scripts/anime-premium-admin.js", import.meta.url), "utf8");
  assert.match(adminScript, /candidateId: \$\("vap-admin-candidate-id"\)\.value\.trim\(\) \|\| \$\("vap-admin-provider"\)\.value\.trim\(\)/);
});
