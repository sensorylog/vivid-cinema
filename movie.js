const API_KEY = "6a46c44a2b36f3b6c206e5f19cafa558";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const YOUTUBE_BASE_URL = "https://www.youtube.com/embed/";
const movieInfo = document.getElementById("movie-info");
const trailerBox = document.querySelector(".video-container");
const trailerFrame = document.getElementById("movieTrailer");
const closeBtn = document.querySelector(".close-video");

const urlParams = new URLSearchParams(window.location.search);
const movieId = urlParams.get("id");

if (!movieId) {
  movieInfo.innerHTML = "<p>Movie not found.</p>";
} else {
  fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${API_KEY}&append_to_response=videos,watch/providers,credits`)
    .then(res => res.json())
    .then(data => renderMovie(data))
    .catch(err => console.error("Error fetching movie details:", err));
}

function renderMovie(movie) {
  const trailer = movie.videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
  const providers = movie["watch/providers"].results?.US?.flatrate || [];
  const providerLogos = providers.map(p => `<img src="https://image.tmdb.org/t/p/w92${p.logo_path}" alt="${p.provider_name}" />`).join("");

  const cast = movie.credits?.cast?.slice(0, 5).map(actor => actor.name).join(", ") || "N/A";
  const runtime = movie.runtime ? `${movie.runtime} min` : "N/A";
  const budget = movie.budget ? `$${movie.budget.toLocaleString()}` : "N/A";

  movieInfo.innerHTML = `
    <div class="movie-detail-box">
      <img class="poster" src="${IMAGE_BASE_URL}${movie.poster_path}" alt="${movie.title}" />
      <div class="movie-meta">
        <h1>${movie.title}</h1>
        <p><strong>Release:</strong> ${movie.release_date}</p>
        <p><strong>Genres:</strong> ${movie.genres.map(g => g.name).join(", ")}</p>
        <p><strong>Runtime:</strong> ${runtime}</p>
        <p><strong>Budget:</strong> ${budget}</p>
        <p><strong>Cast:</strong> ${cast}</p>
        <p>${movie.overview}</p>
        ${providerLogos ? `<div class="providers"><h4>Available on:</h4>${providerLogos}</div>` : ""}
        ${trailer ? `<button class="watch-btn play-btn" onclick="playTrailer('${trailer.key}')">
          <i class='bx bx-right-arrow'></i><span>Watch Trailer</span>
        </button>` : ""}
      </div>
    </div>
  `;
}

function playTrailer(key) {
  trailerFrame.src = `${YOUTUBE_BASE_URL}${key}?autoplay=1`;
  trailerBox.classList.add("show-video");
}

closeBtn.onclick = () => {
  trailerBox.classList.remove("show-video");
  trailerFrame.src = "";
};
