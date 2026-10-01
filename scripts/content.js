import { tmdbApi } from "./tmdb.js";
import { normalizeResults } from "./media.js";

export async function getFeaturedMovies(limit = 8) {
  const data = await tmdbApi.trending("movie", "week");
  return normalizeResults(data.results || [], "movie").filter((item) => item.backdrop_path).slice(0, limit);
}

export async function getHomeSections() {
  const [trending, popularMovies, topRatedMovies, popularTv, upcoming] = await Promise.all([
    tmdbApi.trending("all", "week"), tmdbApi.popularMovies(), tmdbApi.topRatedMovies(),
    tmdbApi.popularTv(), tmdbApi.upcomingMovies()
  ]);
  return {
    trending: normalizeResults(trending.results || []),
    popularMovies: normalizeResults(popularMovies.results || [], "movie"),
    topRatedMovies: normalizeResults(topRatedMovies.results || [], "movie"),
    popularTv: normalizeResults(popularTv.results || [], "tv"),
    upcoming: normalizeResults(upcoming.results || [], "movie")
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
