import { tmdbApi } from "./tmdb.js";
import { normalizeResults } from "./media.js";

async function providerDiscover(providerId, type, page = 1) {
  const params = { page, watch_region: "US", with_watch_monetization_types: "flatrate", with_watch_providers: String(providerId), sort_by: "popularity.desc", "vote_count.gte": "20" };
  return type === "movie" ? tmdbApi.discoverMovies(params) : tmdbApi.discoverTv(params);
}
async function providerHome(providerId) {
  const results = await Promise.allSettled([providerDiscover(providerId, "movie"), providerDiscover(providerId, "tv")]);
  const items = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...normalizeResults(result.value?.results || [], index === 0 ? "movie" : "tv"));
  });
  items.sort((a,b) => Number(b.raw?.popularity||0)-Number(a.raw?.popularity||0) || Number(b.vote_average||0)-Number(a.vote_average||0));
  return { page: 1, total_pages: 1, results: items.slice(0, 20) };
}
const PROVIDER_IDS = Object.freeze({ netflix: 8, primeVideo: 9, hboMax: 1899, disneyPlus: 337, appleTvPlus: 350, hulu: 15, paramountPlus: 531 });
const HOME_LOADERS = Object.freeze({
  trending: (page) => tmdbApi.trending("all", "week", page),
  top10: async () => {
    const results = await Promise.allSettled([tmdbApi.popularMovies(1), tmdbApi.popularTv(1)]);
    const items = [];
    results.forEach((result,index) => { if(result.status === "fulfilled") items.push(...normalizeResults(result.value?.results || [], index === 0 ? "movie" : "tv")); });
    items.sort((a,b) => Number(b.raw?.popularity || 0) - Number(a.raw?.popularity || 0) || Number(b.vote_average || 0) - Number(a.vote_average || 0));
    return {page:1,total_pages:1,results:items.slice(0,10)};
  },
  nowPlaying: (page) => tmdbApi.nowPlayingMovies(page),
  popularMovies: (page) => tmdbApi.popularMovies(page),
  topRatedMovies: (page) => tmdbApi.topRatedMovies(page),
  popularTv: (page) => tmdbApi.popularTv(page),
  topRatedTv: (page) => tmdbApi.topRatedTv(page),
  airingToday: (page) => tmdbApi.airingTodayTv(page),
  anime: (page) => tmdbApi.discoverMovies({ page, with_genres: 16, sort_by: "popularity.desc" }),
  kdrama: (page) => tmdbApi.discoverTv({ page, with_original_language: "ko", sort_by: "popularity.desc" }),
  netflix: () => providerHome(PROVIDER_IDS.netflix),
  primeVideo: () => providerHome(PROVIDER_IDS.primeVideo),
  hboMax: () => providerHome(PROVIDER_IDS.hboMax),
  disneyPlus: () => providerHome(PROVIDER_IDS.disneyPlus),
  appleTvPlus: () => providerHome(PROVIDER_IDS.appleTvPlus),
  hulu: () => providerHome(PROVIDER_IDS.hulu),
  paramountPlus: () => providerHome(PROVIDER_IDS.paramountPlus),
  newReleases: () => {
    const now = new Date();
    const from = new Date(now); from.setDate(from.getDate() - 45);
    const to = new Date(now); to.setDate(to.getDate() + 14);
    return Promise.allSettled([
      tmdbApi.newMovies(1, from.toISOString().slice(0,10), to.toISOString().slice(0,10)),
      tmdbApi.newTv(1, from.toISOString().slice(0,10), to.toISOString().slice(0,10))
    ]).then(results => {
      const items = [];
      results.forEach((result,index) => {
        if(result.status==="fulfilled") items.push(...normalizeResults(result.value?.results||[], index===0?"movie":"tv"));
      });
      items.sort((a,b)=>Number(b.raw?.popularity||0)-Number(a.raw?.popularity||0));
      return {page:1,total_pages:1,results:items.slice(0,20)};
    });
  },
  upcoming: (page) => {
    const now = new Date();
    const from = now.toISOString().slice(0, 10);
    const future = new Date(now);
    future.setDate(future.getDate() + 120);
    return tmdbApi.futureMovies(page, from, future.toISOString().slice(0, 10));
  }
});

export const HOME_SECTION_META = Object.freeze({
  trending: { title: "Trending now", description: "What people are discovering this week.", type: "all" },
  top10: { title: "Top 10 on Vivid", description: "The ten titles with the strongest current catalogue momentum.", type: "all" },
  nowPlaying: { title: "Now playing", description: "Movies currently in cinemas and in the current release cycle.", type: "movie" },
  popularMovies: { title: "Popular movies", description: "Big-screen stories worth a look.", type: "movie" },
  topRatedMovies: { title: "Top rated", description: "Highly rated across the catalogue.", type: "movie" },
  popularTv: { title: "Popular TV", description: "Series people are watching now.", type: "tv" },
  topRatedTv: { title: "Top rated TV", description: "Highly rated series across the catalogue.", type: "tv" },
  airingToday: { title: "On TV today", description: "Series with episodes airing today.", type: "tv" },
  anime: { title: "Anime", description: "Animated worlds and stories.", type: "movie" },
  kdrama: { title: "K-Dramas", description: "Popular Korean series.", type: "tv" },
  upcoming: { title: "Coming soon", description: "Upcoming movies on the radar.", type: "movie" },
  netflix: { title: "Trending on Netflix", description: "Popular titles currently surfacing on Netflix.", type: "all" },
  primeVideo: { title: "Trending on Prime Video", description: "Popular titles currently surfacing on Prime Video.", type: "all" },
  hboMax: { title: "Trending on HBO Max", description: "Popular titles currently surfacing on HBO Max.", type: "all" },
  disneyPlus: { title: "Trending on Disney+", description: "Popular titles currently surfacing on Disney+.", type: "all" },
  appleTvPlus: { title: "Trending on Apple TV+", description: "Popular titles currently surfacing on Apple TV+.", type: "all" },
  hulu: { title: "Trending on Hulu", description: "Popular titles currently surfacing on Hulu.", type: "all" },
  paramountPlus: { title: "Trending on Paramount+", description: "Popular titles currently surfacing on Paramount+.", type: "all" },
  newReleases: { title: "New releases", description: "Fresh movies and series from the current release window.", type: "all" }
});

export const CURATED_CATEGORIES = Object.freeze({
  spaceSciFi: { label: "Space sci-fi", description: "Big ideas, distant worlds and stories beyond Earth.", type: "all", params: { with_genres: "878", with_keywords: "9882" }, featured: true },
  action90s: { label: "90s action", description: "Classic action energy from the 1990s.", type: "movie", params: { with_genres: "28", "primary_release_date.gte": "1990-01-01", "primary_release_date.lte": "1999-12-31" }, featured: true },
  africanCinema: { label: "African cinema", description: "Stories from across Africa, including Ghana and Nigeria.", type: "all", params: { with_origin_country: "GH|NG|ZA|KE|SN|EG|MA|DZ|TN|ET|TZ|UG" }, featured: true },
  oneNight: { label: "One-night movies", description: "Easy-to-finish movies for a single evening.", type: "movie", params: { "with_runtime.gte": "1", "with_runtime.lte": "120" }, featured: true },
  under100: { label: "Under 100 minutes", description: "Great picks when time is limited.", type: "movie", params: { "with_runtime.gte": "1", "with_runtime.lte": "99" }, featured: true },
  feelGood: { label: "Feel-good", description: "Warm, uplifting and easy-to-love stories.", type: "all", params: { with_genres: "35|10751|10749" }, featured: true },
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
    description: "Coming-of-age stories, first loves, high school and young romance.",
    type: "all",
    // Romance + Drama without a rare single keyword so the list is not tiny.
    params: { with_genres: "10749,18", "vote_count.gte": "40", sort_by: "popularity.desc" }
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


/* Apple TV-style Browse catalogue: editorial categories are the landing surface.
   Search remains a separate destination; these keys route into the existing
   curated discovery engine so the Browse UI stays data-driven. */
export const BROWSE_CATEGORIES = Object.freeze([
  { key:"naturalWonders", label:"Natural Wonders", description:"Oceans, mountains, wild places and the planet at its most spectacular.", group:"Featured", type:"all", params:{ with_genres:"99|12", sort_by:"popularity.desc" } },
  { key:"psychologicalTerror", label:"Psychological Terror", description:"Mind games, paranoia and horror that gets under your skin.", group:"Featured", type:"all", params:{ with_genres:"27|53", sort_by:"popularity.desc" }, keywords:["psychological"] },
  { key:"dramedies", label:"Dramedies", description:"Where sharp comedy meets stories with something real to say.", group:"Featured", type:"all", params:{ with_genres:"35,18", sort_by:"popularity.desc" } },
  { key:"periodDramas", label:"Period Dramas", description:"Sweeping stories shaped by another time.", group:"Featured", type:"all", params:{ with_genres:"18|36", sort_by:"popularity.desc" } },
  { key:"cultComedies", label:"Cult Comedies", description:"Offbeat, endlessly quotable comedies with a devoted following.", group:"Featured", type:"all", params:{ with_genres:"35", sort_by:"popularity.desc" }, keywords:["cult"] },
  { key:"fantasyAdventures", label:"Fantasy Adventures", description:"Epic quests, impossible worlds and journeys beyond the ordinary.", group:"Featured", type:"all", params:{ with_genres:"14,12", sort_by:"popularity.desc" } },
  { key:"darkLaughs", label:"Dark Laughs", description:"Morbid, wicked and seriously funny.", group:"Featured", type:"all", params:{ with_genres:"35", sort_by:"popularity.desc" }, keywords:["dark comedy"] },
  { key:"musicDocs", label:"Music Docs", description:"Artists, performances and the stories behind the sound.", group:"Featured", type:"movie", params:{ with_genres:"99", sort_by:"popularity.desc" }, keywords:["music"] },
  { key:"darkFantasy", label:"Dark Fantasy", description:"Magic, monsters and worlds with a shadow over them.", group:"Featured", type:"all", params:{ with_genres:"14,27", sort_by:"popularity.desc" } },
  { key:"heistsCapers", label:"Heists & Capers", description:"Big scores, clever crews and plans that never go to plan.", group:"Featured", type:"all", params:{ with_genres:"80|35", sort_by:"popularity.desc" }, keywords:["heist"] },
  { key:"legalDramas", label:"Legal Dramas", description:"Courtrooms, cases, verdicts and the people behind them.", group:"Stories", type:"all", params:{ with_genres:"18", sort_by:"popularity.desc" }, keywords:["legal"] },
  { key:"explorersAdventurers", label:"Explorers & Adventurers", description:"Journeys to the edge of the map and beyond.", group:"Stories", type:"all", params:{ with_genres:"12", sort_by:"popularity.desc" } },
  { key:"alienInvaders", label:"Alien Invaders", description:"First contact, hostile worlds and visitors from beyond.", group:"Stories", type:"all", params:{ with_genres:"878", sort_by:"popularity.desc" }, keywords:["alien"] },
  { key:"familyMovieNight", label:"Family Movie Night", description:"Big-hearted picks everyone can watch together.", group:"Stories", type:"all", params:{ with_genres:"10751", sort_by:"popularity.desc" } },
  { key:"actionThrillers", label:"Action Thrillers", description:"High stakes, hard turns and no time to slow down.", group:"Stories", type:"all", params:{ with_genres:"28,53", sort_by:"popularity.desc" } },
  { key:"romComs", label:"Rom-Coms", description:"Chemistry, chaos and falling in love.", group:"Stories", type:"all", params:{ with_genres:"10749,35", sort_by:"popularity.desc" } },
  { key:"crimeDramas", label:"Crime Dramas", description:"Power, loyalty, consequence and the long way down.", group:"Stories", type:"all", params:{ with_genres:"80,18", sort_by:"popularity.desc" } },
  { key:"superheroesVillains", label:"Superheroes & Villains", description:"Heroes, antiheroes and the forces that challenge them.", group:"Stories", type:"all", params:{ with_genres:"28", sort_by:"popularity.desc" }, keywords:["superhero"] },
  { key:"frontierGrit", label:"Frontier Grit", description:"Dust, danger and hard lives on the edge of civilisation.", group:"Stories", type:"all", params:{ with_genres:"37", sort_by:"popularity.desc" } },
  { key:"musicMovies", label:"Music Movies", description:"Stories where music is part of the journey.", group:"Stories", type:"all", params:{ with_genres:"10402", sort_by:"popularity.desc" } },
  { key:"youngLove", label:"Young Love", description:"First loves, coming of age and everything in between.", group:"Stories", type:"all", params:{ with_genres:"10749,18", sort_by:"popularity.desc" } },
  { key:"basedOnABook", label:"Based on a Book", description:"Stories that began on the page.", group:"Stories", type:"all", params:{ sort_by:"popularity.desc" }, keywords:["based on novel"] },
  { key:"spies", label:"Spies", description:"Secrets, double lives and missions in the shadows.", group:"Stories", type:"all", params:{ with_genres:"53|28", sort_by:"popularity.desc" }, keywords:["spy"] },
  { key:"historicalRomance", label:"Historical Romance", description:"Love stories set against another chapter of history.", group:"Stories", type:"all", params:{ with_genres:"10749,36", sort_by:"popularity.desc" } },
  { key:"americana", label:"Americana", description:"Stories rooted in the people, places and myths of America.", group:"Stories", type:"all", params:{ with_origin_country:"US", sort_by:"popularity.desc" } },
  { key:"sportsStories", label:"Sports Stories", description:"Competition, ambition, teamwork and the stories behind the score.", group:"Stories", type:"all", params:{ with_genres:"18|99", sort_by:"popularity.desc" }, keywords:["sports"] },
  { key:"kidsFamily", label:"Kids & Family", description:"Animation, adventure and stories made for all ages.", group:"Genres", type:"all", params:{ with_genres:"10751|16", sort_by:"popularity.desc" } },
  { key:"comedy", label:"Comedy", description:"Find something funny.", group:"Genres", type:"all", params:{ with_genres:"35", sort_by:"popularity.desc" } },
  { key:"drama", label:"Drama", description:"Character-driven stories with something to say.", group:"Genres", type:"all", params:{ with_genres:"18", sort_by:"popularity.desc" } },
  { key:"sciFi", label:"Sci-Fi", description:"Future worlds, strange ideas and impossible technology.", group:"Genres", type:"all", params:{ with_genres:"878", sort_by:"popularity.desc" } },
  { key:"romance", label:"Romance", description:"Stories about love and connection.", group:"Genres", type:"all", params:{ with_genres:"10749", sort_by:"popularity.desc" } },
  { key:"horror", label:"Horror", description:"Something is waiting in the dark.", group:"Genres", type:"all", params:{ with_genres:"27", sort_by:"popularity.desc" } },
  { key:"action", label:"Action", description:"Move fast. Hit hard.", group:"Genres", type:"all", params:{ with_genres:"28", sort_by:"popularity.desc" } },
  { key:"crime", label:"Crime", description:"Underworlds, investigations and dangerous choices.", group:"Genres", type:"all", params:{ with_genres:"80", sort_by:"popularity.desc" } },
  { key:"reality", label:"Reality", description:"Unscripted stories, competition and real lives.", group:"Genres", type:"tv", params:{ with_genres:"10764", sort_by:"popularity.desc" } },
  { key:"animatedHijinks", label:"Animated Hijinks", description:"Animated comedy, chaos and unforgettable characters.", group:"Genres", type:"all", params:{ with_genres:"16,35", sort_by:"popularity.desc" } },
  { key:"sciFiThrillers", label:"Sci-Fi Thrillers", description:"Future-facing stories with the tension turned up.", group:"Genres", type:"all", params:{ with_genres:"878,53", sort_by:"popularity.desc" } },
  { key:"independent", label:"Independent", description:"Distinctive films outside the mainstream.", group:"Genres", type:"movie", params:{ sort_by:"vote_average.desc", "vote_count.gte":"100" }, keywords:["independent film"] },
  { key:"historicalEpics", label:"Historical Epics", description:"Large-scale stories from the pages of history.", group:"Genres", type:"all", params:{ with_genres:"36,18", sort_by:"popularity.desc" } },
  { key:"workplaceComedies", label:"Workplace Comedies", description:"Office politics, colleagues and comedy on the clock.", group:"Genres", type:"tv", params:{ with_genres:"35", sort_by:"popularity.desc" }, keywords:["workplace"] },
  { key:"anime", label:"Anime", description:"Japanese animation and anime worlds.", group:"Vivid", type:"all", params:{ with_genres:"16", with_original_language:"ja", sort_by:"popularity.desc" } },
  { key:"africanCinema", label:"African Cinema", description:"Stories from Ghana, Nigeria and across the continent.", group:"Vivid", type:"all", params:{ with_origin_country:"GH|NG|ZA|KE|SN|EG|MA|DZ|TN|ET|TZ|UG", sort_by:"popularity.desc" } },
  { key:"nollywood", label:"Nollywood", description:"Movies and series from Nigeria.", group:"Vivid", type:"all", params:{ with_origin_country:"NG", sort_by:"popularity.desc" } },
  { key:"kDrama", label:"K-Dramas", description:"Korean-language series and stories.", group:"Vivid", type:"tv", params:{ with_origin_country:"KR", with_original_language:"ko", sort_by:"popularity.desc" } },
  { key:"bollywood", label:"Bollywood", description:"Hindi-language Indian movies and series.", group:"Vivid", type:"all", params:{ with_origin_country:"IN", with_original_language:"hi", sort_by:"popularity.desc" } },
  { key:"cDrama", label:"C-Dramas", description:"Chinese-language series and stories.", group:"Vivid", type:"tv", params:{ with_origin_country:"CN", with_original_language:"zh", sort_by:"popularity.desc" } },
  { key:"turkishDrama", label:"Turkish Dramas", description:"Series and stories from Türkiye.", group:"Vivid", type:"tv", params:{ with_origin_country:"TR", with_original_language:"tr", sort_by:"popularity.desc" } },
  { key:"british", label:"British", description:"Movies and TV from the United Kingdom.", group:"Vivid", type:"all", params:{ with_origin_country:"GB", sort_by:"popularity.desc" } },
  { key:"french", label:"French Cinema", description:"French-language movies and series.", group:"Vivid", type:"all", params:{ with_original_language:"fr", sort_by:"popularity.desc" } },
  { key:"japanese", label:"Japanese", description:"Japanese movies and TV beyond anime.", group:"Vivid", type:"all", params:{ with_origin_country:"JP", with_original_language:"ja", sort_by:"popularity.desc" } },
  { key:"hiddenGems", label:"Hidden Gems", description:"Strongly rated titles that deserve a bigger audience.", group:"Vivid", type:"all", params:{ "vote_average.gte":"7", "vote_count.gte":"100", sort_by:"vote_average.desc" } },
  { key:"awardWinners", label:"Award-Worthy", description:"Critically acclaimed stories worth discovering.", group:"Vivid", type:"movie", params:{ "vote_average.gte":"7.5", "vote_count.gte":"500", sort_by:"vote_average.desc" } },
  { key:"oneNight", label:"One-Night Movies", description:"Easy-to-finish movies for a single evening.", group:"Vivid", type:"movie", params:{ "with_runtime.gte":"1", "with_runtime.lte":"120", sort_by:"popularity.desc" } },
  { key:"under100", label:"Under 100 Minutes", description:"Great picks when time is limited.", group:"Vivid", type:"movie", params:{ "with_runtime.gte":"1", "with_runtime.lte":"99", sort_by:"popularity.desc" } }
]);

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
    const id = String(exact?.id || "");
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
  const category = CURATED_CATEGORIES[key] || BROWSE_CATEGORIES.find((item) => item.key === key);
  if (!category) throw new Error("Unknown curated category: " + key);
  let keywordId = "";
  if (Array.isArray(category.keywords) && category.keywords.length) {
    const ids = await Promise.all(category.keywords.map((q) => resolveKeyword(q)));
    keywordId = ids.filter(Boolean).join("|"); // TMDB OR
  } else if (category.keyword) {
    keywordId = await resolveKeyword(category.keyword);
  }
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

export async function getAnimePage(page = 1, filters = {}) {
  const type = filters.type === "movie" || filters.type === "tv" ? filters.type : "";
  const params = { page, with_genres: "16", with_original_language: "ja", sort_by: filters.sort_by || "popularity.desc" };
  if (filters.year) {
    if (type === "tv") params.first_air_date_year = filters.year;
    if (type === "movie") params.primary_release_year = filters.year;
  }
  if (filters.rating) params["vote_average.gte"] = filters.rating;
  const requests = type === "movie"
    ? [tmdbApi.discoverMovies(params).then(data => ({ data, type: "movie" }))]
    : type === "tv"
      ? [tmdbApi.discoverTv(params).then(data => ({ data, type: "tv" }))]
      : [
          tmdbApi.discoverTv(params).then(data => ({ data, type: "tv" })),
          tmdbApi.discoverMovies(params).then(data => ({ data, type: "movie" }))
        ];
  const results = await Promise.allSettled(requests);
  const successful = results.filter(result => result.status === "fulfilled").map(result => result.value);
  if (!successful.length) throw (results.find(result => result.status === "rejected")?.reason || new Error("Anime catalogue unavailable."));
  const items = successful.flatMap(({ data, type: mediaType }) => normalizeResults(data?.results || [], mediaType))
    .sort((a,b) => Number(b.raw?.popularity || 0) - Number(a.raw?.popularity || 0) || Number(b.vote_average || 0) - Number(a.vote_average || 0));
  return { items, page, totalPages: Math.min(500, Math.max(...successful.map(({data}) => Number(data?.total_pages || 1)), 1)), partial: successful.length < requests.length };
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
