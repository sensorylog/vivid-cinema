import {
  allowedOrigin, AnimePremiumError, enforceRateLimit, getPremiumServices,
  jsonResponse, optionsResponse, requirePremiumUser, timestampFromMillis
} from "../../lib/anime-premium-service.js";

export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  try {
    const user = await requirePremiumUser(request, env);
    const raw = await request.text();
    if (raw.length > 2000) throw new AnimePremiumError(400, "invalid-progress", "This playback progress update is too large.");
    let body;
    try { body = JSON.parse(raw); } catch { throw new AnimePremiumError(400, "invalid-progress", "A valid progress update is required."); }
    const sessionId = String(body.sessionId || "");
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new AnimePremiumError(400, "invalid-session", "This playback session is invalid.");
    const currentTime = Number(body.currentTime);
    const duration = Number(body.duration);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60 || currentTime < 0 || currentTime > duration + 5) {
      throw new AnimePremiumError(400, "invalid-progress", "The playback progress values are invalid.");
    }
    const { db } = getPremiumServices(env);
    await enforceRateLimit(db, user.uid, "progress", 60, 60 * 1000);
    const membershipSnapshot = await db.collection("animePremiumMemberships").doc(user.uid).get();
    const membership = membershipSnapshot.exists ? membershipSnapshot.data() || {} : {};
    const periodEnd = typeof membership.currentPeriodEnd?.toMillis === "function" ? membership.currentPeriodEnd.toMillis() : Number(membership.currentPeriodEnd || 0);
    if (!["active", "past_due"].includes(membership.status) || periodEnd <= Date.now()) {
      throw new AnimePremiumError(403, "premium-membership-required", "An active Vivid Anime Premium membership is required.");
    }
    const sessionRef = db.collection("animePremiumPlaybackSessions").doc(sessionId);
    const sessionSnapshot = await sessionRef.get();
    if (!sessionSnapshot.exists) throw new AnimePremiumError(404, "playback-session-not-found", "This playback session has expired.");
    const session = sessionSnapshot.data() || {};
    const sessionExpiry = typeof session.expiresAt?.toMillis === "function" ? session.expiresAt.toMillis() : Number(session.expiresAt || 0);
    if (session.uid !== user.uid || sessionExpiry <= Date.now()) throw new AnimePremiumError(403, "playback-session-invalid", "This playback session is no longer valid.");
    const profileRef = db.collection("animePremiumProfiles").doc(user.uid);
    const now = Date.now();
    const progressPercent = Math.min(100, Math.round((currentTime / duration) * 1000) / 10);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(profileRef);
      const profile = snapshot.exists ? snapshot.data() || {} : {};
      const current = Array.isArray(profile.continueWatching) ? [...profile.continueWatching] : [];
      const key = session.mediaType + ":" + session.titleId + ":" + (session.season || 0) + ":" + (session.episode || 0);
      const filtered = current.filter(item => [item.mediaType, item.titleId, item.season || 0, item.episode || 0].join(":") !== key);
      if (progressPercent < 92) {
        filtered.unshift({
          titleId: session.titleId,
          mediaType: session.mediaType,
          season: session.season || 0,
          episode: session.episode || 0,
          progressSeconds: Math.floor(currentTime),
          durationSeconds: Math.floor(duration),
          progressPercent,
          updatedAt: timestampFromMillis(now)
        });
      }
      transaction.set(profileRef, { continueWatching: filtered.slice(0, 30), updatedAt: timestampFromMillis(now) }, { merge: true });
    });
    return jsonResponse({ ok: true, progressPercent }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "progress-update-failed", message: status < 500 ? error.message : "Playback progress could not be saved." }, status, origin, env);
  }
}
