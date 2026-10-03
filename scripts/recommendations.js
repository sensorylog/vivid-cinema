import { tmdbApi } from "./tmdb.js";
import { getLocalLibrary } from "./library.js";
import { normalizeResults } from "./media.js";

const PROGRESS_KEY = "vivid:progress:v1";
const FOR_YOU_CACHE_KEY = "vivid:for-you:v1";
const FOR_YOU_CACHE_TTL = 30 * 60 * 1000;

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeProgress(value) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("vivid:progress-changed", { detail: value }));
}

export function getPlaybackProgress(contentId) {
  const item = readProgress()[contentId];
  return item && Number(item.progress) > 0 ? item : null;
}

export function savePlaybackProgress(contentId, data = {}) {
  if (!contentId) return;
  const current = readProgress();
  const progress = Math.max(0, Number(data.progress) || 0);
  const duration = Math.max(0, Number(data.duration) || 0);
  const percentage = duration ? Math.min(100, (progress / duration) * 100) : 0;
  current[contentId] = {
    ...current[contentId],
    ...data,
    progress,
    duration,
    percentage,
    updatedAt: Date.now()
  };
  writeProgress(current);
}

export function removePlaybackProgress(contentId) {
  const current = readProgress();
  delete current[contentId];
  writeProgress(current);
}

export function getContinueWatching(limit = 10) {
  return Object.entries(readProgress())
    .map(([contentId, item]) => ({ ...item, content_id: contentId }))
    .filter((item) => Number(item.progress) > 5 && Number(item.duration) > 0 && Number(item.percentage) < 92)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, limit);
}

export function formatProgress(item) {
  const percentage = Math.max(0, Math.min(100, Number(item?.percentage) || 0));
  return Math.round(percentage) + "%";
}

function tasteWeight(item, progress, base) {
  const pct = Number(progress[keyFor(item)]?.percentage || item.completion || 0);
  const completion = pct >= 80 ? 1.45 : pct >= 45 ? 1.1 : pct > 5 ? .72 : 1;
  const age = Math.max(0, (Date.now() - Number(item.updatedAt || 0)) / 86400000);
  return base * (0.55 + 0.45 * Math.exp(-age / 45)) * completion;
}
function keyFor(item) {
  return String(item?.media_type || item?.mediaType || "movie") + ":" + String(item?.id);
}
function readForYouCache() {
  try { return JSON.parse(localStorage.getItem(FOR_YOU_CACHE_KEY)); } catch { return null; }
}
function writeForYouCache(value) {
  try { localStorage.setItem(FOR_YOU_CACHE_KEY, JSON.stringify(value)); } catch {}
}
function rankForYou(candidates, profile, excluded, limit) {
  const ranked = candidates.filter(item => !excluded.has(keyFor(item))).map(item => {
    const genres = new Set(item.genre_ids || []);
    const genreScore = Object.entries(profile.genres).reduce((sum, [id, weight]) => sum + (genres.has(Number(id)) ? weight : 0), 0);
    const media = profile.media[item.media_type || "movie"] || 0;
    const quality = Math.min(1, Number(item.vote_average || 0) / 10);
    const popularity = Math.min(1, Math.log10(1 + Math.max(0, Number(item.popularity || 0))) / 4);
    return { item, score: genreScore * 5.2 + media * 1.8 + quality * 1.7 + popularity * 1.1 };
  }).sort((a, b) => b.score - a.score);
  const out = [], genres = new Map(), types = { movie: 0, tv: 0 };
  for (const {item} of ranked) {
    if (out.length >= limit) break;
    const type = item.media_type || "movie";
    const genre = (item.genre_ids || []).find(id => profile.genres[id]);
    if (genre && (genres.get(genre) || 0) >= 4) continue;
    if (out.length >= 4 && types[type] >= Math.ceil(limit * .75)) continue;
    out.push(item); types[type] = (types[type] || 0) + 1;
    if (genre) genres.set(genre, (genres.get(genre) || 0) + 1);
  }
  return out;
}

export async function getPersonalRecommendations(limit = 12) {
  const library = getLocalLibrary();
  const progress = readProgress();
  const observed = [...(library.history || []), ...(library.favorites || []), ...(library.watchLater || [])];
  const seeds = uniqueByKey(observed).sort((a,b) => (Number(b.updatedAt||0) - Number(a.updatedAt||0))).slice(0, 6);
  if (!seeds.length) return [];

  const libraryKey = [...observed, ...Object.values(progress)].map(keyFor).sort().join("|");
  const cached = readForYouCache();
  if (cached?.libraryKey === libraryKey && Date.now() - Number(cached.updatedAt||0) < FOR_YOU_CACHE_TTL) return (cached.items||[]).slice(0,limit);

  const profile = { genres: {}, media: { movie: 0, tv: 0 } };
  seeds.forEach(item => {
    const base = library.favorites?.some(x => keyFor(x) === keyFor(item)) ? 3.2 : library.history?.some(x => keyFor(x) === keyFor(item)) ? 2.1 : 1.2;
    profile.media[item.media_type || "movie"] += tasteWeight(item, progress, base);
  });
  const details = await Promise.allSettled(seeds.map(seed => seed.media_type === "tv" ? tmdbApi.tvDetailsBasic(seed.id) : tmdbApi.movieDetailsBasic(seed.id)));
  details.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    const weight = tasteWeight(seeds[i], progress, 2);
    (result.value.genres || []).forEach(g => { profile.genres[g.id] = (profile.genres[g.id] || 0) + weight; });
  });

  const topGenres = Object.entries(profile.genres).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id])=>id).join("|");
  const calls = seeds.slice(0,5).map(seed => seed.media_type === "tv" ? tmdbApi.tvRecommendations(seed.id) : tmdbApi.movieRecommendations(seed.id));
  if (topGenres) {
    calls.push(tmdbApi.discoverMovies({with_genres:topGenres,sort_by:"popularity.desc",vote_count_gte:100,page:1}));
    calls.push(tmdbApi.discoverTv({with_genres:topGenres,sort_by:"popularity.desc",vote_count_gte:50,page:1}));
  }
  const responses = await Promise.allSettled(calls);
  const candidates = responses.flatMap(result => result.status === "fulfilled" ? normalizeResults(result.value?.results || []) : []);
  const excluded = new Set(observed.map(keyFor));
  const items = rankForYou(candidates, profile, excluded, limit);
  writeForYouCache({version:1,libraryKey,updatedAt:Date.now(),items});
  try { localStorage.setItem("vivid:taste:v1", JSON.stringify({version:1,updatedAt:Date.now(),genres:profile.genres,media:profile.media})); } catch {}
  return items;
}
