import { getLocalLibrary, upsertLibraryItem, removeLibraryItem } from "./library.js";
import { getAllPlaybackProgress } from "./recommendations.js";
import { auth } from "./firebase.js";
import { getActiveProfileId, initializeProfileFoundation } from "./profiles.js";

const PREFERENCES_KEY = "vivid:anime-premium-preferences:v1";
const PREFERENCES_OWNER_KEY = "vivid:anime-premium-preferences-owner:v1";
const PREFERENCES_SNAPSHOT_PREFIX = "vivid:anime-premium-preferences-snapshot:";
const MEDIA_TYPES = new Set(["movie", "tv"]);
const TRACKS = new Set(["sub", "dub"]);

function normalizeItem(item = {}) {
  const id = String(item.id ?? "").trim();
  const mediaType = String(item.media_type || item.mediaType || "tv").toLowerCase();
  if (!/^\d+$/.test(id) || !MEDIA_TYPES.has(mediaType)) {
    throw new TypeError("Anime library items require a numeric TMDB ID and movie or tv media type.");
  }
  const sourceGenres = Array.isArray(item.genre_ids) ? item.genre_ids : Array.isArray(item.genres) ? item.genres.map(genre => genre?.id) : [];
  const genreIds = [...new Set(sourceGenres.map(Number).filter(value => Number.isInteger(value) && value > 0 && value <= 200000))].slice(0, 20);
  return {
    id,
    media_type: mediaType,
    title: String(item.title || item.name || "Untitled").slice(0, 300),
    year: String(item.year || "").slice(0, 10),
    poster_path: String(item.poster_path || "").slice(0, 500),
    backdrop_path: String(item.backdrop_path || "").slice(0, 500),
    ...(genreIds.length ? { genre_ids: genreIds } : {}),
    ...(typeof item.adult === "boolean" ? { adult: item.adult } : {}),
    ...(typeof item.certification === "string" ? { certification: item.certification.slice(0, 16) } : {}),
    isAnime: true
  };
}

function ensurePreferencesOwner(uid, requestedProfileId = null) {
  const profileId = uid ? (requestedProfileId || getActiveProfileId(uid)) : "guest";
  const nextOwner = uid ? String(uid) + "::" + String(profileId) : "guest";
  const currentOwner = localStorage.getItem(PREFERENCES_OWNER_KEY) || "guest";
  if (currentOwner === nextOwner) return;
  const current = localStorage.getItem(PREFERENCES_KEY);
  if (uid && currentOwner === String(uid) && !localStorage.getItem(PREFERENCES_SNAPSHOT_PREFIX + nextOwner) && current) {
    localStorage.setItem(PREFERENCES_SNAPSHOT_PREFIX + nextOwner, current);
  }
  if (current) localStorage.setItem(PREFERENCES_SNAPSHOT_PREFIX + currentOwner, current);
  const saved = localStorage.getItem(PREFERENCES_SNAPSHOT_PREFIX + nextOwner);
  localStorage.setItem(PREFERENCES_KEY, saved || JSON.stringify({
    track: "sub", autoplayNextEpisode: true, subtitleLanguage: "en", preferredPlayer: "auto", updatedAt: 0
  }));
  localStorage.setItem(PREFERENCES_OWNER_KEY, nextOwner);
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
  ensurePreferencesOwner(auth?.currentUser?.uid || "guest");
  const stored = readStoredPreferences();
  return {
    track: TRACKS.has(stored.track) ? stored.track : "sub",
    autoplayNextEpisode: stored.autoplayNextEpisode !== false,
    subtitleLanguage: String(stored.subtitleLanguage || "en").slice(0, 12),
    preferredPlayer: String(stored.preferredPlayer || "auto").slice(0, 32),
    updatedAt: Number(stored.updatedAt) || 0
  };
}

export function saveAnimeLibraryPreferences(patch = {}) {
  const current = getAnimeLibraryPreferences();
  const next = {
    ...current,
    ...patch,
    track: TRACKS.has(patch.track) ? patch.track : current.track,
    autoplayNextEpisode: patch.autoplayNextEpisode == null ? current.autoplayNextEpisode : Boolean(patch.autoplayNextEpisode),
    subtitleLanguage: String(patch.subtitleLanguage ?? current.subtitleLanguage).slice(0, 12),
    preferredPlayer: String(patch.preferredPlayer ?? current.preferredPlayer).slice(0, 32),
    updatedAt: Date.now()
  };
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("vivid:anime-preferences-changed", { detail: next }));
  if (auth?.currentUser?.uid) void syncAnimePreferencesForUser(auth.currentUser).catch(error => console.warn("Anime preferences cloud sync unavailable:", error));
  return next;
}

let preferencesFirebasePromise = null;
async function getPreferencesFirestore() {
  if (!preferencesFirebasePromise) {
    preferencesFirebasePromise = import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")
      .then(sdk => ({ doc: sdk.doc, getDocFromServer: sdk.getDocFromServer, setDoc: sdk.setDoc }))
      .catch(error => { preferencesFirebasePromise = null; throw error; });
  }
  const { db } = await import("./firebase.js");
  return { db, ...(await preferencesFirebasePromise) };
}

export async function syncAnimePreferencesForUser(user = null) {
  if (!user?.uid || String(auth?.currentUser?.uid || "") !== String(user.uid)) return getAnimeLibraryPreferences();
  await initializeProfileFoundation(user);
  const profileId = getActiveProfileId(user.uid);
  const ownerScope = String(user.uid) + "::" + String(profileId);
  ensurePreferencesOwner(user.uid, profileId);
  const isCurrentProfile = () => String(auth?.currentUser?.uid || "") === String(user.uid) &&
    getActiveProfileId(user.uid) === profileId &&
    localStorage.getItem(PREFERENCES_OWNER_KEY) === ownerScope;
  const { db, doc, getDocFromServer, setDoc } = await getPreferencesFirestore();
  const reference = doc(db, "users", user.uid, "profiles", profileId, "animePreferences", "default");
  const snapshot = await getDocFromServer(reference);
  if (!isCurrentProfile()) return getAnimeLibraryPreferences();
  const local = getAnimeLibraryPreferences();
  if (snapshot.exists()) {
    const remote = snapshot.data() || {};
    if (Number(remote.updatedAt || 0) > Number(local.updatedAt || 0)) {
      const merged = {
        track: TRACKS.has(remote.track) ? remote.track : local.track,
        autoplayNextEpisode: remote.autoplayNextEpisode !== false,
        subtitleLanguage: String(remote.subtitleLanguage || local.subtitleLanguage).slice(0, 12),
        preferredPlayer: String(remote.preferredPlayer || local.preferredPlayer).slice(0, 32),
        updatedAt: Number(remote.updatedAt) || Date.now()
      };
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent("vivid:anime-preferences-changed", { detail: merged }));
      return merged;
    }
  }
  if (!isCurrentProfile()) return getAnimeLibraryPreferences();
  await setDoc(reference, local, { merge: true });
  return local;
}

function isAnime(item) {
  return item?.isAnime === true;
}

function sortRecent(items, field = "lastWatchedAt") {
  return [...(items || [])].filter(isAnime)
    .sort((a, b) => Number(b[field] || b.updatedAt || 0) - Number(a[field] || a.updatedAt || 0));
}

export function getAnimeLibrarySnapshot() {
  const library = getLocalLibrary();
  const titles = [...(library.history || []), ...(library.watchLater || []), ...(library.favorites || []), ...(library.completed || [])];
  const progress = getAllPlaybackProgress().filter(item => item.isAnime === true && Number(item.progress) > 0);
  const withTitle = progress.map(item => {
    const [mediaType, id] = String(item.contentId || "").split(":");
    const title = titles.find(entry => entry.isAnime === true && String(entry.id) === String(item.id || id) && String(entry.media_type) === String(item.media_type || mediaType));
    return { ...(title || {}), ...item, id: String(item.id || id), media_type: item.media_type || mediaType };
  }).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

  return {
    watchlist: sortRecent(library.watchLater),
    favorites: sortRecent(library.favorites),
    history: sortRecent(library.history),
    completed: sortRecent(library.completed),
    continueWatching: withTitle.filter(item => !item.completed),
    completedEpisodes: withTitle.filter(item => item.completed),
    preferences: getAnimeLibraryPreferences()
  };
}

export function addAnimeToWatchlist(item) {
  return upsertLibraryItem("watchLater", normalizeItem(item));
}

export function removeAnimeFromWatchlist(id, mediaType = "tv") {
  return removeLibraryItem("watchLater", String(id), mediaType);
}

export function markAnimeCompleted(item) {
  return upsertLibraryItem("completed", {
    ...normalizeItem(item),
    completion: 100,
    completedAt: Date.now()
  });
}

export function unmarkAnimeCompleted(id, mediaType = "tv") {
  return removeLibraryItem("completed", String(id), mediaType);
}

export function addAnimeFavorite(item) {
  return upsertLibraryItem("favorites", normalizeItem(item));
}

export function removeAnimeFavorite(id, mediaType = "tv") {
  return removeLibraryItem("favorites", String(id), mediaType);
}

if (typeof window !== "undefined") {
  window.addEventListener("vivid:profile-changed", event => {
    const uid = String(event.detail?.uid || "");
    if (!uid || String(auth?.currentUser?.uid || "") !== uid) return;
    ensurePreferencesOwner(uid, event.detail?.profileId || null);
    void syncAnimePreferencesForUser(auth.currentUser).catch(error => {
      console.warn("Vivid profile anime preferences sync unavailable:", error);
    });
  });
}
