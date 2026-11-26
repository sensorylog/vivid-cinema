import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../cloudflare/functions/api/anime-premium/exchange-rate.js";

test("exchange-rate endpoint requests a direct GHS-base table and returns the selected currency rate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://open-rates.currencyfreaks.com/rates?base=GHS");
    return new Response(JSON.stringify({
      date: "2026-11-26",
      base: "GHS",
      rates: { GHS: 1, NGN: 100, EUR: 0.09, USD: 0.1 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=NGN"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.base, "GHS");
    assert.equal(payload.currency, "NGN");
    assert.equal(payload.rate, 100);
    assert.equal(payload.date, "2026-11-26");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GHS is exactly one-to-one and does not require an external FX request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("GHS should not need an FX provider call."); };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=GHS"),
      env: {}
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rate, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchange-rate endpoint rejects invalid or unpublished currencies without inventing a rate", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ date: "2026-11-26", base: "GHS", rates: { GHS: 1, EUR: 0.09 } }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const invalid = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=GHS1"),
      env: {}
    });
    assert.equal(invalid.status, 400);
    const missing = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=NGN"),
      env: {}
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "currency-rate-unavailable");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
