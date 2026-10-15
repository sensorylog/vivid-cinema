import { searchContent, mergeSearchCatalogueResults } from "./content.js";
import { tmdbApi } from "./tmdb.js";
import { normalizeResults } from "./media.js";
import { parseIntent } from "./intent-parser.js";
import { getTasteProfile, getNotForMeKeys } from "./intelligence.js";

const RECENT_KEY = "vivid:search:recent:v1";
const MAX_RECENT = 8;

const GENRE_HINTS = Object.freeze({
  action: [28], adventure: [12], animation: [16], comedy: [35], crime: [80],
  documentary: [99], drama: [18], horror: [27], mystery: [9648], romance: [10749],
  "science fiction": [878], "sci fi": [878], fantasy: [14], thriller: [53],
  war: [10752], western: [37], family: [10751], history: [36], music: [10402],
  "tv movie": [10770]
});

const TYPE_HINTS = Object.freeze({
  movie: "movie", movies: "movie", film: "movie", films: "movie",
  tv: "tv", series: "tv", show: "tv", shows: "tv", drama: null
});

function normalizeQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function readRecent() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value) ? value.filter(Boolean).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRecent(items) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT))); } catch {}
}

export function getRecentSearches() {
  return readRecent();
}

export function rememberSearch(query) {
  const q = normalizeQuery(query);
  if (q.length < 2) return;
  const next = [q, ...readRecent().filter(item => item.toLowerCase() !== q.toLowerCase())];
  writeRecent(next);
}

export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY); } catch {}
}

export function getSearchIntent(query) {
  const q = normalizeQuery(query).toLowerCase();
  const genres = Object.entries(GENRE_HINTS)
    .filter(([label]) => q.includes(label))
    .flatMap(([, ids]) => ids)
    .filter((id, index, list) => list.indexOf(id) === index);
  const type = Object.entries(TYPE_HINTS).find(([label]) => new RegExp("\\b" + label + "\\b").test(q))?.[1] || null;
  const similarity = q.match(/(?:like|similar to|similar)\\s+(.+)$/i)?.[1]?.trim() || "";
  const people = /\b(actor|actress|director|creator|cast)\b/.test(q);
  return { query: normalizeQuery(query), genres, type, similarity, people };
}

function tokens(value) {
  return normalizeQuery(value).toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 1);
}

function tokenOverlap(queryTokens, title) {
  const titleTokens = new Set(tokens(title));
  return queryTokens.reduce((score, token) => score + (titleTokens.has(token) ? 1 : 0), 0);
}

export function isStructuredSearchIntent(intent = {}, query = "") {
  const q = normalizeQuery(query).toLowerCase();
  const typeOnlyQuery = q
    .replace(/\b(?:movie|movies|film|films|tv|series|show|shows)\b/g, " ")
    .replace(/[\s,]+/g, " ")
    .trim();
  return Boolean(
    intent.genre || intent.year || intent.language || intent.runtimeMax || intent.anime ||
    (intent.mediaType !== "all" && !typeOnlyQuery)
  );
}

export function buildStructuredSearchParams(intent = {}, type, page = 1) {
  if (type !== "movie" && type !== "tv") return null;
  const genreId = intent.genreIds?.[type] ??
    intent.genre?.[type === "movie" ? "movieId" : "tvId"];
  // Never silently broaden a genre that the catalogue cannot filter for this type.
  if (intent.genre && !genreId) return null;

  const params = {
    page: Math.max(1, Math.min(500, Number(page) || 1)),
    sort_by: "popularity.desc",
    include_adult: false
  };
  if (genreId) params.with_genres = String(genreId);
  if (intent.runtimeMax) params["with_runtime.lte"] = String(Math.max(1, Number(intent.runtimeMax)));
  if (intent.year) {
    params[type === "movie" ? "primary_release_year" : "first_air_date_year"] = String(intent.year);
  }
  if (intent.language) params.with_original_language = String(intent.language);
  if (intent.anime) {
    params.with_original_language = "ja";
    if (type === "tv") params.with_origin_country = "JP";
  }
  return params;
}

export function matchesStructuredSearchIntent(item = {}, intent = {}) {
  const type = item.media_type;
  if (type !== "movie" && type !== "tv") return false;
  if (["movie", "tv"].includes(intent.mediaType) && type !== intent.mediaType) return false;

  const raw = item.raw || item;
  const genreId = intent.genreIds?.[type] ??
    intent.genre?.[type === "movie" ? "movieId" : "tvId"];
  if (intent.genre && (!genreId || !(raw.genre_ids || item.genre_ids || []).map(Number).includes(Number(genreId)))) {
    return false;
  }
  if (intent.year) {
    const date = String(raw.release_date || raw.first_air_date || item.date || "").slice(0, 4);
    if (date !== String(intent.year)) return false;
  }
  if (intent.language && String(raw.original_language || "") !== String(intent.language)) return false;
  if (intent.runtimeMax) {
    const runtimes = type === "tv"
      ? (Array.isArray(raw.episode_run_time) ? raw.episode_run_time : [])
      : [raw.runtime];
    const known = runtimes.map(Number).filter(value => Number.isFinite(value) && value > 0);
    if (!known.length || !known.some(value => value <= Number(intent.runtimeMax))) return false;
  }
  if (intent.anime && type === "tv" &&
      !(raw.origin_country || []).includes("JP")) return false;
  return true;
}

export async function rankSearchResults(items, query, options = {}) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const intent = getSearchIntent(q);
  const taste = await getTasteProfile().catch(() => ({ genres: {} }));
  const notForMe = getNotForMeKeys();
  const queryTokens = tokens(q.replace(/\b(?:movies?|films?|series|shows?)\b/gi, ""));
  const exact = q.toLowerCase();

  const ranked = items
    .filter(item => !notForMe.has(item.content_id))
    .map((item, index) => {
      const title = String(item.title || "").toLowerCase();
      const raw = item.raw || {};
      const originalTitle = String(raw.original_title || raw.original_name || "").toLowerCase();
      let score = Math.max(0, 60 - index);
      if (title === exact || originalTitle === exact) score += 120;
      else if (title.startsWith(exact) || originalTitle.startsWith(exact)) score += 70;
      else if (title.includes(exact) || originalTitle.includes(exact)) score += 35;
      score += Math.max(tokenOverlap(queryTokens, item.title), tokenOverlap(queryTokens, originalTitle)) * 18;
      if (intent.type && item.media_type === intent.type) score += 24;
      if (intent.genres.some(id => (raw.genre_ids || []).includes(id))) score += 28;
      const tasteGenres = Object.keys(taste.genres || {});
      const matchedTaste = (raw.genre_ids || []).filter(id => tasteGenres.includes(String(id))).length;
      score += Math.min(24, matchedTaste * 8);
      score += Math.min(12, Number(raw.popularity || 0) / 20);
      if (item.media_type === "person" && intent.people) score += 20;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.item);

  return ranked.slice(0, Number(options.limit || 8));
}

export async function searchIntelligently(query, options = {}) {
  const q = normalizeQuery(query);
  if (!q) return { items: [], intent: getSearchIntent(""), recent: getRecentSearches() };
  const page = Math.max(1, Math.min(500, Number(options.page || 1)));
  const parsed = parseIntent(q);
  const structured = isStructuredSearchIntent(parsed, q);
  const calls = [searchContent(q, page)];

  if (structured) {
    const types = ["movie", "tv"].filter(type =>
      parsed.mediaType === "all" || parsed.mediaType === type
    );
    for (const type of types) {
      const params = buildStructuredSearchParams(parsed, type, page);
      if (!params) continue;
      calls.push((type === "tv" ? tmdbApi.discoverTv(params) : tmdbApi.discoverMovies(params))
        .then(response => normalizeResults(response?.results || [], type)));
    }
  }

  const responses = await Promise.allSettled(calls);
  const successful = responses.filter(result => result.status === "fulfilled");
  if (!successful.length) {
    throw responses.find(result => result.status === "rejected")?.reason ||
      new Error("Catalogue search is temporarily unavailable.");
  }

  const textItems = responses[0]?.status === "fulfilled" ? responses[0].value : [];
  const discovered = responses.slice(1).flatMap(result =>
    result.status === "fulfilled" ? result.value : []
  );
  const relevantTextItems = structured
    ? textItems.filter(item => matchesStructuredSearchIntent(item, parsed))
    : textItems;
  // Structured discovery is the primary source for filter queries. Text search
  // supplements it only when the returned metadata verifies the requested filters.
  const items = structured
    ? mergeSearchCatalogueResults([discovered, relevantTextItems])
    : mergeSearchCatalogueResults([textItems]);

  // Search must remain useful even if personalization/taste data is unavailable.
  // Catalogue results are the source of truth; ranking is an enhancement.
  let ranked = items;
  try {
    ranked = await rankSearchResults(items, q, options);
  } catch {
    ranked = items.slice(0, Number(options.limit || 8));
  }
  return { items: ranked, intent: { ...getSearchIntent(q), structured: structured ? parsed : null }, recent: getRecentSearches() };
}
