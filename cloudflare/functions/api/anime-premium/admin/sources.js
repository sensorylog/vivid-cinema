import {
  allowedOrigin, AnimePremiumError, enforceRateLimit, getPremiumServices, jsonResponse, optionsResponse,
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
    const allowedTerritories = Array.isArray(body.allowedTerritories)
      ? [...new Set(body.allowedTerritories.map(value => String(value).trim().toUpperCase()))]
      : [];
    const rightsReference = String(body.rightsReference || "").trim();
    const licenseStartsAt = Date.parse(body.licenseStartsAt);
    const licenseEndsAt = Date.parse(body.licenseEndsAt);
    if (!mediaType || !/^\d{1,12}$/.test(titleId) || !/^[A-Za-z0-9:_-]{3,160}$/.test(sourceId) ||
        !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(provider) ||
        (body.candidateId != null && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(String(body.candidateId))) ||
        !allowedTerritories.length || allowedTerritories.length > 100 || allowedTerritories.some(code => !/^[A-Z]{2}$/.test(code)) ||
        !/^[A-Za-z0-9._:-]{3,120}$/.test(rightsReference) ||
        !Number.isFinite(licenseStartsAt) || !Number.isFinite(licenseEndsAt) || licenseEndsAt <= licenseStartsAt ||
        body.rightsVerified !== true) {
      throw new AnimePremiumError(400, "invalid-source-rights", "Enter the provider, verified rights reference, licensed territories and a valid licence window before saving a source.");
    }
    if (mediaType === "tv" && (!Number.isInteger(season) || season < 1 || season > 100 || !Number.isInteger(episode) || episode < 1 || episode > 10000)) {
      throw new AnimePremiumError(400, "invalid-episode", "Enter a valid season and episode.");
    }
    const { db } = getPremiumServices(env);
    await enforceRateLimit(db, user.uid, "admin-sources", 20, 60 * 1000);
    const key = mediaType + "_" + titleId + (mediaType === "tv" ? "_s" + season + "_e" + episode : "");
    const now = Date.now();
    const sourceRef = db.collection("animePremiumSources").doc(key);
    const existingSnapshot = await sourceRef.get();
    const existing = existingSnapshot.exists ? existingSnapshot.data() || {} : {};
    const candidates = Array.isArray(existing.candidates) ? [...existing.candidates] :
      (existing.sourceId && existing.provider ? [{ ...existing, candidateId: String(existing.provider) }] : []);
    const candidateId = String(body.candidateId || provider).trim().slice(0, 80);
    const nextCandidate = {
      candidateId, mediaType, titleId, season, episode, sourceId, provider,
      rightsVerified: true, rightsReference, allowedTerritories,
      licenseStartsAt: timestampFromMillis(licenseStartsAt),
      licenseEndsAt: timestampFromMillis(licenseEndsAt),
      active: body.active !== false,
      priority: Math.max(1, Math.min(100, Number(body.priority) || 50))
    };
    const existingIndex = candidates.findIndex(item => item.candidateId === candidateId);
    if (existingIndex >= 0) candidates[existingIndex] = nextCandidate;
    else candidates.push(nextCandidate);
    if (candidates.length > 8) throw new AnimePremiumError(400, "source-limit-reached", "An episode can have up to eight authorised streaming server candidates.");
    candidates.sort((left, right) => Number(left.priority || 50) - Number(right.priority || 50));
    await sourceRef.set({
      mediaType, titleId, season, episode, candidates,
      active: candidates.some(item => item.active === true),
      updatedBy: user.uid, updatedAt: timestampFromMillis(now)
    }, { merge: true });
    await db.collection("animePremiumAdminAudit").add({
      actorUid: user.uid, action: "source_registry_update", sourceKey: key,
      provider, candidateId, priority: nextCandidate.priority, rightsReference, allowedTerritories,
      licenseStartsAt: timestampFromMillis(licenseStartsAt),
      licenseEndsAt: timestampFromMillis(licenseEndsAt),
      active: body.active !== false, createdAt: timestampFromMillis(now)
    });
    return jsonResponse({ ok: true, sourceKey: key }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "source-update-failed", message: status < 500 ? error.message : "The authorised source could not be updated." }, status, origin, env);
  }
}
