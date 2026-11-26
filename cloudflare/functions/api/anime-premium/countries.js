import { ANIME_PREMIUM_COUNTRIES } from "../../../../scripts/anime-premium-countries.js";
import { allowedOrigin, jsonResponse, optionsResponse } from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) {
    return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  }

  // This directory is bundled with the Pages Function. Do not fetch countries
  // from REST Countries/CDNs at runtime: those upstream outages caused the
  // Premium selector to fall back to a tiny offline list.
  const countries = ANIME_PREMIUM_COUNTRIES;
  return jsonResponse({ ok: true, countries, count: countries.length }, 200, origin, env);
}
