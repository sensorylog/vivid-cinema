import {
  allowedOrigin, AnimePremiumError, getPremiumServices, jsonResponse, optionsResponse,
  paystackRequest, requirePremiumUser, resolveCheckoutPlan, safeReference, timestampFromMillis
} from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed", message: "This origin is not allowed." }, 403, "", env);
  try {
    const raw = await request.text();
    if (raw.length > 8000) throw new AnimePremiumError(400, "invalid-request", "This checkout request is too large.");
    let body;
    try { body = JSON.parse(raw); } catch { throw new AnimePremiumError(400, "invalid-request", "A valid checkout request is required."); }
    const user = await requirePremiumUser(request, env);
    const country = String(body.country || "").toUpperCase();
    const paymentMethod = String(body.paymentMethod || "");
    if (!["card", "mobile_money"].includes(paymentMethod)) throw new AnimePremiumError(400, "invalid-payment-method", "Choose card or mobile money.");
    const plan = resolveCheckoutPlan(country, env);
    if (paymentMethod === "card" && !plan.planCode) {
      throw new AnimePremiumError(503, "card-renewal-not-configured", "Automatic card renewal is not configured for this checkout currency yet.");
    }
    if (paymentMethod === "mobile_money" && !plan.mobileMoneyAvailable) {
      throw new AnimePremiumError(400, "mobile-money-not-supported", "Mobile money checkout is not supported for the selected country. Choose card instead.");
    }
    const { db } = getPremiumServices(env);
    const reference = "VAP" + crypto.randomUUID().replace(/-/g, "").slice(0, 28).toUpperCase();
    if (!safeReference(reference)) throw new AnimePremiumError(500, "reference-generation-failed", "A checkout reference could not be created.");
    const now = Date.now();
    const renewalMode = paymentMethod === "card" ? "automatic" : "manual";
    const checkoutRef = db.collection("animePremiumCheckouts").doc(reference);
    await checkoutRef.set({
      reference,
      uid: user.uid,
      email: user.email,
      planId: "monthly",
      country,
      currency: plan.currency,
      amount: plan.amount,
      paymentMethod,
      renewalMode,
      status: "initializing",
      createdAt: timestampFromMillis(now),
      updatedAt: timestampFromMillis(now)
    });
    const callbackUrl = new URL("/anime-premium-return.html", origin).toString();
    const paystackBody = {
      email: user.email,
      amount: String(plan.amount),
      currency: plan.currency,
      reference,
      callback_url: callbackUrl,
      channels: paymentMethod === "card" ? ["card"] : ["mobile_money"],
      metadata: {
        uid: user.uid,
        planId: "monthly",
        country,
        paymentMethod,
        renewalMode,
        product: "vivid_anime_premium"
      }
    };
    if (paymentMethod === "card") paystackBody.plan = plan.planCode;
    try {
      const result = await paystackRequest(env, "/transaction/initialize", { body: paystackBody });
      if (!result.authorization_url || !/^https:\/\/checkout\.paystack\.com\//.test(result.authorization_url)) {
        throw new AnimePremiumError(502, "invalid-checkout-url", "Paystack returned an invalid checkout link.");
      }
      await checkoutRef.set({
        status: "pending",
        authorizationUrl: result.authorization_url,
        accessCode: result.access_code || null,
        updatedAt: timestampFromMillis(Date.now())
      }, { merge: true });
      return jsonResponse({
        ok: true,
        authorizationUrl: result.authorization_url,
        reference,
        currency: plan.currency,
        amountMinor: plan.amount,
        renewalMode
      }, 200, origin, env);
    } catch (error) {
      await checkoutRef.set({ status: "initialization_failed", updatedAt: timestampFromMillis(Date.now()) }, { merge: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({
      ok: false,
      code: error.code || "checkout-failed",
      message: status < 500 ? error.message : "Checkout could not be started. Please try again."
    }, status, origin, env);
  }
}
