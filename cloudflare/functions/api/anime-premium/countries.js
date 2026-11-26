import { allowedOrigin, jsonResponse, optionsResponse } from "../../lib/anime-premium-service.js";

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cf: { cacheTtl: 21600, cacheEverything: true }
    });
  } finally {
    clearTimeout(timer);
  }
}

function fromRestCountries(rows) {
  return rows.map(country => ({
    code: String(country.cca2 || "").toUpperCase(),
    name: String(country.name?.common || country.cca2 || ""),
    currency: Object.keys(country.currencies || {}).sort()[0] || ""
  })).filter(country => /^[A-Z]{2}$/.test(country.code) && country.name);
}

function fromAnnexare(data) {
  return Object.entries(data || {}).map(([code, country]) => ({
    code: String(code).toUpperCase(),
    name: String(country.name || code),
    currency: Array.isArray(country.currency) ? String(country.currency[0] || "").toUpperCase() : String(country.currency || "").toUpperCase()
  })).filter(country => /^[A-Z]{2}$/.test(country.code) && country.name);
}

async function loadDirectory() {
  const sources = [
    async () => {
      const response = await fetchWithTimeout("https://restcountries.com/v3.1/all?fields=cca2,name,currencies");
      if (!response.ok) throw new Error("REST Countries returned " + response.status);
      return fromRestCountries(await response.json());
    },
    async () => {
      const response = await fetchWithTimeout("https://cdn.jsdelivr.net/gh/annexare/Countries@master/dist/countries.json");
      if (!response.ok) throw new Error("Backup country dataset returned " + response.status);
      return fromAnnexare(await response.json());
    }
  ];
  let lastError;
  for (const source of sources) {
    try {
      const rows = await source();
      const countries = [...new Map(rows.map(country => [country.code, country])).values()];
      if (countries.length < 180) throw new Error("Country dataset was incomplete (" + countries.length + ").");
      return countries.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      lastError = error;
      console.warn("Vivid Anime Premium country source failed; trying backup:", error);
    }
  }
  throw lastError || new Error("No country directory source is available.");
}

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) {
    return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  }
  try {
    const countries = await loadDirectory();
    return jsonResponse({ ok: true, countries, count: countries.length }, 200, origin, env);
  } catch (error) {
    console.error("Vivid Anime Premium country directory failed:", error?.message || String(error));
    return jsonResponse({
      ok: false,
      code: "country-directory-unavailable",
      message: "The international country directory is temporarily unavailable."
    }, 503, origin, env);
  }
}
