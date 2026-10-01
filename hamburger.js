// hamburger.js

(() => {
    const API_KEY      = "6a46c44a2b36f3b6c206e5f19cafa558";
    const genreSelect  = document.getElementById("genre-select");
    const yearSelect   = document.getElementById("year-select");
    const applyBtn     = document.getElementById("apply-filters");
    const hamburgerBtn = document.getElementById("hamburger-btn");
    const mobileMenu   = document.getElementById("mobile-filter-menu");
    const closeBtn     = document.getElementById("close-filter-menu");
  
    // ─── Toggle Menu ───────────────────────────────────────────
    hamburgerBtn.addEventListener("click", () => {
      hamburgerBtn.classList.toggle("open");
      mobileMenu.classList.toggle("open");
    });
    closeBtn.addEventListener("click", () => {
      hamburgerBtn.classList.remove("open");
      mobileMenu.classList.remove("open");
    });
  
    // ─── Populate Years 2000–2025 ──────────────────────────────
    for (let y = 2025; y >= 2000; y--) {
      const o = document.createElement("option");
      o.value = y;
      o.textContent = y;
      yearSelect.appendChild(o);
    }
  
    // ─── Load Genres from TMDB ──────────────────────────────────
    (async function loadGenres() {
      try {
        const res  = await fetch(
          `https://api.themoviedb.org/3/genre/movie/list?api_key=${API_KEY}&language=en-US`
        );
        const { genres } = await res.json();
        genres.forEach(({ id, name }) => {
          const o = document.createElement("option");
          o.value = id;
          o.textContent = name;
          genreSelect.appendChild(o);
        });
      } catch (e) {
        console.error("Error loading genres:", e);
      }
    })();
  
    // ─── Build Discover URL ─────────────────────────────────────
    function buildDiscoverURL(genreId, year) {
      const params = new URLSearchParams({
        api_key: API_KEY,
        language: "en-US",
        sort_by: "popularity.desc",
        include_adult: "false",
        include_video: "false",
        page: "1"
      });
      if (genreId) params.set("with_genres", genreId);
      if (year)    params.set("primary_release_year", year);
      return `https://api.themoviedb.org/3/discover/movie?${params}`;
    }
  
    // ─── Apply Filters & Render ─────────────────────────────────
    applyBtn.addEventListener("click", async e => {
      e.preventDefault();
      const genreId = genreSelect.value;
      const year    = yearSelect.value;
      const url     = buildDiscoverURL(genreId, year);
  
      try {
        const res  = await fetch(url);
        const data = await res.json();
        if (typeof window.renderAllMovies === "function") {
          window.renderAllMovies(data.results || []);
        }
      } catch (err) {
        console.error("Error fetching filtered movies:", err);
        if (typeof window.renderAllMovies === "function") {
          window.renderAllMovies([]);
        }
      }
  
      // Close the menu
      hamburgerBtn.classList.remove("open");
      mobileMenu.classList.remove("open");
    });
  })();
  