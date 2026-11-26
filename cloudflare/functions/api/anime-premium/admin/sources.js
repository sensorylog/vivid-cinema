import {
  allowedOrigin, AnimePremiumError, getPremiumServices, jsonResponse, optionsResponse,
  requirePremiumUser, timestampFromMillis
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
    if (request.method !== "POST") return jsonResponse({ ok: false, code: "method-not-allowed" }, 405, origin, env);
    const body = await request.json();
    const mediaType = body.mediaType === "movie" ? "movie" : body.mediaType === "tv" ? "tv" : "";
    const titleId = String(body.titleId || "");
    const season = mediaType === "tv" ? Number(body.season) : null;
    const episode = mediaType === "tv" ? Number(body.episode) : null;
    const sourceId = String(body.sourceId || "").trim();
    const provider = String(body.provider || "").trim().slice(0, 80);
    if (!mediaType || !/^\d{1,12}$/.test(titleId) || !/^[A-Za-z0-9:_-]{3,160}$/.test(sourceId) || !provider) {
      throw new AnimePremiumError(400, "invalid-source", "Enter a valid anime title, approved provider and resolver source ID.");
    }
    if (mediaType === "tv" && (!Number.isInteger(season) || season < 1 || season > 100 || !Number.isInteger(episode) || episode < 1 || episode > 10000)) {
      throw new AnimePremiumError(400, "invalid-episode", "Enter a valid season and episode.");
    }
    const { db } = getPremiumServices(env);
    const key = mediaType + "_" + titleId + (mediaType === "tv" ? "_s" + season + "_e" + episode : "");
    const now = Date.now();
    await db.collection("animePremiumSources").doc(key).set({
      mediaType, titleId, season, episode, sourceId, provider,
      active: body.active !== false,
      updatedBy: user.uid, updatedAt: timestampFromMillis(now)
    }, { merge: true });
    await db.collection("animePremiumAdminAudit").add({
      actorUid: user.uid, action: "source_registry_update", sourceKey: key,
      provider, active: body.active !== false, createdAt: timestampFromMillis(now)
    });
    return jsonResponse({ ok: true, sourceKey: key }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "source-update-failed", message: status < 500 ? error.message : "The authorised source could not be updated." }, status, origin, env);
  }
}
