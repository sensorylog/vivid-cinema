const API_KEY = "6a46c44a2b36f3b6c206e5f19cafa558";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500";
const container = document.getElementById("watch-container");
const contentId = new URLSearchParams(location.search).get("id");
let moreLikePage = 1;
let currentContent = null;
let currentType = "movie";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[c]));

async function tmdb(path, params = {}) {
  const query = new URLSearchParams({ api_key: API_KEY, language: "en-US", ...params });
  const response = await fetch("https://api.themoviedb.org/3/" + path + "?" + query);
  if (!response.ok) throw new Error("TMDB request failed: " + response.status);
  return response.json();
}

function storeList(key, content) {
  const list = JSON.parse(localStorage.getItem(key) || "[]");
  if (!list.some((item) => item.id === content.id && item.media_type === content.media_type)) {
    list.push({ id: content.id, title: content.title || content.name, poster_path: content.poster_path, media_type: content.media_type || currentType });
    localStorage.setItem(key, JSON.stringify(list));
    return true;
  }
  return false;
}

function renderCast(cast = []) {
  return `<div class="cast-list">${cast.slice(0, 10).map((actor) => `
    <div class="cast-member">
      <img loading="lazy" src="${actor.profile_path ? IMAGE_BASE_URL + actor.profile_path : "fav-icon.png"}" alt="${escapeHtml(actor.name)}">
      <p>${escapeHtml(actor.name)}</p>
    </div>`).join("")}</div>`;
}

function renderSimilar(results = []) {
  return results.slice(0, 6).map((item) => `
    <div class="movie-box" data-id="${item.id}">
      <img loading="lazy" src="${item.poster_path ? IMAGE_BASE_URL + item.poster_path : "fav-icon.png"}" alt="${escapeHtml(item.title || item.name)}">
      <div class="box-text"><p>${escapeHtml(item.title || item.name)}</p></div>
    </div>`).join("");
}

function bindSimilar() {
  document.querySelectorAll("#similar-container .movie-box").forEach((card) => {
    card.addEventListener("click", () => { location.href = "watch.html?id=" + encodeURIComponent(card.dataset.id); });
  });
}

function commentsFor(id) {
  try { return JSON.parse(localStorage.getItem("comments") || "{}")[id] || []; }
  catch { return []; }
}

function renderComments(id) {
  const comments = commentsFor(id);
  const box = document.getElementById("comments-container");
  if (!box) return;
  box.innerHTML = comments.length
    ? comments.map((comment) => `<div class="comment"><p><strong>${escapeHtml(comment.username)}</strong></p><p>${escapeHtml(comment.comment)}</p></div>`).join("")
    : '<p class="empty-state">No comments yet.</p>';
}

function bindComments(id) {
  const form = document.getElementById("comment-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = form.querySelector("[name=username]").value.trim();
    const comment = form.querySelector("[name=comment]").value.trim();
    if (!username || !comment) return;

    const all = JSON.parse(localStorage.getItem("comments") || "{}");
    all[id] = all[id] || [];
    all[id].push({ username, comment, createdAt: Date.now() });
    localStorage.setItem("comments", JSON.stringify(all));
    form.reset();
    renderComments(id);
  });
}

async function detectTypeAndLoad(id) {
  try {
    const [movie, tv] = await Promise.all([
      tmdb("movie/" + encodeURIComponent(id)),
      tmdb("tv/" + encodeURIComponent(id))
    ]);
    if (movie?.id && movie.title) {
      currentType = "movie";
      await renderMovie(movie);
    } else if (tv?.id && tv.name) {
      currentType = "tv";
      await renderTV(tv);
    } else {
      container.innerHTML = "<p>Content not found.</p>";
    }
  } catch (error) {
    console.error(error);
    container.innerHTML = "<p>Unable to load this title right now.</p>";
  }
}

async function commonDetails(type, id) {
  const [details, videos, credits, similar] = await Promise.all([
    tmdb(type + "/" + id),
    tmdb(type + "/" + id + "/videos"),
    tmdb(type + "/" + id + "/credits"),
    tmdb(type + "/" + id + "/similar", { page: moreLikePage })
  ]);
  return { details, videos, credits, similar };
}

function trailerMarkup(videos) {
  const trailer = (videos.results || []).find((v) => v.type === "Trailer" && v.site === "YouTube");
  return trailer
    ? `<iframe title="Trailer" width="100%" height="400" src="https://www.youtube.com/embed/${encodeURIComponent(trailer.key)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
    : "<p>No trailer available.</p>";
}

async function renderMovie(movie) {
  const { details, videos, credits, similar } = await commonDetails("movie", movie.id);
  currentContent = { ...details, media_type: "movie" };
  container.innerHTML = `
    <a href="home.html" class="watch-btn">← Back to Home</a>
    <div class="movie-detail">
      <h1 class="movie-title">${escapeHtml(details.title)}</h1>
      <p class="movie-meta">${escapeHtml(details.release_date || "Release date unavailable")} · ${details.runtime || "?"} min · ${escapeHtml((details.genres || []).map(g => g.name).join(", "))}</p>
      <p class="movie-description">${escapeHtml(details.overview || "No description available.")}</p>
      <h3>Trailer</h3><div class="video-frame">${trailerMarkup(videos)}</div>
      <h3>Cast</h3>${renderCast(credits.cast)}
      <h3>More Like This</h3>
      <div class="movies-content" id="similar-container">${renderSimilar(similar.results)}</div>
      <button class="watch-btn" id="load-more">Load More</button>
      <div class="btn-row">
        <button class="watch-btn" id="add-watch-later">Add to Watch Later</button>
        <button class="watch-btn" id="add-favorites">Add to Favorites</button>
      </div>
      <div class="comment-section">
        <h3>User Comments</h3><div id="comments-container"></div>
        <form id="comment-form">
          <input name="username" type="text" placeholder="Your Name" maxlength="80" required>
          <textarea name="comment" placeholder="Add your comment..." maxlength="1000" required></textarea>
          <button type="submit" class="watch-btn">Post Comment</button>
        </form>
      </div>
    </div>`;
  bindPage(details.id);
}

async function renderTV(tv) {
  const { details, videos, credits, similar } = await commonDetails("tv", tv.id);
  currentContent = { ...details, media_type: "tv" };
  const seasons = (details.seasons || []).filter((season) => season.season_number > 0);
  container.innerHTML = `
    <a href="home.html" class="watch-btn">← Back to Home</a>
    <div class="movie-detail">
      <h1 class="movie-title">${escapeHtml(details.name)}</h1>
      <p class="movie-meta">${escapeHtml(details.first_air_date || "Release date unavailable")} · ${escapeHtml((details.genres || []).map(g => g.name).join(", "))}</p>
      <p class="movie-description">${escapeHtml(details.overview || "No description available.")}</p>
      <h3>Trailer</h3><div class="video-frame">${trailerMarkup(videos)}</div>
      <h3>Cast</h3>${renderCast(credits.cast)}
      <h3>Seasons</h3>
      <select id="season-selector">${seasons.map(s => `<option value="${s.season_number}">${escapeHtml(s.name)} (Season ${s.season_number})</option>`).join("")}</select>
      <h3>More Like This</h3>
      <div class="movies-content" id="similar-container">${renderSimilar(similar.results)}</div>
      <button class="watch-btn" id="load-more">Load More</button>
      <div class="btn-row">
        <button class="watch-btn" id="add-watch-later">Add to Watch Later</button>
        <button class="watch-btn" id="add-favorites">Add to Favorites</button>
      </div>
      <div class="comment-section">
        <h3>User Comments</h3><div id="comments-container"></div>
        <form id="comment-form">
          <input name="username" type="text" placeholder="Your Name" maxlength="80" required>
          <textarea name="comment" placeholder="Add your comment..." maxlength="1000" required></textarea>
          <button type="submit" class="watch-btn">Post Comment</button>
        </form>
      </div>
    </div>`;
  bindPage(details.id);
}

function bindPage(id) {
  bindSimilar();
  renderComments(id);
  bindComments(id);
  document.getElementById("load-more")?.addEventListener("click", async () => {
    moreLikePage++;
    try {
      const data = await tmdb(currentType + "/" + id + "/similar", { page: moreLikePage });
      const box = document.getElementById("similar-container");
      if (box) box.insertAdjacentHTML("beforeend", renderSimilar(data.results));
      bindSimilar();
    } catch (error) { console.error(error); }
  });
  document.getElementById("add-watch-later")?.addEventListener("click", () => {
    alert(storeList("watchLater", currentContent) ? "Added to Watch Later." : "Already in Watch Later.");
  });
  document.getElementById("add-favorites")?.addEventListener("click", () => {
    alert(storeList("favorites", currentContent) ? "Added to Favorites." : "Already in Favorites.");
  });
}

if (container) {
  if (contentId) detectTypeAndLoad(contentId);
  else container.innerHTML = "<p>No content selected.</p>";
}
