import {
  allowedOrigin, AnimePremiumError, getPremiumServices, jsonResponse, optionsResponse,
  requirePremiumUser, timestampFromMillis, addDaysMillis, paystackRequest
} from "../../../lib/anime-premium-service.js";

function requireAdmin(user, env) {
  const allowlist = new Set(String(env.ANIME_PREMIUM_ADMIN_UIDS || "").split(",").map(value => value.trim()).filter(Boolean));
  if (user.admin !== true && user.animePremiumAdmin !== true && !allowlist.has(user.uid)) {
    throw new AnimePremiumError(403, "admin-required", "Anime Premium administrator access is required.");
  }
}
export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  try {
    const user = await requirePremiumUser(request, env);
    requireAdmin(user, env);
    const { db } = getPremiumServices(env);
    if (request.method === "GET") {
      const snapshot = await db.collection("animePremiumMemberships").orderBy("updatedAt", "desc").limit(50).get();
      const memberships = snapshot.docs.map(document => {
        const value = document.data() || {};
        const periodEnd = typeof value.currentPeriodEnd?.toMillis === "function" ? value.currentPeriodEnd.toMillis() : Number(value.currentPeriodEnd || 0);
        return {
          uid: document.id,
          status: value.status || "inactive",
          billingStatus: value.billingStatus || "unknown",
          planId: value.planId || "monthly",
          currency: value.currency || null,
          country: value.country || null,
          renewalMode: value.renewalMode || "manual",
          autoRenew: Boolean(value.autoRenew),
          currentPeriodEnd: periodEnd ? new Date(periodEnd).toISOString() : null,
          updatedAt: typeof value.updatedAt?.toMillis === "function" ? new Date(value.updatedAt.toMillis()).toISOString() : null
        };
      });
      return jsonResponse({ ok: true, memberships }, 200, origin, env);
    }
    if (request.method !== "POST") return jsonResponse({ ok: false, code: "method-not-allowed" }, 405, origin, env);
    const body = await request.json();
    const uid = String(body.uid || "").trim();
    const action = String(body.action || "");
    const reason = String(body.reason || "").trim().slice(0, 300);
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(uid) || reason.length < 8) {
      throw new AnimePremiumError(400, "invalid-admin-request", "Enter a valid user ID and an audit reason of at least 8 characters.");
    }
    const ref = db.collection("animePremiumMemberships").doc(uid);
    const existingSnapshot = await ref.get();
    const existingMembership = existingSnapshot.exists ? existingSnapshot.data() || {} : {};
    const now = Date.now();
    if (action === "grant") {
      const days = Number(body.days || 30);
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new AnimePremiumError(400, "invalid-duration", "Membership duration must be between 1 and 3650 days.");
      await ref.set({
        uid, status: "active", billingStatus: "admin_granted", planId: "admin_override",
        renewalMode: "manual", autoRenew: false, cancelAtPeriodEnd: false,
        currentPeriodStart: timestampFromMillis(now), currentPeriodEnd: timestampFromMillis(addDaysMillis(days, now)),
        adminGrantReason: reason, adminGrantBy: user.uid, updatedAt: timestampFromMillis(now)
      }, { merge: true });
    } else if (action === "revoke") {
      if (existingMembership.autoRenew && existingMembership.subscriptionCode && existingMembership.subscriptionEmailToken) {
        await paystackRequest(env, "/subscription/disable", { body: { code: existingMembership.subscriptionCode, token: existingMembership.subscriptionEmailToken } });
      } else if (existingMembership.autoRenew) {
        throw new AnimePremiumError(409, "renewal-cancellation-unavailable", "Automatic renewal credentials are unavailable. Disable the Paystack subscription before revoking this membership.");
      }
      await ref.set({
        status: "suspended", billingStatus: "admin_revoked", autoRenew: false,
        cancelAtPeriodEnd: false, adminRevokeReason: reason, adminRevokeBy: user.uid,
        currentPeriodEnd: timestampFromMillis(now), updatedAt: timestampFromMillis(now)
      }, { merge: true });
    } else {
      throw new AnimePremiumError(400, "invalid-action", "Choose grant or revoke.");
    }
    await db.collection("animePremiumAdminAudit").add({
      actorUid: user.uid, targetUid: uid, action, reason,
      days: action === "grant" ? Number(body.days || 30) : null,
      createdAt: timestampFromMillis(now)
    });
    return jsonResponse({ ok: true, uid, action }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "admin-operation-failed", message: status < 500 ? error.message : "The admin operation could not be completed." }, status, origin, env);
  }
}
