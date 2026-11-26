import {
  allowedOrigin, AnimePremiumError, getPremiumServices, jsonResponse, optionsResponse,
  paystackRequest, requirePremiumUser, timestampFromMillis
} from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  try {
    const user = await requirePremiumUser(request, env);
    const { db } = getPremiumServices(env);
    const membershipRef = db.collection("animePremiumMemberships").doc(user.uid);
    const snapshot = await membershipRef.get();
    const membership = snapshot.exists ? snapshot.data() || {} : {};
    if (!membership.autoRenew || membership.renewalMode !== "automatic" || !membership.subscriptionCode || !membership.subscriptionEmailToken) {
      throw new AnimePremiumError(409, "automatic-renewal-not-active", "There is no active automatic card renewal to cancel.");
    }
    await paystackRequest(env, "/subscription/disable", {
      body: { code: membership.subscriptionCode, token: membership.subscriptionEmailToken }
    });
    await membershipRef.set({
      autoRenew: false,
      cancelAtPeriodEnd: true,
      renewalMode: "manual",
      cancellationRequestedAt: timestampFromMillis(Date.now()),
      updatedAt: timestampFromMillis(Date.now())
    }, { merge: true });
    return jsonResponse({ ok: true, cancelAtPeriodEnd: true }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "cancel-renewal-failed", message: status < 500 ? error.message : "Automatic renewal could not be cancelled. Please try again." }, status, origin, env);
  }
}
