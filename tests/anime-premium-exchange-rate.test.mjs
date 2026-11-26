import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../cloudflare/functions/api/anime-premium/exchange-rate.js";

test("exchange-rate endpoint cross-converts GHS to currencies using the broad USD-base provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://open.er-api.com/v6/latest/USD");
    return new Response(JSON.stringify({
      result: "success",
      base_code: "USD",
      time_last_update_unix: 1795651200,
      rates: { USD: 1, GHS: 12, TTD: 6, NGN: 1500, EUR: 0.9 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=TTD"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.base, "GHS");
    assert.equal(payload.currency, "TTD");
    assert.equal(payload.rate, 0.5);
    assert.equal(payload.source, "ExchangeRate-API Open Access");
    assert.equal(payload.calculation, "GHS cross-rate calculated from a USD-base reference table");
    assert.ok(payload.date);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CurrencyFreaks USD-base table is used as a fallback when the primary provider fails", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (calls.length === 1) return new Response("unavailable", { status: 503 });
    assert.equal(String(url), "https://open-rates.currencyfreaks.com/rates");
    return new Response(JSON.stringify({
      date: "2026-11-26",
      base: "USD",
      rates: { USD: 1, GHS: 10, XCG: 5 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=XCG"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.rate, 0.5);
    assert.equal(payload.source, "CurrencyFreaks Open Rates");
    assert.equal(payload.date, "2026-11-26");
    assert.equal(calls.length, 2);
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
    return new Response(JSON.stringify({
      result: "success", base_code: "USD",
      rates: { USD: 1, GHS: 10, EUR: 0.9 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const invalid = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=GHS1"),
      env: {}
    });
    assert.equal(invalid.status, 400);
    const missing = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/exchange-rate?currency=KPW"),
      env: {}
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "currency-rate-unavailable");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
