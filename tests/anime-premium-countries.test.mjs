import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../cloudflare/functions/api/anime-premium/countries.js";

test("country directory is served from the bundled ISO catalogue without network dependencies", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Country endpoint must not make an upstream request."); };
  try {
    const response = await onRequestGet({
      request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/countries"),
      env: {}
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.ok(payload.count >= 200, "full ISO country list should contain at least 200 entries");
    assert.equal(payload.countries.length, payload.count);
    assert.deepEqual(payload.countries.find(country => country.code === "GH"), {
      code: "GH", name: "Ghana", currency: "GHS"
    });
    assert.equal(payload.countries.find(country => country.code === "NG")?.currency, "NGN");
    assert.equal(payload.countries.find(country => country.code === "US")?.currency, "USD");
    assert.ok(payload.countries.some(country => country.code === "CA"));
    assert.ok(payload.countries.some(country => country.code === "JP"));
    assert.match(payload.source, /Bundled countries-list ISO 3166-1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("country directory endpoint rejects unapproved origins", async () => {
  const response = await onRequestGet({
    request: new Request("https://vivid-cinema.pages.dev/api/anime-premium/countries", {
      headers: { Origin: "https://attacker.example" }
    }),
    env: {}
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "origin-not-allowed");
});
