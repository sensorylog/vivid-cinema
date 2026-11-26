import {
  allowedOrigin, AnimePremiumError, getPremiumServices, jsonResponse, optionsResponse,
  requirePremiumUser
} from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequestGet({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  try {
    const user = await requirePremiumUser(request, env);
    const { db } = getPremiumServices(env);
    const snapshot = await db.collection("animePremiumMemberships").doc(user.uid).get();
    if (!snapshot.exists) return jsonResponse({ ok: true, membership: { status: "inactive", active: false } }, 200, origin, env);
    const data = snapshot.data() || {};
    const periodEndMillis = typeof data.currentPeriodEnd?.toMillis === "function"
      ? data.currentPeriodEnd.toMillis()
      : Number(data.currentPeriodEnd || 0);
    const active = ["active", "past_due"].includes(data.status) && periodEndMillis > Date.now();
    return jsonResponse({
      ok: true,
      membership: {
        status: active ? data.status : "expired",
        active,
        planId: data.planId || "monthly",
        currency: data.currency || null,
        renewalMode: data.renewalMode || "manual",
        autoRenew: Boolean(data.autoRenew && data.renewalMode === "automatic"),
        currentPeriodEnd: periodEndMillis ? new Date(periodEndMillis).toISOString() : null,
        cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd)
      }
    }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "membership-unavailable", message: status < 500 ? error.message : "Membership status is temporarily unavailable." }, status, origin, env);
  }
}
