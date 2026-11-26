import {
  allowedOrigin, AnimePremiumError, enforceRateLimit, getPremiumServices, jsonResponse, optionsResponse,
  requirePremiumUser, timestampFromMillis
} from "../../lib/anime-premium-service.js";

const PAGE_PLANS = Object.freeze({
  monthly: { amount: 5330, currency: "GHS", url: "https://paystack.shop/pay/0l2xtffj32" },
  biannually: { amount: 28782, currency: "GHS", url: "https://paystack.shop/pay/0uore5wiij" },
  annually: { amount: 51168, currency: "GHS", url: "https://paystack.shop/pay/au6i-868ud" }
});

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed", message: "This origin is not allowed." }, 403, "", env);
  try {
    const raw = await request.text();
    if (raw.length > 4000) throw new AnimePremiumError(400, "invalid-request", "This checkout request is too large.");
    let body;
    try { body = JSON.parse(raw); } catch { throw new AnimePremiumError(400, "invalid-request", "A valid checkout request is required."); }
    const user = await requirePremiumUser(request, env);
    if (!String(env.PAYSTACK_SECRET_KEY || "").trim()) throw new AnimePremiumError(503, "checkout-verification-not-configured", "Secure payment verification is not configured yet. Please contact Vivid support.");
    const planId = String(body.planId || "monthly").toLowerCase();
    const plan = PAGE_PLANS[planId];
    if (!plan) throw new AnimePremiumError(400, "invalid-plan", "Choose a valid Premium billing period.");
    const { db } = getPremiumServices(env);
    await enforceRateLimit(db, user.uid, "page-checkout", 3, 10 * 60 * 1000);
    const reference = "VAPP" + crypto.randomUUID().replace(/-/g, "").slice(0, 28).toUpperCase();
    const now = Date.now();
    await db.collection("animePremiumPageCheckouts").doc(reference).set({
      reference, uid: user.uid, email: String(user.email).trim().toLowerCase(),
      planId, country: "GH", currency: plan.currency, amount: plan.amount,
      paymentMethod: "card", renewalMode: "automatic", status: "pending",
      createdAt: timestampFromMillis(now), updatedAt: timestampFromMillis(now)
    });
    return jsonResponse({ ok: true, paymentPageUrl: plan.url, reference, planId }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "checkout-failed", message: status < 500 ? error.message : "Checkout could not be started. Please try again." }, status, origin, env);
  }
}
