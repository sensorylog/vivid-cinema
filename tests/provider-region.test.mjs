import test from "node:test";
import assert from "node:assert/strict";
import {
  getProviderCountry,
  getProviderCountryName,
  getSupportedProviderCountryOptions,
  normalizeProviderCountryOptions,
  setProviderCountry
} from "../scripts/provider-region.js";

test("normalizes TMDB country data, rejects malformed codes, deduplicates, and sorts labels", () => {
  assert.deepEqual(normalizeProviderCountryOptions([
    { iso_3166_1: "GH", english_name: "Ghana" },
    { iso_3166_1: "DE", english_name: "Germany" },
    { iso_3166_1: "DE", english_name: "Germany duplicate" },
    { iso_3166_1: "ZZZ", english_name: "Invalid" },
    { iso_3166_1: "FR", english_name: "France" }
  ]), [["FR", "France"], ["DE", "Germany"], ["GH", "Ghana"]].sort((a, b) => a[1].localeCompare(b[1])));
});

test("fallback provider regions include existing markets and accept valid saved country codes", () => {
  const options = getSupportedProviderCountryOptions();
  assert.ok(options.some(([code, name]) => code === "GH" && name === "Ghana"));
  assert.ok(options.some(([code, name]) => code === "DE" && name === "Germany"));
  assert.ok(options.some(([code, name]) => code === "FR" && name === "France"));

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([["vivid:provider-country", "DE"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    }
  });
  try {
    assert.equal(getProviderCountry(), "DE");
    assert.equal(setProviderCountry("FR"), "FR");
    assert.equal(values.get("vivid:provider-country"), "FR");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("provider region labels use the shared country list with a safe code fallback", () => {
  assert.equal(getProviderCountryName("GH"), "Ghana");
  assert.equal(getProviderCountryName("ZZ"), "ZZ");
});
