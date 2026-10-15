import { tmdbApi } from "./tmdb.js";
import { normalizeResults, getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";
import {
  getBecauseYouLiked,
  getContinueWatching,
  getIntentRecommendations,
  getPersonalRecommendations,
  formatProgress
} from "./recommendations.js";
import {
  getFeedback,
  recordBehavior,
  setFeedback,
  invalidateRecommendationCaches
} from "./intelligence.js";
import { parseIntent, intentHasFilters } from "./intent-parser.js";

const $ = id => document.getElementById(id);
let activeType = "all";
let currentItems = [];
let becauseItems = [];
let requestId = 0;
let currentIntent = parseIntent("");

function intentForPage() {
  const intent = parseIntent($("intent-query")?.value || "");
  if (activeType === "anime") {
    intent.mediaType = "tv";
    intent.anime = true;
    intent.language = "ja";
    intent.genre = { key: "animation", name: "Animation", movieId: 16, tvId: 16 };
    intent.genreIds = { movie: 16, tv: 16 };
    intent.constraints = [...new Set([...intent.constraints, "Anime", "Japanese-language", "Animation"])];
  } else if (activeType !== "all") {
    intent.mediaType = activeType;
    intent.constraints = [...new Set([...intent.constraints, activeType === "movie" ? "Movies" : "TV series"])];
  }
  return intent;
}

function showStatus(message) {
  const status = $("recommendation-status");
  if (status) {
    status.hidden = !message;
    status.textContent = message || "";
  }
}

function renderIntent(intent) {
  const summary = $("intent-summary");
  const chips = $("intent-chips");
  const limitations = $("intent-limitations");
  const hasVisibleIntent = Boolean(intent.constraints?.length || intent.unsupported?.length);
  summary.hidden = !hasVisibleIntent;
  chips.innerHTML = (intent.constraints || []).map(value => '<span class="vivid-intent-chip">' + escapeHtml(value) + "</span>").join("");
  limitations.hidden = !(intent.unsupported || []).length;
  limitations.textContent = (intent.unsupported || []).length ? (intent.unsupported || []).join(" ") + " Vivid has not applied these details as filters." : "";
}

function cardMarkup(item, index, compact = false) {
  const title = item.title || item.name || "Untitled";
  const poster = getImageUrl(item.poster_path || item.raw?.poster_path, "w342");
  const year = item.year || String(item.date || item.raw?.release_date || item.raw?.first_air_date || "").slice(0, 4);
  const rating = Number(item.vote_average || item.raw?.vote_average || 0);
  const mediaLabel = item.media_type === "tv" ? "Series" : "Movie";
  const feedback = getFeedback(item);
  const href = getMediaUrl(item);
  const reason = item.recommendationReason || (item.sourceLabel === "trending" ? "A popular place to start" : "Picked for you");
  return `<article class="vivid-for-you-card${compact ? " vivid-for-you-card-compact" : ""}">
    <a class="vivid-for-you-poster" href="${escapeHtml(href)}" data-open-index="${index}" aria-label="Explore ${escapeHtml(title)}">
      <img src="${escapeHtml(poster)}" alt="Poster for ${escapeHtml(title)}" loading="lazy" decoding="async">
      ${rating > 0 ? '<span class="vivid-for-you-rating"><i class="bi bi-star-fill" aria-hidden="true"></i> ' + rating.toFixed(1) + "</span>" : ""}
    </a>
    <div class="vivid-for-you-card-body">
      <h3 class="vivid-for-you-card-title">${escapeHtml(title)}</h3>
      <p class="vivid-for-you-card-meta">${escapeHtml(mediaLabel)}${year ? " · " + escapeHtml(year) : ""}</p>
      <p class="vivid-for-you-card-reason">${escapeHtml(reason)}</p>
      <div class="vivid-for-you-card-actions">
        <button type="button" data-feedback="like" data-index="${index}" class="${feedback === "like" ? "is-active" : ""}" aria-pressed="${feedback === "like"}" aria-label="More like ${escapeHtml(title)}"><i class="bi bi-hand-thumbs-up" aria-hidden="true"></i><span>More like</span></button>
        <button type="button" data-feedback="not_for_me" data-index="${index}" class="${feedback === "not_for_me" ? "is-active" : ""}" aria-pressed="${feedback === "not_for_me"}" aria-label="Not for me: ${escapeHtml(title)}"><i class="bi bi-hand-thumbs-down" aria-hidden="true"></i><span>Not for me</span></button>
      </div>
    </div>
  </article>`;
}

function renderItems(items) {
  const grid = $("recommendation-grid");
  currentItems = items;
  grid.innerHTML = items.map((item, index) => cardMarkup(item, index)).join("");
  $("recommendation-empty").hidden = items.length > 0;
  if (items.length) {
    items.slice(0, 12).forEach(item => recordBehavior("recommendation_impression", item, { surface: "for_you" }));
    showStatus(items.length + (items.length === 1 ? " pick ready." : " picks ready."));
  } else {
    showStatus("");
  }
}

async function loadSecondarySections() {
  const continueItems = getContinueWatching(6);
  $("continue-section").hidden = !continueItems.length;
  $("continue-grid").innerHTML = continueItems.map(item => {
    const title = item.title || item.name || "Continue watching";
    const poster = getImageUrl(item.poster_path || item.raw?.poster_path, "w185");
    const percentage = Math.max(0, Math.min(100, Number(item.percentage) || 0));
    const href = getMediaUrl({ id: item.id, media_type: item.media_type || "movie" });
    return `<a class="vivid-for-you-continue-card" href="${escapeHtml(href)}">
      <img src="${escapeHtml(poster)}" alt="" loading="lazy" decoding="async">
      <span class="vivid-for-you-continue-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(item.media_type === "tv" ? "Series" : "Movie")} · ${escapeHtml(formatProgress(item))} complete</span><span class="vivid-for-you-progress"><span style="width:${percentage}%"></span></span></span>
    </a>`;
  }).join("");

  try {
    becauseItems = await getBecauseYouLiked(8);
    $("because-section").hidden = !becauseItems.length;
    $("because-grid").innerHTML = becauseItems.map((item, index) => cardMarkup(item, index, true)).join("");
  } catch {
    $("because-section").hidden = true;
    $("because-grid").innerHTML = "";
  }
}

async function loadRecommendations({ refresh = false } = {}) {
  const thisRequest = ++requestId;
  const intent = intentForPage();
  currentIntent = intent;
  renderIntent(intent);
  $("recommendation-error").hidden = true;
  $("recommendation-empty").hidden = true;
  $("recommendation-grid").innerHTML = "";
  showStatus("Finding picks that fit…");
  $("recommendation-heading").textContent = intent.constraints.length ? "Matches for your mood" : "Picks for your next watch";
  $("recommendation-copy").textContent = intent.constraints.length
    ? "These results use catalogue filters we can verify."
    : "A mix of familiar taste and something new to discover.";

  try {
    if (refresh) invalidateRecommendationCaches();
    let items;
    if (intentHasFilters(intent)) {
      items = await getIntentRecommendations(intent, 24);
    } else {
      items = await getPersonalRecommendations(24);
      if (!items.length) {
        const response = await tmdbApi.trending("all", "week", 1);
        items = normalizeResults(response?.results || []).map(item => ({
          ...item,
          sourceLabel: "trending",
          recommendationReason: "A popular starting point — like a few titles to shape your picks"
        }));
      }
    }
    if (thisRequest !== requestId) return;
    renderItems(items);
    if (!items.length) {
      $("recommendation-empty").hidden = false;
      showStatus("");
    }
    await loadSecondarySections();
  } catch (error) {
    if (thisRequest !== requestId) return;
    console.error("Vivid For You recommendations failed:", error);
    showStatus("");
    $("recommendation-grid").innerHTML = "";
    $("recommendation-empty").hidden = true;
    $("recommendation-error").hidden = false;
  }
}

function setActiveType(type) {
  activeType = type;
  document.querySelectorAll("[data-type]").forEach(button => {
    const active = button.dataset.type === type;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  $("intent-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const parsed = parseIntent($("intent-query").value);
    if (parsed.anime) setActiveType("anime");
    else if (parsed.mediaType !== "all") setActiveType(parsed.mediaType);
    else setActiveType("all");
    void loadRecommendations();
  });

  document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => {
    $("intent-query").value = button.dataset.example || "";
    const parsed = parseIntent($("intent-query").value);
    setActiveType(parsed.anime ? "anime" : parsed.mediaType);
    void loadRecommendations();
  }));

  document.querySelectorAll("[data-type]").forEach(button => button.addEventListener("click", () => {
    setActiveType(button.dataset.type);
    void loadRecommendations();
  }));

  $("clear-intent")?.addEventListener("click", () => {
    $("intent-query").value = "";
    setActiveType("all");
    void loadRecommendations();
  });
  $("refresh-recommendations")?.addEventListener("click", () => void loadRecommendations({ refresh: true }));
  $("retry-recommendations")?.addEventListener("click", () => void loadRecommendations());

  $("recommendation-grid")?.addEventListener("click", event => {
    const button = event.target.closest("[data-feedback]");
    if (button) {
      const item = currentItems[Number(button.dataset.index)];
      if (!item) return;
      const kind = button.dataset.feedback;
      setFeedback(item, kind);
      if (kind === "not_for_me") {
        currentItems = currentItems.filter(candidate => !(candidate.id === item.id && candidate.media_type === item.media_type));
        renderItems(currentItems);
        if (!currentItems.length) void loadRecommendations();
      } else {
        button.classList.toggle("is-active", getFeedback(item) === "like");
        button.setAttribute("aria-pressed", String(getFeedback(item) === "like"));
      }
      return;
    }
    const anchor = event.target.closest("[data-open-index]");
    if (anchor) {
      const item = currentItems[Number(anchor.dataset.openIndex)];
      if (item) recordBehavior("recommendation_clicked", item, { surface: "for_you" });
    }
  });

  $("because-grid")?.addEventListener("click", event => {
    const button = event.target.closest("[data-feedback]");
    if (!button) return;
    const item = becauseItems[Number(button.dataset.index)];
    if (!item) return;
    const kind = button.dataset.feedback;
    setFeedback(item, kind);
    if (kind === "not_for_me") {
      becauseItems = becauseItems.filter(candidate => !(candidate.id === item.id && candidate.media_type === item.media_type));
      $("because-section").hidden = !becauseItems.length;
      $("because-grid").innerHTML = becauseItems.map((candidate, index) => cardMarkup(candidate, index, true)).join("");
    } else {
      button.classList.toggle("is-active", getFeedback(item) === "like");
      button.setAttribute("aria-pressed", String(getFeedback(item) === "like"));
    }
  });

  window.addEventListener("vivid:recommendations-invalidated", () => {
    // Avoid duplicate refreshes while the initial request is still in flight.
    if (document.visibilityState === "visible") void loadRecommendations();
  });
  window.addEventListener("vivid:library-changed", () => void loadRecommendations());
  window.addEventListener("vivid:progress-changed", () => void loadSecondarySections());
  void loadRecommendations();
});
