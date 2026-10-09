import { searchIntelligently, getRecentSearches, rememberSearch, clearRecentSearches } from "./search.js";

const input = document.getElementById("search-page-input");
const clear = document.getElementById("search-page-clear");
const content = document.getElementById("search-page-content");

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[char]));

function resultHref(item) {
  return item.media_type === "tv"
    ? "title.html?id=" + encodeURIComponent(item.id) + "&type=tv"
    : item.media_type === "movie"
      ? "title.html?id=" + encodeURIComponent(item.id) + "&type=movie"
      : "person.html?id=" + encodeURIComponent(item.id);
}

function renderRecent() {
  const recent = getRecentSearches();
  content.innerHTML = recent.length
    ? '<div class="vivid-search-page-label">RECENT SEARCHES</div>' +
      '<div class="vivid-search-recent-grid">' +
      recent.map(q => '<button type="button" data-recent="' + escapeHtml(q) + '"><i class="bi bi-clock-history"></i><span>' + escapeHtml(q) + '</span></button>').join("") +
      '</div><button type="button" class="vivid-search-clear-recent" id="clear-recent">Clear recent searches</button>'
    : '<div class="vivid-search-empty-page"><i class="bi bi-search"></i><strong>Start exploring</strong><span>Search for a movie, series, actor, director, or genre.</span></div>';

  content.querySelectorAll("[data-recent]").forEach(button => {
    button.addEventListener("click", () => {
      input.value = button.dataset.recent;
      void runSearch(button.dataset.recent);
    });
  });
  content.querySelector("#clear-recent")?.addEventListener("click", () => {
    clearRecentSearches();
    renderRecent();
  });
}

function renderResults(items, query) {
  const movies = items.filter(item => item.media_type === "movie");
  const shows = items.filter(item => item.media_type === "tv");
  const people = items.filter(item => item.media_type === "person");

  const renderGroup = (label, group) => !group.length ? "" :
    '<section class="vivid-search-result-group">' +
      '<div class="vivid-search-result-group-head"><h2>' + label + '</h2><span>' + group.length + '</span></div>' +
      '<div class="vivid-search-page-results">' + group.map(item => {
        const title = item.title || "Untitled";
        const meta = item.media_type === "person"
          ? "Person"
          : ((item.year || "—") + " · " + (item.media_type === "tv" ? "TV Series" : "Movie"));
        const image = item.poster_path
          ? "https://image.tmdb.org/t/p/w185" + item.poster_path
          : "icons/vivid-icon.svg";
        return '<a class="vivid-search-page-result" href="' + escapeHtml(resultHref(item)) + '">' +
          '<img src="' + escapeHtml(image) + '" alt="" loading="lazy">' +
          '<span><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(meta) + '</small></span>' +
          '<i class="bi bi-chevron-right"></i></a>';
      }).join("") + '</div></section>';

  content.innerHTML =
    '<div class="vivid-search-page-label">RESULTS FOR “' + escapeHtml(query) + '”</div>' +
    (items.length
      ? renderGroup("Movies", movies) + renderGroup("TV Shows", shows) + renderGroup("People", people)
      : '<div class="vivid-search-empty-page"><i class="bi bi-search"></i><strong>No matches found</strong><span>Try another title, person, genre, or shorter search.</span></div>');
}

async function runSearch(value) {
  const query = String(value || "").trim();
  if (!query) {
    renderRecent();
    return;
  }
  content.innerHTML = '<div class="vivid-search-loading"><span></span><strong>Searching…</strong></div>';
  try {
    const result = await searchIntelligently(query, { limit: 12 });
    rememberSearch(query);
    renderResults(result.items, query);
  } catch (error) {
    content.innerHTML = '<div class="vivid-search-empty-page"><i class="bi bi-exclamation-circle"></i><strong>Search is temporarily unavailable</strong><span>' + escapeHtml(error?.message || "Please try again.") + '</span></div>';
  }
}

input?.addEventListener("input", event => {
  const value = event.target.value.trim();
  clear.hidden = !value;
  if (!value) renderRecent();
});
input?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    void runSearch(input.value);
  }
});
clear?.addEventListener("click", () => {
  input.value = "";
  clear.hidden = true;
  input.focus();
  renderRecent();
});

renderRecent();
