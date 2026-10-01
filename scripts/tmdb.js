import { VIVID_CONFIG } from "./config.js";

const { tmdbBaseUrl, tmdbApiKey, language } = VIVID_CONFIG.api;
const cache = new Map();

function buildUrl(path, params = {}) {
  const query = new URLSearchParams({
    api_key: tmdbApiKey,
    language,
    ...params
  });
  return tmdbBaseUrl + "/" + path.replace(/^\/+/, "") + "?" + query.toString();
}

export async function tmdb(path, params = {}, options = {}) {
  const url = buildUrl(path, params);
  const useCache = options.cache !== false;
  const timeoutMs = options.timeoutMs ?? 10000;

  if (useCache && cache.has(url)) return cache.get(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("TMDB request failed: " + response.status);
    const data = await response.json();
    if (useCache) cache.set(url, data);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export const tmdbApi = Object.freeze({
  popularMovies: (page = 1) => tmdb("movie/popular", { page }),
  topRatedMovies: (page = 1) => tmdb("movie/top_rated", { page }),
  upcomingMovies: (page = 1) => tmdb("movie/upcoming", { page }),
  popularTv: (page = 1) => tmdb("tv/popular", { page }),
  trending: (mediaType = "all", timeWindow = "week") =>
    tmdb("trending/" + mediaType + "/" + timeWindow),
  searchMovies: (query, page = 1) => tmdb("search/movie", { query, page }),
  searchTv: (query, page = 1) => tmdb("search/tv", { query, page }),
  movieDetails: (id) =>
    tmdb("movie/" + id, { append_to_response: "credits,videos,similar,watch/providers" }),
  tvDetails: (id) =>
    tmdb("tv/" + id, { append_to_response: "credits,videos,similar,watch/providers" })
});

export function clearTmdbCache() {
  cache.clear();
}
