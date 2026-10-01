const API_KEY = "6a46c44a2b36f3b6c206e5f19cafa558";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const YT_BASE_URL = "https://www.youtube.com/embed/";

const $ = (id) => document.getElementById(id);
const popularContainer = $("popular-container");
const moviesContainer = $("movies-container");
const topRatedContainer = $("top-rated-container");
const animeContainer = $("Anime");
const kdramaContainer = $("kdrama-container");
const tvshowsContainer = $("tvshows-container");
const upcomingSlider = $("upcoming-cards");
const searchInput = $("search-input");
const toggleThemeBtn = $("theme-toggle");
const nextBtn = $("nowplaying-more");
const heroTitle = $("title");
const heroDesc = $("overview");
const heroGenre = $("gen");
const heroDate = $("date");
const heroRating = $("rating");
const heroVideoContainer = $("hero-video-container");

let allMovies = [];
let allMoviesPage = 1;
let popularPage = 1;
let topRatedPage = 1;
let animePage = 1;
let kdramaPage = 1;
let tvPage = 1;
let upcomingMovies = [];
let currentTrailerIndex = 0;
let searchTimer;

async function tmdb(path, params = {}) {
  const query = new URLSearchParams({ api_key: API_KEY, language: "en-US", ...params });
  const response = await fetch("https://api.themoviedb.org/3/" + path + "?" + query);
  if (!response.ok) throw new Error("TMDB request failed: " + response.status);
  return response.json();
}

function movieCard(movie) {
  const title = movie.title || movie.name || "Untitled";
  const image = movie.poster_path ? IMAGE_BASE_URL + movie.poster_path : "fav-icon.png";
  const year = (movie.release_date || movie.first_air_date || "").slice(0, 4);
  return `<div class="movie-box" data-id="${movie.id}" role="button" tabindex="0">
    <img src="${image}" alt="${escapeHtml(title)}" class="movie-box-img" loading="lazy">
    <div class="box-text"><h2 class="movie-title">${escapeHtml(title)}</h2><span class="movie-type">${year || "N/A"}</span></div>
  </div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[char]));
}

function renderCards(container, results, append = false) {
  if (!container) return;
  if (!append) container.innerHTML = "";
  if (!results?.length && !append) {
    container.innerHTML = '<p class="empty-state">No results found.</p>';
    return;
  }
  container.insertAdjacentHTML("beforeend", results.map(movieCard).join(""));
  container.querySelectorAll(".movie-box").forEach((card) => {
    if (card.dataset.bound) return;
    card.dataset.bound = "1";
    const open = () => { window.location.href = "watch.html?id=" + encodeURIComponent(card.dataset.id); };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") open(); });
  });
}

function renderAllMovies(movies) {
  allMovies = movies || [];
  renderCards(moviesContainer, allMovies);
}
window.renderAllMovies = renderAllMovies;
window.allMovies = allMovies;

async function fetchAllMovies(page = 1, append = false) {
  try {
    const data = await tmdb("movie/popular", { page });
    allMovies = append ? [...allMovies, ...(data.results || [])] : (data.results || []);
    window.allMovies = allMovies;
    renderCards(moviesContainer, data.results || [], append);
  } catch (error) {
    console.error(error);
    if (!append && moviesContainer) moviesContainer.innerHTML = '<p class="empty-state">Movies could not be loaded. Please try again.</p>';
  }
}

async function loadSection(container, path, page = 1, append = false, params = {}) {
  try {
    const data = await tmdb(path, { page, ...params });
    renderCards(container, data.results || [], append);
  } catch (error) {
    console.error(error);
    if (!append && container) container.innerHTML = '<p class="empty-state">This section could not be loaded.</p>';
  }
}

async function searchMovies(query) {
  if (!query) return fetchAllMovies();
  try {
    const [movies, shows] = await Promise.all([
      tmdb("search/movie", { query }),
      tmdb("search/tv", { query })
    ]);
    const combined = [...(movies.results || []), ...(shows.results || [])];
    renderAllMovies(combined);
  } catch (error) {
    console.error(error);
    if (moviesContainer) moviesContainer.innerHTML = '<p class="empty-state">Search failed. Please try again.</p>';
  }
}

searchInput?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  searchTimer = setTimeout(() => searchMovies(query), 350);
});

nextBtn?.addEventListener("click", () => {
  allMoviesPage++;
  fetchAllMovies(allMoviesPage, true);
});

async function fetchUpcomingMovies() {
  if (!upcomingSlider) return;
  try {
    const data = await tmdb("movie/upcoming", { page: 1 });
    upcomingMovies = (data.results || []).slice(0, 10);
    upcomingSlider.innerHTML = upcomingMovies.map((movie, index) => `
      <div class="card" data-id="${movie.id}" data-index="${index}">
        <img src="${movie.poster_path ? IMAGE_BASE_URL + movie.poster_path : "fav-icon.png"}" alt="${escapeHtml(movie.title || "Movie")}" class="poster" loading="lazy">
        <div class="cont"><h4>${escapeHtml(movie.title || "Untitled")}</h4>
        <div class="sub"><span>${(movie.release_date || "").slice(0,4) || "N/A"}</span><span>★ ${Number(movie.vote_average || 0).toFixed(1)}</span></div></div>
      </div>`).join("");
    upcomingSlider.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => {
        currentTrailerIndex = Number(card.dataset.index);
        loadHeroTrailer(upcomingMovies[currentTrailerIndex]);
      });
    });
    if (upcomingMovies[0]) loadHeroTrailer(upcomingMovies[0]);
  } catch (error) {
    console.error(error);
  }
}

async function loadHeroTrailer(movie) {
  if (!movie) return;
  if (heroTitle) heroTitle.textContent = movie.title || "Untitled";
  if (heroDesc) heroDesc.textContent = movie.overview || "No description available.";
  if (heroDate) heroDate.textContent = (movie.release_date || "").slice(0, 4) || "N/A";
  if (heroRating) heroRating.textContent = Number(movie.vote_average || 0).toFixed(1);
  if (heroGenre) heroGenre.textContent = "Featured";

  if (!heroVideoContainer) return;
  try {
    const data = await tmdb(`movie/${movie.id}/videos`);
    const trailer = (data.results || []).find((video) => video.type === "Trailer" && video.site === "YouTube");
    heroVideoContainer.innerHTML = trailer
      ? `<iframe title="Trailer for ${escapeHtml(movie.title || "movie")}" src="${YT_BASE_URL}${encodeURIComponent(trailer.key)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(trailer.key)}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
      : "";
  } catch (error) {
    console.error(error);
    heroVideoContainer.innerHTML = "";
  }
}

window.scrollCards = (direction) => {
  if (!upcomingMovies.length) return;
  currentTrailerIndex = (currentTrailerIndex + direction + upcomingMovies.length) % upcomingMovies.length;
  loadHeroTrailer(upcomingMovies[currentTrailerIndex]);
};

function loadTheme() {
  document.body.classList.toggle("light-theme", localStorage.getItem("theme") === "light");
}
function toggleTheme() {
  const light = !document.body.classList.contains("light-theme");
  document.body.classList.toggle("light-theme", light);
  localStorage.setItem("theme", light ? "light" : "dark");
}

toggleThemeBtn?.addEventListener("click", toggleTheme);

document.addEventListener("DOMContentLoaded", () => {
  loadTheme();
  fetchAllMovies();
  loadSection(popularContainer, "movie/popular");
  loadSection(topRatedContainer, "movie/top_rated");
  loadSection(animeContainer, "discover/movie", 1, false, { with_genres: 16, sort_by: "popularity.desc" });
  loadSection(kdramaContainer, "discover/tv", 1, false, { with_original_language: "ko", sort_by: "popularity.desc" });
  loadSection(tvshowsContainer, "tv/popular");
  fetchUpcomingMovies();

  $("popular-more")?.addEventListener("click", () => { popularPage++; loadSection(popularContainer, "movie/popular", popularPage, true); });
  $("top-rated-more")?.addEventListener("click", () => { topRatedPage++; loadSection(topRatedContainer, "movie/top_rated", topRatedPage, true); });
  $("Anime-more")?.addEventListener("click", () => { animePage++; loadSection(animeContainer, "discover/movie", animePage, true, { with_genres: 16, sort_by: "popularity.desc" }); });
  $("kdrama-more")?.addEventListener("click", () => { kdramaPage++; loadSection(kdramaContainer, "discover/tv", kdramaPage, true, { with_original_language: "ko", sort_by: "popularity.desc" }); });
  $("tvshows-more")?.addEventListener("click", () => { tvPage++; loadSection(tvshowsContainer, "tv/popular", tvPage, true); });
});
