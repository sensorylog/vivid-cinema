import { tmdbApi } from "./tmdb.js";
import { getLocalLibrary } from "./library.js";
import { normalizeResults } from "./media.js";
import { getTasteProfile, getNotForMeKeys, getFeedbackState, getTasteStrength, getRecommendationMemory, recordBehavior } from "./intelligence.js";

const PROGRESS_KEY = "vivid:progress:v1";
const FOR_YOU_CACHE_KEY = "vivid:for-you:v1";
const FOR_YOU_CACHE_TTL = 30 * 60 * 1000;
const TONIGHT_SESSION_KEY = "vivid:tonight:v1";
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
    completed: Boolean(item.completed),
    ...(item.completedAt ? { completedAt: Number(item.completedAt) } : {}),
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
  return item && !item.completed && Number(item.progress) > 0 ? item : null;
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
    completed: false,
    completedAt: null,
    updatedAt: Date.now()
  };
  writeProgress(current);
  queueRemoteProgress(contentId, current[contentId]);
}

export function completePlaybackProgress(contentId, data = {}) {
  if (!contentId) return;
  const timer = progressTimers.get(contentId);
  if (timer) {
    window.clearTimeout(timer);
    progressTimers.delete(contentId);
  }
  pendingProgress.delete(contentId);
  const current = readProgress();
  const existing = current[contentId] || {};
  const duration = Math.max(0, Number(data.duration || existing.duration) || 0);
  current[contentId] = {
    ...existing,
    ...data,
    progress: duration || Number(data.progress || existing.progress) || 0,
    duration,
    percentage: 100,
    completed: true,
    completedAt: Date.now(),
    updatedAt: Date.now()
  };
  writeProgress(current);
  const completed = current[contentId];
  void getFirebaseAuth().then(auth => {
    if (auth?.currentUser) return setRemoteProgress(auth.currentUser.uid, contentId, completed);
  }).catch(error => console.warn("Vivid completion sync unavailable:", error));
}

export async function flushPlaybackProgress(contentId) {
  if (!contentId) return;
  const timer = progressTimers.get(contentId);
  if (timer) {
    window.clearTimeout(timer);
    progressTimers.delete(contentId);
  }
  const current = readProgress()[contentId];
  if (!current) return;
  pendingProgress.delete(contentId);
  try {
    const auth = await getFirebaseAuth();
    if (auth?.currentUser) await setRemoteProgress(auth.currentUser.uid, contentId, current);
  } catch (error) {
    console.warn("Vivid playback progress flush unavailable:", error);
  }
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

export function getLatestPlaybackProgress(mediaType, id) {
  const prefix = String(mediaType || "movie") + ":" + String(id);
  const matches = Object.entries(readProgress())
    .filter(([key, item]) => key === prefix || key.startsWith(prefix + ":"))
    .map(([contentId, item]) => ({ ...item, content_id: contentId }))
    .filter(item => Number(item.progress) > 5 && Number(item.duration) > 0 && Number(item.percentage) < 92)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return matches[0] || null;
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

function keyFor(item) {
  return String(item?.media_type || item?.mediaType || "movie") + ":" + String(item?.id);
}

function uniqueByKey(items) {
  const map = new Map();
  items.forEach(item => { if (item?.id != null) map.set(keyFor(item), item); });
  return [...map.values()];
}

function readForYouCache() {
  try { return JSON.parse(localStorage.getItem(FOR_YOU_CACHE_KEY)); } catch { return null; }
}

function writeForYouCache(value) {
  try { localStorage.setItem(FOR_YOU_CACHE_KEY, JSON.stringify(value)); } catch {}
}

function scoreCandidate(item, taste, progress, feedback, recentGenres = new Set(), recommendationMemory = new Map()) {
  const source = item.raw || item;
  const genreIds = source.genre_ids || item.genre_ids || [];
  const genres = new Set(genreIds);
  const genreScore = Object.entries(taste.genres || {}).reduce((sum, [id, weight]) =>
    sum + (genres.has(Number(id)) ? Number(weight) : 0), 0);
  const mediaScore = Number(taste.media?.[item.media_type || "movie"] || 0);
  const languageScore = taste.languages?.[source.original_language] ? Number(taste.languages[source.original_language]) : 0;
  const countryCodes = source.origin_country || (source.production_countries || []).map(country => country.iso_3166_1).filter(Boolean);
  const countryScore = countryCodes.reduce((sum, code) => sum + Number(taste.countries?.[code] || 0), 0);
  const year = Number(String(source.release_date || source.first_air_date || item.date || "").slice(0, 4));
  const decade = year >= 1900 ? String(Math.floor(year / 10) * 10) : "";
  const decadeScore = decade ? Number(taste.decades?.[decade] || 0) : 0;
  const quality = Math.min(1, Math.max(0, Number(item.vote_average || 0) / 10));
  const popularity = Math.min(1, Math.log10(1 + Math.max(0, Number(item.popularity || 0))) / 4);
  const feedbackBoost = feedback[keyFor(item)]?.kind === "like" ? 6 : 0;
  const memory = recommendationMemory.get(keyFor(item));
  const seenPenalty = memory ? Math.min(1.8, memory.impressions * .28) : 0;
  const clickRecovery = memory ? Math.min(1.2, memory.clicks * .6) : 0;
  const recentGenreBoost = genreIds.filter(id => recentGenres.has(Number(id))).slice(0, 2).length * .75;
  const releaseValue = source.release_date || source.first_air_date || item.date || "";
  const releaseTime = Date.parse(releaseValue);
  const ageDays = Number.isFinite(releaseTime) ? Math.max(0, (Date.now() - releaseTime) / 86400000) : Infinity;
  const freshness = Number.isFinite(ageDays) ? Math.max(0, 1 - (ageDays / 180)) : 0;
  return genreScore * 5.4 + mediaScore * 1.9 + languageScore * .55 + countryScore * .35 + decadeScore * .3 + quality * 1.4 + popularity * .8 + feedbackBoost + recentGenreBoost + freshness * .55 - seenPenalty + clickRecovery;
}

function rankForYou(candidates, taste, progress, feedback, excluded, limit, recentGenres = new Set(), recommendationMemory = new Map()) {
  const ranked = uniqueByKey(candidates)
    .filter(item => !excluded.has(keyFor(item)))
    .map(item => ({ item, score: scoreCandidate(item, taste, progress, feedback, recentGenres, recommendationMemory) }))
    .sort((a, b) => b.score - a.score);

  const out = [];
  const genreCounts = new Map();
  const typeCounts = { movie: 0, tv: 0 };

  for (const entry of ranked) {
    if (out.length >= limit) break;
    const item = entry.item;
    const type = item.media_type || "movie";
    const genres = (item.raw?.genre_ids || item.genre_ids || []).filter(id => taste.genres?.[id]);
    const dominantGenre = genres[0];
    const secondaryGenre = genres.find(id => id !== dominantGenre);
    if (dominantGenre && (genreCounts.get(dominantGenre) || 0) >= 3) continue;
    if (out.length >= 5 && typeCounts[type] >= Math.ceil(limit * .7)) continue;

    // Penalize a title that only repeats an already dominant genre.
    // The score remains visible so strong matches can still win.
    const repetitionPenalty = dominantGenre
      ? Math.min(2.2, (genreCounts.get(dominantGenre) || 0) * .65)
      : 0;
    const knownGenreCount = genres.filter(id => genreCounts.has(id)).length;
    const exploration = knownGenreCount === 0 ? .9 : knownGenreCount === 1 && dominantGenre !== undefined ? .3 : 0;
    const discoveryScore = entry.score - repetitionPenalty + exploration + (secondaryGenre && !genreCounts.has(secondaryGenre) ? .35 : 0);

    const source = item.raw || item;
    const languageMatch = Boolean(source.original_language && taste.languages?.[source.original_language]);
    const countryMatch = (source.origin_country || []).some(code => taste.countries?.[code]);
    const recentMatch = (source.genre_ids || []).some(id => recentGenres.has(Number(id)));
    let recommendationReason = "Picked for you";
    if (exploration > .5) recommendationReason = "A discovery that fits your taste";
    else if (dominantGenre) recommendationReason = "Because it matches your taste";
    else if (recentMatch) recommendationReason = "Because you've been watching this lately";
    else if (languageMatch) recommendationReason = "Because you enjoy this language";
    else if (countryMatch) recommendationReason = "Because you enjoy this kind of cinema";

    out.push({
      ...item,
      recommendationScore: discoveryScore,
      recommendationReason
    });
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    (item.raw?.genre_ids || item.genre_ids || []).filter(id => taste.genres?.[id]).slice(0, 2).forEach(id =>
      genreCounts.set(id, (genreCounts.get(id) || 0) + 1)
    );
  }
  return out;
}

async function getRecommendationSeeds() {
  const library = getLocalLibrary();
  const feedback = getFeedbackState();
  return uniqueByKey([
    ...(Object.values(feedback).filter(item => item.kind === "like")),
    ...(library.favorites || []),
    ...(library.history || []).filter(item => Number(item.completion || 0) >= 25),
    ...(library.watchLater || [])
  ]).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, 8);
}


function readTonightSession() {
  try { const value = JSON.parse(sessionStorage.getItem(TONIGHT_SESSION_KEY)); return value && typeof value === "object" ? value : { rejected: [] }; } catch { return { rejected: [] }; }
}
function writeTonightSession(value) {
  try { sessionStorage.setItem(TONIGHT_SESSION_KEY, JSON.stringify(value)); } catch {}
}
function getTonightRejected() { return new Set(readTonightSession().rejected || []); }
function rejectTonight(item) {
  const state = readTonightSession();
  const k = keyFor(item);
  state.rejected = [...new Set([...(state.rejected || []), k])].slice(-40);
  writeTonightSession(state);
}
function tonightScore(item, taste, progress, feedback) {
  const genres = new Set(item.genre_ids || []);
  const genre = Object.entries(taste.genres || {}).reduce((sum, [id, weight]) => sum + (genres.has(Number(id)) ? Number(weight) : 0), 0);
  const quality = Math.min(1, Math.max(0, Number(item.vote_average || 0) / 10));
  const popularity = Math.min(1, Math.log10(1 + Math.max(0, Number(item.popularity || 0))) / 4);
  const media = Number(taste.media?.[item.media_type || "movie"] || 0);
  const liked = feedback[keyFor(item)]?.kind === "like" ? 5 : 0;
  const unfinished = progress[keyFor(item)] && !progress[keyFor(item)].completed ? -4 : 0;
  return genre * 5.8 + media * 1.5 + quality * 2.2 + popularity * .65 + liked + unfinished;
}
export async function getTonightPick(options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 12));
  const taste = await getTasteProfile();
  const progress = readProgress();
  const feedback = getFeedbackState();
  const library = getLocalLibrary();
  const excluded = new Set([...getNotForMeKeys(), ...getTonightRejected()]);
  const watched = new Set((library.history || []).map(keyFor));
  const seeds = await getRecommendationSeeds();
  const calls = [];
  seeds.slice(0, 6).forEach(seed => calls.push(seed.media_type === "tv" ? tmdbApi.tvRecommendations(seed.id) : tmdbApi.movieRecommendations(seed.id)));
  const topGenres = Object.entries(taste.genres || {}).sort((a,b) => Number(b[1]) - Number(a[1])).slice(0, 4).map(([id]) => id).join("|");
  if (topGenres) {
    calls.push(tmdbApi.discoverMovies({ with_genres: topGenres, sort_by: "popularity.desc", vote_count_gte: 100, page: 1 }));
    calls.push(tmdbApi.discoverTv({ with_genres: topGenres, sort_by: "popularity.desc", vote_count_gte: 50, page: 1 }));
  } else {
    calls.push(tmdbApi.trending("all", "week", 1));
    calls.push(tmdbApi.popularMovies(1));
  }
  const responses = await Promise.allSettled(calls);
  const candidates = uniqueByKey(responses.flatMap(result => result.status === "fulfilled" ? normalizeResults(result.value?.results || []) : []))
    .filter(item => !excluded.has(keyFor(item)) && !watched.has(keyFor(item)));
  return candidates.map(item => ({ ...item, tonightScore: tonightScore(item, taste, progress, feedback) }))
    .sort((a,b) => b.tonightScore - a.tonightScore)
    .slice(0, limit);
}
export function dismissTonightPick(item) {
  if (item) {
    rejectTonight(item);
    recordBehavior("pick_for_me_rejected", item, { reason: "not_tonight" });
  }
}

export async function getPersonalRecommendations(limit = 12) {
  const library = getLocalLibrary();
  const progress = readProgress();
  const feedback = getFeedbackState();
  const taste = await getTasteProfile();
  const observed = [...(library.history || []), ...(library.favorites || []), ...(library.watchLater || [])];
  const seeds = await getRecommendationSeeds();
  if (!seeds.length && !Object.keys(taste.genres || {}).length) return [];

  const excluded = new Set([
    ...observed.map(keyFor),
    ...getNotForMeKeys()
  ]);
  const recommendationMemory = getRecommendationMemory();
  const recentGenres = new Set(
    (library.history || [])
      .slice()
      .sort((a, b) => Number(b.lastWatchedAt || b.updatedAt || 0) - Number(a.lastWatchedAt || a.updatedAt || 0))
      .slice(0, 5)
      .flatMap(item => item.genre_ids || [])
      .map(Number)
  );

  const fingerprint = [
    ...Object.entries(feedback).map(([k, v]) => k + ":" + v.kind + ":" + v.updatedAt),
    ...Object.entries(progress).map(([k, v]) => k + ":" + v.updatedAt),
    "recent:" + (library.history || []).slice(0, 5).map(item => keyFor(item) + ":" + (item.lastWatchedAt || item.updatedAt || "")).join(","),
    "taste:" + Number(taste.updatedAt || 0),
    "rotation:" + new Date().toISOString().slice(0, 10)
  ].sort().join("|");

  const cached = readForYouCache();
  if (cached?.fingerprint === fingerprint && Date.now() - Number(cached.updatedAt || 0) < FOR_YOU_CACHE_TTL) {
    return (cached.items || []).filter(item => !excluded.has(keyFor(item))).slice(0, limit);
  }

  const calls = seeds.slice(0, 6).map(seed =>
    seed.media_type === "tv"
      ? tmdbApi.tvRecommendations(seed.id)
      : tmdbApi.movieRecommendations(seed.id)
  );

  const topGenres = Object.entries(taste.genres || {}).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4).map(([id]) => id).join("|");
  if (topGenres) {
    calls.push(tmdbApi.discoverMovies({ with_genres: topGenres, sort_by: "popularity.desc", vote_count_gte: 100, page: 1 }));
    calls.push(tmdbApi.discoverTv({ with_genres: topGenres, sort_by: "popularity.desc", vote_count_gte: 50, page: 1 }));
  }

  const responses = await Promise.allSettled(calls);
  const candidates = responses.flatMap(result =>
    result.status === "fulfilled" ? normalizeResults(result.value?.results || []) : []
  );
  const discoveryCalls = [];
  const preferredLanguages = Object.entries(taste.languages || {}).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2).map(([code]) => code);
  if (preferredLanguages.length) {
    discoveryCalls.push(tmdbApi.discoverMovies({ sort_by: "vote_average.desc", vote_count_gte: 250, with_original_language: preferredLanguages[0], page: 1 }));
  }
  const discoveryResponses = await Promise.allSettled(discoveryCalls);
  const discoveryCandidates = discoveryResponses.flatMap(result =>
    result.status === "fulfilled" ? normalizeResults(result.value?.results || []) : []
  );

  const items = rankForYou([...candidates, ...discoveryCandidates], taste, progress, feedback, excluded, limit, recentGenres, recommendationMemory);
  writeForYouCache({ version: 3, fingerprint, updatedAt: Date.now(), items });

  return items;
}

export async function getBecauseYouLiked(limit = 12) {
  const feedback = getFeedbackState();
  const liked = Object.values(feedback)
    .filter(item => item.kind === "like")
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  if (!liked.length) return [];

  const seed = liked[0];
  try {
    const response = seed.media_type === "tv"
      ? await tmdbApi.tvRecommendations(seed.id)
      : await tmdbApi.movieRecommendations(seed.id);
    const excluded = new Set([...getNotForMeKeys(), keyFor(seed)]);
    const items = normalizeResults(response?.results || [])
      .filter(item => !excluded.has(keyFor(item)))
      .slice(0, limit)
      .map(item => ({ ...item, recommendationReason: "Because you liked " + seed.title }));
    recordBehavior("recommendation_row_view", seed, { reason: "because_you_liked" });
    return items;
  } catch {
    return [];
  }
}

export function getRecommendationStrength() {
  return getTasteStrength();
}
