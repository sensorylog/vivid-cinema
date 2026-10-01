import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./media.js";
import { escapeHtml, getErrorMessage } from "./utils.js";
import { getRoute } from "./routes.js";

const $ = (id) => document.getElementById(id);
const route = getRoute();
const state = { type: route.params.get("type") === "tv" ? "tv" : route.params.get("type") === "movie" ? "movie" : "all", genre: route.params.get("genre") || "", year: route.params.get("year") || "", sort: route.params.get("sort") || "popularity.desc", rating: route.params.get("rating") || "", query: route.params.get("q") || "", page: 1, totalPages: 1, requestId: 0 };
let genres = { movie: [], tv: [] };

function currentGenres() {
  if (state.type === "tv") return genres.tv;
  if (state.type === "movie") return genres.movie;
  return [...genres.movie, ...genres.tv]
    .filter((genre, index, list) => list.findIndex((item) => item.id === genre.id) === index)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function populateGenres() {
  const select = $("genre-filter");
  const selected = state.genre;
  const available = currentGenres();
  select.innerHTML = '<option value="">All genres</option>' + available.map((genre) => '<option value="' + genre.id + '">' + escapeHtml(genre.name) + '</option>').join("");
  select.value = selected && available.some((genre) => String(genre.id) === String(selected)) ? selected : "";
  if (select.value !== selected) state.genre = "";
}

function populateYears() {
  const select = $("year-filter");
  const current = new Date().getFullYear();
  select.innerHTML = '<option value="">Any year</option>' + Array.from({ length: 76 }, (_, index) => current - index).map((year) => '<option value="' + year + '">' + year + '</option>').join("");
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

function renderLoading() {
  $("discovery-empty").hidden = true;
  $("discovery-grid").innerHTML = Array.from({ length: 12 }, () => '<div class="vivid-discovery-skeleton"></div>').join("");
}

function renderResults(items, totalPages) {
  state.totalPages = Math.max(1, Math.min(500, Number(totalPages) || 1));
  const grid = $("discovery-grid");
  $("discovery-empty").hidden = items.length !== 0;
  $("results-count").textContent = state.totalPages > 1 ? "Page " + state.page + " of " + state.totalPages : items.length + " titles";
  $("page-label").textContent = "Page " + state.page;
  $("prev-page").disabled = state.page <= 1;
  $("next-page").disabled = state.page >= state.totalPages;
  if (!items.length) { grid.innerHTML = ""; return; }
  grid.innerHTML = items.map((item) => {
    const meta = [item.year, item.media_type === "tv" ? "TV" : "Movie"].filter(Boolean).join(" · ");
    return '<a class="vivid-discovery-card" href="' + escapeHtml(getMediaUrl(item)) + '"><div class="vivid-discovery-poster"><img loading="lazy" src="' + getImageUrl(item.poster_path, "w500") + '" alt="' + escapeHtml(item.title) + ' poster" onerror="this.style.visibility=\'hidden\'"><span class="vivid-discovery-rating">★ ' + (item.vote_average ? item.vote_average.toFixed(1) : "—") + '</span></div><div class="vivid-discovery-copy"><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(meta) + '</small></div></a>';
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

async function fetchDiscovery() {
  const requestId = ++state.requestId;
  renderLoading();
  const query = state.query.trim();
  $("results-label").textContent = query ? "SEARCH" : "DISCOVER";
  $("results-title").textContent = query ? 'Results for “' + escapeHtml(query) + '”' : (state.type === "all" ? "All titles" : state.type === "tv" ? "TV series" : "Movies");

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
        .filter((item) => !state.year || item.year === String(state.year));
      totalPages = Math.max(...results.map((data) => Number(data.total_pages || 1)));
      items = sortItems(items);
    } else if (state.type === "all") {
      const tvSort = state.sort === "primary_release_date.desc"
        ? "first_air_date.desc"
        : state.sort === "primary_release_date.asc"
          ? "first_air_date.asc"
          : state.sort;

      const [movies, tv] = await Promise.all([
        tmdbApi.discoverMovies({
          page: state.page,
          sort_by: state.sort,
          with_genres: state.genre || undefined,
          primary_release_year: state.year || undefined
        }),
        tmdbApi.discoverTv({
          page: state.page,
          sort_by: tvSort,
          with_genres: state.genre || undefined,
          first_air_date_year: state.year || undefined
        })
      ]);

      items = sortItems([
        ...normalizeResults(movies.results || [], "movie"),
        ...normalizeResults(tv.results || [], "tv")
      ]);
      totalPages = Math.max(Number(movies.total_pages || 1), Number(tv.total_pages || 1));
    } else {
      const params = {
        page: state.page,
        sort_by: state.type === "tv" && state.sort.startsWith("primary_release_date")
          ? state.sort.replace("primary_release_date", "first_air_date")
          : state.sort,
        with_genres: state.genre || undefined,
        ...(state.type === "movie"
          ? { primary_release_year: state.year || undefined }
          : { first_air_date_year: state.year || undefined })
      };
      params["vote_average.gte"] = state.rating || undefined;
      const data = state.type === "movie" ? await tmdbApi.discoverMovies(params) : await tmdbApi.discoverTv(params);
      items = normalizeResults(data.results || [], state.type);
      totalPages = Number(data.total_pages || 1);
    }

    if (requestId !== state.requestId) return;
    renderResults(items, totalPages);
  } catch (error) {
    if (requestId !== state.requestId) return;
    $("discovery-grid").innerHTML = '<div class="vivid-discovery-error"><i class="bi bi-exclamation-circle"></i><h2>Discovery is unavailable</h2><p>' + escapeHtml(getErrorMessage(error)) + '</p><button id="retry-discovery" type="button">Try again</button></div>';
    $("discovery-empty").hidden = true;
    $("results-count").textContent = "";
    $("prev-page").disabled = true;
    $("next-page").disabled = true;
    $("retry-discovery").addEventListener("click", fetchDiscovery);
  }
}

function updateFromControls(resetPage = true) {
  state.genre = $("genre-filter").value;
  state.year = $("year-filter").value;
  state.sort = $("sort-filter").value;
  state.rating = $("rating-filter").value;
  if (resetPage) state.page = 1;
  fetchDiscovery();
}

function syncControlsFromUrl() {\n  document.querySelectorAll("[data-type]").forEach((button) => button.classList.toggle("is-active", button.dataset.type === state.type));\n  $("year-filter").value = state.year;\n  $("sort-filter").value = state.sort;\n  $("rating-filter").value = state.rating;\n}\n\nfunction setType(type) {
  state.type = type;
  state.genre = "";
  state.page = 1;
  document.querySelectorAll("[data-type]").forEach((button) => button.classList.toggle("is-active", button.dataset.type === type));
  populateGenres();
  fetchDiscovery();
}

function resetFilters() {
  state.type = "all";
  state.genre = "";
  state.year = "";
  state.sort = "popularity.desc";
  state.query = "";
  state.page = 1;
  document.querySelectorAll("[data-type]").forEach((button) => button.classList.toggle("is-active", button.dataset.type === "all"));
  $("discovery-search").value = state.query;
  $("clear-search").hidden = !state.query;
  $("genre-filter").value = "";
  $("year-filter").value = "";
  $("sort-filter").value = state.sort;
  $("rating-filter").value = state.rating;
  populateGenres();
  fetchDiscovery();
}

function wire() {
  document.querySelectorAll("[data-type]").forEach((button) => button.addEventListener("click", () => setType(button.dataset.type)));
  $("genre-filter").addEventListener("change", () => updateFromControls());
  $("year-filter").addEventListener("change", () => updateFromControls());
  $("sort-filter").addEventListener("change", () => updateFromControls());
  $("rating-filter").addEventListener("change", () => updateFromControls());
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
  wire();
  await loadGenres();
  await fetchDiscovery();
}

init();