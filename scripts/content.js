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

export const CURATED_CATEGORIES = Object.freeze({
  spaceSciFi: { label: "Space sci-fi", description: "Big ideas, distant worlds and stories beyond Earth.", type: "all", params: { with_genres: "878", with_keywords: "9882" }, featured: true },
  action90s: { label: "90s action", description: "Classic action energy from the 1990s.", type: "movie", params: { with_genres: "28", "primary_release_date.gte": "1990-01-01", "primary_release_date.lte": "1999-12-31" }, featured: true },
  africanCinema: { label: "African cinema", description: "Stories from across Africa, including Ghana and Nigeria.", type: "all", params: { with_origin_country: "GH|NG|ZA|KE|SN" }, featured: true },
  oneNight: { label: "One-night movies", description: "Easy-to-finish movies for a single evening.", type: "movie", params: { "with_runtime.gte": "1", "with_runtime.lte": "120" }, featured: true },
  under100: { label: "Under 100 minutes", description: "Great picks when time is limited.", type: "movie", params: { "with_runtime.gte": "1", "with_runtime.lte": "99" }, featured: true },
  feelGood: { label: "Feel-good", description: "Warm, uplifting and easy-to-love stories.", type: "all", params: { with_genres: "35,10751,10749" }, featured: true },
  hiddenGems: { label: "Hidden gems", description: "Strongly rated titles with less mainstream popularity.", type: "all", params: { "vote_average.gte": "7", "vote_count.gte": "100", sort_by: "vote_average.desc" }, featured: true },
  awardWinners: { label: "Award-worthy", description: "Critically acclaimed stories worth discovering.", type: "movie", params: { "vote_average.gte": "7.5", "vote_count.gte": "500", sort_by: "vote_average.desc" }, featured: true },
  sitcom: {
    label: "Sitcom",
    description: "Situation comedies from across the world.",
    type: "tv",
    params: { with_genres: "35" },
    keyword: "sitcom"
  },
  teenRomance: {
    label: "Teen romance",
    description: "Coming-of-age stories, first loves and young romance.",
    type: "all",
    params: { with_genres: "10749" },
    keyword: "teen romance"
  },
  gangsta: {
    label: "Gangsta & crime",
    description: "Gangster, street, organized-crime and crime stories.",
    type: "all",
    params: { with_genres: "80" },
    keyword: "gangster"
  },
  cDrama: {
    label: "C-Dramas",
    description: "Chinese-language series from mainland China.",
    type: "tv",
    params: { with_origin_country: "CN", with_original_language: "zh" }
  },
  bollywood: {
    label: "Bollywood",
    description: "Hindi-language Indian movies and series.",
    type: "all",
    params: { with_origin_country: "IN", with_original_language: "hi" }
  },
  nollywood: {
    label: "Nollywood",
    description: "Movies and series from Nigeria.",
    type: "all",
    params: { with_origin_country: "NG" }
  },
  kumawood: {
    label: "Kumawood",
    description: "Ghanaian titles tagged to the Kumawood tradition when TMDB metadata supports it.",
    type: "all",
    params: { with_origin_country: "GH" },
    keyword: "kumawood"
  },
  ghallywood: {
    label: "Ghallywood",
    description: "Ghanaian titles tagged to the Ghallywood tradition when TMDB metadata supports it.",
    type: "all",
    params: { with_origin_country: "GH" },
    keyword: "ghallywood"
  },
  kDrama: {
    label: "K-Dramas",
    description: "Korean-language series from South Korea.",
    type: "tv",
    params: { with_origin_country: "KR", with_original_language: "ko" }
  },
  anime: {
    label: "Anime",
    description: "Japanese animation and anime from around the world.",
    type: "all",
    params: { with_genres: "16", with_original_language: "ja" }
  },
  turkishDrama: {
    label: "Turkish dramas",
    description: "Series and stories from Türkiye.",
    type: "tv",
    params: { with_origin_country: "TR", with_original_language: "tr" }
  },
  british: {
    label: "British",
    description: "Movies and TV from the United Kingdom.",
    type: "all",
    params: { with_origin_country: "GB" }
  },
  french: {
    label: "French cinema",
    description: "French-language movies and series.",
    type: "all",
    params: { with_original_language: "fr" }
  },
  japanese: {
    label: "Japanese",
    description: "Japanese movies and TV beyond anime.",
    type: "all",
    params: { with_origin_country: "JP", with_original_language: "ja" }
  }
});

const keywordCache = new Map();

function normalizeHome(key, data) {
  return {
    items: normalizeResults(data?.results || [], HOME_SECTION_META[key]?.type || null),
    page: Number(data?.page || 1),
    totalPages: Math.min(500, Number(data?.total_pages || 1))
  };
}

function sortValue(params = {}) {
  return params.sort_by || "popularity.desc";
}

async function resolveKeyword(query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return "";
  if (keywordCache.has(normalized)) return keywordCache.get(normalized);
  try {
    const data = await tmdbApi.searchKeywords(query);
    const results = data.results || [];
    const exact = results.find(item => String(item.name || "").trim().toLowerCase() === normalized);
    const id = String((exact || results[0])?.id || "");
    keywordCache.set(normalized, id);
    return id;
  } catch {
    keywordCache.set(normalized, "");
    return "";
  }
}

function categoryParams(category, type, page, filters = {}, keywordId = "") {
  const base = { ...(category.params || {}) };
  if (keywordId) base.with_keywords = keywordId;
  if (filters.genre) base.with_genres = base.with_genres
    ? base.with_genres + "," + filters.genre
    : filters.genre;
  if (filters.year) {
    if (type === "tv") base.first_air_date_year = filters.year;
    else base.primary_release_year = filters.year;
  }
  if (filters.rating) base["vote_average.gte"] = filters.rating;
  if (filters.region) base.watch_region = filters.region;
  if (filters.provider) {
    base.with_watch_monetization_types = "flatrate";
    base.with_watch_providers = filters.provider;
  }
  base.page = page;
  base.sort_by = type === "tv"
    ? sortValue(filters).replace("primary_release_date", "first_air_date")
    : sortValue(filters);
  return base;
}

export async function getCuratedPage(key, page = 1, filters = {}) {
  const category = CURATED_CATEGORIES[key];
  if (!category) throw new Error("Unknown curated category: " + key);
  const keywordId = category.keyword ? await resolveKeyword(category.keyword) : "";
  const requestedType = filters.type === "movie" || filters.type === "tv" ? filters.type : "";
  const types = requestedType
    ? [requestedType]
    : category.type === "all" ? ["movie", "tv"] : [category.type];
  const results = await Promise.allSettled(types.map(type =>
    type === "movie"
      ? tmdbApi.discoverMovies(categoryParams(category, type, page, filters, keywordId))
      : tmdbApi.discoverTv(categoryParams(category, type, page, filters, keywordId))
  ));
  const successful = results
    .map((result, index) => ({ result, type: types[index] }))
    .filter(({ result }) => result.status === "fulfilled");
  if (!successful.length) throw (results.find(result => result.status === "rejected")?.reason || new Error("Curated discovery unavailable."));
  const items = successful.flatMap(({ result, type }) =>
    normalizeResults(result.value?.results || [], type)
  );
  return {
    items,
    page,
    totalPages: Math.min(500, Math.max(...successful.map(({ result }) => Number(result.value?.total_pages || 1)), 1)),
    partial: successful.length < results.length
  };
}

export async function getFeaturedMovies(limit = 8) {
  const data = await tmdbApi.trending("movie", "week");
  return normalizeResults(data.results || [], "movie").filter((item) => item.backdrop_path).slice(0, limit);
}

async function loadHomeKey(key, page) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await HOME_LOADERS[key](page);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = !status || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function getHomeSections(keys = Object.keys(HOME_LOADERS), page = 1) {
  const selected = keys.filter((key) => HOME_LOADERS[key]);
  const requests = await Promise.allSettled(selected.map((key) => loadHomeKey(key, page)));
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
  return normalizeHome(key, await loadHomeKey(key, page));
}

export async function searchContent(query, page = 1) {
  const q = String(query || "").trim();
  if (!q) return [];
  const data = await tmdbApi.searchMulti(q, page);
  return (data.results || [])
    .filter(item => ["movie", "tv", "person"].includes(item.media_type))
    .map(item => item.media_type === "person"
      ? {
          id: String(item.id),
          media_type: "person",
          content_id: "person:" + item.id,
          title: item.name || "Unknown person",
          year: "",
          overview: "",
          poster_path: item.profile_path || "",
          backdrop_path: "",
          vote_average: 0,
          raw: item
        }
      : normalizeResults([item], item.media_type)[0]
    )
    .filter(Boolean);
}

export async function discoverMovies(params = {}) {
  const data = await tmdbApi.discoverMovies(params);
  return normalizeResults(data.results || [], "movie");
}
