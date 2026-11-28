import { getCloudflareApiUrl } from "./cloudflare-api.js";

import {
  MAX_PROFILES,
  OWNER_PROFILE_ID,
  PROFILE_AVATARS,
  PROFILE_AVATAR_IDS,
  PROFILE_DATA_COLLECTIONS,
  PROFILE_ID_PATTERN,
  PROFILE_SCHEMA_VERSION,
  normalizeAvatarUrl,
  normalizeProfile,
  normalizeProfileId
} from "./profile-schema.js";
export {
  MAX_PROFILES,
  OWNER_PROFILE_ID,
  PROFILE_AVATARS,
  PROFILE_AVATAR_IDS,
  PROFILE_DATA_COLLECTIONS,
  PROFILE_ID_PATTERN,
  PROFILE_SCHEMA_VERSION,
  normalizeAvatarUrl,
  normalizeProfile,
  normalizeProfileId
} from "./profile-schema.js";

let firebasePromise = null;
let authObserverAttached = false;
let lastObservedAuthUid = null;

async function getFirebase() {
  if (!firebasePromise) {
    firebasePromise = Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")
    ]).then(([firebase, firestore, authSdk]) => {
      if (!authObserverAttached) {
        authObserverAttached = true;
        authSdk.onAuthStateChanged(firebase.auth, user => {
          const nextUid = user?.uid ? String(user.uid) : null;
          if (nextUid !== lastObservedAuthUid) {
            initializedProfileAccounts.clear();
            lastObservedAuthUid = nextUid;
          }
        });
      }
      return { ...firebase, ...firestore, authSdk };
    }).catch(error => {
      firebasePromise = null;
      throw error;
    });
  }
  return firebasePromise;
}

export const PROFILE_MIGRATION_ID = "account-data-to-owner-profile-v1";

const ACTIVE_PROFILE_PREFIX = "vivid:active-profile:v1:";

export function profileCollectionPath(uid, profileId, collectionName) {
  const userId = String(uid || "").trim();
  const id = normalizeProfileId(profileId);
  if (!userId || userId.includes("/")) throw new TypeError("A valid account ID is required.");
  if (!PROFILE_DATA_COLLECTIONS.includes(collectionName)) {
    throw new TypeError("Unsupported profile data collection.");
  }
  return ["users", userId, "profiles", id, collectionName];
}

export function activeProfileStorageKey(uid) {
  const userId = String(uid || "").trim();
  if (!userId || userId.includes("/")) throw new TypeError("A valid account ID is required.");
  return ACTIVE_PROFILE_PREFIX + userId;
}

export function withProfileTimeout(promise, milliseconds, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(message);
      error.code = "PROFILE_CHECK_UNAVAILABLE";
      reject(error);
    }, milliseconds);
  });
  return Promise.race([Promise.resolve().then(() => promise), timeout])
    .finally(() => window.clearTimeout(timeoutId));
}

function requireSignedInUser(user, auth) {
  const current = auth.currentUser;
  if (!user?.uid || !current?.uid || String(user.uid) !== String(current.uid)) {
    throw new Error("The signed-in account changed. Please sign in again and retry.");
  }
  if (user.isAnonymous || current.isAnonymous) throw new Error("A registered Vivid account is required for profiles.");
  return current;
}


function stableData(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof value.toMillis === "function") return { __timestamp: value.toMillis() };
  if (value instanceof Date) return { __timestamp: value.getTime() };
  if (Array.isArray(value)) return value.map(stableData);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableData(value[key])]));
}
function sameData(left, right) {
  return JSON.stringify(stableData(left)) === JSON.stringify(stableData(right));
}

function safeAvatarUrl(user) {
  return normalizeAvatarUrl(String(user?.photoURL || user?.providerData?.find(provider => provider.providerId === "google.com")?.photoURL || "").trim());
}

export async function ensureOwnerProfile(user = null) {
  const firebase = await getFirebase();
  const { auth, db, ensureAppCheck, doc, getDocFromServer, serverTimestamp, setDoc } = firebase;
  const current = requireSignedInUser(user || auth.currentUser, auth);
  await withProfileTimeout(
    ensureAppCheck(),
    10_000,
    "Vivid security verification is taking too long. Retry profile loading."
  );
  const reference = doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID);
  const snapshot = await withProfileTimeout(
    getDocFromServer(reference),
    12_000,
    "Vivid couldn't retrieve your Main Profile in time. Check your connection and retry."
  );
  if (snapshot.exists()) {
    const existing = snapshot.data() || {};
    if (existing.isOwner !== true || existing.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new Error("The owner profile has an unsupported or invalid profile record.");
    }
    const normalized = normalizeProfile(OWNER_PROFILE_ID, existing);
    const policyKeys = ["isKids","maturityLevel","movieRatingLimit","tvRatingLimit","blockedGenreIds","blockedTitles","allowUnrated"];
    const updates = Object.fromEntries(policyKeys.filter(key => JSON.stringify(existing[key]) !== JSON.stringify(normalized[key])).map(key => [key, normalized[key]]));
    const googlePhoto = safeAvatarUrl(current);
    if (googlePhoto && !existing.avatarUrl && !["collection","upload"].includes(existing.avatarSource)) {
      updates.avatarUrl = googlePhoto;
      updates.avatarSource = "google";
    }
    if (Object.keys(updates).length) {
      updates.updatedAt = serverTimestamp();
      await withProfileTimeout(
        setDoc(reference, updates, { merge: true }),
        12_000,
        "Vivid couldn't finish updating your Main Profile. Please retry."
      );
    }
    return { id: OWNER_PROFILE_ID, ...existing, ...updates, created: false };
  }

  const profile = normalizeProfile(OWNER_PROFILE_ID, {
    name: current.displayName || current.email?.split("@")[0] || "Main Profile",
    avatarUrl: safeAvatarUrl(current),
    avatarSource: safeAvatarUrl(current) ? "google" : "auto"
  });
  const timestamp = serverTimestamp();
  const { avatarData, ...profileRecord } = profile;
  await withProfileTimeout(setDoc(reference, {
    ...profileRecord,
    createdAt: timestamp,
    updatedAt: timestamp
  }), 12_000, "Vivid couldn't create your Main Profile in time. Please retry.");
  return { ...profile, created: true };
}

export async function listProfiles(user = null) {
  const firebase = await getFirebase();
  const { auth, db, ensureAppCheck, collection, getDocsFromServer } = firebase;
  const current = requireSignedInUser(user || auth.currentUser, auth);
  await ensureAppCheck();
  const snapshot = await getDocsFromServer(collection(db, "users", current.uid, "profiles"));
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(item => PROFILE_ID_PATTERN.test(item.id))
    .sort((a, b) => a.id === OWNER_PROFILE_ID ? -1 : b.id === OWNER_PROFILE_ID ? 1 : Number(a.createdAt?.toMillis?.() || 0) - Number(b.createdAt?.toMillis?.() || 0));
}

export async function listProfileSummaries(user = null) {
  const firebase = await getFirebase();
  const { auth } = firebase;
  const current = requireSignedInUser(user || auth.currentUser, auth);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  let response;
  try {
    // Bound token refresh as well as fetch: Safari can leave getIdToken()
    // pending while auth silently refreshes, otherwise the selector spins forever.
    const token = await withProfileTimeout(
      current.getIdToken(),
      8_000,
      "Your Vivid sign-in is taking too long to refresh. Check your connection and retry."
    );
    // This endpoint authenticates with the Firebase ID token; it does not
    // require browser App Check to list an already-authenticated household.
    response = await fetch(getCloudflareApiUrl("/api/profiles"), {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const unavailable = new Error("Profile verification is temporarily unavailable.");
      unavailable.code = "PROFILE_CHECK_UNAVAILABLE";
      throw unavailable;
    }
    if (error?.code === "PROFILE_CHECK_UNAVAILABLE") throw error;
    const unavailable = new Error("Profile verification is temporarily unavailable.");
    unavailable.code = "PROFILE_CHECK_UNAVAILABLE";
    unavailable.cause = error;
    throw unavailable;
  } finally {
    window.clearTimeout(timeout);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true || !Array.isArray(result.profiles)) {
    const rejected = new Error(result.message || "Could not validate your profile security settings.");
    rejected.code = response.status === 401 || response.status === 403
      ? "PROFILE_SESSION_REJECTED"
      : "PROFILE_CHECK_UNAVAILABLE";
    throw rejected;
  }
  return {
    profiles: result.profiles.map(profile => ({ ...profile, hasPin: profile.hasPin === true })),
    migrationComplete: result.migrationComplete === true
  };
}

const PROFILE_SESSION_STORAGE_PREFIX = "vivid:profile-session:v1:";

export function clearStoredProfileSession(uid) {
  if (!uid) return;
  try { sessionStorage.removeItem(PROFILE_SESSION_STORAGE_PREFIX + String(uid)); } catch {}
}

export async function restoreProfileSession(user) {
  if (!user?.uid) return user;
  const firebase = await getFirebase();
  const current = requireSignedInUser(user, firebase.auth);
  let stored = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(PROFILE_SESSION_STORAGE_PREFIX + current.uid) || "null");
  } catch {}
  if (!stored || !PROFILE_ID_PATTERN.test(String(stored.profileId || "")) ||
      !PROFILE_ID_PATTERN.test(String(stored.sessionId || ""))) return current;

  const existing = await withProfileTimeout(
    current.getIdTokenResult(),
    8_000,
    "Vivid is restoring your profile. Please retry in a moment."
  );
  if (existing.claims.profileId === stored.profileId &&
      existing.claims.profileSessionId === stored.sessionId) return current;

  const token = await withProfileTimeout(
    current.getIdToken(),
    8_000,
    "Vivid is restoring your sign-in. Check your connection and retry."
  );
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    response = await fetch(getCloudflareApiUrl("/api/profile-pin"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ action: "restore", profileId: stored.profileId, sessionId: stored.sessionId }),
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true || typeof result.customToken !== "string") {
    if (response.status === 401 || response.status === 403) clearStoredProfileSession(current.uid);
    const error = new Error(result.message || "Your profile session could not be restored.");
    error.code = result.code || "PROFILE_SESSION_RESTORE_FAILED";
    error.status = response.status;
    throw error;
  }

  const credential = await withProfileTimeout(
    firebase.authSdk.signInWithCustomToken(firebase.auth, result.customToken),
    10_000,
    "Vivid could not restore your selected profile. Please retry."
  );
  if (credential.user?.uid !== current.uid) throw new Error("The restored profile belongs to a different Vivid account.");
  const restoredClaims = await withProfileTimeout(
    credential.user.getIdTokenResult(),
    8_000,
    "Vivid could not confirm your restored profile."
  );
  if (restoredClaims.claims.profileId !== stored.profileId ||
      restoredClaims.claims.profileSessionId !== stored.sessionId) {
    throw new Error("Vivid could not confirm your selected profile session. Please choose your profile again.");
  }
  return credential.user;
}

export async function validateProfileSession(user, profileId) {
  const firebase = await getFirebase();
  const current = requireSignedInUser(user || firebase.auth.currentUser, firebase.auth);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  let response;
  try {
    const token = await withProfileTimeout(
      current.getIdToken(),
      8_000,
      "Your Vivid sign-in is taking too long to refresh. Check your connection and retry."
    );
    response = await fetch(getCloudflareApiUrl("/api/profile-pin"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ action: "validate", profileId }),
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) {
    const unavailable = new Error("Profile security verification is temporarily unavailable.");
    unavailable.code = "PROFILE_CHECK_UNAVAILABLE";
    throw unavailable;
  }
  return result.ok === true;
}

export function getActiveProfileId(uid) {
  const key = activeProfileStorageKey(uid);
  try {
    const id = localStorage.getItem(key) || sessionStorage.getItem(key) || OWNER_PROFILE_ID;
    return normalizeProfileId(id);
  } catch {
    try { return normalizeProfileId(sessionStorage.getItem(key) || OWNER_PROFILE_ID); }
    catch { return OWNER_PROFILE_ID; }
  }
}

export function hasActiveProfileSelection(uid) {
  const key = activeProfileStorageKey(uid);
  try {
    const value = localStorage.getItem(key) || sessionStorage.getItem(key);
    return Boolean(value && PROFILE_ID_PATTERN.test(value));
  } catch {
    try {
      const value = sessionStorage.getItem(key);
      return Boolean(value && PROFILE_ID_PATTERN.test(value));
    } catch { return false; }
  }
}

export function clearActiveProfileId(uid) {
  let key;
  try { key = activeProfileStorageKey(uid); } catch { return; }
  try { localStorage.removeItem(key); } catch {}
  try { sessionStorage.removeItem(key); } catch {}
}

export function clearProfileLocalState(uid, profileId) {
  const accountId = String(uid || "").trim();
  const id = normalizeProfileId(profileId);
  if (!accountId) return false;
  const scopedOwner = accountId + "::" + id;
  const localStores = [
    { ownerKey: "vivid:library-owner:v1", keys: ["vivid:library:v2", "vivid:library-tombstones:v1"] },
    { ownerKey: "vivid:progress-owner:v1", keys: ["vivid:progress:v1", "vivid:for-you:v1"] },
    { ownerKey: "vivid:intelligence-owner:v1", keys: ["vivid:intelligence:v1", "vivid:session:v1", "vivid:taste:v1"] },
    { ownerKey: "vivid:achievements-owner:v1", keys: ["vivid:achievements:v1"] },
    { ownerKey: "vivid:anime-premium-preferences-owner:v1", keys: ["vivid:anime-premium-preferences:v1"] }
  ];
  try {
    for (const store of localStores) {
      if (localStorage.getItem(store.ownerKey) !== scopedOwner) continue;
      for (const key of store.keys) localStorage.removeItem(key);
      localStorage.removeItem(store.ownerKey);
    }
    const snapshotSuffix = ":user:" + scopedOwner;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && (key.includes(snapshotSuffix) || key.startsWith("vivid:anime-premium-preferences-snapshot:" + scopedOwner))) {
        localStorage.removeItem(key);
      }
    }
    if (getActiveProfileId(accountId) === id) clearActiveProfileId(accountId);
  } catch {}
  try {
    if (sessionStorage.getItem("vivid:tonight-owner:v1") === scopedOwner) {
      sessionStorage.removeItem("vivid:tonight:v1");
      sessionStorage.removeItem("vivid:tonight-owner:v1");
    }
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key && key.includes(snapshotSuffix)) sessionStorage.removeItem(key);
    }
  } catch {}
  window.dispatchEvent(new CustomEvent("vivid:profile-deleted", { detail: { uid: accountId, profileId: id } }));
  return true;
}

export function setActiveProfileId(uid, profileId) {
  const key = activeProfileStorageKey(uid);
  const id = normalizeProfileId(profileId);
  // Keep both stores in sync. Safari/private browsing or storage quota errors
  // must not prevent the server-issued profile token from opening the app.
  try { localStorage.setItem(key, id); } catch {}
  try { sessionStorage.setItem(key, id); } catch {}
  window.dispatchEvent(new CustomEvent("vivid:profile-changed", {
    detail: { uid: String(uid), profileId: id }
  }));
  return id;
}

/**
 * Copies legacy account-level viewing data into the owner's profile.
 * The legacy source is deliberately retained: interrupted migrations are
 * restartable and a failed verification can never destroy the user's data.
 */
export async function migrateLegacyProfileData(user = null) {
  const firebase = await getFirebase();
  const { auth, db, ensureAppCheck, collection, doc, getDocFromServer, getDocsFromServer, serverTimestamp, setDoc, writeBatch } = firebase;
  const current = requireSignedInUser(user || auth.currentUser, auth);
  await ensureOwnerProfile(current);
  await withProfileTimeout(
    ensureAppCheck(),
    10_000,
    "Vivid security verification is taking too long to finish your library setup."
  );

  const markerRef = doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID,
    "migrations", PROFILE_MIGRATION_ID);
  const marker = await withProfileTimeout(
    getDocFromServer(markerRef),
    12_000,
    "Vivid library setup is taking too long. Your existing data is safe; retry the setup."
  );
  const summary = {};
  let migratedAny = false;
  for (const collectionName of PROFILE_DATA_COLLECTIONS) {
    const source = await withProfileTimeout(
      getDocsFromServer(collection(db, "users", current.uid, collectionName)),
      12_000,
      "Vivid couldn't read your existing " + collectionName + " data in time. Your data is safe; retry the setup."
    );
    const destinationRef = collection(db, "users", current.uid, "profiles", OWNER_PROFILE_ID, collectionName);
    const destination = await withProfileTimeout(
      getDocsFromServer(destinationRef),
      12_000,
      "Vivid couldn't verify your " + collectionName + " profile data in time. Please retry."
    );
    const destinationById = new Map(destination.docs.map(item => [item.id, item.data()]));
    const pending = [];

    for (const item of source.docs) {
      const oldData = item.data();
      const newData = destinationById.get(item.id);
      const oldUpdatedAt = Number(oldData.updatedAt || oldData.deletedAt || oldData.occurredAt || 0);
      const newUpdatedAt = Number(newData?.updatedAt || newData?.deletedAt || newData?.occurredAt || 0);
      if (!newData || oldUpdatedAt > newUpdatedAt) {
        pending.push({ id: item.id, data: oldData });
      }
    }

    migratedAny = migratedAny || pending.length > 0;
    for (let offset = 0; offset < pending.length; offset += 350) {
      const batch = writeBatch(db);
      for (const item of pending.slice(offset, offset + 350)) {
        batch.set(doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID, collectionName, item.id), item.data);
      }
      await withProfileTimeout(
        batch.commit(),
        12_000,
        "Vivid couldn't finish copying your " + collectionName + " data in time. Your original data is safe; retry the setup."
      );
    }

    const verified = await withProfileTimeout(
      getDocsFromServer(destinationRef),
      12_000,
      "Vivid couldn't verify the copied " + collectionName + " data in time. Please retry."
    );
    const verifiedById = new Map(verified.docs.map(item => [item.id, item.data()]));
    const missing = source.docs.filter(item => !verifiedById.has(item.id));
    const mismatched = pending.filter(item => !sameData(item.data, verifiedById.get(item.id)));
    if (missing.length || mismatched.length) {
      throw new Error("Profile migration verification failed for " + collectionName +
        ": " + missing.length + " records are missing and " + mismatched.length +
        " copied records differ. Original data remains untouched.");
    }
    summary[collectionName] = { sourceCount: source.size, destinationCount: verified.size, copiedCount: pending.length };
  }

  await withProfileTimeout(setDoc(markerRef, {
    migrationId: PROFILE_MIGRATION_ID,
    status: "complete",
    schemaVersion: PROFILE_SCHEMA_VERSION,
    collections: summary,
    completedAt: serverTimestamp()
  }), 12_000, "Vivid couldn't confirm your library setup in time. Please retry.");
  return { migrated: migratedAny, alreadyComplete: marker.exists() && !migratedAny, collections: summary };
}

const profileInitialization = new Map();
const initializedProfileAccounts = new Set();

export function initializeProfileFoundation(user = null) {
  const uid = String(user?.uid || "");
  if (!uid) return Promise.reject(new Error("A signed-in Vivid account is required to initialize profiles."));
  if (initializedProfileAccounts.has(uid)) return Promise.resolve({ migrated: false, alreadyComplete: true, collections: {} });
  if (profileInitialization.has(uid)) return profileInitialization.get(uid);
  const task = (async () => {
    await ensureOwnerProfile(user);
    const result = await migrateLegacyProfileData(user);
    const { auth } = await getFirebase();
    if (String(auth.currentUser?.uid || "") !== uid) {
      throw new Error("The signed-in account changed during profile initialization. Please retry.");
    }
    initializedProfileAccounts.add(uid);
    return result;
  })().finally(() => profileInitialization.delete(uid));
  profileInitialization.set(uid, task);
  return task;
}
