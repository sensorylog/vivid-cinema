import { tmdbApi } from "./tmdb.js";
import { normalizeResults } from "./media.js";

const settledResults = (requests) => requests.map((result) => result.status === "fulfilled" ? result.value : { results: [] });

export async function getFeaturedMovies(limit = 8) {
  const data = await tmdbApi.trending("movie", "week");
  return normalizeResults(data.results || [], "movie").filter((item) => item.backdrop_path).slice(0, limit);
}

export async function getHomeSections() {
  const requests = await Promise.allSettled([
    tmdbApi.trending("all", "week"),
    tmdbApi.nowPlayingMovies(),
    tmdbApi.popularMovies(),
    tmdbApi.topRatedMovies(),
    tmdbApi.upcomingMovies(),
    tmdbApi.popularTv(),
    tmdbApi.topRatedTv(),
    tmdbApi.airingTodayTv(),
    tmdbApi.discoverMovies({ with_genres: 16, sort_by: "popularity.desc" }),
    tmdbApi.discoverTv({ with_original_language: "ko", sort_by: "popularity.desc" })
  ]);
  const [trending, nowPlaying, popularMovies, topRatedMovies, upcoming, popularTv, topRatedTv, airingToday, anime, kdrama] = settledResults(requests);
  return {
    trending: normalizeResults(trending.results || []),
    nowPlaying: normalizeResults(nowPlaying.results || [], "movie"),
    popularMovies: normalizeResults(popularMovies.results || [], "movie"),
    topRatedMovies: normalizeResults(topRatedMovies.results || [], "movie"),
    upcoming: normalizeResults(upcoming.results || [], "movie"),
    popularTv: normalizeResults(popularTv.results || [], "tv"),
    topRatedTv: normalizeResults(topRatedTv.results || [], "tv"),
    airingToday: normalizeResults(airingToday.results || [], "tv"),
    anime: normalizeResults(anime.results || [], "movie"),
    kdrama: normalizeResults(kdrama.results || [], "tv"),
    hasPartialFailure: requests.some((result) => result.status === "rejected")
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
