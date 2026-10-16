import { tmdbApi } from "./tmdb.js";
import { getLocalLibrary } from "./library.js";
import { normalizeResults } from "./media.js";
import { getTasteProfile, getNotForMeKeys, getFeedbackState, getTasteStrength, getRecommendationMemory, recordBehavior } from "./intelligence.js";
import { switchLocalOwner } from "./local-owner.js";
import { buildPlotKeywordQueries, scorePlotCandidate, scorePlotCandidates } from "./plot-search.js";
import { findSemanticPlotMatches } from "./gemini-plot-search.js";

const PROGRESS_KEY = "vivid:progress:v1";
const FOR_YOU_CACHE_KEY = "vivid:for-you:v1";
const FOR_YOU_CACHE_TTL = 30 * 60 * 1000;
const TONIGHT_SESSION_KEY = "vivid:tonight:v1";
const PROGRESS_SYNC_DEBOUNCE = 1800;
const LOCAL_OWNER_KEY = "vivid:progress-owner:v1";

function currentProgressOwner() {
  try { return localStorage.getItem(LOCAL_OWNER_KEY) || "guest"; } catch { return "guest"; }
}

function ensureProgressOwner(uid){
  let changed=false;
  try{
    const result=switchLocalOwner({
      storage:localStorage,
      ownerKey:LOCAL_OWNER_KEY,
      activeKeys:[PROGRESS_KEY,FOR_YOU_CACHE_KEY],
      uid,
      emptyValues:{[PROGRESS_KEY]:"{}",[FOR_YOU_CACHE_KEY]:""}
    });
    changed=changed||result.changed;
  }catch(error){
    console.warn("Vivid could not switch account-local progress snapshots:",error);
  }
  // Tonight's rejected picks live in sessionStorage, not localStorage.
  try{
    const result=switchLocalOwner({
      storage:sessionStorage,
      ownerKey:"vivid:tonight-owner:v1",
      activeKeys:[TONIGHT_SESSION_KEY],
      uid,
      emptyValues:{[TONIGHT_SESSION_KEY]:""}
    });
    changed=changed||result.changed;
  }catch(error){
    console.warn("Vivid could not switch account-local Tonight state:",error);
  }
  if(changed){
    for(const timer of progressTimers.values())window.clearTimeout(timer);
    progressTimers.clear();
    pendingProgress.clear();
    window.dispatchEvent(new CustomEvent("vivid:account-switched",{detail:{uid:uid?String(uid):null}}));
    window.dispatchEvent(new CustomEvent("vivid:progress-changed",{detail:readProgress()}));
  }
}

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
      getDocsFromServer: firestoreSdk.getDocsFromServer,
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

function progressSyncStatus(status, uid, contentId) {
  window.dispatchEvent(new CustomEvent("vivid:sync-status", {
    detail: { store: "progress", status, uid: String(uid || ""), ...(contentId ? { contentId } : {}) }
  }));
}

async function setRemoteProgress(uid, contentId, item) {
  try {
    const { db, doc, setDoc } = await getFirebase();
    await setDoc(
      doc(db, "users", uid, "progress", contentId),
      progressDocData(contentId, item),
      { merge: true }
    );
    progressSyncStatus("synced", uid, contentId);
  } catch (error) {
    progressSyncStatus("error", uid, contentId);
    throw error;
  }
}

async function deleteRemoteProgress(uid, contentId) {
  const { db, doc, deleteDoc } = await getFirebase();
  await deleteDoc(doc(db, "users", uid, "progress", contentId));
}

function queueRemoteProgress(contentId, item) {
  pendingProgress.set(contentId, { ...item });
  if (progressTimers.has(contentId)) return;
  const ownerAtQueue = localStorage.getItem(LOCAL_OWNER_KEY) || "guest";
  const timer = window.setTimeout(async () => {
    progressTimers.delete(contentId);
    const pending = pendingProgress.get(contentId);
    pendingProgress.delete(contentId);
    if (!pending) return;
    try {
      const auth = await getFirebaseAuth();
      const activeOwner = localStorage.getItem(LOCAL_OWNER_KEY) || "guest";
      if (ownerAtQueue !== "guest" && activeOwner === ownerAtQueue &&
          String(auth?.currentUser?.uid || "") === ownerAtQueue) {
        await setRemoteProgress(ownerAtQueue, contentId, pending);
      }
    } catch (error) {
      if ((localStorage.getItem(LOCAL_OWNER_KEY) || "guest") === ownerAtQueue) {
        pendingProgress.set(contentId, pending);
      }
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
  const ownerAtWrite = localStorage.getItem(LOCAL_OWNER_KEY) || "guest";
  void getFirebaseAuth().then(auth => {
    if (ownerAtWrite !== "guest" &&
        (localStorage.getItem(LOCAL_OWNER_KEY) || "guest") === ownerAtWrite &&
        String(auth?.currentUser?.uid || "") === ownerAtWrite) {
      return setRemoteProgress(ownerAtWrite, contentId, completed);
    }
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
  const ownerAtWrite = localStorage.getItem(LOCAL_OWNER_KEY) || "guest";
  try {
    const auth = await getFirebaseAuth();
    if (ownerAtWrite !== "guest" &&
        (localStorage.getItem(LOCAL_OWNER_KEY) || "guest") === ownerAtWrite &&
        String(auth?.currentUser?.uid || "") === ownerAtWrite) {
      await setRemoteProgress(ownerAtWrite, contentId, current);
    }
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

  const ownerAtWrite = localStorage.getItem(LOCAL_OWNER_KEY) || "guest";
  void getFirebaseAuth().then(auth => {
    if (ownerAtWrite !== "guest" &&
        (localStorage.getItem(LOCAL_OWNER_KEY) || "guest") === ownerAtWrite &&
        String(auth?.currentUser?.uid || "") === ownerAtWrite) {
      return deleteRemoteProgress(ownerAtWrite, contentId);
    }
  }).catch(error => console.warn("Vivid remote progress removal unavailable:", error));
}

export async function syncPlaybackProgressForUser(user = null) {
  ensureProgressOwner(user?.uid || null);
  if (!user) return readProgress();
  try {
    const { db, collection, getDocsFromServer } = await getFirebase();
    const snapshot = await getDocsFromServer(collection(db, "users", user.uid, "progress"));
    const auth = await getFirebaseAuth();
    if (String(auth?.currentUser?.uid || "") !== String(user.uid) ||
        (localStorage.getItem(LOCAL_OWNER_KEY) || "guest") !== String(user.uid)) {
      throw new Error("The signed-in account changed during playback progress sync. Please retry.");
    }
    const local = readProgress();
    let changed = false;

    const remoteKeys = new Set(snapshot.docs.map(snapshotDoc => snapshotDoc.id));
    snapshot.docs.forEach(snapshotDoc => {
      const data = snapshotDoc.data() || {};
      const contentId = snapshotDoc.id;
      const remoteUpdated = Number(data.updatedAt) || 0;
      const localUpdated = Number(local[contentId]?.updatedAt) || 0;
      if (remoteUpdated > 0 && remoteUpdated >= localUpdated) {
        const merged = {
          ...local[contentId],
          ...data,
          updatedAt: remoteUpdated
        };
        if (remoteUpdated > localUpdated || JSON.stringify(merged) !== JSON.stringify(local[contentId])) {
          local[contentId] = merged;
          changed = true;
        }
      } else if (localUpdated > remoteUpdated && local[contentId]) {
        queueRemoteProgress(contentId, local[contentId]);
      }
    });
    Object.entries(local).forEach(([contentId, item]) => {
      if (!remoteKeys.has(contentId) && Number(item?.updatedAt || 0) > 0) {
        queueRemoteProgress(contentId, item);
      }
    });

    if (changed) writeProgress(local);
    return local;
  } catch (error) {
    progressSyncStatus("error", user.uid, "sync");
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
        let initialStateHandled = false;
        onAuthStateChanged(auth, user => {
          ensureProgressOwner(user?.uid || null);
          if (!user) {
            if (!initialStateHandled) {
              initialStateHandled = true;
              resolve(readProgress());
            }
            return;
          }
          void syncPlaybackProgressForUser(user).then(value => {
            if (!initialStateHandled) {
              initialStateHandled = true;
              resolve(value);
            }
          }).catch(error => {
            console.warn("Vivid playback progress sync failed; local progress is retained:", error);
            if (!initialStateHandled) {
              initialStateHandled = true;
              resolve(readProgress());
            }
          });
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

export function scoreRecommendationExposure(memory, now = Date.now()) {
  if (!memory || typeof memory !== "object") return { seenPenalty: 0, clickRecovery: 0 };
  const impressions = Math.max(0, Number(memory.impressions) || 0);
  const clicks = Math.max(0, Number(memory.clicks) || 0);
  if (!impressions && !clicks) return { seenPenalty: 0, clickRecovery: 0 };

  // Recent exposure matters most; old impressions should fade instead of
  // permanently burying a title. Missing timestamps get a modest, not full,
  // penalty so legacy memory cannot dominate ranking indefinitely.
  const lastSeen = Number(memory.lastSeen) || 0;
  const ageDays = lastSeen > 0 ? Math.max(0, (now - lastSeen) / 86400000) : 21;
  const recency = Math.pow(0.5, ageDays / 21);
  const seenPenalty = Math.min(5, Math.log2(1 + impressions) * 1.8) * recency;
  // A click is evidence of interest, but does not make the same title immune
  // to rotation. Recovery is deliberately capped below the exposure penalty.
  const clickRecovery = Math.min(seenPenalty * 0.75, clicks * 1.1 * recency);
  return { seenPenalty, clickRecovery };
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
  // Negative feedback should influence similar titles, not only exclude the exact title.
  // Genre metadata is captured with new feedback; missing legacy metadata is ignored safely.
  const notForMeGenres = Object.values(feedback)
    .filter(entry => entry?.kind === "not_for_me" && Array.isArray(entry.genre_ids))
    .flatMap(entry => entry.genre_ids.map(Number).filter(Number.isFinite));
  const dislikePenalty = Math.min(4, genreIds.filter(id => notForMeGenres.includes(Number(id))).length * 1.25);
  const exposure = scoreRecommendationExposure(recommendationMemory.get(keyFor(item))); 
  const { seenPenalty, clickRecovery } = exposure;
  const recentGenreBoost = genreIds.filter(id => recentGenres.has(Number(id))).slice(0, 2).length * .75;
  const releaseValue = source.release_date || source.first_air_date || item.date || "";
  const releaseTime = Date.parse(releaseValue);
  const ageDays = Number.isFinite(releaseTime) ? Math.max(0, (Date.now() - releaseTime) / 86400000) : Infinity;
  const freshness = Number.isFinite(ageDays) ? Math.max(0, 1 - (ageDays / 180)) : 0;

  // Playback progress is account-local and keyed by media identity. Movies use
  // movie:<id>; TV episodes use tv:<id>:<season>:<episode>, so inspect episode
  // keys as well as the series-level key when ranking a TV candidate.
  const progressKey = keyFor(item);
  const exactProgress = progress[progressKey];
  const episodeProgress = item.media_type === "tv"
    ? Object.entries(progress)
        .filter(([key, value]) => key.startsWith(progressKey + ":") && value && !value.completed)
        .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))[0]?.[1]
    : null;
  const activeProgress = exactProgress && !exactProgress.completed ? exactProgress : episodeProgress;
  const progressPercent = Math.max(0, Math.min(100, Number(activeProgress?.percentage) || 0));
  const progressPenalty = item.media_type !== "tv" && exactProgress?.completed
    ? 10
    : activeProgress
      ? progressPercent >= 92 ? 5 : progressPercent >= 50 ? 2.5 : 1.2
      : 0;

  return genreScore * 5.4 + mediaScore * 1.9 + languageScore * .55 + countryScore * .35 + decadeScore * .3 + quality * 1.4 + popularity * .8 + feedbackBoost + recentGenreBoost + freshness * .55 - seenPenalty + clickRecovery - progressPenalty - dislikePenalty;
}

function rankForYou(candidates, taste, progress, feedback, excluded, limit, recentGenres = new Set(), recommendationMemory = new Map(), enforceDiversity = true) {
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
    if (enforceDiversity && dominantGenre && (genreCounts.get(dominantGenre) || 0) >= 3) continue;
    if (enforceDiversity && out.length >= 5 && typeCounts[type] >= Math.ceil(limit * .7)) continue;

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

export function rankIntentCandidates(candidates, options = {}) {
  const taste = options.taste || {};
  const progress = options.progress || {};
  const feedback = options.feedback || {};
  const excluded = options.excluded instanceof Set ? options.excluded : new Set(options.excluded || []);
  const limit = Math.max(1, Math.min(40, Number(options.limit) || 18));
  const recentGenres = options.recentGenres instanceof Set ? options.recentGenres : new Set(options.recentGenres || []);
  return rankForYou(candidates, taste, progress, feedback, excluded, limit, recentGenres, options.recommendationMemory || new Map(), false);
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
  const ownerAtStart = currentProgressOwner();
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 12));
  const taste = await getTasteProfile();
  if (currentProgressOwner() !== ownerAtStart) return [];
  const progress = readProgress();
  const feedback = getFeedbackState();
  const library = getLocalLibrary();
  const excluded = new Set([...getNotForMeKeys(), ...getTonightRejected()]);
  const watched = new Set((library.history || []).map(keyFor));
  const seeds = await getRecommendationSeeds();
  if (currentProgressOwner() !== ownerAtStart) return [];
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
  if (currentProgressOwner() !== ownerAtStart) return [];
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
  const ownerAtStart = currentProgressOwner();
  const library = getLocalLibrary();
  const progress = readProgress();
  const feedback = getFeedbackState();
  const taste = await getTasteProfile();
  if (currentProgressOwner() !== ownerAtStart) return [];
  const observed = [...(library.history || []), ...(library.favorites || []), ...(library.watchLater || [])];
  const seeds = await getRecommendationSeeds();
  if (currentProgressOwner() !== ownerAtStart) return [];
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
  const recommendationMemoryFingerprint = [...recommendationMemory.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contentId, memory]) => contentId + ":" + memory.impressions + ":" + memory.clicks + ":" + memory.lastSeen)
    .join(",");

  const fingerprint = [
    ...Object.entries(feedback).map(([k, v]) => k + ":" + v.kind + ":" + v.updatedAt),
    ...Object.entries(progress).map(([k, v]) => k + ":" + v.updatedAt),
    "recent:" + (library.history || []).slice(0, 5).map(item => keyFor(item) + ":" + (item.lastWatchedAt || item.updatedAt || "")).join(","),
    "library:" + observed.map(item => keyFor(item) + ":" + Number(item.updatedAt || item.lastWatchedAt || 0)).sort().join(","),
    "recommendationMemory:" + recommendationMemoryFingerprint,
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
  if (currentProgressOwner() !== ownerAtStart) return [];
  const discoveryCandidates = discoveryResponses.flatMap(result =>
    result.status === "fulfilled" ? normalizeResults(result.value?.results || []) : []
  );

  const items = rankForYou([...candidates, ...discoveryCandidates], taste, progress, feedback, excluded, limit, recentGenres, recommendationMemory);
  writeForYouCache({ version: 3, fingerprint, updatedAt: Date.now(), items });

  return items;
}

export function collectIntentCandidates(responses = []) {
  const successful = responses.filter(result => result?.status === "fulfilled");
  const candidates = successful.flatMap(result => Array.isArray(result.value) ? result.value : []);
  if (candidates.length || successful.length === responses.length) return candidates;

  // An empty success plus a failed sibling request is not proof that the
  // whole mixed-media search had zero matches.
  const failure = responses.find(result => result?.status === "rejected");
  if (failure) throw failure.reason;
  return candidates;
}

export async function getPlotMatchRecommendations(intent = {}, limit = 18) {
  const ownerAtStart = currentProgressOwner();
  const queries = buildPlotKeywordQueries(intent.query || "");
  if (!queries.length) return [];

  const requestedType = ["movie", "tv"].includes(intent.mediaType) ? intent.mediaType : "all";
  const mediaTypes = requestedType === "all" ? ["movie", "tv"] : [requestedType];
  // Gemini interprets the remembered story semantically. TMDB remains the
  // source of truth: model suggestions are never rendered unless TMDB verifies them.
  const semanticPromise = findSemanticPlotMatches(intent.query || "", requestedType)
    .catch(error => {
      console.error("Vivid Gemini plot search failed; using catalogue fallback:", error);
      return { clues: [], candidates: [], error };
    });
  const [keywordResponses, semantic] = await Promise.all([
    Promise.allSettled(queries.map(query => tmdbApi.searchKeywords(query))),
    semanticPromise
  ]);
  if (currentProgressOwner() !== ownerAtStart) return [];
  window.dispatchEvent(new CustomEvent("vivid:gemini-plot-search-status", {
    detail: semantic.error
      ? { available: false, message: String(semantic.error?.code || semantic.error?.message || "Unknown Gemini error").slice(0, 180) }
      : { available: true }
  }));

  const semanticKeywordResponses = await Promise.allSettled(
    (semantic.clues || []).slice(0, 6).map(query => tmdbApi.searchKeywords(query))
  );
  if (currentProgressOwner() !== ownerAtStart) return [];
  const allKeywordResponses = [...keywordResponses, ...semanticKeywordResponses];

  const keywordMap = new Map();
  allKeywordResponses.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    (result.value?.results || []).slice(0, 5).forEach(keyword => {
      if (keyword?.id == null || !keyword?.name) return;
      const relevance = Math.max(
        scorePlotCandidate(intent.query || "", { title: keyword.name, overview: keyword.name }),
        scorePlotCandidate((semantic.clues || []).join(" "), { title: keyword.name, overview: keyword.name })
      );
      const existing = keywordMap.get(String(keyword.id));
      if (!existing || relevance > existing.relevance) {
        keywordMap.set(String(keyword.id), { id: String(keyword.id), relevance, queryIndex: index });
      }
    });
  });
  const keywordIds = [...keywordMap.values()]
    .sort((a, b) => b.relevance - a.relevance || a.queryIndex - b.queryIndex)
    .slice(0, 8)
    .map(item => item.id);

  const calls = [];
  const hasSpecificFilters = Boolean(intent.genre || intent.runtimeMax || intent.year || intent.decade || intent.country || intent.language || intent.anime);
  const normalizeTitleForMatch = value => String(value || "").toLocaleLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const aiSuggestions = hasSpecificFilters ? [] : (semantic.candidates || []).slice(0, 8);
  aiSuggestions.forEach((suggestion, suggestionIndex) => {
    const types = suggestion.mediaType === "movie" || suggestion.mediaType === "tv"
      ? [suggestion.mediaType]
      : mediaTypes;
    for (const type of types) {
      const search = type === "tv" ? tmdbApi.searchTv : tmdbApi.searchMovies;
      calls.push(search(suggestion.title).then(response => normalizeResults(response?.results || [], type)
        .filter(item => normalizeTitleForMatch(item.title || item.name) === normalizeTitleForMatch(suggestion.title))
        .map(item => ({
          ...item,
          aiPlotRank: suggestionIndex,
          aiPlotConfidence: suggestion.confidence,
          aiPlotReason: suggestion.reason
        }))));
    }
  });
  if (keywordIds.length) {
    for (const type of mediaTypes) {
      const genreId = intent.genreIds?.[type] ?? intent.genre?.[type === "movie" ? "movieId" : "tvId"];
      if (intent.genre && !genreId) continue;
      const params = {
        with_keywords: keywordIds.join("|"),
        sort_by: "popularity.desc",
        page: 1,
        include_adult: false,
        "vote_count.gte": type === "movie" ? 10 : 5
      };
      if (genreId) params.with_genres = String(genreId);
      if (intent.runtimeMax) params["with_runtime.lte"] = String(Math.max(1, Number(intent.runtimeMax)));
      if (intent.year) {
        if (type === "movie") params.primary_release_year = String(intent.year);
        else params.first_air_date_year = String(intent.year);
      }
      if (intent.decade) {
        if (type === "movie") {
          params["primary_release_date.gte"] = String(intent.decade) + "-01-01";
          params["primary_release_date.lte"] = String(Number(intent.decade) + 9) + "-12-31";
        } else {
          params["first_air_date.gte"] = String(intent.decade) + "-01-01";
          params["first_air_date.lte"] = String(Number(intent.decade) + 9) + "-12-31";
        }
      }
      if (intent.country) params.with_origin_country = String(intent.country);
      if (intent.language) params.with_original_language = String(intent.language);
      if (intent.anime) {
        if (!intent.language) params.with_original_language = "ja";
        if (type === "tv" && !intent.country) params.with_origin_country = "JP";
      }
      calls.push((type === "tv" ? tmdbApi.discoverTv(params) : tmdbApi.discoverMovies(params))
        .then(response => normalizeResults(response?.results || [], type)));
    }
  }

  // A title lookup is a useful fallback when the description accidentally
  // contains a remembered title or subtitle. Only use it when there are no
  // structured filters to bypass, and respect the requested media type.
  if (!hasSpecificFilters) {
    for (const type of mediaTypes) {
      calls.push((type === "tv" ? tmdbApi.searchTv(intent.query || "") : tmdbApi.searchMovies(intent.query || ""))
        .then(response => normalizeResults(response?.results || [], type)));
    }
  }
  const responses = await Promise.allSettled(calls);
  if (currentProgressOwner() !== ownerAtStart) return [];
  let candidates = [];
  try { candidates = collectIntentCandidates(responses); } catch {}
  let scored = scorePlotCandidates(intent.query || "", uniqueByKey(candidates));

  // Preserve verified Gemini title matches even when catalogue synopsis wording differs.
  const mergedScores = new Map(scored.map(item => [keyFor(item), item]));
  const verifiedAiCandidates = candidates.filter(item => Number.isFinite(Number(item.aiPlotRank)));
  for (const item of verifiedAiCandidates) {
    const identity = keyFor(item);
    const previous = mergedScores.get(identity);
    const confidence = Math.max(0, Math.min(1, Number(item.aiPlotConfidence) || 0));
    const semanticScore = Math.max(1, 28 + confidence * 8 - Math.max(0, Number(item.aiPlotRank) || 0) * 0.35);
    mergedScores.set(identity, {
      ...(previous || {}),
      ...item,
      plotScore: Math.max(Number(previous?.plotScore) || 0, semanticScore),
      aiPlotMatch: true
    });
  }
  scored = [...mergedScores.values()].sort((a, b) => Number(b.plotScore || 0) - Number(a.plotScore || 0));

  // TMDB keyword tagging is incomplete. If it yields no plausible plot match,
  // scan a small popularity-ordered catalogue slice with the same verified
  // constraints and score the actual overviews instead of returning an
  // immediate empty state. This is a fallback, not a claim of exhaustive search.
  if (!scored.length) {
    const fallbackCalls = [];
    for (const type of mediaTypes) {
      const genreId = intent.genreIds?.[type] ?? intent.genre?.[type === "movie" ? "movieId" : "tvId"];
      if (intent.genre && !genreId) continue;
      const params = {
        sort_by: "popularity.desc",
        page: 1,
        include_adult: false,
        "vote_count.gte": type === "movie" ? 10 : 5
      };
      if (genreId) params.with_genres = String(genreId);
      if (intent.runtimeMax) params["with_runtime.lte"] = String(Math.max(1, Number(intent.runtimeMax)));
      if (intent.year) {
        if (type === "movie") params.primary_release_year = String(intent.year);
        else params.first_air_date_year = String(intent.year);
      }
      if (intent.decade) {
        if (type === "movie") {
          params["primary_release_date.gte"] = String(intent.decade) + "-01-01";
          params["primary_release_date.lte"] = String(Number(intent.decade) + 9) + "-12-31";
        } else {
          params["first_air_date.gte"] = String(intent.decade) + "-01-01";
          params["first_air_date.lte"] = String(Number(intent.decade) + 9) + "-12-31";
        }
      }
      if (intent.country) params.with_origin_country = String(intent.country);
      if (intent.language) params.with_original_language = String(intent.language);
      if (intent.anime) {
        params.with_original_language = "ja";
        if (type === "tv") params.with_origin_country = "JP";
      }
      fallbackCalls.push((type === "tv" ? tmdbApi.discoverTv(params) : tmdbApi.discoverMovies(params))
        .then(response => normalizeResults(response?.results || [], type)));
    }
    const fallbackResponses = await Promise.allSettled(fallbackCalls);
    if (currentProgressOwner() !== ownerAtStart) return [];
    try {
      candidates = collectIntentCandidates(fallbackResponses);
    } catch (error) {
      if (!responses.some(result => result.status === "fulfilled")) throw error;
      candidates = [];
    }
    scored = scorePlotCandidates(intent.query || "", uniqueByKey(candidates));
  }
  if (!scored.length) return [];

  const library = getLocalLibrary();
  const feedback = getFeedbackState();
  const progress = readProgress();
  const taste = await getTasteProfile();
  if (currentProgressOwner() !== ownerAtStart) return [];
  // A remembered-plot query is direct search, not a recommendation request.
  // Previously watched, favorited, or disliked titles must remain discoverable.
  const recentGenres = new Set(
    (library.history || [])
      .slice()
      .sort((a, b) => Number(b.lastWatchedAt || b.updatedAt || 0) - Number(a.lastWatchedAt || a.updatedAt || 0))
      .slice(0, 5)
      .flatMap(item => item.genre_ids || item.raw?.genre_ids || [])
      .map(Number)
  );
  const ranked = rankIntentCandidates(scored, {
    taste, progress, feedback, excluded: new Set(), limit: Math.min(40, Math.max(1, Number(limit) || 18)),
    recentGenres, recommendationMemory: getRecommendationMemory()
  });
  return ranked
    .map(item => ({ ...item, recommendationReason: "Possible match for your remembered plot", plotMatchScore: item.plotScore }))
    .sort((a, b) => Number(b.plotMatchScore || 0) - Number(a.plotMatchScore || 0) ||
      Number(b.recommendationScore || 0) - Number(a.recommendationScore || 0))
    .slice(0, Math.min(40, Math.max(1, Number(limit) || 18)));
}

export async function getIntentRecommendations(intent = {}, limit = 18) {
  const ownerAtStart = currentProgressOwner();
  const safeLimit = Math.max(1, Math.min(40, Number(limit) || 18));
  const requestedType = ["movie", "tv"].includes(intent.mediaType) ? intent.mediaType : "all";
  const mediaTypes = requestedType === "all" ? ["movie", "tv"] : [requestedType];
  const calls = mediaTypes.flatMap(type => {
    const genreId = intent.genreIds?.[type] ?? intent.genre?.[type === "movie" ? "movieId" : "tvId"];
    // Do not fill a genre-constrained search with unrelated TV titles when
    // the catalogue has no corresponding TV genre filter.
    if (intent.genre && !genreId) return [];
    const params = {
      sort_by: "popularity.desc",
      page: 1,
      include_adult: false,
      "vote_count.gte": type === "movie" ? 40 : 20
    };
    if (genreId) params.with_genres = String(genreId);
    if (intent.runtimeMax) params["with_runtime.lte"] = String(Math.max(1, Number(intent.runtimeMax)));
    if (intent.year) {
      if (type === "movie") params.primary_release_year = String(intent.year);
      else params.first_air_date_year = String(intent.year);
    }
    if (intent.decade) {
      if (type === "movie") {
        params["primary_release_date.gte"] = String(intent.decade) + "-01-01";
        params["primary_release_date.lte"] = String(Number(intent.decade) + 9) + "-12-31";
      } else {
        params["first_air_date.gte"] = String(intent.decade) + "-01-01";
        params["first_air_date.lte"] = String(Number(intent.decade) + 9) + "-12-31";
      }
    }
    if (intent.country) params.with_origin_country = String(intent.country);
    if (intent.language) params.with_original_language = String(intent.language);
    if (intent.anime) {
      params.with_original_language = "ja";
      if (type === "tv") params.with_origin_country = "JP";
    }
    return [(type === "tv" ? tmdbApi.discoverTv(params) : tmdbApi.discoverMovies(params))
      .then(response => normalizeResults(response?.results || [], type))];
  });

  const responses = await Promise.allSettled(calls);
  if (currentProgressOwner() !== ownerAtStart) return [];
  // Distinguish a genuine zero-match result from total catalogue/network failure.
  // Partial success is still useful; only reject when every request failed.
  const candidates = collectIntentCandidates(responses);
  if (!candidates.length) return [];

  const library = getLocalLibrary();
  const feedback = getFeedbackState();
  const progress = readProgress();
  const taste = await getTasteProfile();
  if (currentProgressOwner() !== ownerAtStart) return [];
  const observed = [...(library.history || []), ...(library.favorites || []), ...(library.watchLater || [])];
  const excluded = new Set([...observed.map(keyFor), ...getNotForMeKeys()]);
  const recentGenres = new Set(
    (library.history || [])
      .slice()
      .sort((a, b) => Number(b.lastWatchedAt || b.updatedAt || 0) - Number(a.lastWatchedAt || a.updatedAt || 0))
      .slice(0, 5)
      .flatMap(item => item.genre_ids || item.raw?.genre_ids || [])
      .map(Number)
  );
  const ranked = rankIntentCandidates(candidates, {
    taste,
    progress,
    feedback,
    excluded,
    limit: safeLimit,
    recentGenres,
    recommendationMemory: getRecommendationMemory()
  });
  return ranked.map(item => ({
    ...item,
    recommendationReason: intent.constraints?.length
      ? "Matches your filters: " + intent.constraints.slice(0, 3).join(" · ")
      : item.recommendationReason
  }));
}

export async function getBecauseYouLiked(limit = 12) {
  const ownerAtStart = currentProgressOwner();
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
    if (currentProgressOwner() !== ownerAtStart) return [];
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

if (typeof window !== "undefined") {
  // Keep progress ownership aligned on Library and recommendation surfaces too.
  void startPlaybackSync();
  window.addEventListener("online", () => {
    void getFirebaseAuth().then(auth => {
      if (auth?.currentUser) return syncPlaybackProgressForUser(auth.currentUser);
    }).catch(error => {
      console.warn("Vivid playback progress retry after reconnect failed:", error);
    });
  });
}
