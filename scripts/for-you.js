import { tmdbApi } from "./tmdb.js";
import { normalizeResults, getImageUrl, getMediaUrl } from "./media.js";
import { escapeHtml } from "./utils.js";
import {
  getBecauseYouLiked,
  getContinueWatching,
  getIntentRecommendations,
  getPlotMatchRecommendations,
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
import { isPlotDescriptionQuery } from "./plot-search.js";

const $ = id => document.getElementById(id);
let activeType = "all";
let currentItems = [];
let becauseItems = [];
let lastDismissedItem = null;
let requestId = 0;
let removedFilters = new Set();
let suppressInvalidationRefresh = false;
let secondaryRequestId = 0;
let recommendationImpressionObserver = null;
let recallStatusMessage = "";
const LANGUAGE_LABELS = { en: "English", ko: "Korean", ja: "Japanese", fr: "French", es: "Spanish", hi: "Hindi", zh: "Chinese", de: "German", it: "Italian", pt: "Portuguese", th: "Thai", ar: "Arabic", tr: "Turkish", ta: "Tamil", te: "Telugu", yo: "Yoruba" };

function intentForPage() {
  const intent = parseIntent($("intent-query")?.value || "");
  if (activeType === "anime") {
    intent.mediaType = "tv";
    intent.anime = true;
    intent.language = "ja";
    intent.genre = { key: "animation", name: "Animation", movieId: 16, tvId: 16 };
  } else if (activeType !== "all") {
    // Keep an explicit anime-film request as a movie; the Movies chip must not
    // erase its Japanese-language and animation constraints.
    if (intent.anime && (activeType !== "movie" || !/\b(movie|movies|film|films|feature film)\b/i.test(intent.query))) {
      intent.anime = false;
      if (intent.genre?.key === "animation") intent.genre = null;
      if (intent.language === "ja") intent.language = null;
    }
    intent.mediaType = activeType;
  }

  if (removedFilters.has("anime")) {
    intent.anime = false;
    if (intent.genre?.key === "animation") intent.genre = null;
    if (intent.language === "ja") intent.language = null;
    if (intent.mediaType === "tv" && /anime/i.test(intent.query)) intent.mediaType = "all";
  }
  if (removedFilters.has("mediaType")) intent.mediaType = "all";
  if (removedFilters.has("genre")) intent.genre = null;
  if (removedFilters.has("runtime")) intent.runtimeMax = null;
  if (removedFilters.has("year")) intent.year = null;
  if (removedFilters.has("language")) intent.language = null;

  intent.genreIds = intent.genre ? { movie: intent.genre.movieId, tv: intent.genre.tvId } : null;
  intent.unsupported = (intent.unsupported || []).filter(note => !note.startsWith("Catalogue limitation:"));
  if (intent.mediaType !== "movie" && intent.genre?.tvNote && !intent.anime) {
    intent.unsupported.push("Catalogue limitation: " + intent.genre.tvNote);
  }

  const constraints = [];
  if (intent.anime) constraints.push(intent.mediaType === "movie" ? "Anime movies (Japanese-language animation)" : "Anime (Japanese-language animation)");
  else if (intent.mediaType === "movie") constraints.push("Movies");
  else if (intent.mediaType === "tv") constraints.push("TV series");
  if (intent.genre && !intent.anime) constraints.push(intent.mediaType === "tv" && intent.genre.tvLabel ? intent.genre.tvLabel : intent.genre.name);
  if (intent.runtimeMax) {
    const runtimeConstraint = intent.mediaType === "tv"
      ? "Up to " + intent.runtimeMax + " min per episode"
      : intent.mediaType === "all"
        ? "Movies up to " + intent.runtimeMax + " min; TV episodes up to " + intent.runtimeMax + " min"
        : "Up to " + intent.runtimeMax + " min";
    constraints.push(runtimeConstraint);
  }
  if (intent.year) constraints.push(String(intent.year));
  if (intent.language && !intent.anime) constraints.push(LANGUAGE_LABELS[intent.language] || intent.language);
  intent.constraints = [...new Set(constraints)];
  return intent;
}

function intentChipEntries(intent) {
  const entries = [];
  if (intent.anime) entries.push({ key: "anime", label: intent.mediaType === "movie" ? "Anime movies · Japanese" : "Anime · Japanese" });
  else if (intent.mediaType !== "all") entries.push({ key: "mediaType", label: intent.mediaType === "movie" ? "Movies" : "TV series" });
  if (intent.genre && !intent.anime) entries.push({ key: "genre", label: intent.mediaType === "tv" && intent.genre.tvLabel ? intent.genre.tvLabel : intent.genre.name });
  if (intent.runtimeMax) entries.push({ key: "runtime", label: intent.mediaType === "tv" ? "Up to " + intent.runtimeMax + " min / episode" : intent.mediaType === "all" ? "Movies ≤ " + intent.runtimeMax + " min · TV episodes ≤ " + intent.runtimeMax + " min" : "Up to " + intent.runtimeMax + " min" });
  if (intent.year) entries.push({ key: "year", label: String(intent.year) });
  if (intent.language && !intent.anime) entries.push({ key: "language", label: LANGUAGE_LABELS[intent.language] || intent.language });
  return entries;
}

function showFeedbackUndo(item) {
  lastDismissedItem = item;
  $("feedback-undo-copy").textContent = "We will show fewer picks like " + (item.title || item.name || "this title") + ".";
  $("feedback-undo").hidden = false;
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
  const entries = intentChipEntries(intent);
  const hasVisibleIntent = Boolean(entries.length || intent.unsupported?.length);
  summary.hidden = !hasVisibleIntent;
  chips.innerHTML = entries.map(entry => '<button type="button" class="vivid-intent-chip" data-remove-filter="' + entry.key + '" aria-label="Remove ' + escapeHtml(entry.label) + ' filter">' + escapeHtml(entry.label) + '<i class="bi bi-x" aria-hidden="true"></i></button>').join("");
  limitations.hidden = !(intent.unsupported || []).length;
  limitations.textContent = (intent.unsupported || []).join(" ");
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
  return `<article class="vivid-for-you-card${compact ? " vivid-for-you-card-compact" : ""}" data-impression-index="${index}">
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

function clearRecommendationImpressionObserver() {
  recommendationImpressionObserver?.disconnect();
  recommendationImpressionObserver = null;
}

function observeRecommendationImpressions(items) {
  clearRecommendationImpressionObserver();
  const grid = $("recommendation-grid");
  // Without viewability support, do not invent impression events for unseen cards.
  if (!grid || typeof IntersectionObserver !== "function") return;
  const seen = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
      const index = Number(entry.target.dataset.impressionIndex);
      const item = items[index];
      if (item) {
        const identity = (item.media_type || "movie") + ":" + item.id;
        if (!seen.has(identity)) {
          seen.add(identity);
          recordBehavior("recommendation_impression", item, {
            surface: "for_you",
            visibility: "at_least_50_percent"
          });
        }
      }
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.5 });
  recommendationImpressionObserver = observer;
  grid.querySelectorAll("[data-impression-index]").forEach(card => observer.observe(card));
}

function renderItems(items) {
  const grid = $("recommendation-grid");
  clearRecommendationImpressionObserver();
  currentItems = items;
  grid.innerHTML = items.map((item, index) => cardMarkup(item, index)).join("");
  $("recommendation-empty").hidden = items.length > 0;
  if (items.length) {
    observeRecommendationImpressions(items);
    showStatus(recallStatusMessage || (items.length + (items.length === 1 ? " pick ready." : " picks ready.")));
  } else {
    showStatus("");
  }
}

async function loadSecondarySections(expectedRequestId = requestId) {
  const thisSecondaryRequest = ++secondaryRequestId;
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
    const nextBecauseItems = await getBecauseYouLiked(8);
    if (expectedRequestId !== requestId || thisSecondaryRequest !== secondaryRequestId) return;
    becauseItems = nextBecauseItems;
    $("because-section").hidden = !becauseItems.length;
    $("because-grid").innerHTML = becauseItems.map((item, index) => cardMarkup(item, index, true)).join("");
  } catch {
    if (expectedRequestId !== requestId || thisSecondaryRequest !== secondaryRequestId) return;
    $("because-section").hidden = true;
    $("because-grid").innerHTML = "";
  }
}

async function loadRecommendations({ refresh = false } = {}) {
  clearRecommendationImpressionObserver();
  const thisRequest = ++requestId;
  const intent = intentForPage();
  renderIntent(intent);
  $("recommendation-error").hidden = true;
  $("recommendation-empty").hidden = true;
  $("recommendation-grid").innerHTML = "";
  showStatus("Finding picks that fit…");
  recallStatusMessage = "";
  const plotSearch = isPlotDescriptionQuery(intent.query);
  $("recommendation-heading").textContent = plotSearch ? "Titles that may match your memory" : intent.constraints.length ? "Matches for your mood" : "Picks for your next watch";
  $("recommendation-copy").textContent = plotSearch
    ? "Vivid extracts story clues locally, searches TMDB through multiple routes, and ranks candidates by matching plot evidence."
    : intent.constraints.length
      ? "These results use catalogue filters we can verify."
      : "A mix of familiar taste and something new to discover.";

  try {
    if (refresh) {
      suppressInvalidationRefresh = true;
      invalidateRecommendationCaches();
      suppressInvalidationRefresh = false;
    }
    let items;
    if (isPlotDescriptionQuery(intent.query)) {
      items = await getPlotMatchRecommendations(intent, 24);
    } else if (intentHasFilters(intent)) {
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
      showStatus(plotSearch && recallStatusMessage ? recallStatusMessage : "");
    }
    await loadSecondarySections(thisRequest);
  } catch (error) {
    if (thisRequest !== requestId) return;
    console.error("Vivid For You recommendations failed:", error);
    showStatus(recallStatusMessage || "");
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
  window.addEventListener("vivid:plot-search-status", event => {
    const detail = event.detail || {};
    recallStatusMessage = detail.localOnly
      ? "VIVID RECALL · Local clue matching is active; no AI service is required."
      : detail.available
        ? "Catalogue suggestions are being checked against TMDB."
        : "Using Vivid Recall’s local catalogue matcher.";
    showStatus(recallStatusMessage);
  });
  $("intent-form")?.addEventListener("submit", event => {
    event.preventDefault();
    removedFilters.clear();
    const parsed = parseIntent($("intent-query").value);
    if (parsed.anime && parsed.mediaType !== "movie") setActiveType("anime");
    else if (parsed.mediaType !== "all") setActiveType(parsed.mediaType);
    else setActiveType("all");
    void loadRecommendations();
  });

  document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => {
    $("intent-query").value = button.dataset.example || "";
    removedFilters.clear();
    const parsed = parseIntent($("intent-query").value);
    setActiveType(parsed.anime && parsed.mediaType !== "movie" ? "anime" : parsed.mediaType);
    void loadRecommendations();
  }));

  document.querySelectorAll("[data-type]").forEach(button => button.addEventListener("click", () => {
    removedFilters.clear();
    setActiveType(button.dataset.type);
    void loadRecommendations();
  }));

  $("intent-chips")?.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-filter]");
    if (!button) return;
    const filter = button.dataset.removeFilter;
    removedFilters.add(filter);
    if (filter === "anime" || filter === "mediaType") setActiveType("all");
    void loadRecommendations();
  });

  $("clear-intent")?.addEventListener("click", () => {
    $("intent-query").value = "";
    removedFilters.clear();
    setActiveType("all");
    void loadRecommendations();
  });
  $("undo-feedback")?.addEventListener("click", () => {
    const item = lastDismissedItem;
    if (!item) return;
    lastDismissedItem = null;
    $("feedback-undo").hidden = true;
    setFeedback(item, "not_for_me");
  });

  $("refresh-recommendations")?.addEventListener("click", () => void loadRecommendations({ refresh: true }));
  $("retry-recommendations")?.addEventListener("click", () => void loadRecommendations());

  $("recommendation-grid")?.addEventListener("click", event => {
    const button = event.target.closest("[data-feedback]");
    if (button) {
      const item = currentItems[Number(button.dataset.index)];
      if (!item) return;
      const kind = button.dataset.feedback;
      const nextFeedback = setFeedback(item, kind);
      if (kind === "not_for_me" && nextFeedback === "not_for_me") {
        showFeedbackUndo(item);
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
    if (!button) {
      const anchor = event.target.closest("[data-open-index]");
      const item = anchor ? becauseItems[Number(anchor.dataset.openIndex)] : null;
      if (item) recordBehavior("recommendation_clicked", item, { surface: "because_you_liked" });
      return;
    }
    const item = becauseItems[Number(button.dataset.index)];
    if (!item) return;
    const kind = button.dataset.feedback;
    const nextFeedback = setFeedback(item, kind);
    if (kind === "not_for_me" && nextFeedback === "not_for_me") {
      showFeedbackUndo(item);
      becauseItems = becauseItems.filter(candidate => !(candidate.id === item.id && candidate.media_type === item.media_type));
      $("because-section").hidden = !becauseItems.length;
      $("because-grid").innerHTML = becauseItems.map((candidate, index) => cardMarkup(candidate, index, true)).join("");
    } else {
      button.classList.toggle("is-active", getFeedback(item) === "like");
      button.setAttribute("aria-pressed", String(getFeedback(item) === "like"));
    }
  });

  window.addEventListener("vivid:account-switched", () => {
    // Invalidate every in-flight request and clear the previous owner's data
    // before starting a fresh load for the newly active account.
    requestId++;
    secondaryRequestId++;
    clearRecommendationImpressionObserver();
    currentItems = [];
    becauseItems = [];
    lastDismissedItem = null;
    $("intent-query").value = "";
    removedFilters.clear();
    setActiveType("all");
    renderIntent(parseIntent(""));
    $("recommendation-grid").innerHTML = "";
    $("because-grid").innerHTML = "";
    $("continue-grid").innerHTML = "";
    $("continue-section").hidden = true;
    $("because-section").hidden = true;
    $("recommendation-empty").hidden = true;
    $("recommendation-error").hidden = true;
    $("feedback-undo").hidden = true;
    showStatus("Refreshing recommendations for this account…");
    void loadRecommendations();
  });
  window.addEventListener("vivid:recommendations-invalidated", () => {
    if (!suppressInvalidationRefresh && document.visibilityState === "visible") void loadRecommendations();
  });
  window.addEventListener("vivid:library-changed", () => void loadRecommendations());
  window.addEventListener("vivid:progress-changed", () => void loadSecondarySections());
  void loadRecommendations();
});
