const ID = /^[a-z0-9][a-z0-9-]{1,79}$/i;
const MAX_BODY_BYTES = 4096;

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}

export async function onRequest({ request, env }) {
  if (request.method === "GET") {
    return json(200, {
      ok: true,
      service: "african-stories-session",
      providerRegistryConfigured: Boolean(env.AFRICAN_STORIES_PROVIDER && typeof env.AFRICAN_STORIES_PROVIDER.fetch === "function")
    });
  }
  if (request.method !== "POST") return json(405, { ok: false, code: "method-not-allowed", message: "Use POST to request a playback session." });
  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (origin !== new URL(request.url).origin) return json(403, { ok: false, code: "cross-origin", message: "Cross-origin playback-session requests are not allowed." });
    } catch {
      return json(400, { ok: false, code: "invalid-origin", message: "The request origin is invalid." });
    }
  }
  if (!env.AFRICAN_STORIES_PROVIDER || typeof env.AFRICAN_STORIES_PROVIDER.fetch !== "function") {
    return json(503, { ok: false, code: "provider-registry-empty", message: "No authorized African Stories provider-session adapter is configured. Playback remains unavailable until a provider contract and title grant are verified." });
  }
  let raw;
  try { raw = await request.text(); } catch { return json(400, { ok: false, code: "invalid-body", message: "A valid playback-session request is required." }); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { ok: false, code: "body-too-large", message: "The playback-session request is too large." });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { ok: false, code: "invalid-json", message: "A valid playback-session request is required." }); }
  if (!ID.test(body?.titleId || "") || !ID.test(body?.editionId || "") || !ID.test(body?.sourceId || "")) {
    return json(400, { ok: false, code: "invalid-identity", message: "A published title, edition and source identity are required." });
  }
  try {
    // The provider service is the trust boundary: it must re-check title-level
    // rights, territory, time window, provider registration and user/session
    // policy before minting a short-lived URL. The browser never supplies URLs.
    const upstream = await env.AFRICAN_STORIES_PROVIDER.fetch("https://african-stories-provider.internal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        titleId: body.titleId,
        editionId: body.editionId,
        sourceId: body.sourceId,
        requestOrigin: new URL(request.url).origin
      })
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || payload.ok !== true) {
      return json(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        ok: false,
        code: payload.code || "provider-unavailable",
        message: "The authorized provider could not issue a playback session."
      });
    }
    return json(200, {
      ok: true,
      playbackUrl: payload.playbackUrl,
      expiresAt: payload.expiresAt,
      mimeType: payload.mimeType,
      sessionId: payload.sessionId
    });
  } catch (error) {
    console.error("African Stories provider session failed:", error?.message || error);
    return json(502, { ok: false, code: "provider-error", message: "The authorized provider session could not be created." });
  }
}
