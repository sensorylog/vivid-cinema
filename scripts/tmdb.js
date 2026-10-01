import { VIVID_CONFIG } from "./config.js";

const { tmdbBaseUrl, tmdbApiKey, language } = VIVID_CONFIG.api;
const cache = new Map();

function buildUrl(path, params = {}) {
  return tmdbBaseUrl + "/" + path.replace(/^\/+/, "") + "?" +
    new URLSearchParams({ api_key: tmdbApiKey, language, ...params }).toString();
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
    if (!response.ok) {
      const error = new Error("TMDB request failed: " + response.status);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    if (useCache) cache.set(url, data);
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("TMDB request timed out");
      timeoutError.code = "TMDB_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const tmdbApi = Object.freeze({
  popularMovies: (page = 1) => tmdb("movie/popular", { page }),
  topRatedMovies: (page = 1) => tmdb("movie/top_rated", { page }),
  upcomingMovies: (page = 1) => tmdb("movie/upcoming", { page }),
  popularTv: (page = 1) => tmdb("tv/popular", { page }),
  trending: (mediaType = "all", timeWindow = "week") => tmdb("trending/" + mediaType + "/" + timeWindow),
  searchMovies: (query, page = 1) => tmdb("search/movie", { query, page }),
  searchTv: (query, page = 1) => tmdb("search/tv", { query, page }),
  discoverMovies: (params = {}) => tmdb("discover/movie", params),
  discoverTv: (params = {}) => tmdb("discover/tv", params),
  movieDetails: (id) => tmdb("movie/" + encodeURIComponent(id), { append_to_response: "credits,videos,similar,watch/providers" }),
  tvDetails: (id) => tmdb("tv/" + encodeURIComponent(id), { append_to_response: "credits,videos,similar,watch/providers" }),
  movieGenres: () => tmdb("genre/movie/list"),
  tvGenres: () => tmdb("genre/tv/list"),
  movieSimilar: (id, page = 1) => tmdb("movie/" + encodeURIComponent(id) + "/similar", { page }),
  tvSimilar: (id, page = 1) => tmdb("tv/" + encodeURIComponent(id) + "/similar", { page })
});

export function clearTmdbCache() { cache.clear(); }
