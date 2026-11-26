import {
  AnimePremiumError, getPremiumServices, paystackRequest, timestampFromMillis,
  verifyPaystackSignature, jsonResponse, safeReference
} from "../../lib/anime-premium-service.js";

async function eventDocumentId(event, data) {
  const value = [event, data.reference || data.id || "", data.subscription?.subscription_code || data.subscription_code || ""].join(":");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function addMonthsMillis(planId, from = Date.now()) {
  const months = planId === "annually" ? 12 : planId === "biannually" ? 6 : 1;
  const date = new Date(from);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}
function millis(value) {
  const result = Date.parse(value || "");
  return Number.isFinite(result) ? result : 0;
}
async function handleChargeSuccess(db, env, data, eventRef) {
  const reference = String(data.reference || "");
  let checkoutRef;
  let checkoutSnapshot;
  let checkout = {};
  let hostedPageCheckout = false;
  if (reference.startsWith("VAP") && safeReference(reference)) {
    checkoutRef = db.collection("animePremiumCheckouts").doc(reference);
    checkoutSnapshot = await checkoutRef.get();
    if (!checkoutSnapshot.exists) return;
    checkout = checkoutSnapshot.data() || {};
  } else {
    // Payment Page transactions have Paystack-generated references, not the
    // Vivid VAP references used by the API-initialized checkout flow. Their
    // signed charge.success payload is the authoritative payment receipt.
    if (String(data.status || "").toLowerCase() !== "success") return;
    const email = String(data.customer?.email || "").trim().toLowerCase();
    const amount = Number(data.amount || 0);
    const currency = String(data.currency || "").toUpperCase();
    if (!email || !amount || !currency) return;
    const pending = await db.collection("animePremiumPageCheckouts").where("email", "==", email).limit(20).get();
    const now = Date.now();
    const matches = pending.docs.filter(doc => {
      const value = doc.data() || {};
      const created = typeof value.createdAt?.toMillis === "function" ? value.createdAt.toMillis() : Number(value.createdAt || 0);
      return value.status === "pending" &&
        Number(value.amount) === amount &&
        String(value.currency || "").toUpperCase() === currency &&
        created > now - 24 * 60 * 60 * 1000;
    });
    // Never guess which account/plan a payment belongs to. If more than one
    // pending order matches, leave it for manual reconciliation.
    if (matches.length !== 1) {
      console.warn("Hosted Paystack payment did not map to exactly one pending Vivid checkout.", {
        reference, email, amount, currency, matches: matches.length
      });
      return;
    }
    checkoutRef = matches[0].ref;
    checkoutSnapshot = matches[0];
    checkout = checkoutSnapshot.data() || {};
    hostedPageCheckout = true;
  }
  if (hostedPageCheckout) {
    // A matching email/amount is not enough: donations and unrelated Paystack
    // charges can share those values. Only a real Paystack subscription charge
    // may activate a hosted-page Premium checkout.
    const subscriptionCode = String(data.subscription?.subscription_code || data.subscription_code || "");
    if (!/^SUB_[A-Za-z0-9]{6,80}$/i.test(subscriptionCode)) {
      console.warn("Hosted Paystack charge has no subscription evidence; Premium was not activated.", {
        reference, email: data.customer?.email || "", amount: data.amount, currency: data.currency
      });
      return;
    }
    if (data.subscription?.amount != null && Number(data.subscription.amount) !== amount) {
      console.warn("Hosted Paystack subscription amount did not match its charge.", { reference, amount, subscriptionAmount: data.subscription.amount });
      return;
    }
  }
  if (checkout.status === "paid") return;
  const verified = hostedPageCheckout
    ? data
    : await paystackRequest(env, "/transaction/verify/" + encodeURIComponent(reference), { method: "GET" });
  if (String(verified.status || "").toLowerCase() !== "success" || String(verified.reference) !== reference ||
      Number(verified.amount) !== Number(checkout.amount) ||
      String(verified.currency).toUpperCase() !== String(checkout.currency).toUpperCase()) {
    throw new AnimePremiumError(409, "payment-verification-failed", "The Paystack transaction did not match the pending checkout.");
  }
  const uid = String(checkout.uid || "");
  if (!uid) throw new AnimePremiumError(409, "checkout-owner-missing", "The checkout has no verified Vivid account.");
  const membershipRef = db.collection("animePremiumMemberships").doc(uid);
  const now = Date.now();
  const customerCode = String(verified.customer?.customer_code || data.customer?.customer_code || "");
  const pendingSubscriptionSnapshot = customerCode
    ? await db.collection("animePremiumPendingSubscriptions").where("customerCode", "==", customerCode).limit(1).get()
    : null;
  const pendingSubscriptionDoc = pendingSubscriptionSnapshot && !pendingSubscriptionSnapshot.empty ? pendingSubscriptionSnapshot.docs[0] : null;
  const pendingSubscription = pendingSubscriptionDoc ? pendingSubscriptionDoc.data() || {} : {};
  const paystackSubscriptionCode = String(verified.subscription?.subscription_code || data.subscription?.subscription_code || data.subscription_code || pendingSubscription.subscriptionCode || "");
  const subscriptionEmailToken = String(verified.subscription?.email_token || data.subscription?.email_token || pendingSubscription.emailToken || "");
  const requestedNextPayment = millis(verified.subscription?.next_payment_date || data.subscription?.next_payment_date);
  const hasRecurringPlan = Boolean(paystackSubscriptionCode);

  await db.runTransaction(async transaction => {
    const [eventSnapshot, liveCheckout, existingMembership] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(checkoutRef),
      transaction.get(membershipRef)
    ]);
    if (eventSnapshot.exists || !liveCheckout.exists || liveCheckout.data()?.status === "paid") return;
    const old = existingMembership.exists ? existingMembership.data() || {} : {};
    const oldEnd = typeof old.currentPeriodEnd?.toMillis === "function" ? old.currentPeriodEnd.toMillis() : Number(old.currentPeriodEnd || 0);
    const periodStart = oldEnd > now ? oldEnd : now;
    const periodEnd = Math.max(requestedNextPayment > now ? requestedNextPayment : 0, addMonthsMillis(checkout.planId || "monthly", periodStart));
    const renewalMode = checkout.checkoutSource === "hosted_payment_page"
      ? (hasRecurringPlan ? "automatic" : "manual")
      : checkout.renewalMode === "automatic" && checkout.paymentMethod === "card" ? "automatic" : "manual";
    transaction.set(membershipRef, {
      uid,
      status: "active",
      billingStatus: "paid",
      planId: checkout.planId || "monthly",
      currency: checkout.currency,
      country: checkout.country,
      renewalMode,
      autoRenew: renewalMode === "automatic",
      cancelAtPeriodEnd: false,
      paymentMethod: checkout.paymentMethod,
      paystackCustomerCode: customerCode || old.paystackCustomerCode || null,
      subscriptionCode: paystackSubscriptionCode || old.subscriptionCode || null,
      subscriptionEmailToken: subscriptionEmailToken || old.subscriptionEmailToken || null,
      lastPaymentReference: reference,
      currentPeriodStart: timestampFromMillis(periodStart),
      currentPeriodEnd: timestampFromMillis(periodEnd),
      updatedAt: timestampFromMillis(now)
    }, { merge: true });
    transaction.set(checkoutRef, {
      status: "paid",
      transactionId: verified.id || data.id || null,
      paidAt: timestampFromMillis(now),
      updatedAt: timestampFromMillis(now)
    }, { merge: true });
    if (pendingSubscriptionDoc) transaction.delete(pendingSubscriptionDoc.ref);
    transaction.set(eventRef, { processedAt: timestampFromMillis(now), event: "charge.success", reference });
  });
}
async function membershipBySubscription(db, subscriptionCode) {
  if (!subscriptionCode) return null;
  const snapshot = await db.collection("animePremiumMemberships").where("subscriptionCode", "==", subscriptionCode).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0];
}
async function membershipByCustomer(db, customerCode) {
  if (!customerCode) return null;
  const snapshot = await db.collection("animePremiumMemberships").where("paystackCustomerCode", "==", customerCode).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0];
}
async function handleRecurringEvent(db, eventName, data, eventRef) {
  const subscriptionCode = String(data.subscription?.subscription_code || data.subscription_code || data.subscription?.code || "");
  const customerCode = String(data.customer?.customer_code || data.customer_code || "");
  const membershipDoc = await membershipBySubscription(db, subscriptionCode) || (eventName === "subscription.create" ? await membershipByCustomer(db, customerCode) : null);
  if (!membershipDoc) {
    if (eventName === "subscription.create" && subscriptionCode) {
      await db.collection("animePremiumPendingSubscriptions").doc(subscriptionCode).set({
        subscriptionCode, customerCode,
        emailToken: String(data.email_token || data.subscription?.email_token || ""),
        createdAt: timestampFromMillis(Date.now())
      }, { merge: true });
      await eventRef.set({ processedAt: timestampFromMillis(Date.now()), event: eventName, subscriptionCode, pending: true }, { merge: true });
    }
    return;
  }
  const membershipRef = membershipDoc.ref;
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const [eventSnapshot, current] = await Promise.all([transaction.get(eventRef), transaction.get(membershipRef)]);
    if (eventSnapshot.exists || !current.exists) return;
    const value = current.data() || {};
    if (eventName === "subscription.create") {
      transaction.set(membershipRef, {
        subscriptionCode: subscriptionCode || value.subscriptionCode || null,
        subscriptionEmailToken: String(data.email_token || data.subscription?.email_token || value.subscriptionEmailToken || ""),
        paystackCustomerCode: customerCode || value.paystackCustomerCode || null,
        autoRenew: true,
        renewalMode: "automatic",
        updatedAt: timestampFromMillis(now)
      }, { merge: true });
    } else if (eventName === "invoice.payment_success") {
      const oldEnd = typeof value.currentPeriodEnd?.toMillis === "function" ? value.currentPeriodEnd.toMillis() : Number(value.currentPeriodEnd || 0);
      const start = oldEnd > now ? oldEnd : now;
      const next = millis(data.next_payment_date || data.subscription?.next_payment_date);
      transaction.set(membershipRef, {
        status: "active",
        billingStatus: "paid",
        autoRenew: true,
        renewalMode: "automatic",
        cancelAtPeriodEnd: false,
        currentPeriodStart: timestampFromMillis(start),
        currentPeriodEnd: timestampFromMillis(Math.max(next > now ? next : 0, addMonthsMillis(value.planId || "monthly", start))),
        updatedAt: timestampFromMillis(now)
      }, { merge: true });
    } else if (eventName === "invoice.payment_failed") {
      const end = typeof value.currentPeriodEnd?.toMillis === "function" ? value.currentPeriodEnd.toMillis() : Number(value.currentPeriodEnd || 0);
      transaction.set(membershipRef, {
        status: end > now ? "active" : "past_due",
        billingStatus: "past_due",
        updatedAt: timestampFromMillis(now)
      }, { merge: true });
    } else if (eventName === "subscription.disable" || eventName === "subscription.not_renew") {
      transaction.set(membershipRef, {
        autoRenew: false,
        cancelAtPeriodEnd: true,
        renewalMode: "manual",
        updatedAt: timestampFromMillis(now)
      }, { merge: true });
    }
    transaction.set(eventRef, { processedAt: timestampFromMillis(now), event: eventName, subscriptionCode });
  });
}
export async function onRequestPost({ request, env }) {
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > 128000) return jsonResponse({ ok: false, code: "payload-too-large" }, 413);
  try {
    if (!await verifyPaystackSignature(request, rawBody, env)) {
      return jsonResponse({ ok: false, code: "invalid-webhook-signature" }, 401);
    }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(rawBody)); }
    catch { return jsonResponse({ ok: false, code: "invalid-webhook-body" }, 400); }
    const eventName = String(payload.event || "");
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const { db } = getPremiumServices(env);
    const id = await eventDocumentId(eventName, data);
    const eventRef = db.collection("animePremiumWebhookEvents").doc(id);
    if (eventName === "charge.success") await handleChargeSuccess(db, env, data, eventRef);
    else if (["subscription.create", "invoice.payment_success", "invoice.payment_failed", "subscription.disable", "subscription.not_renew"].includes(eventName)) {
      await handleRecurringEvent(db, eventName, data, eventRef);
    } else {
      await eventRef.set({ processedAt: timestampFromMillis(Date.now()), event: eventName, ignored: true }, { merge: true });
    }
    return jsonResponse({ ok: true, received: true }, 200);
  } catch (error) {
    console.error("Vivid Anime Premium Paystack webhook failed:", { code: error.code || "internal", message: error.message || String(error) });
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "webhook-processing-failed" }, status);
  }
}
