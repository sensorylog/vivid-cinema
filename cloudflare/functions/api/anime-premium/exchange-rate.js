import { allowedOrigin, jsonResponse, optionsResponse } from "../../lib/anime-premium-service.js";

async function fetchDailyRates() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://open-rates.currencyfreaks.com/rates?base=GHS", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cf: { cacheTtl: 21600, cacheEverything: true }
    });
    if (!response.ok) throw new Error("Reference-rate provider returned " + response.status);
    const payload = await response.json();
    const rates = payload?.rates || {};
    if (payload.base !== "GHS" || !Number.isFinite(Number(rates.GHS)) || Number(rates.GHS) !== 1) {
      throw new Error("Reference-rate provider did not return a valid GHS-base rate table.");
    }
    return { date: String(payload.date || ""), rates };
  } finally {
    clearTimeout(timer);
  }
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
    const quote = await fetchDailyRates();
    const rate = Number(quote.rates[currency]);
    if (!Number.isFinite(rate) || rate <= 0) {
      return jsonResponse({ ok: false, code: "currency-rate-unavailable", message: "A published reference rate is not available for " + currency + "." }, 404, origin, env);
    }
    return jsonResponse({
      ok: true,
      base: "GHS",
      currency,
      rate,
      date: quote.date,
      source: "CurrencyFreaks Open Rates · daily blended reference rates from 127 official sources"
    }, 200, origin, env);
  } catch (error) {
    console.error("Vivid Anime Premium exchange-rate lookup failed:", error?.message || String(error));
    return jsonResponse({
      ok: false,
      code: "exchange-rate-unavailable",
      message: "The latest published exchange-rate reference is temporarily unavailable."
    }, 503, origin, env);
  }
}
