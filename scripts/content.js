import { tmdbApi } from "./tmdb.js";
import { normalizeResults } from "./media.js";

const HOME_LOADERS = Object.freeze({
  trending: (page) => tmdbApi.trending("all", "week", page),
  nowPlaying: (page) => tmdbApi.nowPlayingMovies(page),
  popularMovies: (page) => tmdbApi.popularMovies(page),
  topRatedMovies: (page) => tmdbApi.topRatedMovies(page),
  popularTv: (page) => tmdbApi.popularTv(page),
  topRatedTv: (page) => tmdbApi.topRatedTv(page),
  airingToday: (page) => tmdbApi.airingTodayTv(page),
  anime: (page) => tmdbApi.discoverMovies({ page, with_genres: 16, sort_by: "popularity.desc" }),
  kdrama: (page) => tmdbApi.discoverTv({ page, with_original_language: "ko", sort_by: "popularity.desc" }),
  upcoming: (page) => tmdbApi.upcomingMovies(page)
});

export const HOME_SECTION_META = Object.freeze({
  trending: { title: "Trending now", description: "What people are discovering this week.", type: "all" },
  nowPlaying: { title: "Now playing", description: "Movies currently in cinemas and in the current release cycle.", type: "movie" },
  popularMovies: { title: "Popular movies", description: "Big-screen stories worth a look.", type: "movie" },
  topRatedMovies: { title: "Top rated", description: "Highly rated across the catalogue.", type: "movie" },
  popularTv: { title: "Popular TV", description: "Series people are watching now.", type: "tv" },
  topRatedTv: { title: "Top rated TV", description: "Highly rated series across the catalogue.", type: "tv" },
  airingToday: { title: "On TV today", description: "Series with episodes airing today.", type: "tv" },
  anime: { title: "Anime", description: "Animated worlds and stories.", type: "movie" },
  kdrama: { title: "K-Dramas", description: "Popular Korean series.", type: "tv" },
  upcoming: { title: "Coming soon", description: "Upcoming movies on the radar.", type: "movie" }
});

function normalizeHome(key, data) {
  return {
    items: normalizeResults(data?.results || [], HOME_SECTION_META[key]?.type || null),
    page: Number(data?.page || 1),
    totalPages: Math.min(500, Number(data?.total_pages || 1))
  };
}

export async function getFeaturedMovies(limit = 8) {
  const data = await tmdbApi.trending("movie", "week");
  return normalizeResults(data.results || [], "movie").filter((item) => item.backdrop_path).slice(0, limit);
}

export async function getHomeSections(keys = Object.keys(HOME_LOADERS), page = 1) {
  const selected = keys.filter((key) => HOME_LOADERS[key]);
  const requests = await Promise.allSettled(selected.map((key) => HOME_LOADERS[key](page)));
  const output = {};
  selected.forEach((key, index) => {
    output[key] = requests[index].status === "fulfilled"
      ? normalizeHome(key, requests[index].value)
      : { items: [], page, totalPages: 1, failed: true };
  });
  output.hasPartialFailure = requests.some((result) => result.status === "rejected");
  return output;
}

export async function getHomeSectionPage(key, page = 1) {
  if (!HOME_LOADERS[key]) throw new Error("Unknown home section: " + key);
  return normalizeHome(key, await HOME_LOADERS[key](page));
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
