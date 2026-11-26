import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../cloudflare/functions/api/anime-premium/exchange-rate.js";

test("exchange-rate endpoint converts GHS to the selected currency from daily USD-base rates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://open-rates.currencyfreaks.com/rates?base=USD");
    return new Response(JSON.stringify({
      date: "2026-11-26",
      base: "USD",
      rates: { GHS: 10, NGN: 1000, EUR: 0.9 }
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

test("exchange-rate endpoint rejects invalid or unpublished currencies without inventing a rate", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ date: "2026-11-26", base: "USD", rates: { GHS: 10, EUR: 0.9 } }), {
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
