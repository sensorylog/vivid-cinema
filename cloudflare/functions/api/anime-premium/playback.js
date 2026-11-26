import {
  allowedOrigin, AnimePremiumError, enforceRateLimit, getPremiumServices, jsonResponse, optionsResponse,
  requirePremiumUser, timestampFromMillis
} from "../../lib/anime-premium-service.js";

function allowedStreamHosts(env) {
  return new Set(String(env.ANIME_PREMIUM_STREAM_HOSTS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
}
function timestampMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value === "string") return Date.parse(value);
  return Number(value || 0);
}
function providerResolver(env, providerId) {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(providerId)) {
    throw new AnimePremiumError(404, "authorised-source-not-found", "No authorised playback source is available for this episode.");
  }
  const configured = String(env.ANIME_PREMIUM_PROVIDER_RESOLVERS_JSON || "").trim();
  let settings;
  if (configured) {
    let providers;
    try { providers = JSON.parse(configured); }
    catch { throw new AnimePremiumError(503, "playback-provider-not-configured", "The authorised playback providers are not configured correctly."); }
    settings = providers?.[providerId];
  } else {
    settings = {
      resolverUrl: env.ANIME_PREMIUM_STREAM_RESOLVER_URL,
      resolverToken: env.ANIME_PREMIUM_STREAM_RESOLVER_TOKEN,
      allowedHosts: [...allowedStreamHosts(env)]
    };
  }
  const resolverUrl = String(settings?.resolverUrl || "").trim();
  const resolverToken = String(settings?.resolverToken || "").trim();
  const hosts = new Set((Array.isArray(settings?.allowedHosts) ? settings.allowedHosts : [])
    .map(value => String(value).trim().toLowerCase()).filter(Boolean));
  if (!resolverUrl || !resolverToken || !hosts.size) {
    throw new AnimePremiumError(503, "playback-provider-not-configured", "This authorised playback provider is not configured yet.");
  }
  let url;
  try { url = new URL(resolverUrl); }
  catch { throw new AnimePremiumError(503, "playback-provider-not-configured", "The authorised playback resolver URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new AnimePremiumError(503, "playback-provider-not-configured", "The authorised playback resolver URL is invalid.");
  }
  return { url, token: resolverToken, hosts };
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
    const excludedRaw = body.excludeCandidateIds;
    if (excludedRaw !== undefined && (!Array.isArray(excludedRaw) || excludedRaw.length > 8 ||
        excludedRaw.some(value => typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(value)))) {
      throw new AnimePremiumError(400, "invalid-server-fallback", "The server fallback request is invalid.");
    }
    const excludedCandidates = new Set(excludedRaw || []);
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
    const source = sourceSnapshot.data() || {};
    // One episode can have several independently rights-cleared server candidates.
    // Legacy single-source documents remain readable during migration.
    const candidates = (Array.isArray(source.candidates) ? source.candidates.slice(0, 8) :
      [{ ...source, candidateId: String(source.provider || "legacy") }])
      .sort((left, right) => Number(left.priority || 50) - Number(right.priority || 50));
    const territory = String(request.cf?.country || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(territory)) {
      throw new AnimePremiumError(451, "territory-or-rights-unavailable", "Vivid could not verify the playback territory for this request.");
    }
    let rightsEligible = false;
    let selected = null;
    for (const candidate of candidates) {
      if (!candidate || excludedCandidates.has(String(candidate.candidateId || candidate.provider || "legacy")) ||
          candidate.active !== true || !candidate.sourceId || typeof candidate.provider !== "string") continue;
      const licenseStartsAt = timestampMillis(candidate.licenseStartsAt);
      const licenseEndsAt = timestampMillis(candidate.licenseEndsAt);
      if (candidate.rightsVerified !== true || !Array.isArray(candidate.allowedTerritories) ||
          !candidate.allowedTerritories.includes(territory) || !Number.isFinite(licenseStartsAt) ||
          !Number.isFinite(licenseEndsAt) || licenseStartsAt > Date.now() || licenseEndsAt <= Date.now()) continue;
      rightsEligible = true;
      try {
        const provider = providerResolver(env, candidate.provider);
        const resolverResponse = await fetch(provider.url.toString(), {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(12000),
          headers: { Authorization: "Bearer " + provider.token, "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceId: candidate.sourceId,
            provider: candidate.provider,
            mediaType,
            titleId,
            season,
            episode,
            userId: user.uid
          })
        });
        const resolved = await resolverResponse.json().catch(() => ({}));
        if (!resolverResponse.ok || typeof resolved.url !== "string" || !resolved.url || !resolved.expiresAt) {
          throw new Error("Provider did not return a playable session.");
        }
        let url;
        try { url = new URL(resolved.url); } catch { throw new Error("Provider returned an invalid stream URL."); }
        const expiresAt = Date.parse(resolved.expiresAt);
        const mimeType = String(resolved.mimeType || "");
        if (url.protocol !== "https:" || !provider.hosts.has(url.hostname.toLowerCase()) || url.username || url.password ||
            !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 60 * 60 * 1000 ||
            !["video/mp4", "application/vnd.apple.mpegurl", "application/x-mpegURL"].includes(mimeType)) {
          throw new Error("Provider returned a stream outside its approved playback policy.");
        }
        selected = { candidate, url, expiresAt, mimeType };
        break;
      } catch (error) {
        // Keep trying the next rights-cleared candidate; never relax its host or territory checks.
      }
    }
    if (!selected) {
      if (!rightsEligible) throw new AnimePremiumError(451, "territory-or-rights-unavailable", "This episode is not licensed for playback in your region or outside its authorised release window.");
      throw new AnimePremiumError(502, "playback-source-unavailable", "No authorised streaming server could open this episode. Vivid checked the enabled licensed sources and none was ready.");
    }
    const sessionId = crypto.randomUUID();
    await db.collection("animePremiumPlaybackSessions").doc(sessionId).set({
      uid: user.uid, mediaType, titleId, season, episode, sourceKey,
      provider: selected.candidate.provider,
      candidateId: selected.candidate.candidateId || selected.candidate.provider,
      expiresAt: timestampFromMillis(selected.expiresAt), createdAt: timestampFromMillis(Date.now())
    });
    return jsonResponse({
      ok: true,
      playback: {
        sessionId,
        url: selected.url.toString(),
        expiresAt: new Date(selected.expiresAt).toISOString(),
        mimeType: selected.mimeType,
        provider: String(selected.candidate.label || selected.candidate.provider || "Vivid authorised source"),
        candidateId: String(selected.candidate.candidateId || selected.candidate.provider || "legacy")
      }
    }, 200, origin, env);
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    return jsonResponse({ ok: false, code: error.code || "playback-failed", message: status < 500 ? error.message : "Protected playback is temporarily unavailable." }, status, origin, env);
  }
}
