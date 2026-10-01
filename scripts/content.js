import { tmdbApi } from "./tmdb.js";

export async function getFeaturedMovies(limit = 8) {
  const data = await tmdbApi.trending("movie", "week");
  return (data.results || []).filter((item) => item.backdrop_path).slice(0, limit);
}

export async function getHomeSections() {
  const [trending, popularMovies, topRatedMovies, popularTv, upcoming] =
    await Promise.all([
      tmdbApi.trending("all", "week"),
      tmdbApi.popularMovies(),
      tmdbApi.topRatedMovies(),
      tmdbApi.popularTv(),
      tmdbApi.upcomingMovies()
    ]);

  return {
    trending: trending.results || [],
    popularMovies: popularMovies.results || [],
    topRatedMovies: topRatedMovies.results || [],
    popularTv: popularTv.results || [],
    upcoming: upcoming.results || []
  };
}
