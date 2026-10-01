const API_KEY = "6a46c44a2b36f3b6c206e5f19cafa558";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const container = document.getElementById("watch-container");
const params = new URLSearchParams(window.location.search);
const contentId = params.get("id");
let moreLikePage = 1;

document.addEventListener("DOMContentLoaded", () => {
  if (!contentId) {
    container.innerHTML = `<p style="color:white;">No content selected</p>`;
  } else {
    detectTypeAndLoad(contentId);
  }
});

// Watch Later functionality
function saveToWatchLater(content) {
  let watchLaterList = JSON.parse(localStorage.getItem("watchLater")) || [];
  if (!watchLaterList.some(item => item.id === content.id)) {
    watchLaterList.push(content);
    localStorage.setItem("watchLater", JSON.stringify(watchLaterList));
    alert("Added to Watch Later");
  } else {
    alert("This movie is already in your Watch Later list.");
  }
}

// Add to Favorites functionality
function addToFavorites(content) {
  let favorites = JSON.parse(localStorage.getItem("favorites")) || [];
  if (!favorites.some(item => item.id === content.id)) {
    favorites.push(content);
    localStorage.setItem("favorites", JSON.stringify(favorites));
    alert("Added to Favorites");
  } else {
    alert("This movie is already in your Favorites.");
  }
}

// Save resume data for movie or TV show
function saveResumeData(content) {
  const resumeData = {
    id: content.id,
    type: content.type || "movie",
    position: document.querySelector("iframe").contentWindow.document.body.scrollTop || 0,
  };
  localStorage.setItem("resumeData", JSON.stringify(resumeData));
}

// Display comments for the content
function displayComments(contentId) {
  const commentsContainer = document.getElementById("comments-container");
  const comments = JSON.parse(localStorage.getItem("comments")) || {};
  const contentComments = comments[contentId] || [];

  commentsContainer.innerHTML = contentComments.map(comment => `
    <div class="comment">
      <p><strong>User:</strong> ${comment.username}</p>
      <p>${comment.comment}</p>
    </div>
  `).join("");

  document.getElementById("comment-form").addEventListener("submit", function(e) {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const userComment = document.getElementById("user-comment").value;

    if (username && userComment) {
      if (!comments[contentId]) {
        comments[contentId] = [];
      }
      comments[contentId].push({ username, comment: userComment });
      localStorage.setItem("comments", JSON.stringify(comments));
      displayComments(contentId); // Re-display comments after adding
    }
  });
}

async function detectTypeAndLoad(id) {
  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${API_KEY}`),
      fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${API_KEY}`)
    ]);
    const movieData = await movieRes.json();
    const tvData = await tvRes.json();

    if (movieData && movieData.id && movieData.title) {
      fetchMovieDetails(movieData);
    } else if (tvData && tvData.id && tvData.name) {
      fetchTVDetails(tvData);
    } else {
      container.innerHTML = `<p style="color:red;">Content not found.</p>`;
    }
  } catch (err) {
    container.innerHTML = `<p style="color:red;">Error loading content. Try again later.</p>`;
  }
}

function renderCast(castArray) {
  return `<div style="display:flex; overflow-x:auto; gap:1rem; padding-bottom:1rem;">
    ${castArray.slice(0, 10).map(actor => `
      <div class="cast-member" style="min-width:100px; flex-shrink:0; text-align:center;">
        <img loading="lazy" src="${actor.profile_path ? IMAGE_BASE_URL + actor.profile_path : 'img/user.jpg'}" alt="${actor.name}" style="width:100px;height:140px;object-fit:cover;border-radius:8px;"/>
        <p style="margin-top:0.5rem;font-size:0.85rem;color:white;">${actor.name}</p>
      </div>`).join("")}
  </div>`;
}

function renderSimilar(similarArray) {
  return similarArray.slice(0, 6).map(m => `
    <div class="movie-box" onclick="location.href='watch.html?id=${m.id}'">
      <img loading="lazy" src="${m.poster_path ? IMAGE_BASE_URL + m.poster_path : 'img/fallback.jpg'}" alt="${m.title || m.name}" />
      <div class="box-text"><p>${m.title || m.name}</p></div>
    </div>`).join("");
}

async function fetchMovieDetails(movie) {
  const [videos, credits, similar] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/movie/${movie.id}/videos?api_key=${API_KEY}`).then(r => r.json()),
    fetch(`https://api.themoviedb.org/3/movie/${movie.id}/credits?api_key=${API_KEY}`).then(r => r.json()),
    fetch(`https://api.themoviedb.org/3/movie/${movie.id}/similar?api_key=${API_KEY}&page=${moreLikePage}`).then(r => r.json())
  ]);

  const trailer = videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
  const trailerHTML = trailer
    ? `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${trailer.key}" frameborder="0" allowfullscreen></iframe>`
    : `<p style="color:white;">No trailer available</p>`;

  container.innerHTML = `
    <a href="index.html" class="watch-btn" style="margin-bottom: 1.5rem;">← Back to Home</a>
    <div class="movie-detail">
      <h1 class="movie-title">${movie.title}</h1>
      <p class="movie-meta">${movie.release_date} | ${movie.runtime} min | ${movie.genres.map(g => g.name).join(', ')}</p>
      <p class="movie-description">${movie.overview}</p>

      <h3>🎬 Stream Movie</h3>
      <div class="video-frame">
        <iframe width="100%" height="400" src="https://vidapi.xyz/embedmulti/movie/${movie.id}" frameborder="0" allowfullscreen></iframe>
      </div>

      <h3 class="mt-2">📺 Trailer</h3>
      <div>${trailerHTML}</div>

      <h3 class="mt-2">🎭 Cast</h3>
      ${renderCast(credits.cast)}

      <h3 class="mt-2">🎞 More Like This</h3>
      <div class="movies-content" id="similar-container">${renderSimilar(similar.results)}</div>
      <button class="watch-btn mt-2" id="load-more">Load More</button>
      <div class="btn-row">
        <button class="watch-btn" id="add-watch-later">Add to Watch Later</button>
        <button class="watch-btn" id="add-favorites">Add to Favorites</button>
      </div>

      <div class="comment-section">
        <h3>💬 User Comments</h3>
        <div id="comments-container"></div>
        <form id="comment-form">
          <input type="text" id="username" placeholder="Your Name" required />
          <textarea id="user-comment" placeholder="Add your comment..." required></textarea>
          <button type="submit" class="watch-btn">Post Comment</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById("load-more").addEventListener("click", () => {
    fetchMoreLikeThis(movie.id, ++moreLikePage);
  });

  document.getElementById("add-watch-later").addEventListener("click", () => saveToWatchLater(movie));
  document.getElementById("add-favorites").addEventListener("click", () => addToFavorites(movie));

  displayComments(movie.id);
}

async function fetchTVDetails(tv) {
  const [credits, videos] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/tv/${tv.id}/credits?api_key=${API_KEY}`).then(r => r.json()),
    fetch(`https://api.themoviedb.org/3/tv/${tv.id}/videos?api_key=${API_KEY}`).then(r => r.json())
  ]);

  const trailer = videos.results.find(v => v.type === "Trailer" && v.site === "YouTube");
  const trailerHTML = trailer
    ? `<iframe width="100%" height="400" src="https://www.youtube.com/embed/${trailer.key}" frameborder="0" allowfullscreen></iframe>`
    : `<p style="color:white;">No trailer available</p>`;

  const seasonOptions = tv.seasons.filter(s => s.season_number > 0).map(s => `
    <option value="${s.season_number}">${s.name} (Season ${s.season_number})</option>
  `).join("");

  container.innerHTML = `
    <a href="index.html" class="watch-btn" style="margin-bottom: 1.5rem;">← Back to Home</a>
    <div class="movie-detail">
      <h1 class="movie-title">${tv.name}</h1>
      <p class="movie-meta">${tv.first_air_date} | ${tv.genres.map(g => g.name).join(', ')}</p>
      <p class="movie-description">${tv.overview}</p>

      <h3>🎬 Stream TV Show</h3>
      <div class="video-frame">
        <iframe width="100%" height="400" src="https://vidapi.xyz/embedmulti/tv/${tv.id}" frameborder="0" allowfullscreen></iframe>
      </div>

      <h3 class="mt-2">📺 Trailer</h3>
      <div>${trailerHTML}</div>

      <h3 class="mt-2">🎭 Cast</h3>
      ${renderCast(credits.cast)}

      <h3 class="mt-2">🌟 Seasons</h3>
      <select id="season-selector">${seasonOptions}</select>

      <h3 class="mt-2">🎞 More Like This</h3>
      <div class="movies-content" id="similar-container">${renderSimilar(tv.similar.results)}</div>
      <button class="watch-btn mt-2" id="load-more">Load More</button>
      <div class="btn-row">
        <button class="watch-btn" id="add-watch-later">Add to Watch Later</button>
        <button class="watch-btn" id="add-favorites">Add to Favorites</button>
      </div>

      <div class="comment-section">
        <h3>💬 User Comments</h3>
        <div id="comments-container"></div>
        <form id="comment-form">
          <input type="text" id="username" placeholder="Your Name" required />
          <textarea id="user-comment" placeholder="Add your comment..." required></textarea>
          <button type="submit" class="watch-btn">Post Comment</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById("load-more").addEventListener("click", () => {
    fetchMoreLikeThis(tv.id, ++moreLikePage);
  });

  document.getElementById("add-watch-later").addEventListener("click", () => saveToWatchLater(tv));
  document.getElementById("add-favorites").addEventListener("click", () => addToFavorites(tv));

  displayComments(tv.id);
}

function fetchMoreLikeThis(id, page) {
  // Implementation for loading more similar movies or shows (based on 'page')
}
