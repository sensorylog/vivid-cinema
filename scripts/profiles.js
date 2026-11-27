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
      return { ...firebase, ...firestore };
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
  await ensureAppCheck();
  const reference = doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID);
  const snapshot = await getDocFromServer(reference);
  if (snapshot.exists()) {
    const existing = snapshot.data() || {};
    if (existing.isOwner !== true || existing.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new Error("The owner profile has an unsupported or invalid profile record.");
    }
    const googlePhoto = safeAvatarUrl(current);
    if (googlePhoto && !existing.avatarUrl && !["collection","upload"].includes(existing.avatarSource)) {
      const timestamp = serverTimestamp();
      await setDoc(reference, { avatarUrl: googlePhoto, avatarSource: "google", updatedAt: timestamp }, { merge: true });
      return { id: OWNER_PROFILE_ID, ...existing, avatarUrl: googlePhoto, avatarSource: "google", created: false };
    }
    return { id: OWNER_PROFILE_ID, ...existing, created: false };
  }

  const profile = normalizeProfile(OWNER_PROFILE_ID, {
    name: current.displayName || current.email?.split("@")[0] || "Main Profile",
    avatarUrl: safeAvatarUrl(current),
    avatarSource: safeAvatarUrl(current) ? "google" : "auto"
  });
  const timestamp = serverTimestamp();
  const { avatarData, ...profileRecord } = profile;
  await setDoc(reference, {
    ...profileRecord,
    createdAt: timestamp,
    updatedAt: timestamp
  });
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
  const { auth, ensureAppCheck } = firebase;
  const current = requireSignedInUser(user || auth.currentUser, auth);
  await ensureAppCheck();
  const token = await current.getIdToken();
  const response = await fetch("/api/profiles", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true || !Array.isArray(result.profiles)) {
    throw new Error(result.message || "Could not validate your profile security settings.");
  }
  return {
    profiles: result.profiles.map(profile => ({ ...profile, hasPin: profile.hasPin === true })),
    migrationComplete: result.migrationComplete === true
  };
}

export async function validateProfileSession(user, profileId) {
  const firebase = await getFirebase();
  const current = requireSignedInUser(user || firebase.auth.currentUser, firebase.auth);
  const token = await current.getIdToken();
  const response = await fetch("https://vivid-cinema-api.vercel.app/api/profile-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "validate", profileId }),
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  return response.ok && result.ok === true;
}

export function getActiveProfileId(uid) {
  try {
    const id = localStorage.getItem(activeProfileStorageKey(uid)) || OWNER_PROFILE_ID;
    return normalizeProfileId(id);
  } catch {
    return OWNER_PROFILE_ID;
  }
}

export function hasActiveProfileSelection(uid) {
  try {
    const value = localStorage.getItem(activeProfileStorageKey(uid));
    return Boolean(value && PROFILE_ID_PATTERN.test(value));
  } catch {
    return false;
  }
}

export function clearActiveProfileId(uid) {
  try { localStorage.removeItem(activeProfileStorageKey(uid)); } catch {}
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
  localStorage.setItem(key, id);
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
  await ensureAppCheck();

  const markerRef = doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID,
    "migrations", PROFILE_MIGRATION_ID);
  const marker = await getDocFromServer(markerRef);
  const summary = {};
  let migratedAny = false;
  for (const collectionName of PROFILE_DATA_COLLECTIONS) {
    const source = await getDocsFromServer(collection(db, "users", current.uid, collectionName));
    const destinationRef = collection(db, "users", current.uid, "profiles", OWNER_PROFILE_ID, collectionName);
    const destination = await getDocsFromServer(destinationRef);
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
      await batch.commit();
    }

    const verified = await getDocsFromServer(destinationRef);
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

  await setDoc(markerRef, {
    migrationId: PROFILE_MIGRATION_ID,
    status: "complete",
    schemaVersion: PROFILE_SCHEMA_VERSION,
    collections: summary,
    completedAt: serverTimestamp()
  });
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
