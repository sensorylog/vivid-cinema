const DEFAULT_TIMEOUT_MS = 20_000;
const DIRECT_VIDEO_MIME = /^video\/(?:mp4|webm|quicktime|ogg|x-matroska)$/i;

function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { throw new TypeError("A valid FlixQuest API base URL is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("FlixQuest API must use a clean HTTPS base URL.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api/v2") ? path : path + "/api/v2";
  return url;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function explicitOfflineAsset(link) {
  const item = safeObject(link);
  // Never infer download permission from the ordinary playback "url" field.
  const rawUrl = typeof item.downloadUrl === "string" ? item.downloadUrl :
    typeof item.download_url === "string" ? item.download_url : "";
  const mimeType = typeof item.mimeType === "string" ? item.mimeType :
    typeof item.mime_type === "string" ? item.mime_type : "";
  if (item.offlineDownload !== true && item.offline_download !== true) return null;
  if (!rawUrl || !DIRECT_VIDEO_MIME.test(mimeType)) return null;

  let downloadUrl;
  try { downloadUrl = new URL(rawUrl); } catch { return null; }
  if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password ||
      downloadUrl.hash) return null;
  return { url: downloadUrl.href, mimeType };
}

export function createFlixQuestApi({
  baseUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const root = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    throw new TypeError("timeoutMs must be between 1000 and 120000.");
  }

  async function request(path, query = {}, { signal } = {}) {
    const url = new URL(path.replace(/^\/+/, ""), root.href.endsWith("/") ? root : new URL(root.href + "/"));
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("FlixQuest request timed out.")), timeoutMs);
    try {
      const response = await fetchImpl(url.href, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal
      });
      if (response.redirected || (response.url && new URL(response.url).origin !== root.origin)) {
        throw new Error("FlixQuest API redirected outside its configured origin.");
      }
      let body = {};
      try { body = safeObject(await response.json()); } catch {}
      if (!response.ok || body.success === false) {
        const message = [body.error, body.details, body.message].find(v => typeof v === "string" && v.trim());
        throw new Error(message || "FlixQuest API request failed (HTTP " + response.status + ").");
      }
      return body;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function getProviders(options = {}) {
    const body = await request("providers", {}, options);
    if (!Array.isArray(body.providers)) throw new Error("FlixQuest returned an invalid provider list.");
    return body.providers.filter(p => safeObject(p).enabled === true && typeof p.id === "string")
      .map(p => ({ id: p.id, name: typeof p.name === "string" ? p.name : p.id }));
  }

  async function getProviderStatus(options = {}) {
    return request("providers/status", {}, options);
  }

  async function getStreams({ mediaType, tmdbId, providerId, season, episode, full = false, signal } = {}) {
    if (!["movie", "tv"].includes(mediaType)) throw new TypeError("mediaType must be movie or tv.");
    if (!/^\d{1,12}$/.test(String(tmdbId ?? ""))) throw new TypeError("A valid TMDB ID is required.");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(providerId ?? ""))) throw new TypeError("A valid provider ID is required.");
    const query = { tmdbId, provider: providerId, full: full ? "true" : undefined };
    let path = "stream-movie";
    if (mediaType === "tv") {
      if (!Number.isInteger(Number(season)) || Number(season) < 0 ||
          !Number.isInteger(Number(episode)) || Number(episode) < 0) {
        throw new TypeError("A valid TV season and episode are required.");
      }
      path = "stream-tv";
      query.season = season;
      query.episode = episode;
    }
    const body = await request(path, query, { signal });
    return Array.isArray(body.links) ? body.links.map(safeObject) : [];
  }

  async function getDownloadOptions(requestArgs) {
    const links = await getStreams(requestArgs);
    return links.map((link, index) => {
      const asset = explicitOfflineAsset(link);
      if (!asset) return null;
      return {
        id: String(link.id ?? link.token ?? index),
        quality: typeof link.quality === "string" ? link.quality : "Available quality",
        mimeType: asset.mimeType
      };
    }).filter(Boolean);
  }

  async function resolveDownload(requestArgs, optionId) {
    const links = await getStreams(requestArgs);
    const match = links.find((link, index) =>
      String(link.id ?? link.token ?? index) === String(optionId));
    const asset = match && explicitOfflineAsset(match);
    if (!asset) throw new Error("FlixQuest did not explicitly authorize a direct offline-download asset for this option.");
    return asset;
  }

  return Object.freeze({ getProviders, getProviderStatus, getStreams, getDownloadOptions, resolveDownload });
}
