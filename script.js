
// ✅ FIXED SCRIPT WITH NO SYNTAX ERRORS OR ESCAPE ISSUES

const API_KEY = "6a46c44a2b36f3b6c206e5f19cafa558";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const YT_BASE_URL = "https://www.youtube.com/embed/";

const popularContainer = document.getElementById("popular-container");
const moviesContainer = document.getElementById("movies-container");
const topRatedContainer = document.getElementById("top-rated-container");
const AnimeContainer = document.getElementById("Anime");
const kdramaContainer = document.getElementById("kdrama-container");
const tvshowsContainer = document.getElementById("tvshows-container");
const upcomingSlider = document.getElementById("upcoming-cards");

const genreSelect = document.getElementById("genre-select");
const searchInput = document.getElementById("search-input");
const suggestionsBox = document.getElementById("search-suggestions");
const toggleThemeBtn = document.getElementById("theme-toggle");
const nextBtn = document.getElementById("nowplaying-more");

const userDropdown = document.getElementById("user-dropdown");
const userMenu = document.getElementById("user-menu");
const authLink = document.getElementById("auth-link");
const authUser = JSON.parse(localStorage.getItem("Vivid Cinema_auth_user") || "null");

const heroTitle = document.getElementById("title");
const heroDesc = document.getElementById("overview");
const heroGenre = document.getElementById("genre");
const heroDate = document.getElementById("date");
const heroRating = document.getElementById("rating");
const heroVideoContainer = document.getElementById("hero-video-container");

if (authUser) {
  authLink.style.display = "none";
  document.getElementById("user-email").textContent = authUser.email;
  userDropdown.addEventListener("click", () => {
    userMenu.classList.toggle("hidden");
  });
  document.getElementById("logout-link").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem("Vivid Cinema_auth_user");
    alert("Logged out");
    location.href = "login.html";
  });
} else {
  userDropdown.style.display = "none";
}

let allMovies = [];
let allMoviesPage = 1;
let popularPage = 1;
let topRatedPage = 1;
let AnimePage = 1;
let kdramaPage = 1;
let tvPage = 1;

async function fetchAllMovies(page = 1, append = false) {
  const res = await fetch(`https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=${page}`);
  const data = await res.json();
  allMovies = append ? [...allMovies, ...data.results] : data.results;
  renderAllMovies(allMovies);
}

function renderAllMovies(movies) {
  moviesContainer.innerHTML = "";
  if (!movies.length) {
    moviesContainer.innerHTML = `<p style="color:white;text-align:center">No results found.</p>`;
    return;
  }
  movies.forEach(movie => {
    const image = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : "img/fallback.jpg";
    const year = (movie.release_date || "").slice(0, 4);
    moviesContainer.innerHTML += `
      <div class="movie-box" onclick="location.href='watch.html?id=${movie.id}'">
        <img src="${image}" alt="${movie.title}" class="movie-box-img" loading="lazy"/>
        <div class="box-text">
          <h2 class="movie-title">${movie.title}</h2>
          <span class="movie-type">${year || "N/A"}</span>
        </div>
      </div>`;
  });
}

searchInput?.addEventListener("input", async () => {
  const query = searchInput.value.trim();
  if (!query) return fetchAllMovies();

  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(query)}`),
      fetch(`https://api.themoviedb.org/3/search/tv?api_key=${API_KEY}&query=${encodeURIComponent(query)}`)
    ]);

    const movieData = await movieRes.json();
    const tvData = await tvRes.json();
    const combinedResults = [...movieData.results, ...tvData.results];
    renderAllMovies(combinedResults);
  } catch (err) {
    console.error("Search error:", err);
  }
});

nextBtn?.addEventListener("click", () => {
  allMoviesPage++;
  fetchAllMovies(allMoviesPage, true);
});

function movieCard(movie) {
  const image = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : "img/fallback.jpg";
  const year = (movie.release_date || movie.first_air_date || "").slice(0, 4);
  return `
    <div class="movie-box" onclick="location.href='watch.html?id=${movie.id}'">
      <img src="${image}" alt="${movie.title || movie.name}" class="movie-box-img" loading="lazy"/>
      <div class="box-text">
        <h2 class="movie-title">${movie.title || movie.name}</h2>
        <span class="movie-type">${year || "N/A"}</span>
      </div>
    </div>`;
}

async function fetchPopularMovies(page = 1, append = false) {
  const res = await fetch(`https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=${page}`);
  const data = await res.json();
  if (!append) popularContainer.innerHTML = "";
  data.results.forEach(movie => popularContainer.insertAdjacentHTML("beforeend", movieCard(movie)));
}

async function fetchTopRatedMovies(page = 1, append = false) {
  const res = await fetch(`https://api.themoviedb.org/3/movie/top_rated?api_key=${API_KEY}&page=${page}`);
  const data = await res.json();
  if (!append) topRatedContainer.innerHTML = "";
  data.results.forEach(movie => topRatedContainer.insertAdjacentHTML("beforeend", movieCard(movie)));
}

async function fetchAnime(page = 1, append = false) {
  const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${API_KEY}&query=anime&page=${page}`);
  const data = await res.json();
  if (!append) AnimeContainer.innerHTML = "";
  data.results.forEach(movie => AnimeContainer.insertAdjacentHTML("beforeend", movieCard(movie)));
}

async function fetchHotKoreanDrama(page = 1, append = false) {
  const res = await fetch(`https://api.themoviedb.org/3/discover/tv?api_key=${API_KEY}&with_original_language=ko&page=${page}`);
  const data = await res.json();
  if (!append) kdramaContainer.innerHTML = "";
  data.results.forEach(movie => kdramaContainer.insertAdjacentHTML("beforeend", movieCard(movie)));
}

async function fetchTVShows(page = 1, append = false) {
  const res = await fetch(`https://api.themoviedb.org/3/tv/popular?api_key=${API_KEY}&page=${page}`);
  const data = await res.json();
  const filtered = data.results.filter(show => show.genre_ids.some(id => [18, 10759, 10765, 10766, 10768].includes(id)));
  if (!append) tvshowsContainer.innerHTML = "";
  filtered.forEach(movie => tvshowsContainer.insertAdjacentHTML("beforeend", movieCard(movie)));
}

let upcomingMovies = [];
let currentTrailerIndex = 0;

async function fetchUpcomingMovies() {
  const res = await fetch(`https://api.themoviedb.org/3/movie/upcoming?api_key=${API_KEY}`);
  const data = await res.json();
  upcomingMovies = data.results.slice(0, 10);

  upcomingSlider.innerHTML = upcomingMovies.map((movie, index) => `
    <div class="card" data-id="${movie.id}" data-index="${index}">
      <img src="${IMAGE_BASE_URL + movie.poster_path}" alt="${movie.title}" class="poster" />
      <div class="cont">
        <h4>${movie.title}</h4>
        <div class="sub">
          <span>${movie.release_date?.slice(0, 4) || "N/A"}</span>
          <span>★ ${movie.vote_average?.toFixed(1)}</span>
        </div>
      </div>
    </div>`).join("");

  document.querySelectorAll("#upcoming-cards .card").forEach(card => {
    card.addEventListener("click", () => {
      const index = parseInt(card.dataset.index);
      currentTrailerIndex = index;
      loadHeroTrailer(upcomingMovies[currentTrailerIndex]);
    });
  });

  loadHeroTrailer(upcomingMovies[currentTrailerIndex]);
}

function scrollCards(dir) {
  currentTrailerIndex += dir;
  if (currentTrailerIndex < 0) currentTrailerIndex = upcomingMovies.length - 1;
  if (currentTrailerIndex >= upcomingMovies.length) currentTrailerIndex = 0;
  loadHeroTrailer(upcomingMovies[currentTrailerIndex]);
}

function loadHeroTrailer(movie) {
  heroTitle.textContent = movie.title;
  heroDesc.textContent = movie.overview || "No description available.";
  heroDate.textContent = movie.release_date?.slice(0, 4) || "N/A";
  heroRating.textContent = movie.vote_average?.toFixed(1) || "0.0";
  heroGenre.textContent = "Genre ID: " + (movie.genre_ids?.join(", ") || "N/A");

  fetch(`https://api.themoviedb.org/3/movie/${movie.id}/videos?api_key=${API_KEY}`)
    .then(res => res.json())
    .then(data => {
      const trailer = data.results.find(v => v.type === "Trailer" && v.site === "YouTube");
      heroVideoContainer.innerHTML = trailer
        ? `<iframe src="${YT_BASE_URL}${trailer.key}?autoplay=1&mute=1&controls=0&loop=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
        : `<div style="height:100%;background:black;"></div>`;
    });
}

function loadTheme() {
  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light-theme");
  }
}
function toggleTheme() {
  document.body.classList.toggle("light-theme");
  localStorage.setItem("theme", document.body.classList.contains("light-theme") ? "light" : "dark");
}
toggleThemeBtn?.addEventListener("click", toggleTheme);

document.addEventListener("DOMContentLoaded", () => {
  fetchPopularMovies();
  fetchTopRatedMovies();
  fetchAnime();
  fetchHotKoreanDrama();
  fetchTVShows();
  fetchAllMovies();
  fetchUpcomingMovies();
  loadTheme();

  document.getElementById("popular-more")?.addEventListener("click", () => {
    popularPage++;
    fetchPopularMovies(popularPage, true);
  });
  document.getElementById("top-rated-more")?.addEventListener("click", () => {
    topRatedPage++;
    fetchTopRatedMovies(topRatedPage, true);
  });
  document.getElementById("Anime-more")?.addEventListener("click", () => {
    AnimePage++;
    fetchAnime(AnimePage, true);
  });
  document.getElementById("kdrama-more")?.addEventListener("click", () => {
    kdramaPage++;
    fetchHotKoreanDrama(kdramaPage, true);
  });
  document.getElementById("tvshows-more")?.addEventListener("click", () => {
    tvPage++;
    fetchTVShows(tvPage, true);
  });
});

