import { searchIntelligently, getRecentSearches, getRecentSearchOwner, rememberSearch, clearRecentSearches } from "./search.js";

const input = document.getElementById("search-page-input");
const clear = document.getElementById("search-page-clear");
const content = document.getElementById("search-page-content");
const PAGE_SIZE = 12;
let currentQuery = "";
let currentPage = 1;
let currentItems = [];
let currentSearchNotes = [];
let currentSimilarityTarget = null;
let currentPersonTarget = null;
let currentProviderTarget = null;
let currentSearchHistoryOwner = null;

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

function renderResults(items, query, canLoadMore = false, notes = currentSearchNotes, similarityTarget = currentSimilarityTarget, personTarget = currentPersonTarget, providerTarget = currentProviderTarget) {
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

  const notesMarkup = notes.length
    ? '<aside class="vivid-search-filter-note" role="status"><strong>Search limitations</strong><ul>' +
      notes.map(note => '<li>' + escapeHtml(note) + '</li>').join("") +
      '</ul></aside>'
    : '';
  const personRoleLabels = {
    actor: "FEATURING",
    director: "DIRECTED BY",
    director_writer: "WRITTEN AND DIRECTED BY",
    writer: "WRITTEN BY",
    creator: "CREATED BY",
    producer: "PRODUCED BY"
  };
  const resultHeading = similarityTarget?.title
    ? 'SIMILAR TO “' + escapeHtml(similarityTarget.title) + '”'
    : personTarget?.name
      ? escapeHtml(personRoleLabels[personTarget.role] || "CREDITS FOR") + ' “' + escapeHtml(personTarget.name) + '”'
      : providerTarget?.name
        ? 'STREAMING ON ' + escapeHtml(providerTarget.name) + ' IN ' + escapeHtml(providerTarget.regionLabel || providerTarget.region)
        : 'RESULTS FOR “' + escapeHtml(query) + '”';
  content.innerHTML =
    '<div class="vivid-search-page-label">' + resultHeading + '</div>' +
    notesMarkup +
    (items.length
      ? renderGroup("Movies", movies) + renderGroup("TV Shows", shows) + renderGroup("People", people)
      : '<div class="vivid-search-empty-page"><i class="bi bi-search"></i><strong>No matches found</strong><span>Try another title, person, genre, or shorter search.</span></div>') +
    (canLoadMore ? '<div class="vivid-search-load-more-wrap"><button type="button" class="vivid-search-load-more" data-search-load-more>Load more results</button></div>' : '');
  content.querySelector("[data-search-load-more]")?.addEventListener("click", () => {
    void runSearch(query, { append: true });
  });
}

async function runSearch(value, { append = false } = {}) {
  const query = String(value || "").trim();
  const searchOwnerAtStart = getRecentSearchOwner();
  if (!query) {
    renderRecent();
    return;
  }
  if (!append) {
    currentQuery = query;
    currentPage = 1;
    currentItems = [];
    currentPersonTarget = null;
    currentSimilarityTarget = null;
    currentProviderTarget = null;
    content.innerHTML = '<div class="vivid-search-loading"><span></span><strong>Searching…</strong></div>';
  } else {
    if (query !== currentQuery) return;
    const loadButton = content.querySelector("[data-search-load-more]");
    if (loadButton) {
      loadButton.disabled = true;
      loadButton.textContent = "Loading…";
    }
  }
  const requestedPage = append ? currentPage + 1 : 1;
  try {
    const result = await searchIntelligently(query, { limit: PAGE_SIZE, page: requestedPage });
    if (query !== currentQuery) return;
    if (!append) rememberSearch(query, searchOwnerAtStart);
    const pageItems = result.items || [];
    currentSearchNotes = result.intent?.filters?.unsupported || [];
    currentSimilarityTarget = result.intent?.similarityTarget || null;
    currentPersonTarget = result.intent?.personTarget || null;
    currentProviderTarget = result.intent?.providerTarget || null;
    const identities = new Set(currentItems.map(item => item.media_type + ":" + item.id));
    const newItems = pageItems.filter(item => !identities.has(item.media_type + ":" + item.id));
    currentItems = [...currentItems, ...newItems];
    currentPage = requestedPage;
    renderResults(currentItems, query, pageItems.length >= PAGE_SIZE, currentSearchNotes, currentSimilarityTarget, currentPersonTarget, currentProviderTarget);
  } catch (error) {
    if (append && currentItems.length) {
      renderResults(currentItems, query, true, currentSearchNotes, currentSimilarityTarget, currentPersonTarget, currentProviderTarget);
      const loadButton = content.querySelector("[data-search-load-more]");
      if (loadButton) loadButton.textContent = "Try loading more";
    } else {
      content.innerHTML = '<div class="vivid-search-empty-page"><i class="bi bi-exclamation-circle"></i><strong>Search is temporarily unavailable</strong><span>' + escapeHtml(error?.message || "Please try again.") + '</span></div>';
    }
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

window.addEventListener("vivid:search-history-ready", event => {
  const nextOwner = event.detail?.owner || "guest";
  const changedOwner = currentSearchHistoryOwner !== null && currentSearchHistoryOwner !== nextOwner;
  currentSearchHistoryOwner = nextOwner;
  if (changedOwner) {
    currentQuery = "";
    currentPage = 1;
    currentItems = [];
    currentSearchNotes = [];
    currentSimilarityTarget = null;
    currentProviderTarget = null;
    if (input) input.value = "";
    if (clear) clear.hidden = true;
    content.innerHTML = "";
  }
  if (!currentQuery && !input?.value.trim()) renderRecent();
});
