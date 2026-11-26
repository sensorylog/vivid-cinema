import {
  allowedOrigin, AnimePremiumError, enforceRateLimit, getPremiumServices, jsonResponse, optionsResponse,
  requirePremiumUser, timestampFromMillis
} from "../../lib/anime-premium-service.js";

function allowedStreamHosts(env) {
  return new Set(String(env.ANIME_PREMIUM_STREAM_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
}
export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  try {
    const user = await requirePremiumUser(request, env);
    const raw = await request.text();
    if (raw.length > 4000) throw new AnimePremiumError(400, "invalid-request", "This playback request is too large.");
    let body;
    try { body = JSON.parse(raw); } catch { throw new AnimePremiumError(400, "invalid-request", "A valid playback request is required."); }
    const mediaType = body.mediaType === "movie" ? "movie" : body.mediaType === "tv" ? "tv" : "";
    const titleId = String(body.titleId || "");
    if (!mediaType || !/^\d{1,12}$/.test(titleId)) throw new AnimePremiumError(400, "invalid-title", "A valid anime title is required.");
    const season = mediaType === "tv" ? Number(body.season) : null;
    const episode = mediaType === "tv" ? Number(body.episode) : null;
    if (mediaType === "tv" && (!Number.isInteger(season) || season < 1 || season > 100 || !Number.isInteger(episode) || episode < 1 || episode > 10000)) {
      throw new AnimePremiumError(400, "invalid-episode", "Choose a valid season and episode.");
    }
    const { db } = getPremiumServices(env);
    await enforceRateLimit(db, user.uid, "playback", 40, 60 * 1000);
    const membershipSnapshot = await db.collection("animePremiumMemberships").doc(user.uid).get();
    const membership = membershipSnapshot.exists ? membershipSnapshot.data() : null;
    const end = typeof membership?.currentPeriodEnd?.toMillis === "function" ? membership.currentPeriodEnd.toMillis() : Number(membership?.currentPeriodEnd || 0);
    if (!membership || !["active", "past_due"].includes(membership.status) || end <= Date.now()) {
      throw new AnimePremiumError(403, "premium-membership-required", "An active Vivid Anime Premium membership is required.");
    }
    const sourceKey = mediaType + "_" + titleId + (mediaType === "tv" ? "_s" + season + "_e" + episode : "");
    const sourceSnapshot = await db.collection("animePremiumSources").doc(sourceKey).get();
    if (!sourceSnapshot.exists || sourceSnapshot.data()?.active !== true) {
      throw new AnimePremiumError(404, "authorised-source-not-found", "No authorised playback source is available for this episode.");
    }
    const resolverUrl = String(env.ANIME_PREMIUM_STREAM_RESOLVER_URL || "").trim();
    const resolverToken = String(env.ANIME_PREMIUM_STREAM_RESOLVER_TOKEN || "").trim();
    const hosts = allowedStreamHosts(env);
    if (!resolverUrl || !resolverToken || !hosts.size) {
      throw new AnimePremiumError(503, "playback-provider-not-configured", "The authorised playback provider is not configured yet.");
    }
    const resolver = new URL(resolverUrl);
    if (resolver.protocol !== "https:" || resolver.username || resolver.password) {
      throw new AnimePremiumError(503, "playback-provider-not-configured", "The authorised playback resolver URL is invalid.");
    }
    const source = sourceSnapshot.data();
    if (!source.sourceId || !source.provider) throw new AnimePremiumError(404, "authorised-source-not-found", "No authorised playback source is available for this episode.");
    const resolverResponse = await fetch(resolver.toString(), {
      method: "POST",
      headers: { Authorization: "Bearer " + resolverToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: source.sourceId,
        provider: source.provider,
        mediaType,
        titleId,
        season,
        episode,
        userId: user.uid
      })
    });
    const resolved = await resolverResponse.json().catch(() => ({}));
    if (!resolverResponse.ok || !resolved.url || !resolved.expiresAt) {
      throw new AnimePremiumError(502, "playback-source-unavailable", "The authorised playback provider could not open this episode.");
    }
    const url = new URL(resolved.url);
    const expiresAt = Date.parse(resolved.expiresAt);
    const mimeType = String(resolved.mimeType || "");
    if (url.protocol !== "https:" || !hosts.has(url.hostname.toLowerCase()) || url.username || url.password ||
        !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 60 * 60 * 1000 ||
        !["video/mp4", "application/vnd.apple.mpegurl", "application/x-mpegURL"].includes(mimeType)) {
      throw new AnimePremiumError(502, "invalid-playback-session", "The authorised provider returned an invalid playback session.");
    }
    return jsonResponse({
      ok: true,
      playback: {
        url: url.toString(),
        expiresAt: new Date(expiresAt).toISOString(),
        mimeType,
        provider: String(source.provider || "Vivid authorised source")
      }
    }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "playback-failed", message: status < 500 ? error.message : "Protected playback is temporarily unavailable." }, status, origin, env);
  }
}
