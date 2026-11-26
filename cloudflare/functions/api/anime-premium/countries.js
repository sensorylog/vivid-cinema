import { countries as isoCountries } from "countries-list";
import { allowedOrigin, jsonResponse, optionsResponse } from "../../lib/anime-premium-service.js";

// Serve the ISO 3166-1 country directory from the deployed bundle. Do not
// depend on third-party APIs at request time: both previous upstream URLs
// were retired/moved and made the selector fall back to 20 countries.
function loadDirectory() {
  return Object.entries(isoCountries).map(([code, country]) => ({
    code: String(code).toUpperCase(),
    name: String(country.name || code),
    currency: Array.isArray(country.currency)
      ? String(country.currency[0] || "").toUpperCase()
      : String(country.currency || "").toUpperCase()
  })).filter(country => /^[A-Z]{2}$/.test(country.code) && country.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}

export function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) {
    return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  }
  try {
    const countries = loadDirectory();
    if (countries.length < 200) throw new Error("Bundled ISO country directory is incomplete (" + countries.length + ").");
    return jsonResponse({
      ok: true,
      countries,
      count: countries.length,
      source: "Bundled countries-list ISO 3166-1 / ISO 4217 dataset"
    }, 200, origin, env);
  } catch (error) {
    console.error("Vivid Anime Premium bundled country directory failed:", error?.message || String(error));
    return jsonResponse({
      ok: false,
      code: "country-directory-unavailable",
      message: "The bundled international country directory could not be loaded."
    }, 503, origin, env);
  }
}
