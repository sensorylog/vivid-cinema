const SESSION_ENDPOINT = "/api/african-stories/session";
const SESSION_LIFETIME_LIMIT_MS = 15 * 60 * 1000;
const ID = /^[a-z0-9][a-z0-9-]{1,79}$/i;

export async function requestAfricanProviderSession(title, source, fetchImpl = fetch) {
  if (!title || !ID.test(title.id || "") || !ID.test(title.editionId || "") ||
      !source || !ID.test(source.sourceId || "") || source.provider !== "partner") {
    throw new TypeError("Invalid African Stories provider-session request.");
  }
  const response = await fetchImpl(SESSION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ titleId: title.id, editionId: title.editionId, sourceId: source.sourceId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    const error = new Error(payload.message || "An authorized African Stories provider session is not available.");
    error.status = response.status;
    throw error;
  }
  const url = new URL(payload.playbackUrl);
  const expiresAt = Date.parse(payload.expiresAt);
  const now = Date.now();
  if (url.protocol !== "https:" || url.username || url.password ||
      !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + SESSION_LIFETIME_LIMIT_MS ||
      !["application/vnd.apple.mpegurl", "application/dash+xml", "video/mp4", "video/webm"].includes(payload.mimeType) ||
      typeof payload.sessionId !== "string" || !payload.sessionId.trim()) {
    throw new Error("The African Stories provider returned an invalid or expired playback session.");
  }
  return {
    url: url.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
    mimeType: payload.mimeType,
    sessionId: payload.sessionId
  };
}
