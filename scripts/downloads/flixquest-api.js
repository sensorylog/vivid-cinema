const DEFAULT_TIMEOUT_MS = 20000;
function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new TypeError("Enter your FlixQuest API instance URL first."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new TypeError("FlixQuest API must use a clean HTTPS base URL.");
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api/v2") ? path : path + "/api/v2";
  return url;
}
const safeObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
function safeStreamUrl(value) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" && !url.username && !url.password && !url.hash ? url : null; } catch { return null; }
}
function linkFormat(link) {
  if (link.isM3U8 === true) return "hls";
  if (link.isDASH === true) return "dash";
  return "file";
}
export function createFlixQuestApi({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const root = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new TypeError("timeoutMs must be between 1000 and 120000.");
  async function request(path, query = {}, { signal, method = "GET", body } = {}) {
    const url = new URL(path.replace(/^\/+/, ""), root.href.endsWith("/") ? root : new URL(root.href + "/"));
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("FlixQuest request timed out.")), timeoutMs);
    try {
      const response = await fetchImpl(url.href, { method, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal });
      if (response.redirected || (response.url && new URL(response.url).origin !== root.origin)) throw new Error("FlixQuest API redirected outside its configured origin.");
      let data = {}; try { data = safeObject(await response.json()); } catch {}
      if (!response.ok || data.success === false) {
        const message = [data.error, data.details, data.message].find(value => typeof value === "string" && value.trim());
        throw new Error(message || "FlixQuest API request failed (HTTP " + response.status + ").");
      }
      return data;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async function getProviders(options = {}) {
    const data = await request("providers", {}, options);
    if (!Array.isArray(data.providers)) throw new Error("FlixQuest returned an invalid provider list.");
    return data.providers.filter(item => safeObject(item).enabled !== false && typeof item.id === "string")
      .map(item => ({ id: item.id, name: typeof item.name === "string" ? item.name : item.id }));
  }
  async function getProviderStatus(options = {}) { return request("providers/status", {}, options); }
  async function getStreams({ mediaType, tmdbId, providerId, season, episode, full = true, signal } = {}) {
    if (!["movie", "tv"].includes(mediaType)) throw new TypeError("mediaType must be movie or tv.");
    if (!/^\d{1,12}$/.test(String(tmdbId ?? ""))) throw new TypeError("A valid TMDB ID is required.");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(providerId ?? ""))) throw new TypeError("A valid provider ID is required.");
    const query = { tmdbId, provider: providerId, full: full ? "true" : undefined };
    let path = "stream-movie";
    if (mediaType === "tv") {
      if (!Number.isInteger(Number(season)) || Number(season) < 0 || !Number.isInteger(Number(episode)) || Number(episode) < 0) throw new TypeError("A valid TV season and episode are required.");
      path = "stream-tv"; query.season = season; query.episode = episode;
    }
    const data = await request(path, query, { signal });
    return Array.isArray(data.links) ? data.links.map(safeObject) : [];
  }
  async function getDownloadOptions(media) {
    const providers = await getProviders();
    if (!providers.length) throw new Error("FlixQuest has no enabled stream providers.");
    const results = await Promise.allSettled(providers.map(async provider => {
      const links = await getStreams({ mediaType: media.media_type, tmdbId: media.id, providerId: provider.id, season: media.season, episode: media.episode, full: true });
      return links.map((link, index) => {
        const url = safeStreamUrl(link.url), format = linkFormat(link);
        if (!url || !["hls", "dash", "file"].includes(format)) return null;
        const quality = typeof link.quality === "string" && link.quality.trim() ? link.quality : "Auto";
        const server = typeof link.server === "string" && link.server.trim() ? link.server : provider.name;
        return { id: provider.id + "::" + index, providerId: provider.id, linkIndex: index, label: quality + " · " + server,
          quality, server, format, sizeToken: typeof link.sizeToken === "string" ? link.sizeToken : "" };
      }).filter(Boolean);
    }));
    const options = results.flatMap(result => result.status === "fulfilled" ? result.value : []);
    if (!options.length) throw new Error("No supported downloadable HLS, DASH or direct video streams were returned.");
    return options;
  }
  async function resolveDownload(media, selectedId) {
    const id = String(selectedId || ""), split = id.lastIndexOf("::");
    if (split < 1) throw new Error("The selected FlixQuest stream is invalid.");
    const providerId = id.slice(0, split), index = Number(id.slice(split + 2));
    if (!Number.isInteger(index) || index < 0) throw new Error("The selected FlixQuest stream is invalid.");
    const links = await getStreams({ mediaType: media.media_type, tmdbId: media.id, providerId, season: media.season, episode: media.episode, full: true });
    const link = links[index], url = safeStreamUrl(link?.url), format = link && linkFormat(link);
    if (!link || !url || !["hls", "dash", "file"].includes(format)) throw new Error("The selected media source could not be re-resolved. Search again and retry.");
    const headers = {};
    for (const [name, value] of Object.entries(safeObject(link.headers))) {
      if (/^accept$/i.test(name) && typeof value === "string" && value.length < 2048) headers[name] = value;
    }
    return { url: url.href, type: format, mimeType: format === "hls" ? "application/vnd.apple.mpegurl" : format === "dash" ? "application/dash+xml" : "video/mp4",
      headers, allowedHosts: [...new Set([root.hostname, url.hostname])], providerId, server: link.server || providerId, quality: link.quality || "Auto" };
  }
  async function getStreamSize(token) {
    if (typeof token !== "string" || !token) throw new TypeError("A FlixQuest stream-size token is required.");
    return request("stream-size", {}, { method: "POST", body: { token } });
  }
  return Object.freeze({ baseUrl: root.origin, getProviders, getProviderStatus, getStreams, getDownloadOptions, resolveDownload, getStreamSize });
}
