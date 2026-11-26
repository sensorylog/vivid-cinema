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
    if (!String(env.PAYSTACK_WEBHOOK_SECRET || "").trim()) {
      throw new AnimePremiumError(503, "webhook-verification-not-configured", "Paystack webhook signing secret is not configured. Vivid cannot safely activate membership until the webhook signing secret is added.");
    }
    const planId = String(body.planId || "monthly").toLowerCase();
    const plan = PAGE_PLANS[planId];
    if (!plan) throw new AnimePremiumError(400, "invalid-plan", "Choose a valid Premium billing period.");
    const { db } = getPremiumServices(env);
    await enforceRateLimit(db, user.uid, "page-checkout", 3, 10 * 60 * 1000);
    const reference = "VAPP" + crypto.randomUUID().replace(/-/g, "").slice(0, 28).toUpperCase();
    const now = Date.now();
    const email = String(user.email || "").trim().toLowerCase();
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      throw new AnimePremiumError(403, "verified-email-required", "A verified Vivid account email is required for Premium checkout.");
    }
    const pendingRef = db.collection("animePremiumPageCheckouts");
    const previous = await pendingRef.where("uid", "==", user.uid).get();
    const batch = db.batch();
    previous.docs.forEach(doc => {
      if (doc.data()?.status === "pending") batch.set(doc.ref, {
        status: "superseded", supersededAt: timestampFromMillis(now), updatedAt: timestampFromMillis(now)
      }, { merge: true });
    });
    const checkoutRef = pendingRef.doc(reference);
    batch.set(checkoutRef, {
      reference, uid: user.uid, email,
      planId, country: "GH", currency: plan.currency, amount: plan.amount,
      paymentMethod: "card", checkoutSource: "hosted_payment_page", renewalMode: "pending", status: "pending",
      createdAt: timestampFromMillis(now), updatedAt: timestampFromMillis(now)
    });
    await batch.commit();
    const paymentPageUrl = new URL(plan.url);
    paymentPageUrl.searchParams.set("email", email);
    paymentPageUrl.searchParams.set("read-only", "email");
    return jsonResponse({ ok: true, paymentPageUrl: paymentPageUrl.toString(), reference, planId }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "checkout-failed", message: status < 500 ? error.message : "Checkout could not be started. Please try again." }, status, origin, env);
  }
}
