import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../cloudflare/functions/api/anime-premium/countries.js";
import { ANIME_PREMIUM_COUNTRIES } from "../scripts/anime-premium-countries.js";

test("bundled country directory contains the complete international country and territory catalogue", async () => {
  assert.ok(ANIME_PREMIUM_COUNTRIES.length >= 240);
  assert.ok(ANIME_PREMIUM_COUNTRIES.some(country => country.code === "GH" && country.currency === "GHS"));
  assert.ok(ANIME_PREMIUM_COUNTRIES.some(country => country.code === "NG" && country.currency === "NGN"));
  assert.ok(ANIME_PREMIUM_COUNTRIES.some(country => country.code === "CA" && country.currency === "CAD"));
  assert.ok(ANIME_PREMIUM_COUNTRIES.some(country => country.code === "GB" && country.currency === "GBP"));
  assert.ok(ANIME_PREMIUM_COUNTRIES.some(country => country.code === "DE" && country.currency === "EUR"));
});

test("country directory endpoint serves the bundled list without any external network request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("country endpoint must not fetch external APIs"); };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/countries"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.count, ANIME_PREMIUM_COUNTRIES.length);
    assert.equal(payload.countries.length, ANIME_PREMIUM_COUNTRIES.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("country directory endpoint respects Vivid origin restrictions", async () => {
  const response = await onRequestGet({
    request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/countries", {
      headers: { Origin: "https://attacker.example" }
    }),
    env: {}
  });
  assert.equal(response.status, 403);
});
