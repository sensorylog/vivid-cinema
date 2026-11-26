import { getLocalLibrary, upsertLibraryItem, removeLibraryItem } from "./library.js";
import { getAllPlaybackProgress } from "./recommendations.js";
import { normalizeAnimeTrack, readAnimeTrackPreference, writeAnimeTrackPreference } from "./playback/anime-playback.js";

const PREFERENCES_KEY = "vivid:anime-library-preferences:v1";
const MEDIA_TYPES = new Set(["movie", "tv"]);

function isAnimeItem(item) {
  return item?.isAnime === true;
}

function normalizeAnimeItem(item = {}) {
  const id = String(item.id ?? "").trim();
  const mediaType = String(item.media_type || item.mediaType || "tv").toLowerCase();
  if (!/^\d+$/.test(id) || !MEDIA_TYPES.has(mediaType)) {
    throw new TypeError("Anime library items require a numeric TMDB ID and movie or tv media type.");
  }
  return {
    id,
    media_type: mediaType,
    title: String(item.title || item.name || "Untitled").slice(0, 300),
    year: String(item.year || "").slice(0, 10),
    poster_path: String(item.poster_path || "").slice(0, 500),
    backdrop_path: String(item.backdrop_path || "").slice(0, 500),
    isAnime: true
  };
}

function readStoredPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function getAnimeLibraryPreferences() {
  const stored = readStoredPreferences();
  return {
    track: normalizeAnimeTrack(stored.track || readAnimeTrackPreference()),
    autoplayNextEpisode: stored.autoplayNextEpisode !== false,
    subtitleLanguage: String(stored.subtitleLanguage || "en").slice(0, 12),
    preferredPlayer: String(stored.preferredPlayer || "auto").slice(0, 32)
  };
}

export function saveAnimeLibraryPreferences(patch = {}) {
  const current = getAnimeLibraryPreferences();
  const next = {
    ...current,
    ...patch,
    track: normalizeAnimeTrack(patch.track ?? current.track),
    autoplayNextEpisode: patch.autoplayNextEpisode == null
      ? current.autoplayNextEpisode
      : Boolean(patch.autoplayNextEpisode),
    subtitleLanguage: String(patch.subtitleLanguage ?? current.subtitleLanguage).slice(0, 12),
    preferredPlayer: String(patch.preferredPlayer ?? current.preferredPlayer).slice(0, 32)
  };
  writeAnimeTrackPreference(next.track);
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("vivid:anime-preferences-changed", { detail: next }));
  return next;
}

export function getAnimeLibrarySnapshot() {
  const library = getLocalLibrary();
  const progress = getAllPlaybackProgress()
    .filter(item => item.isAnime === true && Number(item.progress) > 0)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const sortRecent = items => [...items].filter(isAnimeItem)
    .sort((a, b) => Number(b.lastWatchedAt || b.updatedAt || 0) - Number(a.lastWatchedAt || a.updatedAt || 0));

  return {
    watchlist: sortRecent(library.watchLater || []),
    favorites: sortRecent(library.favorites || []),
    history: sortRecent(library.history || []),
    completed: sortRecent(library.completed || []),
    continueWatching: progress.filter(item => !item.completed),
    completedEpisodes: progress.filter(item => item.completed),
    preferences: getAnimeLibraryPreferences()
  };
}

export function addAnimeToWatchlist(item) {
  return upsertLibraryItem("watchLater", normalizeAnimeItem(item));
}

export function removeAnimeFromWatchlist(id, mediaType = "tv") {
  return removeLibraryItem("watchLater", String(id), mediaType);
}

export function markAnimeCompleted(item) {
  return upsertLibraryItem("completed", {
    ...normalizeAnimeItem(item),
    completion: 100,
    completedAt: Date.now()
  });
}

export function unmarkAnimeCompleted(id, mediaType = "tv") {
  return removeLibraryItem("completed", String(id), mediaType);
}

export function addAnimeFavorite(item) {
  return upsertLibraryItem("favorites", normalizeAnimeItem(item));
}

export function removeAnimeFavorite(id, mediaType = "tv") {
  return removeLibraryItem("favorites", String(id), mediaType);
}
