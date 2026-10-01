(() => {
  const genreSelect = document.getElementById("genre-select");
  const yearSelect = document.getElementById("year-select");
  const applyBtn = document.getElementById("apply-filters");
  const hamburgerBtn = document.getElementById("hamburger-btn");
  const mobileMenu = document.getElementById("mobile-filter-menu");
  const closeBtn = document.getElementById("close-filter-menu");

  if (!genreSelect || !yearSelect || !applyBtn || !hamburgerBtn || !mobileMenu || !closeBtn) return;

  hamburgerBtn.addEventListener("click", () => {
    const open = hamburgerBtn.classList.toggle("open");
    mobileMenu.classList.toggle("open", open);
    hamburgerBtn.setAttribute("aria-expanded", String(open));
  });

  closeBtn.addEventListener("click", () => {
    hamburgerBtn.classList.remove("open");
    mobileMenu.classList.remove("open");
    hamburgerBtn.setAttribute("aria-expanded", "false");
  });

  for (let year = new Date().getFullYear(); year >= 2000; year--) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  }

  async function loadGenres() {
    try {
      const response = await fetch("https://api.themoviedb.org/3/genre/movie/list?api_key=6a46c44a2b36f3b6c206e5f19cafa558&language=en-US");
      if (!response.ok) throw new Error("Genre request failed");
      const data = await response.json();
      (data.genres || []).forEach(({ id, name }) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = name;
        genreSelect.appendChild(option);
      });
    } catch (error) {
      console.error(error);
    }
  }
  loadGenres();

  applyBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    const params = new URLSearchParams({
      api_key: "6a46c44a2b36f3b6c206e5f19cafa558",
      language: "en-US",
      sort_by: "popularity.desc",
      include_adult: "false",
      include_video: "false",
      page: "1"
    });
    if (genreSelect.value) params.set("with_genres", genreSelect.value);
    if (yearSelect.value) params.set("primary_release_year", yearSelect.value);

    try {
      const response = await fetch("https://api.themoviedb.org/3/discover/movie?" + params);
      if (!response.ok) throw new Error("Filter request failed");
      const data = await response.json();
      if (typeof window.renderAllMovies === "function") window.renderAllMovies(data.results || []);
    } catch (error) {
      console.error(error);
      if (typeof window.renderAllMovies === "function") window.renderAllMovies([]);
    }

    hamburgerBtn.classList.remove("open");
    mobileMenu.classList.remove("open");
  });
})();
