import { tmdbApi } from "./tmdb.js";
import { CURATED_CATEGORIES, getCuratedPage } from "./content.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./media.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { getRoute } from "./routes.js";
import { rankSearchResults } from "./search.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();

const state = {
  type: ["all", "movie", "tv"].includes(route.params.get("type")) ? route.params.get("type") : "all",
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
  page: Math.max(1, Number(route.params.get("page") || 1) || 1),
  totalPages: 1,
  requestId: 0
};

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
  short: { label: "Under 90 min", min: 1, max: 89, kind: "movie" },
  standard: { label: "90–120 min", min: 90, max: 120, kind: "movie" },
  long: { label: "Over 120 min", min: 121, max: 360, kind: "movie" },
  quickEpisode: { label: "Episodes under 30 min", min: 1, max: 29, kind: "tv" },
  episode: { label: "Episodes 30–60 min", min: 30, max: 60, kind: "tv" },
  longEpisode: { label: "Episodes over 60 min", min: 61, max: 180, kind: "tv" }
});

const FEATURED_PROVIDER_IDS = [8, 119, 337, 1899, 350, 15, 531, 386, 283, 11];
const FEATURED_PROVIDER_NAMES = new Map([
  [8, "Netflix"], [119, "Prime Video"], [337, "Disney+"], [1899, "Max"],
  [350, "Apple TV+"], [15, "Hulu"], [531, "Paramount+"], [386, "Peacock"],
  [283, "Crunchyroll"], [11, "MUBI"]
]);

if (!CURATED_CATEGORIES[state.category]) state.category = "";
if (state.mood && !MOODS[state.mood]) state.mood = "";
if (state.runtime && !RUNTIMES[state.runtime]) state.runtime = "";

function currentGenres() {
  if (state.type === "tv") return genres.tv;
  if (state.type === "movie") return genres.movie;
  return [...genres.movie, ...genres.tv]
    .filter((genre, index, list) => list.findIndex((item) => item.id === genre.id) === index)
    .sort((a, b) => a.name.localeCompare(b.name));
}

let genres = { movie: [], tv: [] };
let providers = { movie: [], tv: [] };

function renderFeaturedCollections() {
  const container = $("featured-collections");
  if (!container) return;
  const entries = Object.entries(CURATED_CATEGORIES).filter(([, category]) => category.featured).slice(0, 8);
  container.innerHTML = entries.map(([key, category]) =>
    '<button class="vivid-collection-card" type="button" data-collection="' + escapeHtml(key) + '">' +
    '<span class="vivid-collection-card-kicker">VIVID</span><strong>' + escapeHtml(category.label) +
    '</strong><small>' + escapeHtml(category.description) +
    '</small><span class="vivid-collection-card-arrow"><i class="bi bi-arrow-up-right"></i></span></button>'
  ).join("");
  container.querySelectorAll("[data-collection]").forEach((button) => button.addEventListener("click", () => {
    selectCategory(button.dataset.collection || "");
    document.querySelector(".vivid-discovery-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function populateGenres() {
  const select = $("genre-filter");
  const available = currentGenres();
  select.innerHTML = '<option value="">All genres</option>' +
    available.map((genre) => '<option value="' + genre.id + '">' + escapeHtml(genre.name) + "</option>").join("");
  select.value = selectedValue(state.genre, available.map((g) => g.id));
  state.genre = select.value;
}

function populateYears() {
  const select = $("year-filter");
  const current = new Date().getFullYear();
  select.innerHTML = '<option value="">Any year</option>' +
    Array.from({ length: 76 }, (_, i) => current - i)
      .map((year) => '<option value="' + year + '">' + year + "</option>").join("");
  select.value = state.year;
}

function selectedValue(value, allowed) {
  return value && allowed.some((item) => String(item) === String(value)) ? String(value) : "";
}

function syncUrl() {
  const params = new URLSearchParams();
  const fields = ["category", "type", "genre", "year", "rating", "region", "provider", "mood", "runtime", "q"];
  fields.forEach((key) => {
    const value = state[key];
    if (!value || (key === "type" && value === "all")) return;
    params.set(key, String(value));
  });
  if (state.sort !== "popularity.desc") params.set("sort", state.sort);
  if (state.page > 1) params.set("page", String(state.page));
  history.replaceState(null, "", "discover.html" + (params.toString() ? "?" + params : ""));
}

function providerPool() {
  const source = state.type === "tv" ? providers.tv : state.type === "movie" ? providers.movie : [...providers.movie, ...providers.tv];
  const unique = source.filter((provider, index, list) =>
    list.findIndex((item) => item.provider_id === provider.provider_id) === index
  );
  return FEATURED_PROVIDER_IDS
    .map((id) => unique.find((provider) => Number(provider.provider_id) === id))
    .filter(Boolean)
    .map((provider) => ({
      ...provider,
      provider_name: FEATURED_PROVIDER_NAMES.get(Number(provider.provider_id)) || provider.provider_name
    }));
}

function populateProviders() {
  const strip = $("provider-filter");
  if (!strip) return;
  const available = providerPool();
  if (state.provider && !available.some((provider) => String(provider.provider_id) === String(state.provider))) {
    state.provider = "";
  }
  const selected = String(state.provider || "");
  strip.innerHTML =
    '<button class="vivid-provider-chip' + (!selected ? " is-active" : "") +
    '" data-provider="" type="button"><span class="vivid-provider-all-icon"><i class="bi bi-grid-3x3-gap"></i></span><span>All services</span></button>' +
    available.map((provider) => {
      const id = String(provider.provider_id);
      const logo = provider.logo_path ? getImageUrl(provider.logo_path, "w92") : "icons/vivid-icon.svg";
      return '<button class="vivid-provider-chip' + (id === selected ? " is-active" : "") +
        '" data-provider="' + escapeHtml(id) + '" type="button" aria-pressed="' + (id === selected) +
        '" title="' + escapeHtml(provider.provider_name) + '">' +
        '<span class="vivid-provider-logo"><img loading="lazy" decoding="async" src="' + escapeHtml(logo) +
        '" alt="" aria-hidden="true"></span><span class="vivid-provider-name">' +
        escapeHtml(provider.provider_name) + "</span></button>";
    }).join("");
}

async function loadProviders() {
  try {
    const region = state.region || "";
    const [movie, tv] = await Promise.all([
      tmdbApi.movieWatchProviders(region),
      tmdbApi.tvWatchProviders(region)
    ]);
    providers = { movie: movie.results || [], tv: tv.results || [] };
    populateProviders();
  } catch {
    $("provider-filter").innerHTML =
      '<button class="vivid-provider-chip is-active" data-provider="" type="button">' +
      '<span class="vivid-provider-all-icon"><i class="bi bi-grid-3x3-gap"></i></span><span>Services unavailable</span></button>';
  }
}

function renderLoading() {
  $("discovery-empty").hidden = true;
  $("discovery-grid").innerHTML = Array.from({ length: 12 }, () => '<div class="vivid-discovery-skeleton"></div>').join("");
}

function renderResults(items, totalPages) {
  state.totalPages = Math.max(1, Math.min(500, Number(totalPages) || 1));
  $("discovery-empty").hidden = items.length !== 0;
  $("results-count").textContent = state.totalPages > 1
    ? "Page " + state.page + " of " + state.totalPages
    : items.length + " titles";
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
      '<div class="vivid-discovery-poster"><img loading="lazy" decoding="async" src="' +
      getImageUrl(item.poster_path, "w500") + '" alt="' + escapeHtml(item.title) +
      ' poster" onerror="this.style.visibility=\'hidden\'">' +
      '<span class="vivid-discovery-rating">★ ' + (item.vote_average ? item.vote_average.toFixed(1) : "—") +
      "</span></div><div class="vivid-discovery-copy"><strong>" + escapeHtml(item.title) +
      "</strong><small>" + escapeHtml(meta) + "</small></div></a>";
  }).join("");
}

function sortItems(items) {
  const dateValue = (item) => Date.parse(item.date || "") || 0;
  const ratingValue = (item) => Number(item.vote_average || 0);
  const popularityValue = (item) => Number(item.raw?.popularity || 0);
  if (state.sort === "vote_average.desc") return items.sort((a, b) => ratingValue(b) - ratingValue(a));
  if (state.sort === "primary_release_date.asc") return items.sort((a, b) => dateValue(a) - dateValue(b));
  if (state.sort === "primary_release_date.desc") return items.sort((a, b) => dateValue(b) - dateValue(a));
  return items.sort((a, b) => popularityValue(b) - popularityValue(a));
}

function discoverParams(type) {
  const mood = MOODS[state.mood];
  const runtime = RUNTIMES[state.runtime];
  const sort = type === "tv"
    ? state.sort.replace("primary_release_date", "first_air_date")
    : state.sort;

  const params = {
    page: state.page,
    sort_by: sort,
    include_adult: false,
    with_genres: state.genre || (mood?.genres?.length ? mood.genres.join("|") : undefined),
    ...(type === "movie"
      ? { primary_release_year: state.year || undefined }
      : { first_air_date_year: state.year || undefined }),
    "vote_average.gte": state.rating || undefined,
    "vote_count.gte": state.rating ? (Number(state.rating) >= 9 ? 250 : Number(state.rating) >= 8 ? 100 : 25) : undefined,
    ...(runtime && runtime.kind === type
      ? { "with_runtime.gte": runtime.min, "with_runtime.lte": runtime.max }
      : {}),
    watch_region: state.region || undefined,
    with_watch_monetization_types: state.provider ? "flatrate" : undefined,
    with_watch_providers: state.provider || undefined
  };
  return params;
}

function filtersForCategory() {
  const runtime = RUNTIMES[state.runtime];
  const mood = MOODS[state.mood];
  return {
    genre: state.genre,
    year: state.year,
    sort: state.sort,
    rating: state.rating,
    region: state.region,
    provider: state.provider,
    moodGenres: mood?.genres || [],
    runtime: runtime && (state.type === "all" || runtime.kind === state.type) ? runtime : null
  };
}

async function fetchDiscovery() {
  const requestId = ++state.requestId;
  syncUrl();
  renderLoading();

  const query = state.query.trim();
  const selectedProvider = [...providers.movie, ...providers.tv]
    .find((provider) => String(provider.provider_id) === String(state.provider));
  const selectedCategory = CURATED_CATEGORIES[state.category];

  $("results-label").textContent = query ? "SEARCH" : state.category ? "COLLECTION" : "DISCOVER";
  $("results-title").textContent = query
    ? 'Results for “' + escapeHtml(query) + '”'
    : selectedCategory ? selectedCategory.label
    : selectedProvider ? selectedProvider.provider_name
    : state.mood ? MOODS[state.mood].label
    : state.runtime ? RUNTIMES[state.runtime].label
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
      let normalized = results.flatMap((data, index) =>
        normalizeResults(data.results || [], state.type === "all" ? (index === 0 ? "movie" : "tv") : state.type)
      );
      normalized = normalized
        .filter((item) => !state.genre || item.raw.genre_ids?.includes(Number(state.genre)))
        .filter((item) => !state.year || item.year === String(state.year))
        .filter((item) => !state.rating || Number(item.vote_average || 0) >= Number(state.rating))
        .filter((item) => !state.provider || true);
      totalPages = Math.max(...results.map((data) => Number(data.total_pages || 1)));
      items = await rankSearchResults(normalized, query, { limit: Math.max(20, normalized.length) });
      if (!items.length) items = normalized;
    } else if (state.category) {
      const data = await getCuratedPage(state.category, state.page, {
        ...filtersForCategory(),
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
    $("discovery-grid").innerHTML =
      '<div class="vivid-discovery-error"><i class="bi bi-exclamation-circle"></i><h2>Discovery is unavailable</h2><p>' +
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
  state.category = "";
  state.page = 1;

  if (state.region !== previousRegion) await loadProviders();
  if (state.provider && !state.region) {
    state.region = "GH";
    $("region-filter").value = "GH";
    await loadProviders();
  }
  populateGenres();
  populateProviders();
  fetchDiscovery();
}

function syncRuntimeControls() {
  const hasMovieType = state.type !== "tv";
  const hasTvType = state.type !== "movie";
  document.querySelectorAll("[data-runtime]").forEach((button) => {
    const runtime = RUNTIMES[button.dataset.runtime];
    const visible = !runtime || !button.dataset.runtime || (runtime.kind === "movie" ? hasMovieType : hasTvType);
    button.hidden = !visible;
    button.disabled = !visible;
    button.classList.toggle("is-active", button.dataset.runtime === state.runtime);
  });

  const selected = RUNTIMES[state.runtime];
  if (selected && ((selected.kind === "movie" && !hasMovieType) || (selected.kind === "tv" && !hasTvType))) {
    state.runtime = "";
    document.querySelectorAll("[data-runtime]").forEach((button) => button.classList.toggle("is-active", button.dataset.runtime === ""));
  }
}

function syncControlsFromUrl() {
  if ($("category-filter")) $("category-filter").value = state.category;
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.type === state.type)
  );
  $("year-filter").value = state.year;
  $("sort-filter").value = state.sort;
  $("rating-filter").value = state.rating;
  $("region-filter").value = state.region;
  document.querySelectorAll("[data-mood]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.mood === state.mood)
  );
  syncRuntimeControls();
  populateProviders();
}

function clearMode(mode) {
  if (mode === "mood") {
    state.mood = "";
    document.querySelectorAll("[data-mood]").forEach((button) => button.classList.toggle("is-active", button.dataset.mood === ""));
  } else {
    state.runtime = "";
    document.querySelectorAll("[data-runtime]").forEach((button) => button.classList.toggle("is-active", button.dataset.runtime === ""));
  }
}

function setType(type) {
  if (!["all", "movie", "tv"].includes(type)) return;
  state.type = type;
  state.page = 1;
  state.category = "";
  if (state.runtime && RUNTIMES[state.runtime].kind !== "movie" && type === "movie") state.runtime = "";
  if (state.runtime && RUNTIMES[state.runtime].kind !== "tv" && type === "tv") state.runtime = "";
  $("category-filter").value = "";
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.type === type)
  );
  populateGenres();
  populateProviders();
  syncRuntimeControls();
  fetchDiscovery();
}

function selectCategory(key) {
  const category = CURATED_CATEGORIES[key];
  if (!category) return;
  state.category = key;
  state.page = 1;
  state.genre = "";
  state.mood = "";
  state.runtime = "";
  if (category.type !== "all") state.type = category.type;
  $("category-filter").value = key;
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.type === state.type)
  );
  document.querySelectorAll("[data-mood]").forEach((button) => button.classList.toggle("is-active", button.dataset.mood === ""));
  syncRuntimeControls();
  populateGenres();
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
  state.mood = "";
  state.runtime = "";
  state.category = "";
  state.query = "";
  state.page = 1;

  $("discovery-search").value = "";
  $("clear-search").hidden = true;
  $("category-filter").value = "";
  $("genre-filter").value = "";
  $("year-filter").value = "";
  $("sort-filter").value = state.sort;
  $("rating-filter").value = "";
  $("region-filter").value = "";

  document.querySelectorAll("[data-type]").forEach((button) => button.classList.toggle("is-active", button.dataset.type === "all"));
  document.querySelectorAll("[data-mood]").forEach((button) => button.classList.toggle("is-active", button.dataset.mood === ""));
  syncRuntimeControls();
  populateGenres();
  populateProviders();
  fetchDiscovery();
}

function wire() {
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.addEventListener("click", () => setType(button.dataset.type))
  );

  renderFeaturedCollections();

  $("category-filter")?.addEventListener("change", () => {
    selectCategory($("category-filter").value);
  });

  ["genre-filter", "year-filter", "sort-filter", "rating-filter", "region-filter"]
    .forEach((id) => $(id).addEventListener("change", updateFromControls));

  $("provider-filter").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-provider]");
    if (!button) return;
    state.provider = button.dataset.provider || "";
    state.category = "";
    state.page = 1;
    $("category-filter").value = "";

    if (state.provider && !state.region) {
      state.region = "GH";
      $("region-filter").value = "GH";
      await loadProviders();
    } else {
      populateProviders();
    }
    fetchDiscovery();
  });

  document.querySelectorAll("[data-mood]").forEach((button) => button.addEventListener("click", () => {
    state.mood = button.dataset.mood || "";
    state.runtime = "";
    state.category = "";
    state.page = 1;
    $("category-filter").value = "";
    document.querySelectorAll("[data-mood]").forEach((item) => item.classList.toggle("is-active", item.dataset.mood === state.mood));
    document.querySelectorAll("[data-runtime]").forEach((item) => item.classList.toggle("is-active", item.dataset.runtime === ""));
    fetchDiscovery();
  }));

  document.querySelectorAll("[data-runtime]").forEach((button) => button.addEventListener("click", () => {
    if (button.hidden || button.disabled) return;
    state.runtime = button.dataset.runtime || "";
    state.mood = "";
    state.category = "";
    state.page = 1;
    $("category-filter").value = "";
    document.querySelectorAll("[data-mood]").forEach((item) => item.classList.toggle("is-active", item.dataset.mood === ""));
    document.querySelectorAll("[data-runtime]").forEach((item) => item.classList.toggle("is-active", item.dataset.runtime === state.runtime));
    fetchDiscovery();
  }));

  $("reset-filters").addEventListener("click", resetFilters);

  $("prev-page").addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page -= 1;
    fetchDiscovery();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("next-page").addEventListener("click", () => {
    if (state.page >= state.totalPages) return;
    state.page += 1;
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
    }, 300);
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

async function loadGenres() {
  try {
    const [movie, tv] = await Promise.all([tmdbApi.movieGenres(), tmdbApi.tvGenres()]);
    genres = { movie: movie.genres || [], tv: tv.genres || [] };
    populateGenres();
  } catch {
    $("genre-filter").innerHTML = '<option value="">Genres unavailable</option>';
  }
}

async function init() {
  populateYears();

  $("category-filter").innerHTML = '<option value="">All catalogue</option>' +
    Object.entries(CURATED_CATEGORIES).map(([key, category]) =>
      '<option value="' + escapeHtml(key) + '">' + escapeHtml(category.label) + "</option>"
    ).join("");

  const category = CURATED_CATEGORIES[state.category];
  if (category && category.type !== "all") state.type = category.type;

  wire();
  syncControlsFromUrl();
  $("discovery-search").value = state.query;
  $("clear-search").hidden = !state.query;

  await Promise.allSettled([loadGenres(), loadProviders()]);
  syncControlsFromUrl();
  await fetchDiscovery();
}

void init();
