/**
 * First-party MediaForge API client for Vivid Cinema.
 *
 * The API base URL is intentionally unset until a public, authenticated backend
 * is deployed. No MediaForge API key or upstream source credential belongs in
 * browser code. Stream and download URLs must remain on the configured backend
 * origin; the backend should proxy/serve authorized media from persistent storage.
 */

const MEDIA_TYPES = new Set(["movie", "tv", "anime"]);
const DOWNLOAD_STATES = new Set(["queued", "resolving", "downloading", "processing", "ready", "failed", "cancelled"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("MediaForge backend is not configured yet.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MediaForge backend URL is invalid.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("MediaForge backend must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("MediaForge backend URL must not contain credentials, query, or fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url;
}

function sameOriginUrl(value, baseUrl, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Backend returned an invalid " + label + " URL.");
  }
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new Error("Backend returned an invalid " + label + " URL.");
  }
  if (url.origin !== baseUrl.origin || url.username || url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Backend " + label + " URL must use the configured backend origin.");
  }
  return url.href;
}

function validateMediaRequest(media, episode) {
  const mediaId = String(media?.id ?? "").trim();
  const mediaType = String(media?.type ?? "").trim().toLowerCase();
  if (!ID_PATTERN.test(mediaId)) throw new Error("A valid media ID is required.");
  if (!MEDIA_TYPES.has(mediaType)) throw new Error("Media type must be movie, tv, or anime.");
  const payload = { mediaId, mediaType };
  if (mediaType === "tv" || mediaType === "anime") {
    const season = Number(episode?.season);
    const episodeNumber = Number(episode?.episode);
    if (!Number.isSafeInteger(season) || season < 1 || season > 999 ||
        !Number.isSafeInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > 9999) {
      throw new Error("TV and anime playback require a valid season and episode.");
    }
    payload.season = season;
    payload.episode = episodeNumber;
  }
  return payload;
}

async function readJson(response) {
  if (!response || !response.ok) {
    const status = Number(response?.status || 0);
    throw new Error(status === 401 || status === 403
      ? "Sign in again to use streaming and downloads."
      : status === 404
        ? "That stream or download was not found."
        : status === 429
          ? "Too many requests. Please wait and try again."
          : "Media service is temporarily unavailable.");
  }
  const type = response.headers?.get?.("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new Error("Media service returned an unexpected response.");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Media service returned invalid data.");
  }
}

export function createMediaForgeClient({ baseUrl, getIdToken, fetchImpl } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const requestFetch = fetchImpl || globalThis.fetch;
  if (typeof requestFetch !== "function") throw new Error("Fetch is unavailable.");
  if (typeof getIdToken !== "function") throw new Error("A signed-in user token provider is required.");

  async function request(path, { method = "GET", body } = {}) {
    const token = await getIdToken();
    if (typeof token !== "string" || !token.trim()) {
      throw new Error("Sign in to use streaming and downloads.");
    }
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
      throw new Error("Invalid MediaForge API route.");
    }
    let response;
    try {
      response = await requestFetch(url.href, {
        method,
        redirect: "error",
        headers: {
          "Accept": "application/json",
          "Authorization": "Bearer " + token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch {
      throw new Error("Could not reach the MediaForge service.");
    }
    return readJson(response);
  }

  return Object.freeze({
    async resolveStream(media, episode) {
      const payload = validateMediaRequest(media, episode);
      const data = await request("api/v1/stream/resolve", { method: "POST", body: payload });
      const stream = data?.stream;
      const type = String(stream?.type || "").toLowerCase();
      if (!stream || !["hls", "dash", "file"].includes(type)) {
        throw new Error("Media service did not return a supported stream.");
      }
      const url = sameOriginUrl(stream.url, base, "stream");
      return {
        url,
        type,
        expiresAt: typeof stream.expiresAt === "string" ? stream.expiresAt : null,
        audioTracks: Array.isArray(stream.audioTracks) ? stream.audioTracks : [],
        subtitleTracks: Array.isArray(stream.subtitleTracks) ? stream.subtitleTracks : []
      };
    },

    async startDownload(media, episode) {
      const payload = validateMediaRequest(media, episode);
      const data = await request("api/v1/downloads", { method: "POST", body: payload });
      const jobId = String(data?.jobId || "");
      if (!ID_PATTERN.test(jobId)) throw new Error("Media service returned an invalid download job.");
      return { jobId, status: DOWNLOAD_STATES.has(data.status) ? data.status : "queued" };
    },

    async getDownload(jobId) {
      const id = String(jobId || "");
      if (!ID_PATTERN.test(id)) throw new Error("A valid download job ID is required.");
      const data = await request("api/v1/downloads/" + encodeURIComponent(id));
      const status = String(data?.status || "").toLowerCase();
      if (!DOWNLOAD_STATES.has(status)) throw new Error("Media service returned an invalid download status.");
      const progress = Number(data?.progress);
      const result = {
        jobId: id,
        status,
        progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
        filename: typeof data?.filename === "string" ? data.filename.slice(0, 240) : ""
      };
      if (status === "ready" && data.downloadUrl) {
        result.downloadUrl = sameOriginUrl(data.downloadUrl, base, "download");
      }
      if (status === "failed" && typeof data.message === "string") {
        result.message = data.message.slice(0, 240);
      }
      return result;
    }
  });
}
