import { tmdbApi } from "./tmdb.js";
import { CURATED_CATEGORIES, getCuratedPage } from "./content.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./media.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { getRoute } from "./routes.js";
import { rankSearchResults } from "./search.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
const state = {
  type: route.params.get("type") === "tv" ? "tv" : route.params.get("type") === "movie" ? "movie" : "all",
  genre: route.params.get("genre") || "",
  year: route.params.get("year") || "",
  sort: route.params.get("sort") || "popularity.desc",
  rating: route.params.get("rating") || "",
  region: route.params.get("region") || "",
  provider: route.params.get("provider") || "",
  mood: route.params.get("mood") || "",
  runtime: route.params.get("runtime") || "",
  category: route.params.get("category") || "",
  query: route.params.get("q") || "",
  page: Number(route.params.get("page") || 1) || 1,
  totalPages: 1,
  requestId: 0
};
if (!CURATED_CATEGORIES[state.category]) state.category = "";
let genres = { movie: [], tv: [] };
let providers = { movie: [], tv: [] };

const MOODS = Object.freeze({
  relax: { label: "Relax", genres: [35, 10751], sort: "vote_average.desc" },
  intense: { label: "Intense", genres: [28, 53, 80], sort: "popularity.desc" },
  funny: { label: "Funny", genres: [35], sort: "vote_average.desc" },
  romantic: { label: "Romantic", genres: [10749, 18], sort: "vote_average.desc" },
  thoughtful: { label: "Thought-provoking", genres: [18, 9648, 99], sort: "vote_average.desc" },
  escapist: { label: "Escapist", genres: [12, 14, 878], sort: "popularity.desc" },
  scary: { label: "Scary", genres: [27, 53], sort: "popularity.desc" },
  emotional: { label: "Emotional", genres: [18, 10749], sort: "vote_average.desc" },
  fast: { label: "Fast-paced", genres: [28, 53], sort: "popularity.desc" },
  late: { label: "Late-night", genres: [27, 9648, 53], sort: "vote_average.desc" }
});
const RUNTIMES = Object.freeze({
  short: { label: "Under 90 min", min: 0, max: 90 },
  standard: { label: "90–120 min", min: 90, max: 120 },
  long: { label: "2+ hours", min: 120, max: 300 },
  episode: { label: "One episode", min: 0, max: 70 },
  shortseries: { label: "Short series", min: 1, max: 8 },
  binge: { label: "Long binge", min: 9, max: 60 }
});

const FEATURED_PROVIDER_IDS = [8, 119, 337, 1899, 350, 15, 531, 386, 283, 11];
const FEATURED_PROVIDER_NAMES = new Map([
  [8, "Netflix"], [119, "Prime Video"], [337, "Disney+"], [1899, "Max"],
  [350, "Apple TV+"], [15, "Hulu"], [531, "Paramount+"], [386, "Peacock"],
  [283, "Crunchyroll"], [11, "MUBI"]
]);

function currentGenres() {
  if (state.type === "tv") return genres.tv;
  if (state.type === "movie") return genres.movie;
  return [...genres.movie, ...genres.tv].filter((genre, index, list) =>
    list.findIndex((item) => item.id === genre.id) === index
  ).sort((a, b) => a.name.localeCompare(b.name));
}

function populateGenres() {
  const select = $("genre-filter");
  const available = currentGenres();
  const selected = state.genre;
  select.innerHTML = '<option value="">All genres</option>' +
    available.map((genre) => '<option value="' + genre.id + '">' + escapeHtml(genre.name) + "</option>").join("");
  select.value = selected && available.some((genre) => String(genre.id) === String(selected)) ? selected : "";
  if (select.value !== selected) state.genre = "";
}

function populateYears() {
  const select = $("year-filter");
  const current = new Date().getFullYear();
  select.innerHTML = '<option value="">Any year</option>' +
    Array.from({ length: 76 }, (_, i) => current - i)
      .map((year) => '<option value="' + year + '">' + year + "</option>").join("");
  select.value = state.year;
}

function sortItems(items) {
  const dateValue = (item) => Date.parse(item.date || "") || 0;
  const ratingValue = (item) => Number(item.vote_average || 0);
  if (state.sort === "vote_average.desc") return items.sort((a, b) => ratingValue(b) - ratingValue(a));
  if (state.sort === "primary_release_date.asc") return items.sort((a, b) => dateValue(a) - dateValue(b));
  if (state.sort === "primary_release_date.desc") return items.sort((a, b) => dateValue(b) - dateValue(a));
  return items;
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.category) params.set("category", state.category);
  if (state.type !== "all") params.set("type", state.type);
  if (state.genre) params.set("genre", state.genre);
  if (state.year) params.set("year", state.year);
  if (state.sort !== "popularity.desc") params.set("sort", state.sort);
  if (state.rating) params.set("rating", state.rating);
  if (state.region) params.set("region", state.region);
  if (state.provider) params.set("provider", state.provider);
  if (state.mood) params.set("mood", state.mood);
  if (state.runtime) params.set("runtime", state.runtime);
  if (state.query) params.set("q", state.query);
  if (state.page > 1) params.set("page", String(state.page));
  history.replaceState(null, "", params.toString() ? "discover.html?" + params : "discover.html");
}

function providerPool() {
  const source = state.type === "tv" ? providers.tv : state.type === "movie" ? providers.movie : [...providers.movie, ...providers.tv];
  const unique = source.filter((provider, index, list) =>
    list.findIndex((item) => item.provider_id === provider.provider_id) === index
  );
  return FEATURED_PROVIDER_IDS
    .map((id) => unique.find((provider) => Number(provider.provider_id) === id))
    .filter(Boolean)
    .map((provider) => ({ ...provider, provider_name: FEATURED_PROVIDER_NAMES.get(Number(provider.provider_id)) || provider.provider_name }));
}

function populateProviders() {
  const strip = $("provider-filter");
  const available = providerPool();
  const selected = String(state.provider || "");
  strip.innerHTML = '<button class="vivid-provider-chip' + (!selected ? ' is-active' : '') + '" data-provider="" type="button"><span class="vivid-provider-all-icon"><i class="bi bi-grid-3x3-gap" aria-hidden="true"></i></span><span>All services</span></button>' +
    available.map((provider) => {
      const id = String(provider.provider_id);
      const logo = provider.logo_path ? getImageUrl(provider.logo_path, "w92") : "icons/vivid-icon.svg";
      return '<button class="vivid-provider-chip' + (id === selected ? ' is-active' : '') + '" data-provider="' + escapeHtml(id) + '" type="button" aria-pressed="' + (id === selected) + '" title="' + escapeHtml(provider.provider_name) + '">' +
        '<span class="vivid-provider-logo"><img loading="lazy" decoding="async" src="' + escapeHtml(logo) + '" alt="" aria-hidden="true"></span>' +
        '<span class="vivid-provider-name">' + escapeHtml(provider.provider_name) + '</span></button>';
    }).join("");
  if (selected && !available.some((provider) => String(provider.provider_id) === selected)) state.provider = "";
}

async function loadProviders() {
  try {
    const region = state.region || "";
    const [movie, tv] = await Promise.all([tmdbApi.movieWatchProviders(region), tmdbApi.tvWatchProviders(region)]);
    providers = { movie: movie.results || [], tv: tv.results || [] };
    populateProviders();
  } catch {
    $("provider-filter").innerHTML = '<button class="vivid-provider-chip is-active" data-provider="" type="button"><span class="vivid-provider-all-icon"><i class="bi bi-grid-3x3-gap" aria-hidden="true"></i></span><span>Services unavailable</span></button>';
  }
}

function renderLoading() {
  $("discovery-empty").hidden = true;
  $("discovery-grid").innerHTML = Array.from({ length: 12 }, () => '<div class="vivid-discovery-skeleton"></div>').join("");
}

function renderResults(items, totalPages) {
  state.totalPages = Math.max(1, Math.min(500, Number(totalPages) || 1));
  $("discovery-empty").hidden = items.length !== 0;
  $("results-count").textContent = state.totalPages > 1 ? "Page " + state.page + " of " + state.totalPages : items.length + " titles";
  $("page-label").textContent = "Page " + state.page;
  $("prev-page").disabled = state.page <= 1;
  $("next-page").disabled = state.page >= state.totalPages;
  if (!items.length) {
    $("discovery-grid").innerHTML = "";
    return;
  }
  $("discovery-grid").innerHTML = items.map((item) => {
    const meta = [item.year, item.media_type === "tv" ? "TV" : "Movie"].filter(Boolean).join(" · ");
    return '<a class="vivid-discovery-card" href="' + escapeHtml(getMediaUrl(item)) + '">' +
      '<div class="vivid-discovery-poster"><img loading="lazy" decoding="async" src="' + getImageUrl(item.poster_path, "w500") +
      '" alt="' + escapeHtml(item.title) + ' poster" onerror="this.style.visibility=\'hidden\'">' +
      '<span class="vivid-discovery-rating">★ ' + (item.vote_average ? item.vote_average.toFixed(1) : "—") +
      '</span></div><div class="vivid-discovery-copy"><strong>' + escapeHtml(item.title) +
      '</strong><small>' + escapeHtml(meta) + "</small></div></a>";
  }).join("");
}

async function loadGenres() {
  try {
    const [movie, tv] = await Promise.all([tmdbApi.movieGenres(), tmdbApi.tvGenres()]);
    genres = { movie: movie.genres || [], tv: tv.genres || [] };
    populateGenres();
  } catch {
    $("genre-filter").innerHTML = '<option value="">Genres unavailable</option>';
  }
}

function discoverParams(type) {
  const sort = type === "tv"
    ? state.sort.replace("primary_release_date", "first_air_date")
    : state.sort;
  const mood = MOODS[state.mood];
  const runtime = RUNTIMES[state.runtime];
  const moodGenres = mood?.genres?.length ? mood.genres.join(",") : undefined;
  const baseGenres = state.genre || moodGenres;
  const params = {
    page: state.page,
    sort_by: sort,
    with_genres: baseGenres,
    ...(type === "movie"
      ? { primary_release_year: state.year || undefined }
      : { first_air_date_year: state.year || undefined }),
    "vote_average.gte": state.rating || undefined,
    ...(type === "movie" && runtime ? { with_runtime_gte: runtime.min, with_runtime_lte: runtime.max } : {}),
    watch_region: state.region || undefined,
    with_watch_monetization_types: state.provider ? "flatrate" : undefined,
    with_watch_providers: state.provider || undefined
  };
}

async function fetchDiscovery() {
  const requestId = ++state.requestId;
  syncUrl();
  renderLoading();
  const query = state.query.trim();
  $("results-label").textContent = query ? "SEARCH" : state.category ? "COLLECTION" : "DISCOVER";
  const selectedProvider = [...(providers.movie || []), ...(providers.tv || [])].find((provider) => String(provider.provider_id) === String(state.provider));
  const selectedCategory = CURATED_CATEGORIES[state.category];
  $("results-title").textContent = query
    ? 'Results for “' + escapeHtml(query) + '”'
    : selectedCategory ? selectedCategory.label
    : selectedProvider ? selectedProvider.provider_name
    : state.type === "all" ? "All titles" : state.type === "tv" ? "TV series" : "Movies";

  try {
    let items = [];
    let totalPages = 1;

    if (query) {
      const requests = state.type === "movie"
        ? [tmdbApi.searchMovies(query, state.page)]
        : state.type === "tv"
          ? [tmdbApi.searchTv(query, state.page)]
          : [tmdbApi.searchMovies(query, state.page), tmdbApi.searchTv(query, state.page)];
      const results = await Promise.all(requests);
      const normalized = results.flatMap((data, index) =>
        normalizeResults(data.results || [], state.type === "all" ? (index === 0 ? "movie" : "tv") : state.type)
      );
      items = normalized
        .filter((item) => !state.genre || item.raw.genre_ids?.includes(Number(state.genre)))
        .filter((item) => !state.year || item.year === String(state.year))
        .filter((item) => !state.rating || Number(item.vote_average || 0) >= Number(state.rating));
      totalPages = Math.max(...results.map((data) => Number(data.total_pages || 1)));
      items = await rankSearchResults(items, query, { limit: items.length || 20 });
      if (!items.length) items = sortItems(normalized);
    } else if (state.category) {
      const data = await getCuratedPage(state.category, state.page, {
        genre: state.genre,
        year: state.year,
        sort: state.sort,
        rating: state.rating,
        region: state.region,
        provider: state.provider,
        type: state.type
      });
      items = sortItems(data.items || []);
      totalPages = Number(data.totalPages || 1);
    } else if (state.type === "all") {
      const [movies, tv] = await Promise.all([
        tmdbApi.discoverMovies(discoverParams("movie")),
        tmdbApi.discoverTv(discoverParams("tv"))
      ]);
      items = sortItems([
        ...normalizeResults(movies.results || [], "movie"),
        ...normalizeResults(tv.results || [], "tv")
      ]);
      totalPages = Math.max(Number(movies.total_pages || 1), Number(tv.total_pages || 1));
    } else {
      const data = await (state.type === "movie"
        ? tmdbApi.discoverMovies(discoverParams("movie"))
        : tmdbApi.discoverTv(discoverParams("tv")));
      items = normalizeResults(data.results || [], state.type);
      totalPages = Number(data.total_pages || 1);
    }

    if (requestId !== state.requestId) return;
    renderResults(items, totalPages);
  } catch (error) {
    if (requestId !== state.requestId) return;
    $("discovery-grid").innerHTML = '<div class="vivid-discovery-error"><i class="bi bi-exclamation-circle"></i><h2>Discovery is unavailable</h2><p>' +
      escapeHtml(getErrorMessage(error)) + '</p><button id="retry-discovery" type="button">Try again</button></div>';
    $("discovery-empty").hidden = true;
    $("results-count").textContent = "";
    $("prev-page").disabled = true;
    $("next-page").disabled = true;
    $("retry-discovery").addEventListener("click", fetchDiscovery);
  }
}

async function updateFromControls() {
  const previousRegion = state.region;
  state.genre = $("genre-filter").value;
  state.year = $("year-filter").value;
  state.sort = $("sort-filter").value;
  state.rating = $("rating-filter").value;
  state.region = $("region-filter").value;
  state.page = 1;
  if (state.region !== previousRegion) await loadProviders();
  if (state.provider && !state.region) {
    state.region = "GH";
    $("region-filter").value = "GH";
    await loadProviders();
  }
  fetchDiscovery();
}

function syncControlsFromUrl() {
  const categorySelect = $("category-filter");
  if (categorySelect) categorySelect.value = state.category;
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.type === state.type)
  );
  $("year-filter").value = state.year;
  $("sort-filter").value = state.sort;
  $("rating-filter").value = state.rating;
  $("region-filter").value = state.region;
  populateProviders();
}

function setType(type) {
  state.type = type;
  state.genre = "";
  state.page = 1;
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.type === type)
  );
  populateGenres();
  populateProviders();
  fetchDiscovery();
}

function resetFilters() {
  state.type = "all";
  state.genre = "";
  state.year = "";
  state.sort = "popularity.desc";
  state.rating = "";
  state.region = "";
  state.provider = "";
  state.category = "";
  state.query = "";
  state.page = 1;
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.type === "all")
  );
  $("discovery-search").value = "";
  $("clear-search").hidden = true;
  $("genre-filter").value = "";
  $("year-filter").value = "";
  $("sort-filter").value = state.sort;
  $("rating-filter").value = "";
  $("region-filter").value = "";
  state.provider = "";
  if ($("category-filter")) $("category-filter").value = "";
  populateGenres();
  fetchDiscovery();
}

function wire() {
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.addEventListener("click", () => setType(button.dataset.type))
  );
  $("category-filter")?.addEventListener("change", () => {
    state.category = $("category-filter").value;
    state.page = 1;
    const category = CURATED_CATEGORIES[state.category];
    if (category) {
      state.type = category.type;
      document.querySelectorAll("[data-type]").forEach((button) =>
        button.classList.toggle("is-active", button.dataset.type === state.type)
      );
      state.genre = "";
      if ($("genre-filter")) $("genre-filter").value = "";
      populateGenres();
    }
    fetchDiscovery();
  });
  ["genre-filter", "year-filter", "sort-filter", "rating-filter", "region-filter"]
    .forEach((id) => $(id).addEventListener("change", updateFromControls));
  $("provider-filter").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-provider]");
    if (!button) return;
    state.provider = button.dataset.provider || "";
    state.page = 1;
    if (state.provider && !state.region) {
      state.region = "GH";
      $("region-filter").value = "GH";
      await loadProviders();
    } else {
      populateProviders();
    }
    fetchDiscovery();
  });
  $("reset-filters").addEventListener("click", resetFilters);

  $("prev-page").addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page--;
    fetchDiscovery();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("next-page").addEventListener("click", () => {
    if (state.page >= state.totalPages) return;
    state.page++;
    fetchDiscovery();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  let searchTimer;
  $("discovery-search").addEventListener("input", () => {
    state.query = $("discovery-search").value;
    $("clear-search").hidden = !state.query;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.page = 1;
      fetchDiscovery();
    }, 350);
  });
  $("clear-search").addEventListener("click", () => {
    state.query = "";
    $("discovery-search").value = "";
    $("clear-search").hidden = true;
    state.page = 1;
    fetchDiscovery();
    $("discovery-search").focus();
  });
}

async function init() {
  populateYears();
  if ($("category-filter")) {
    $("category-filter").innerHTML = '<option value="">All catalogue</option>' +
      Object.entries(CURATED_CATEGORIES).map(([key, category]) =>
        '<option value="' + escapeHtml(key) + '">' + escapeHtml(category.label) + '</option>'
      ).join("");
    $("category-filter").value = state.category;
    const category = CURATED_CATEGORIES[state.category];
    if (category) state.type = category.type;
  }
  wire();
  syncControlsFromUrl();
  $("discovery-search").value = state.query;
  $("clear-search").hidden = !state.query;
  await Promise.allSettled([loadGenres(), loadProviders()]);
  syncControlsFromUrl();
  await fetchDiscovery();
}

void init();
