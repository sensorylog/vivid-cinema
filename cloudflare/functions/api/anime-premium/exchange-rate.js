import { allowedOrigin, jsonResponse, optionsResponse } from "../../lib/anime-premium-service.js";

const PROVIDERS = [
  {
    name: "ExchangeRate-API Open Access",
    url: "https://open.er-api.com/v6/latest/USD",
    parse(payload) {
      if (payload?.result !== "success" || payload?.base_code !== "USD") {
        throw new Error("ExchangeRate-API returned an invalid USD-base response.");
      }
      return {
        rates: payload.rates,
        date: Number.isFinite(Number(payload.time_last_update_unix))
          ? new Date(Number(payload.time_last_update_unix) * 1000).toISOString().slice(0, 10)
          : String(payload.time_last_update_utc || "").slice(0, 16),
        source: "ExchangeRate-API Open Access"
      };
    }
  },
  {
    name: "CurrencyFreaks Open Rates",
    url: "https://open-rates.currencyfreaks.com/rates",
    parse(payload) {
      if (payload?.base !== "USD") throw new Error("CurrencyFreaks did not return its USD-base table.");
      return {
        rates: payload.rates,
        date: String(payload.date || ""),
        source: "CurrencyFreaks Open Rates"
      };
    }
  }
];

async function fetchProviderTable(provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(provider.url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cf: { cacheTtl: 86400, cacheEverything: true }
    });
    if (!response.ok) throw new Error(provider.name + " returned HTTP " + response.status);
    const payload = await response.json();
    const table = provider.parse(payload);
    const usd = Number(table.rates?.USD);
    const ghs = Number(table.rates?.GHS);
    if (!Number.isFinite(usd) || usd !== 1 || !Number.isFinite(ghs) || ghs <= 0) {
      throw new Error(provider.name + " did not include valid USD and GHS reference rates.");
    }
    return table;
  } finally {
    clearTimeout(timer);
  }
}

async function getUsdBaseTable(currency) {
  const failures = [];
  let validTableFound = false;
  let providerFailure = false;
  for (const provider of PROVIDERS) {
    try {
      const table = await fetchProviderTable(provider);
      validTableFound = true;
      const targetRate = Number(table.rates?.[currency]);
      if (Number.isFinite(targetRate) && targetRate > 0) return table;
      failures.push(provider.name + " does not publish " + currency + ".");
    } catch (error) {
      providerFailure = true;
      failures.push(provider.name + ": " + (error?.message || String(error)));
      console.warn("Vivid FX provider unavailable:", failures[failures.length - 1]);
    }
  }
  if (validTableFound && !providerFailure) {
    const error = new Error("Neither reference-rate source currently publishes a rate for " + currency + ".");
    error.code = "currency-rate-unavailable";
    throw error;
  }
  throw new Error("All reference-rate providers are unavailable. " + failures.join("; "));
}

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) {
    return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  }

  const currency = String(new URL(request.url).searchParams.get("currency") || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return jsonResponse({ ok: false, code: "invalid-currency", message: "Choose a valid three-letter currency code." }, 400, origin, env);
  }

  if (currency === "GHS") {
    return jsonResponse({
      ok: true, base: "GHS", currency: "GHS", rate: 1,
      date: new Date().toISOString().slice(0, 10),
      source: "Exact base-currency identity"
    }, 200, origin, env);
  }

  try {
    const table = await getUsdBaseTable(currency);
    const usdPerGhs = 1 / Number(table.rates.GHS);
    const targetPerUsd = Number(table.rates[currency]);
    const rate = targetPerUsd * usdPerGhs;
    if (!Number.isFinite(targetPerUsd) || targetPerUsd <= 0 || !Number.isFinite(rate) || rate <= 0) {
      return jsonResponse({
        ok: false,
        code: "currency-rate-unavailable",
        message: "Neither reference-rate source currently publishes a rate for " + currency + "."
      }, 404, origin, env);
    }
    return jsonResponse({
      ok: true,
      base: "GHS",
      currency,
      rate,
      date: table.date,
      source: table.source,
      calculation: "GHS cross-rate calculated from a USD-base reference table"
    }, 200, origin, env);
  } catch (error) {
    if (error?.code === "currency-rate-unavailable") {
      return jsonResponse({ ok: false, code: error.code, message: error.message }, 404, origin, env);
    }
    console.error("Vivid Anime Premium exchange-rate lookup failed:", error?.message || String(error));
    return jsonResponse({
      ok: false,
      code: "exchange-rate-unavailable",
      message: "The latest published exchange-rate reference is temporarily unavailable."
    }, 503, origin, env);
  }
}
