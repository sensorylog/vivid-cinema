import { tmdbApi } from "./tmdb.js";
import { normalizeResults } from "./media.js";

export async function getFeaturedMovies(limit = 8) {
  const data = await tmdbApi.trending("movie", "week");
  return normalizeResults(data.results || [], "movie").filter((item) => item.backdrop_path).slice(0, limit);
}

export async function getHomeSections() {
  const requests = await Promise.allSettled([
    tmdbApi.trending("all", "week"),
    tmdbApi.popularMovies(),
    tmdbApi.topRatedMovies(),
    tmdbApi.popularTv(),
    tmdbApi.upcomingMovies()
  ]);
  const value = (index) => requests[index].status === "fulfilled" ? requests[index].value : { results: [] };
  return {
    trending: normalizeResults(value(0).results || []),
    popularMovies: normalizeResults(value(1).results || [], "movie"),
    topRatedMovies: normalizeResults(value(2).results || [], "movie"),
    popularTv: normalizeResults(value(3).results || [], "tv"),
    upcoming: normalizeResults(value(4).results || [], "movie"),
    failed: requests.some((result) => result.status === "rejected")
  };
}

export async function searchContent(query, page = 1) {
  const q = String(query || "").trim();
  if (!q) return [];
  const [movies, shows] = await Promise.all([tmdbApi.searchMovies(q, page), tmdbApi.searchTv(q, page)]);
  return [...normalizeResults(movies.results || [], "movie"), ...normalizeResults(shows.results || [], "tv")];
}

export async function discoverMovies(params = {}) {
  const data = await tmdbApi.discoverMovies(params);
  return normalizeResults(data.results || [], "movie");
}
