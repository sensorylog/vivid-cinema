import { tmdbApi } from "./tmdb.js";
import { getLocalLibrary } from "./library.js";
import { normalizeResults } from "./media.js";

const PROGRESS_KEY = "vivid:progress:v1";
const FOR_YOU_CACHE_KEY = "vivid:for-you:v1";
const FOR_YOU_CACHE_TTL = 30 * 60 * 1000;
const PROGRESS_SYNC_DEBOUNCE = 1800;

let firebasePromise = null;
let progressSyncPromise = null;
const pendingProgress = new Map();
const progressTimers = new Map();

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

async function getFirebase() {
  if (!firebasePromise) {
    firebasePromise = Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js")
    ]).then(([firebase, authSdk, firestoreSdk]) => ({
      ...firebase,
      onAuthStateChanged: authSdk.onAuthStateChanged,
      collection: firestoreSdk.collection,
      deleteDoc: firestoreSdk.deleteDoc,
      doc: firestoreSdk.doc,
      getDocs: firestoreSdk.getDocs,
      setDoc: firestoreSdk.setDoc
    })).catch(error => {
      firebasePromise = null;
      throw error;
    });
  }
  return firebasePromise;
}

async function getFirebaseAuth() {
  try {
    const { auth } = await getFirebase();
    return auth;
  } catch {
    return null;
  }
}

function progressDocData(contentId, item) {
  const [mediaType = "movie", id = ""] = String(contentId).split(":");
  return {
    id: String(item.id || id),
    media_type: item.media_type || mediaType,
    progress: Math.max(0, Number(item.progress) || 0),
    duration: Math.max(0, Number(item.duration) || 0),
    percentage: Math.max(0, Math.min(100, Number(item.percentage) || 0)),
    season: item.season == null ? null : Math.max(0, Number(item.season) || 0),
    episode: item.episode == null ? null : Math.max(1, Number(item.episode) || 1),
    title: String(item.title || "").slice(0, 300),
    updatedAt: Number(item.updatedAt) || Date.now()
  };
}

async function setRemoteProgress(uid, contentId, item) {
  const { db, doc, setDoc } = await getFirebase();
  await setDoc(
    doc(db, "users", uid, "progress", contentId),
    progressDocData(contentId, item),
    { merge: true }
  );
}

async function deleteRemoteProgress(uid, contentId) {
  const { db, doc, deleteDoc } = await getFirebase();
  await deleteDoc(doc(db, "users", uid, "progress", contentId));
}

function queueRemoteProgress(contentId, item) {
  pendingProgress.set(contentId, { ...item });
  if (progressTimers.has(contentId)) return;
  const timer = window.setTimeout(async () => {
    progressTimers.delete(contentId);
    const pending = pendingProgress.get(contentId);
    pendingProgress.delete(contentId);
    if (!pending) return;
    try {
      const auth = await getFirebaseAuth();
      if (auth?.currentUser) await setRemoteProgress(auth.currentUser.uid, contentId, pending);
    } catch (error) {
      pendingProgress.set(contentId, pending);
      console.warn("Vivid playback progress sync unavailable:", error);
    }
  }, PROGRESS_SYNC_DEBOUNCE);
  progressTimers.set(contentId, timer);
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
  queueRemoteProgress(contentId, current[contentId]);
}

export function removePlaybackProgress(contentId) {
  if (!contentId) return;
  const current = readProgress();
  delete current[contentId];
  writeProgress(current);

  const timer = progressTimers.get(contentId);
  if (timer) {
    window.clearTimeout(timer);
    progressTimers.delete(contentId);
  }
  pendingProgress.delete(contentId);

  void getFirebaseAuth().then(auth => {
    if (auth?.currentUser) return deleteRemoteProgress(auth.currentUser.uid, contentId);
  }).catch(error => console.warn("Vivid remote progress removal unavailable:", error));
}

export async function syncPlaybackProgressForUser(user = null) {
  if (!user) return readProgress();
  try {
    const { db, collection, getDocs } = await getFirebase();
    const snapshot = await getDocs(collection(db, "users", user.uid, "progress"));
    const local = readProgress();
    let changed = false;

    snapshot.docs.forEach(snapshotDoc => {
      const data = snapshotDoc.data() || {};
      const contentId = snapshotDoc.id;
      const remoteUpdated = Number(data.updatedAt) || 0;
      const localUpdated = Number(local[contentId]?.updatedAt) || 0;
      if (remoteUpdated > localUpdated) {
        local[contentId] = {
          ...local[contentId],
          ...data,
          updatedAt: remoteUpdated
        };
        changed = true;
      } else if (localUpdated > remoteUpdated && local[contentId]) {
        queueRemoteProgress(contentId, local[contentId]);
      }
    });

    if (changed) writeProgress(local);
    return local;
  } catch (error) {
    console.warn("Vivid playback progress sync failed:", error);
    return readProgress();
  }
}

export function startPlaybackSync() {
  if (progressSyncPromise) return progressSyncPromise;

  progressSyncPromise = (async () => {
    try {
      const { auth, onAuthStateChanged } = await getFirebase();
      return await new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          unsubscribe?.();
          resolve(value);
        };
        const unsubscribe = onAuthStateChanged(auth, user => {
          if (!user) {
            finish(readProgress());
            return;
          }
          void syncPlaybackProgressForUser(user).then(finish);
        });
      });
    } catch (error) {
      console.warn("Vivid Firebase playback sync unavailable:", error);
      return readProgress();
    }
  })();

  return progressSyncPromise;
}

export function getContinueWatching(limit = 10) {
  return Object.entries(readProgress())
    .map(([contentId, item]) => ({ ...item, content_id: contentId }))
    .filter(item => Number(item.progress) > 5 && Number(item.duration) > 0 && Number(item.percentage) < 92)
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

function uniqueByKey(items) {
  const map = new Map();
  items.forEach(item => map.set(keyFor(item), item));
  return [...map.values()];
}

function readForYouCache() {
  try { return JSON.parse(localStorage.getItem(FOR_YOU_CACHE_KEY)); } catch { return null; }
}

function writeForYouCache(value) {
  try { localStorage.setItem(FOR_YOU_CACHE_KEY, JSON.stringify(value)); } catch {}
}

function rankForYou(candidates, profile, excluded, limit) {
  const ranked = uniqueByKey(candidates).filter(item => !excluded.has(keyFor(item))).map(item => {
    const genres = new Set(item.genre_ids || []);
    const genreScore = Object.entries(profile.genres).reduce((sum, [id, weight]) => sum + (genres.has(Number(id)) ? weight : 0), 0);
    const media = profile.media[item.media_type || "movie"] || 0;
    const quality = Math.min(1, Number(item.vote_average || 0) / 10);
    const popularity = Math.min(1, Math.log10(1 + Math.max(0, Number(item.popularity || 0))) / 4);
    return { item, score: genreScore * 5.2 + media * 1.8 + quality * 1.7 + popularity * 1.1 };
  }).sort((a, b) => b.score - a.score);

  const out = [], genres = new Map(), types = { movie: 0, tv: 0 };
  for (const { item } of ranked) {
    if (out.length >= limit) break;
    const type = item.media_type || "movie";
    const genre = (item.genre_ids || []).find(id => profile.genres[id]);
    if (genre && (genres.get(genre) || 0) >= 4) continue;
    if (out.length >= 4 && types[type] >= Math.ceil(limit * .75)) continue;
    out.push(item);
    types[type] = (types[type] || 0) + 1;
    if (genre) genres.set(genre, (genres.get(genre) || 0) + 1);
  }
  return out;
}

export async function getPersonalRecommendations(limit = 12) {
  const library = getLocalLibrary();
  const progress = readProgress();
  const observed = [...(library.history || []), ...(library.favorites || []), ...(library.watchLater || [])];
  const seeds = uniqueByKey(observed).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, 4);
  if (!seeds.length) return [];

  const libraryKey = [...observed, ...Object.values(progress)].map(keyFor).sort().join("|");
  const cached = readForYouCache();
  if (cached?.libraryKey === libraryKey && Date.now() - Number(cached.updatedAt || 0) < FOR_YOU_CACHE_TTL) {
    return (cached.items || []).slice(0, limit);
  }

  const profile = { genres: {}, media: { movie: 0, tv: 0 } };
  seeds.forEach(item => {
    const base = library.favorites?.some(x => keyFor(x) === keyFor(item)) ? 3.2 : library.history?.some(x => keyFor(x) === keyFor(item)) ? 2.1 : 1.2;
    profile.media[item.media_type || "movie"] += tasteWeight(item, progress, base);
  });

  const details = await Promise.allSettled(seeds.map(seed =>
    seed.media_type === "tv" ? tmdbApi.tvDetailsBasic(seed.id) : tmdbApi.movieDetailsBasic(seed.id)
  ));
  details.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    const weight = tasteWeight(seeds[i], progress, 2);
    (result.value.genres || []).forEach(g => {
      profile.genres[g.id] = (profile.genres[g.id] || 0) + weight;
    });
  });

  const topGenres = Object.entries(profile.genres).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id).join("|");
  const calls = seeds.map(seed =>
    seed.media_type === "tv" ? tmdbApi.tvRecommendations(seed.id) : tmdbApi.movieRecommendations(seed.id)
  );
  if (topGenres) {
    calls.push(tmdbApi.discoverMovies({ with_genres: topGenres, sort_by: "popularity.desc", vote_count_gte: 100, page: 1 }));
    calls.push(tmdbApi.discoverTv({ with_genres: topGenres, sort_by: "popularity.desc", vote_count_gte: 50, page: 1 }));
  }

  const responses = await Promise.allSettled(calls);
  const candidates = responses.flatMap(result =>
    result.status === "fulfilled" ? normalizeResults(result.value?.results || []) : []
  );
  const excluded = new Set(observed.map(keyFor));
  const items = rankForYou(candidates, profile, excluded, limit);

  writeForYouCache({ version: 1, libraryKey, updatedAt: Date.now(), items });
  try {
    localStorage.setItem("vivid:taste:v1", JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      genres: profile.genres,
      media: profile.media
    }));
  } catch {}
  return items;
}
