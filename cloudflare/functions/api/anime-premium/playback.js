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
    if (raw.length > 2000) throw new AnimePremiumError(400, "invalid-request", "This playback request is too large.");
    let body;
    try { body = JSON.parse(raw); } catch { throw new AnimePremiumError(400, "invalid-request", "A valid playback request is required."); }
    const mediaType = body.mediaType === "movie" ? "movie" : body.mediaType === "tv" ? "tv" : "";
    const titleId = String(body.titleId || "");
    if (!mediaType || !/^\\d{1,12}$/.test(titleId)) throw new AnimePremiumError(400, "invalid-title", "A valid anime title is required.");
    const season = mediaType === "tv" ? Number(body.season) : null;
    const episode = mediaType === "tv" ? Number(body.episode) : null;
    if (mediaType === "tv" && (!Number.isInteger(season) || season < 1 || season > 100 || !Number.isInteger(episode) || episode < 1 || episode > 10000)) {
      throw new AnimePremiumError(400, "invalid-episode", "Choose a valid season and episode.");
    }

    const { db } = getPremiumServices(env);
    await enforceRateLimit(db, user.uid, "playback", 40, 60 * 1000);
    const membershipSnapshot = await db.collection("animePremiumMemberships").doc(user.uid).get();
    const membership = membershipSnapshot.exists ? membershipSnapshot.data() : null;
    const periodEnd = typeof membership?.currentPeriodEnd?.toMillis === "function"
      ? membership.currentPeriodEnd.toMillis()
      : Number(membership?.currentPeriodEnd || 0);
    if (!membership || !["active", "past_due"].includes(membership.status) || periodEnd <= Date.now()) {
      throw new AnimePremiumError(403, "premium-membership-required", "An active Vivid Anime Premium membership is required.");
    }

    // Premium access is checked here. The browser then embeds the same third-party
    // player providers already used by Vivid Cinema; it never receives raw stream URLs.
    const sessionId = crypto.randomUUID();
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000;
    await db.collection("animePremiumPlaybackSessions").doc(sessionId).set({
      uid: user.uid, mediaType, titleId, season, episode,
      providerMode: "vivid-third-party-embeds",
      expiresAt: timestampFromMillis(expiresAt),
      createdAt: timestampFromMillis(Date.now())
    });
    return jsonResponse({
      ok: true,
      playback: { sessionId, expiresAt: new Date(expiresAt).toISOString(), providerMode: "vivid-third-party-embeds" }
    }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "playback-failed", message: status < 500 ? error.message : "Premium playback is temporarily unavailable." }, status, origin, env);
  }
}
