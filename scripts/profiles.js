let firebasePromise = null;

async function getFirebase() {
  if (!firebasePromise) {
    firebasePromise = Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")
    ]).then(([firebase, firestore]) => ({ ...firebase, ...firestore })).catch(error => {
      firebasePromise = null;
      throw error;
    });
  }
  return firebasePromise;
}

export const PROFILE_SCHEMA_VERSION = 1;
export const OWNER_PROFILE_ID = "owner";
export const MAX_PROFILES = 5;
export const PROFILE_DATA_COLLECTIONS = Object.freeze([
  "favorites",
  "watchLater",
  "history",
  "completed",
  "progress",
  "libraryTombstones",
  "feedback",
  "events",
  "taste",
  "animePreferences",
  "achievements"
]);
export const PROFILE_MIGRATION_ID = "account-data-to-owner-profile-v1";

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const AVATAR_URL_PATTERN = /^https:\/\//i;
const ACTIVE_PROFILE_PREFIX = "vivid:active-profile:v1:";

export function normalizeProfileId(value) {
  const id = String(value || "").trim();
  if (!PROFILE_ID_PATTERN.test(id)) throw new TypeError("A valid profile ID is required.");
  return id;
}

export function normalizeProfile(profileId, data = {}) {
  const id = normalizeProfileId(profileId);
  const name = typeof data.name === "string" ? data.name.trim().slice(0, 48) : "";
  const avatarUrl = typeof data.avatarUrl === "string" && AVATAR_URL_PATTERN.test(data.avatarUrl)
    ? data.avatarUrl.slice(0, 2048)
    : "";
  const isKids = data.isKids === true;
  return {
    id,
    name: name || (id === OWNER_PROFILE_ID ? "Main Profile" : "Vivid Profile"),
    avatarUrl,
    avatarId: typeof data.avatarId === "string" ? data.avatarId.slice(0, 80) : "",
    isKids,
    maturityLevel: isKids ? "kids" : "adult",
    isOwner: id === OWNER_PROFILE_ID,
    schemaVersion: PROFILE_SCHEMA_VERSION
  };
}

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

function safeAvatarUrl(user) {
  const candidate = String(user?.photoURL || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.href.slice(0, 2048) : "";
  } catch {
    return "";
  }
}

export async function ensureOwnerProfile(user = auth.currentUser) {
  const firebase = await getFirebase();
  const { auth, db, ensureAppCheck, doc, getDocFromServer, serverTimestamp, setDoc } = firebase;
  const current = requireSignedInUser(user, auth);
  await ensureAppCheck();
  const reference = doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID);
  const snapshot = await getDocFromServer(reference);
  if (snapshot.exists()) {
    const existing = snapshot.data() || {};
    if (existing.isOwner !== true || existing.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new Error("The owner profile has an unsupported or invalid profile record.");
    }
    return { id: OWNER_PROFILE_ID, ...existing, created: false };
  }

  const profile = normalizeProfile(OWNER_PROFILE_ID, {
    name: current.displayName || current.email?.split("@")[0] || "Main Profile",
    avatarUrl: safeAvatarUrl(current)
  });
  const timestamp = serverTimestamp();
  await setDoc(reference, {
    ...profile,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  return { ...profile, created: true };
}

export async function listProfiles(user = auth.currentUser) {
  const firebase = await getFirebase();
  const { auth, db, ensureAppCheck, collection, getDocsFromServer } = firebase;
  const current = requireSignedInUser(user, auth);
  await ensureAppCheck();
  const snapshot = await getDocsFromServer(collection(db, "users", current.uid, "profiles"));
  return snapshot.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(item => PROFILE_ID_PATTERN.test(item.id))
    .sort((a, b) => a.id === OWNER_PROFILE_ID ? -1 : b.id === OWNER_PROFILE_ID ? 1 : Number(a.createdAt?.toMillis?.() || 0) - Number(b.createdAt?.toMillis?.() || 0));
}

export function getActiveProfileId(uid) {
  try {
    const id = localStorage.getItem(activeProfileStorageKey(uid)) || OWNER_PROFILE_ID;
    return normalizeProfileId(id);
  } catch {
    return OWNER_PROFILE_ID;
  }
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
export async function migrateLegacyProfileData(user = auth.currentUser) {
  const firebase = await getFirebase();
  const { auth, db, ensureAppCheck, collection, doc, getDocFromServer, getDocsFromServer, serverTimestamp, setDoc, writeBatch } = firebase;
  const current = requireSignedInUser(user, auth);
  await ensureOwnerProfile(current);
  await ensureAppCheck();

  const markerRef = doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID,
    "migrations", PROFILE_MIGRATION_ID);
  const marker = await getDocFromServer(markerRef);
  if (marker.exists() && marker.data()?.status === "complete") {
    return { migrated: false, alreadyComplete: true, collections: marker.data()?.collections || {} };
  }

  const summary = {};
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

    for (let offset = 0; offset < pending.length; offset += 350) {
      const batch = writeBatch(db);
      for (const item of pending.slice(offset, offset + 350)) {
        batch.set(doc(db, "users", current.uid, "profiles", OWNER_PROFILE_ID, collectionName, item.id), item.data, { merge: true });
      }
      await batch.commit();
    }

    const verified = await getDocsFromServer(destinationRef);
    const verifiedIds = new Set(verified.docs.map(item => item.id));
    const missing = source.docs.filter(item => !verifiedIds.has(item.id));
    if (missing.length) {
      throw new Error("Profile migration verification failed for " + collectionName + ": " + missing.length + " records are missing. Original data remains untouched.");
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
  return { migrated: true, alreadyComplete: false, collections: summary };
}
