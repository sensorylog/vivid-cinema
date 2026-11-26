import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../cloudflare/functions/api/anime-premium/countries.js";

test("country directory endpoint returns a complete normalized catalogue through the same origin", async () => {
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 200 }, (_, index) => ({
    cca2: "X" + String(index).padStart(1, "0"),
    name: { common: "Country " + String(index).padStart(3, "0") },
    currencies: { XXX: { name: "Test currency" } }
  }));
  globalThis.fetch = async url => {
    assert.match(String(url), /restcountries\.com/);
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/countries"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.count, 200);
    assert.equal(payload.countries.length, 200);
    assert.equal(payload.countries[0].currency, "XXX");
    assert.equal(payload.countries[0].name, "Country 000");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("country directory endpoint falls back to its maintained secondary dataset", async () => {
  const originalFetch = globalThis.fetch;
  const data = Object.fromEntries(Array.from({ length: 190 }, (_, index) => [
    "Q" + String(index).padStart(1, "0"),
    { name: "Backup country " + index, currency: ["USD"] }
  ]));
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    if (String(url).includes("restcountries.com")) throw new Error("primary source offline");
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/countries"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.equal(payload.count, 190);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("country directory endpoint reports an honest unavailable response if both sources fail", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("upstream offline"); };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/countries"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.equal(payload.code, "country-directory-unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
