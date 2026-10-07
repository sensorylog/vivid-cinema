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
if (["quickEpisode", "episode", "longEpisode"].includes(state.runtime)) state.type = "tv";
if (["short", "standard", "long"].includes(state.runtime)) state.type = "movie";
let genres = { movie: [], tv: [] };
let providers = { movie: [], tv: [] };

const MOODS = Object.freeze({
  // genres[0] is the primary TMDB genre used for ranking so results feel like the chip.
  // Additional ids are OR matches so related titles still surface, then get ranked below.
  relax: { label: "Relax", genres: [35, 10751], sort: "popularity.desc" },       // Comedy, Family
  intense: { label: "Intense", genres: [28, 53, 80], sort: "popularity.desc" }, // Action, Thriller, Crime
  funny: { label: "Funny", genres: [35], sort: "popularity.desc" },             // Comedy only
  romantic: { label: "Romantic", genres: [10749], sort: "popularity.desc" },    // Romance only
  thoughtful: { label: "Thought-provoking", genres: [18, 9648, 99], sort: "popularity.desc" }, // Drama, Mystery, Documentary
  escapist: { label: "Escapist", genres: [12, 14, 878], sort: "popularity.desc" }, // Adventure, Fantasy, Sci-Fi
  scary: { label: "Scary", genres: [27], sort: "popularity.desc" },             // Horror only
  emotional: { label: "Emotional", genres: [18, 10749], sort: "popularity.desc" }, // Drama, Romance
  fast: { label: "Fast-paced", genres: [28, 53], sort: "popularity.desc" },     // Action, Thriller
  late: { label: "Late-night", genres: [27, 9648, 53], sort: "popularity.desc" } // Horror, Mystery, Thriller
});
const RUNTIMES = Object.freeze({
  short: { label: "Under 90 min", min: 1, max: 89 },
  standard: { label: "90–120 min", min: 90, max: 120 },
  long: { label: "Over 120 min", min: 121 },
  quickEpisode: { label: "Episodes under 30 min", min: 1, max: 29 },
  episode: { label: "Episodes 30–60 min", min: 30, max: 60 },
  longEpisode: { label: "Episodes over 60 min", min: 61 }
});

// Rank discover results so the mood's primary genre leads. TMDB with_genres is
// inclusive (any listed genre), so multi-tagged titles (e.g. action-comedy) can
// appear under Funny; ranking puts pure comedy first and drops titles that lost
// the mood genre after normalization edge cases.
function rankByMood(items) {
  const mood = MOODS[state.mood];
  if (!mood?.genres?.length || !items?.length) return items || [];
  const primary = mood.genres[0];
  const allowed = new Set(mood.genres.map(Number));
  return items
    .map((item) => {
      const ids = (item.raw?.genre_ids || []).map(Number);
      const hasPrimary = ids[0] === primary;
      const hasAny = ids.some((id) => allowed.has(id));
      const score = hasPrimary ? 3 : hasAny ? 1 : 0;
      return { item, score, vote: Number(item.vote_average || 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.vote - a.vote)
    .map((entry) => entry.item);
}


function renderFeaturedCollections() {
  const container = $("featured-collections");
  if (!container) return;
  const entries = Object.entries(CURATED_CATEGORIES).filter(([, category]) => category.featured).slice(0, 8);
  container.innerHTML = entries.map(([key, category]) =>
    '<button class="vivid-collection-card" type="button" data-collection="' + escapeHtml(key) + '">' +
    '<span class="vivid-collection-card-kicker">VIVID</span><strong>' + escapeHtml(category.label) + '</strong><small>' + escapeHtml(category.description) + '</small><span class="vivid-collection-card-arrow"><i class="bi bi-arrow-up-right"></i></span></button>'
  ).join("");
  container.querySelectorAll("[data-collection]").forEach((button) => button.addEventListener("click", () => {
    state.category = button.dataset.collection || "";
    state.page = 1;
    const category = CURATED_CATEGORIES[state.category];
    if (category) {
      state.type = category.type;
      document.querySelectorAll("[data-type]").forEach((item) => item.classList.toggle("is-active", item.dataset.type === state.type));
      $("category-filter").value = state.category;
      populateGenres();
    }
    fetchDiscovery();
    document.querySelector(".vivid-discovery-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

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
  const source = state.type === "tv"
    ? providers.tv
    : state.type === "movie"
      ? providers.movie
      : [...providers.movie, ...providers.tv];
  const unique = source.filter((provider, index, list) =>
    list.findIndex((item) => item.provider_id === provider.provider_id) === index
  );
  const known = [
    "Netflix", "Amazon Prime Video", "Prime Video", "Disney Plus", "Disney+",
    "Apple TV", "Apple TV+", "Showmax", "Max", "HBO Max", "Crunchyroll",
    "Paramount Plus", "Paramount+", "MUBI", "Hulu"
  ];
  const ranked = unique
    .filter((provider) => provider?.provider_id && provider?.provider_name)
    .sort((a, b) =>
      (Number(a.display_priority) || 9999) - (Number(b.display_priority) || 9999) ||
      String(a.provider_name).localeCompare(String(b.provider_name))
    );
  const familiar = ranked.filter((provider) =>
    known.some((name) => String(provider.provider_name).toLowerCase().includes(name.toLowerCase()))
  );
  return [...familiar, ...ranked.filter((provider) => !familiar.includes(provider))].slice(0, 8);
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
    // Provider availability is region-specific, so the provider browser and
    // the actual Discover query must use the same selected region.
    const [movie, tv] = await Promise.all([tmdbApi.movieWatchProviders(state.region), tmdbApi.tvWatchProviders(state.region)]);
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
    const isPerson = item.media_type === "person";
    const meta = isPerson ? "Person" : [item.year, item.media_type === "tv" ? "TV" : "Movie"].filter(Boolean).join(" · ");
    const href = isPerson ? "person.html?id=" + encodeURIComponent(item.id) : getMediaUrl(item);
    const image = item.poster_path || item.profile_path;
    return '<a class="vivid-discovery-card' + (isPerson ? ' vivid-discovery-card--person' : '') + '" href="' + escapeHtml(href) + '">' +
      '<div class="vivid-discovery-poster"><img loading="lazy" decoding="async" src="' + getImageUrl(image, "w500") +
      '" alt="' + escapeHtml(item.title) + ' poster" onerror="this.style.visibility=\'hidden\'">' +
      (!isPerson ? '<span class="vivid-discovery-rating">★ ' + (item.vote_average ? item.vote_average.toFixed(1) : "—") + '</span>' : '') +
      '</div><div class="vivid-discovery-copy"><strong>' + escapeHtml(item.title) +
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
  const mood = MOODS[state.mood];
  const runtime = RUNTIMES[state.runtime];
  // Mood is the primary discovery mode: its genres and sort win over a stale
  // genre select so Funny always hits Comedy (35), Scary always hits Horror (27).
  const effectiveSort = mood?.sort || state.sort;
  const sort = type === "tv"
    ? effectiveSort.replace("primary_release_date", "first_air_date")
    : effectiveSort;
  // TMDB: comma = AND, pipe = OR. Moods use OR across their genre list.
  const moodGenreQuery = mood?.genres?.length ? mood.genres.join("|") : "";
  const params = {
    include_adult: false,
    include_video: false,
    page: state.page,
    sort_by: sort,
    with_genres: moodGenreQuery || state.genre || undefined,
    ...(type === "movie"
      ? { primary_release_year: state.year || undefined }
      : { first_air_date_year: state.year || undefined }),
    "vote_average.gte": state.rating || undefined,
    // Modest vote floor when browsing by mood so mis-tagged low-signal titles
    // do not drown out real comedy / horror / romance matches.
    ...(mood ? { "vote_count.gte": 40 } : {}),
    // TMDB expects the dotted runtime parameters. Use them for both movies
    // and TV because TV discover supports episode runtime as well.
    ...(runtime
      ? { "with_runtime.gte": runtime.min, "with_runtime.lte": runtime.max }
      : {}),
    watch_region: state.region || undefined,
    with_watch_monetization_types: state.provider ? "flatrate" : undefined,
    with_watch_providers: state.provider || undefined
  };
  return params;
}


async function fetchDiscovery() {
  const requestId = ++state.requestId;
  syncUrl();
  renderLoading();
  const query = state.query.trim();
  $("results-label").textContent = query ? "SEARCH" : state.category ? "COLLECTION" : "DISCOVER";
  const selectedProvider = [...(providers.movie || []), ...(providers.tv || [])].find((provider) => String(provider.provider_id) === String(state.provider));
  const selectedCategory = CURATED_CATEGORIES[state.category];
  const selectedMood = MOODS[state.mood];
  $("results-title").textContent = query
    ? 'Results for “' + escapeHtml(query) + '”'
    : selectedCategory ? selectedCategory.label
    : selectedMood ? selectedMood.label
    : selectedProvider ? selectedProvider.provider_name
    : state.type === "all" ? "All titles" : state.type === "tv" ? "TV series" : "Movies";

  try {
    let items = [];
    let totalPages = 1;

    if (query) {
      const data = await tmdbApi.searchMulti(query, state.page);
      const rawResults = (data.results || [])
        .filter((item) => ["movie", "tv", "person"].includes(item.media_type))
        .filter((item) => state.type === "all" || item.media_type === state.type);
      const normalized = rawResults.map((item) => {
        if (item.media_type === "person") {
          return {
            id: String(item.id), media_type: "person", content_id: "person:" + item.id,
            title: item.name || "Unknown person", year: "",
            overview: item.known_for_department || "", poster_path: item.profile_path || "",
            backdrop_path: "", vote_average: 0, raw: item
          };
        }
        return normalizeResults([item], item.media_type)[0];
      }).filter(Boolean);
      items = normalized
        .filter((item) => item.media_type === "person" || !state.genre || item.raw.genre_ids?.includes(Number(state.genre)))
        .filter((item) => item.media_type === "person" || !state.year || item.year === String(state.year))
        .filter((item) => item.media_type === "person" || !state.rating || Number(item.vote_average || 0) >= Number(state.rating));
      totalPages = Math.min(500, Number(data.total_pages || 1));
      items = await rankSearchResults(items, query, { limit: items.length || 20 });
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
      if (state.mood) items = rankByMood(items);
      totalPages = Math.max(Number(movies.total_pages || 1), Number(tv.total_pages || 1));
    } else {
      const data = await (state.type === "movie"
        ? tmdbApi.discoverMovies(discoverParams("movie"))
        : tmdbApi.discoverTv(discoverParams("tv")));
      items = normalizeResults(data.results || [], state.type);
      if (state.mood) items = rankByMood(items);
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
  document.querySelectorAll("[data-mood]").forEach((button) => button.classList.toggle("is-active", button.dataset.mood === state.mood));
  document.querySelectorAll("[data-runtime]").forEach((button) => button.classList.toggle("is-active", button.dataset.runtime === state.runtime));
  populateProviders();
}

function setType(type) {
  state.type = type;
  state.genre = "";
  // Runtime presets are content-type specific. Do not send a movie runtime
  // to TV or an episode runtime to the movie endpoint after switching type.
  const episodeRuntime = ["quickEpisode", "episode", "longEpisode"].includes(state.runtime);
  const movieRuntime = ["short", "standard", "long"].includes(state.runtime);
  if ((type === "tv" && movieRuntime) || (type === "movie" && episodeRuntime)) {
    state.runtime = "";
    document.querySelectorAll("[data-runtime]").forEach((item) =>
      item.classList.toggle("is-active", item.dataset.runtime === "")
    );
  }
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
  state.mood = "";
  state.runtime = "";
  state.category = "";
  state.query = "";
  state.page = 1;
  document.querySelectorAll("[data-type]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.type === "all")
  );
  document.querySelectorAll("[data-mood]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.mood === "")
  );
  document.querySelectorAll("[data-runtime]").forEach((button) =>
    button.classList.toggle("is-active", button.dataset.runtime === "")
  );
  $("discovery-search").value = "";
  $("clear-search").hidden = true;
  $("genre-filter").value = "";
  $("year-filter").value = "";
  $("sort-filter").value = state.sort;
  $("rating-filter").value = "";
  $("region-filter").value = "";
  if ($("category-filter")) $("category-filter").value = "";
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
    state.mood = "";
    state.runtime = "";
    state.genre = "";
    state.year = "";
    state.rating = "";
    state.query = "";
    $("discovery-search").value = "";
    $("clear-search").hidden = true;
    // A provider is its own discovery mode. Never let a curated collection
    // silently bypass the provider filter and return unrelated titles.
    state.category = "";
    if ($("category-filter")) $("category-filter").value = "";
    state.page = 1;
    if (state.provider && !state.region) {
      // A provider cannot be resolved without a watch region. Ghana is the
      // safe default for this public deployment when none has been selected.
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
    state.provider = "";
    state.query = "";
    $("discovery-search").value = "";
    $("clear-search").hidden = true;
    state.runtime = "";
    state.category = "";
    // Mood is a primary discovery mode. Clear restrictive filters so a
    // previous provider/genre/year/rating cannot silently reduce it to zero.
    state.genre = "";
    state.year = "";
    state.rating = "";
    state.provider = "";
    if ($("category-filter")) $("category-filter").value = "";
    if ($("genre-filter")) $("genre-filter").value = "";
    if ($("year-filter")) $("year-filter").value = "";
    if ($("rating-filter")) $("rating-filter").value = "";
    populateProviders();
    document.querySelectorAll("[data-runtime]").forEach((item) => item.classList.toggle("is-active", item.dataset.runtime === ""));
    state.page = 1;
    document.querySelectorAll("[data-mood]").forEach((item) => item.classList.toggle("is-active", item.dataset.mood === state.mood));
    fetchDiscovery();
  }));
  document.querySelectorAll("[data-runtime]").forEach((button) => button.addEventListener("click", () => {
    state.runtime = button.dataset.runtime || "";
    state.mood = "";
    state.provider = "";
    state.query = "";
    $("discovery-search").value = "";
    $("clear-search").hidden = true;
    state.mood = "";
    state.category = "";
    state.genre = "";
    state.year = "";
    state.rating = "";
    state.provider = "";
    // Episode-length presets are TV-specific. Switch to TV instead of sending
    // an episode runtime filter to the movie endpoint as well.
    const episodeRuntime = ["quickEpisode", "episode", "longEpisode"].includes(state.runtime);
    const movieRuntime = ["short", "standard", "long"].includes(state.runtime);
    if (episodeRuntime) {
      state.type = "tv";
    } else if (movieRuntime) {
      state.type = "movie";
    }
    document.querySelectorAll("[data-type]").forEach((item) =>
      item.classList.toggle("is-active", item.dataset.type === state.type)
    );
    if ($("category-filter")) $("category-filter").value = "";
    if ($("genre-filter")) $("genre-filter").value = "";
    if ($("year-filter")) $("year-filter").value = "";
    if ($("rating-filter")) $("rating-filter").value = "";
    populateGenres();
    populateProviders();
    document.querySelectorAll("[data-mood]").forEach((item) => item.classList.toggle("is-active", item.dataset.mood === ""));
    state.page = 1;
    document.querySelectorAll("[data-runtime]").forEach((item) => item.classList.toggle("is-active", item.dataset.runtime === state.runtime));
    fetchDiscovery();
  }));
  $("reset-filters").addEventListener("click", resetFilters);

  $("prev-page").addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page--;
    fetchDiscovery();
  });
  $("next-page").addEventListener("click", () => {
    if (state.page >= state.totalPages) return;
    state.page++;
    fetchDiscovery();
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
  // Do not block the first catalogue render on secondary metadata requests.
  // Genres/providers hydrate in the background and are ready for subsequent filtering.
  const firstRender = fetchDiscovery();
  void Promise.allSettled([loadGenres(), loadProviders()]).then(() => {
    if (state.provider || state.category || state.genre) {
      syncControlsFromUrl();
    } else {
      populateGenres();
      populateProviders();
    }
  });
  await firstRender;
}

void init();
