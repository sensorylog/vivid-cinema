import { tmdbApi } from "./tmdb.js";
import { getLocalLibrary } from "./library.js";
import { normalizeResults } from "./media.js";

const PROGRESS_KEY = "vivid:progress:v1";

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

export async function getPersonalRecommendations(limit = 12) {
  const library = getLocalLibrary();
  const seeds = [...(library.history || []), ...(library.favorites || []), ...(library.watchLater || [])]
    .filter((item, index, list) => list.findIndex((entry) => entry.media_type + ":" + entry.id === item.media_type + ":" + item.id) === index)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, 3);

  if (!seeds.length) return [];

  const responses = await Promise.allSettled(seeds.map((seed) =>
    seed.media_type === "tv"
      ? tmdbApi.tvRecommendations(seed.id)
      : tmdbApi.movieRecommendations(seed.id)
  ));

  const seen = new Set();
  const recommendations = [];
  responses.forEach((result) => {
    if (result.status !== "fulfilled") return;
    normalizeResults(result.value.results || []).forEach((item) => {
      const key = item.media_type + ":" + item.id;
      if (seen.has(key)) return;
      if (seeds.some((seed) => seed.media_type + ":" + seed.id === key)) return;
      seen.add(key);
      recommendations.push(item);
    });
  });

  return recommendations
    .sort((a, b) => Number(b.vote_average || 0) - Number(a.vote_average || 0))
    .slice(0, limit);
}
