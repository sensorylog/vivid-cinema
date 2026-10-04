import { searchContent } from "./content.js";
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
      let score = Math.max(0, 60 - index);
      if (title === exact) score += 120;
      else if (title.startsWith(exact)) score += 70;
      else if (title.includes(exact)) score += 35;
      score += tokenOverlap(queryTokens, item.title) * 18;
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
  const items = await searchContent(q, 1);
  const ranked = await rankSearchResults(items, q, options);
  return { items: ranked, intent: getSearchIntent(q), recent: getRecentSearches() };
}
