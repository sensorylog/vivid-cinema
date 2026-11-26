import {
  allowedOrigin, AnimePremiumError, enforceRateLimit, getPremiumServices,
  jsonResponse, optionsResponse, requirePremiumUser, timestampFromMillis
} from "../../lib/anime-premium-service.js";

function iso(value) {
  const millis = typeof value?.toMillis === "function" ? value.toMillis() : Number(value || 0);
  return millis > 0 ? new Date(millis).toISOString() : null;
}
function safeProfile(data = {}) {
  return {
    favorites: (Array.isArray(data.favorites) ? data.favorites : []).slice(0, 100).map(item => ({
      titleId: String(item.titleId || ""),
      mediaType: item.mediaType === "movie" ? "movie" : "tv",
      title: String(item.title || ""),
      posterPath: String(item.posterPath || ""),
      releaseYear: String(item.releaseYear || ""),
      genres: Array.isArray(item.genres) ? item.genres.slice(0, 8).map(String) : [],
      savedAt: iso(item.savedAt)
    })),
    continueWatching: (Array.isArray(data.continueWatching) ? data.continueWatching : []).slice(0, 30).map(item => ({
      titleId: String(item.titleId || ""),
      mediaType: item.mediaType === "movie" ? "movie" : "tv",
      season: Number(item.season || 0),
      episode: Number(item.episode || 0),
      progressSeconds: Number(item.progressSeconds || 0),
      durationSeconds: Number(item.durationSeconds || 0),
      progressPercent: Number(item.progressPercent || 0),
      updatedAt: iso(item.updatedAt)
    }))
  };
}
export function onRequestOptions({ request, env }) {
  return optionsResponse(request.headers.get("Origin") || "", env);
}
export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  try {
    const user = await requirePremiumUser(request, env);
    const { db } = getPremiumServices(env);
    await enforceRateLimit(db, user.uid, "profile", 60, 60000);
    const ref = db.collection("animePremiumProfiles").doc(user.uid);
    if (request.method === "GET") {
      const snapshot = await ref.get();
      return jsonResponse({ ok: true, profile: safeProfile(snapshot.exists ? snapshot.data() : {}) }, 200, origin, env);
    }
    if (request.method !== "POST") return jsonResponse({ ok: false, code: "method-not-allowed" }, 405, origin, env);
    const raw = await request.text();
    if (raw.length > 8000) throw new AnimePremiumError(400, "invalid-request", "This profile request is too large.");
    let body;
    try { body = JSON.parse(raw); } catch { throw new AnimePremiumError(400, "invalid-request", "A valid profile request is required."); }
    const action = String(body.action || "");
    const mediaType = body.mediaType === "movie" ? "movie" : body.mediaType === "tv" ? "tv" : "";
    const titleId = String(body.titleId || "");
    if (!["favorite", "unfavorite"].includes(action) || !mediaType || !/^\d{1,12}$/.test(titleId)) {
      throw new AnimePremiumError(400, "invalid-favorite", "Choose a valid anime title.");
    }
    const now = Date.now();
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const favorites = Array.isArray(data.favorites) ? [...data.favorites] : [];
      const index = favorites.findIndex(item => String(item.titleId) === titleId && item.mediaType === mediaType);
      if (action === "unfavorite") {
        if (index >= 0) favorites.splice(index, 1);
      } else {
        const title = String(body.title || "").trim().slice(0, 140);
        const posterPath = String(body.posterPath || "");
        if (!title || (posterPath && !/^\/[A-Za-z0-9/_\-.]{1,180}$/.test(posterPath))) {
          throw new AnimePremiumError(400, "invalid-favorite", "The title information is invalid.");
        }
        const genres = Array.isArray(body.genres) ? body.genres.slice(0, 8).map(value => String(value).trim().slice(0, 40)).filter(Boolean) : [];
        const item = {
          titleId, mediaType, title, posterPath,
          releaseYear: String(body.releaseYear || "").slice(0, 4),
          genres,
          savedAt: timestampFromMillis(now)
        };
        if (index >= 0) favorites.splice(index, 1);
        favorites.unshift(item);
        favorites.splice(100);
      }
      transaction.set(ref, { favorites, updatedAt: timestampFromMillis(now) }, { merge: true });
    });
    const updated = await ref.get();
    return jsonResponse({ ok: true, profile: safeProfile(updated.data() || {}) }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "profile-failed", message: status < 500 ? error.message : "Your Premium profile is temporarily unavailable." }, status, origin, env);
  }
}
