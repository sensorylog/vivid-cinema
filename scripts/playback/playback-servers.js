const STORAGE_KEY = "vivid:custom-playback-servers:v1";
const MAX_CUSTOM_SERVERS = 10;
const DEFAULT_MOVIE_PATTERN = "{url}/movie/{tmdbId}?autoplay=true";
const DEFAULT_TV_PATTERN = "{url}/tv/{tmdbId}/{season}/{episode}?autoplay=true";
const ALLOWED_TOKENS = new Set(["url", "type", "tmdbId", "imdbId", "slug", "season", "episode"]);

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid server URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Server URLs must use HTTPS and must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Enter the server base URL without query parameters or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href.replace(/\/$/, "");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function applyPattern(pattern, server, params) {
  const values = {
    url: server.url.replace(/\/+$/, ""),
    type: params.type === "tv" ? (server.tvTypeLabel || "tv") : (server.movieTypeLabel || "movie"),
    tmdbId: encodeURIComponent(String(params.tmdbId || "")),
    imdbId: encodeURIComponent(String(params.imdbId || "")),
    slug: encodeURIComponent(slugify(params.title)),
    season: String(Math.max(1, Number(params.season) || 1)),
    episode: String(Math.max(1, Number(params.episode) || 1))
  };
  const expanded = pattern.replace(/\{(\w+)\}/g, (_match, token) => {
    if (!ALLOWED_TOKENS.has(token)) throw new Error("Unsupported server URL placeholder: " + token);
    return values[token];
  });
  let result;
  try {
    result = new URL(expanded);
  } catch {
    throw new Error("The server URL pattern did not produce a valid URL.");
  }
  const base = new URL(server.url);
  if (result.protocol !== "https:" || result.username || result.password || result.origin !== base.origin) {
    throw new Error("The generated playback URL must stay on the configured HTTPS server.");
  }
  return result.href;
}

function normalizeServer(input, { requireId = false } = {}) {
  const name = String(input?.name || "").trim().slice(0, 48);
  if (!name) throw new Error("Give this server a name.");
  const url = normalizeBaseUrl(input?.url);
  const movieUrlPattern = String(input?.movieUrlPattern || DEFAULT_MOVIE_PATTERN).trim();
  const tvUrlPattern = String(input?.tvUrlPattern || DEFAULT_TV_PATTERN).trim();
  for (const pattern of [movieUrlPattern, tvUrlPattern]) {
    const tokens = [...pattern.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    if (!pattern.includes("{url}")) throw new Error("Each URL pattern must include the {url} placeholder.");
    if (tokens.some(token => !ALLOWED_TOKENS.has(token))) throw new Error("Use only supported placeholders: {url}, {type}, {tmdbId}, {imdbId}, {slug}, {season}, {episode}.");
  }
  const id = String(input?.id || "").trim();
  if (requireId && !id) throw new Error("Server ID is missing.");
  const server = {
    id: id || ("custom-" + (slugify(name) || "server")),
    name,
    url,
    movieUrlPattern,
    tvUrlPattern,
    movieTypeLabel: String(input?.movieTypeLabel || "movie").trim().slice(0, 20),
    tvTypeLabel: String(input?.tvTypeLabel || "tv").trim().slice(0, 20)
  };
  // Validate both templates now, not later when a viewer presses Play.
  applyPattern(server.movieUrlPattern, server, { type: "movie", tmdbId: "123", title: "Test Movie" });
  applyPattern(server.tvUrlPattern, server, { type: "tv", tmdbId: "123", season: 1, episode: 1, title: "Test Show" });
  return server;
}

export function listCustomPlaybackServers() {
  return readStorage().slice(0, MAX_CUSTOM_SERVERS).flatMap(raw => {
    try {
      const server = normalizeServer(raw, { requireId: true });
      return server.id.startsWith("custom-") ? [server] : [];
    } catch {
      return [];
    }
  });
}

export function getCustomPlaybackServer(id) {
  return listCustomPlaybackServers().find(server => server.id === id) || null;
}

export function saveCustomPlaybackServer(input) {
  const existing = listCustomPlaybackServers();
  if (existing.length >= MAX_CUSTOM_SERVERS) throw new Error("You can save up to 10 custom servers.");
  const normalized = normalizeServer(input);
  const baseId = "custom-" + (slugify(normalized.name) || "server");
  let id = baseId;
  let suffix = 2;
  while (existing.some(server => server.id === id)) id = baseId + "-" + suffix++;
  const next = [...existing, { ...normalized, id }];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error("Could not save this server in browser storage. Check your device storage settings.");
  }
  return id;
}

export function removeCustomPlaybackServer(id) {
  const next = listCustomPlaybackServers().filter(server => server.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function buildCustomEmbedUrl(server, params) {
  const safe = normalizeServer(server, { requireId: true });
  const pattern = params.type === "tv" ? safe.tvUrlPattern : safe.movieUrlPattern;
  return applyPattern(pattern, safe, params);
}
