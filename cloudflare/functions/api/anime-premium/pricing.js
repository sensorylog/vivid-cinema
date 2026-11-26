import { allowedOrigin, jsonResponse, optionsResponse, publicPricing } from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  try {
    return jsonResponse({ ok: true, ...publicPricing(env) }, 200, origin, env);
  } catch (error) {
    return jsonResponse({ ok: false, code: error.code || "pricing-unavailable", message: error.message || "Pricing is unavailable." }, error.status || 503, origin, env);
  }
}
