import { VIVID_CONFIG } from "./config.js";

const { tmdbBaseUrl, tmdbApiKey, language } = VIVID_CONFIG.api;
const cache = new Map();
const inFlight = new Map();

function buildUrl(path, params = {}) {
  return tmdbBaseUrl + "/" + path.replace(/^\/+/, "") + "?" +
    new URLSearchParams({ api_key: tmdbApiKey, language, ...params }).toString();
}

export async function tmdb(path, params = {}, options = {}) {
  const url = buildUrl(path, params);
  const useCache = options.cache !== false;
  const timeoutMs = options.timeoutMs ?? 10000;
  if (useCache && cache.has(url)) return cache.get(url);
  if (useCache && inFlight.has(url)) return inFlight.get(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const request = (async () => {
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } });
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
  })();
  if (useCache) inFlight.set(url, request);
  try {
    return await request;
  } finally {
    inFlight.delete(url);
  }
}

export const tmdbApi = Object.freeze({
  popularMovies: (page = 1) => tmdb("movie/popular", { page }),
  topRatedMovies: (page = 1) => tmdb("movie/top_rated", { page }),
  upcomingMovies: (page = 1) => tmdb("movie/upcoming", { page }),
  nowPlayingMovies: (page = 1) => tmdb("movie/now_playing", { page }),
  popularTv: (page = 1) => tmdb("tv/popular", { page }),
  topRatedTv: (page = 1) => tmdb("tv/top_rated", { page }),
  airingTodayTv: (page = 1) => tmdb("tv/airing_today", { page }),
  trending: (mediaType = "all", timeWindow = "week", page = 1) => tmdb("trending/" + mediaType + "/" + timeWindow, { page }),
  searchMovies: (query, page = 1) => tmdb("search/movie", { query, page }),
  searchTv: (query, page = 1) => tmdb("search/tv", { query, page }),
  discoverMovies: (params = {}) => tmdb("discover/movie", params),
  discoverTv: (params = {}) => tmdb("discover/tv", params),
  movieWatchProviders: (region = "") => tmdb("watch/providers/movie", { watch_region: region || undefined }),
  tvWatchProviders: (region = "") => tmdb("watch/providers/tv", { watch_region: region || undefined }),
  movieDetailsBasic: (id) => tmdb("movie/" + encodeURIComponent(id)),
  movieVideos: (id) => tmdb("movie/" + encodeURIComponent(id) + "/videos", { include_video_language: "en-US,null" }),
  movieDetails: (id) => tmdb("movie/" + encodeURIComponent(id), { append_to_response: "credits,videos,similar,watch/providers,recommendations,external_ids" }),
  tvDetailsBasic: (id) => tmdb("tv/" + encodeURIComponent(id)),
  tvVideos: (id) => tmdb("tv/" + encodeURIComponent(id) + "/videos", { include_video_language: "en-US,null" }),
  tvDetails: (id) => tmdb("tv/" + encodeURIComponent(id), { append_to_response: "credits,videos,watch/providers,recommendations" }),
  tvSeason: (id, season) => tmdb("tv/" + encodeURIComponent(id) + "/season/" + encodeURIComponent(season), { append_to_response: "credits,videos" }),
  movieGenres: () => tmdb("genre/movie/list"),
  tvGenres: () => tmdb("genre/tv/list"),
  movieSimilar: (id, page = 1) => tmdb("movie/" + encodeURIComponent(id) + "/similar", { page }),
  tvSimilar: (id, page = 1) => tmdb("tv/" + encodeURIComponent(id) + "/similar", { page }),
  movieRecommendations: (id, page = 1) => tmdb("movie/" + encodeURIComponent(id) + "/recommendations", { page }),
  tvRecommendations: (id, page = 1) => tmdb("tv/" + encodeURIComponent(id) + "/recommendations", { page }),
  personDetails: (id) => tmdb("person/" + encodeURIComponent(id), { append_to_response: "combined_credits,external_ids,images" })
});

export function clearTmdbCache() { cache.clear(); }
