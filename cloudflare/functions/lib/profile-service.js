import { verifyFirebaseIdToken } from "./firebase-token-verification.js";
import {
  allowedOrigin, AnimePremiumError, enforceRateLimit, getPremiumServices, jsonResponse
} from "./anime-premium-service.js";
import { Timestamp } from "@ljoukov/firebase-admin-cloudflare/firestore";
import {
  MAX_PROFILES, OWNER_PROFILE_ID, PROFILE_AVATARS, PROFILE_DATA_COLLECTIONS,
  normalizeProfile, normalizeProfileId
} from "../../../scripts/profile-schema.js";

const PROFILE_DELETE_COLLECTIONS = Object.freeze([
  ...PROFILE_DATA_COLLECTIONS,
  "migrations",
  "profileSecurity",
  "profileSessions",
  "parentalControls",
  "profilePreferences",
  "profileManagement",
  "avatar"
]);
const AVATAR_IDS = new Set(PROFILE_AVATARS.map(item => item.id));

export function profileOptionsResponse(origin, env = {}) {
  if (!allowedOrigin(origin, env)) {
    return jsonResponse({ ok: false, code: "origin-not-allowed" }, 403, "", env);
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    }
  });
}

export async function requireProfileUser(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AnimePremiumError(401, "unauthenticated", "Sign in with your Vivid account to manage profiles.");
  const services = getPremiumServices(env);
  try {
    const claims = await verifyFirebaseIdToken(match[1], services.projectId, services.serviceAccount);
    return { ...services, user: claims };
  } catch (error) {
    throw new AnimePremiumError(401, error?.code || "invalid-id-token", "Your Vivid sign-in needs refreshing. Please sign in again.");
  }
}

const PROFILE_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PROFILE_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export async function requireUnlockedProfile(db, user, profileId) {
  if (!user?.uid || user.profileId !== profileId) {
    throw new AnimePremiumError(403, "profile-authorization-required", "Open this profile before managing its settings.");
  }
  const profileReference = db.collection("users").doc(user.uid).collection("profiles").doc(profileId);
  const [profileSnapshot, pinSnapshot] = await Promise.all([
    profileReference.get(),
    profileReference.collection("profileSecurity").doc("pin").get()
  ]);
  if (!profileSnapshot.exists) {
    throw new AnimePremiumError(404, "profile-not-found", "This Vivid profile no longer exists.");
  }
  const profileData = profileSnapshot.data() || {};
  if (profileId === OWNER_PROFILE_ID && profileData.isOwner !== true) {
    throw new AnimePremiumError(409, "owner-profile-required", "The main Vivid profile must be initialized before managing profiles.");
  }
  if (!pinSnapshot.exists) {
    if (profileId === OWNER_PROFILE_ID) {
      const kidsProfiles = await db.collection("users").doc(user.uid).collection("profiles").where("isKids", "==", true).limit(1).get();
      if (!kidsProfiles.empty) {
        throw new AnimePremiumError(409, "parent-pin-required", "Restore the Main Profile PIN before managing profiles while Kids profiles exist.");
      }
    }
    return profileData;
  }

  const sessionId = String(user.profileSessionId || "");
  if (!PROFILE_SESSION_ID_PATTERN.test(sessionId)) {
    throw new AnimePremiumError(401, "profile-session-required", "Unlock this profile again before managing it.");
  }
  const sessionSnapshot = await profileReference.collection("profileSessions").doc(sessionId).get();
  const session = sessionSnapshot.data() || {};
  const expiresAt = Number(session.expiresAt?.toMillis?.() || 0);
  const lastActivityAt = Number(session.lastActivityAt?.toMillis?.() || 0);
  if (!sessionSnapshot.exists || session.uid !== user.uid || session.profileId !== profileId ||
      session.revoked === true || expiresAt <= Date.now() ||
      lastActivityAt <= Date.now() - PROFILE_SESSION_IDLE_TIMEOUT_MS ||
      session.pinHash !== pinSnapshot.data()?.pinHash) {
    throw new AnimePremiumError(401, "profile-session-expired", "This profile unlock has expired. Enter its PIN again.");
  }
  return profileData;
}

export function profileErrorResponse(error, origin, env) {
  const status = error instanceof AnimePremiumError ? error.status : 500;
  return jsonResponse({
    ok: false,
    code: error?.code || "profile-service-unavailable",
    message: status < 500 ? error.message : "Vivid profiles are temporarily unavailable."
  }, status, origin, env);
}

export function validateProfileOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (origin && !allowedOrigin(origin, env)) {
    throw new AnimePremiumError(403, "origin-not-allowed", "This Vivid origin is not allowed to manage profiles.");
  }
  return origin;
}

export async function readProfileBody(request) {
  const raw = await request.text();
  if (raw.length > 220000) throw new AnimePremiumError(413, "profile-payload-too-large", "The profile update is too large.");
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new AnimePremiumError(400, "invalid-request", "A valid profile request is required."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AnimePremiumError(400, "invalid-request", "A valid profile request is required.");
  }
  return body;
}

function cleanProfileInput(profileId, body, existing = {}) {
  const name = typeof body.name === "string" ? body.name.trim() : String(existing.name || "").trim();
  if (!name || name.length > 48) throw new AnimePremiumError(400, "invalid-profile-name", "Profile names must contain 1–48 characters.");
  const avatarId = body.avatarId == null ? (existing.avatarId || "aurora") : String(body.avatarId);
  if (!AVATAR_IDS.has(String(avatarId || ""))) throw new AnimePremiumError(400, "invalid-avatar", "Choose an avatar from the Vivid collection.");
  const avatarSource = body.avatarSource == null
    ? (["auto","google","collection","upload"].includes(existing.avatarSource)
      ? existing.avatarSource
      : existing.avatarData ? "upload" : existing.avatarUrl ? "google" : profileId === OWNER_PROFILE_ID ? "auto" : "collection")
    : String(body.avatarSource);
  const allowedSources = new Set(["auto","google","collection","upload"]);
  if (avatarSource && !allowedSources.has(avatarSource)) throw new AnimePremiumError(400, "invalid-avatar-source", "Choose a valid profile photo source.");
  const source = avatarSource || (profileId === OWNER_PROFILE_ID ? "auto" : "collection");
  if (source === "auto" && profileId !== OWNER_PROFILE_ID) throw new AnimePremiumError(400, "invalid-avatar-source", "Automatic Google photos are only available for the account owner.");
  const requestedUrl = body.avatarUrl == null ? String(existing.avatarUrl || "") : String(body.avatarUrl);
  const requestedData = body.avatarData == null ? String(existing.avatarData || "") : String(body.avatarData);
  const avatarUrl = source === "google" || source === "auto" ? requestedUrl : "";
  const avatarData = source === "upload" ? requestedData : "";
  const isKids = body.isKids == null ? existing.isKids === true : body.isKids === true;
  const normalized = normalizeProfile(profileId, { name, avatarId, avatarUrl, avatarData, avatarSource: source, isKids, movieRatingLimit: body.movieRatingLimit ?? existing.movieRatingLimit, tvRatingLimit: body.tvRatingLimit ?? existing.tvRatingLimit, blockedGenreIds: body.blockedGenreIds ?? existing.blockedGenreIds, blockedTitles: body.blockedTitles ?? existing.blockedTitles, allowUnrated: body.allowUnrated ?? existing.allowUnrated });
  const policyFields=["isKids","movieRatingLimit","tvRatingLimit","blockedGenreIds","blockedTitles","allowUnrated"];
  if(policyFields.some(key=>Object.prototype.hasOwnProperty.call(body,key))&&body.__profileRole!=="owner")throw new AnimePremiumError(403,"parent-authorization-required","Only the Main Profile can change Kids Mode and parental controls.");
  if (!normalized.name || normalized.avatarId !== avatarId) {
    throw new AnimePremiumError(400, "invalid-profile", "The profile details are not valid.");
  }
  if (avatarUrl && !normalized.avatarUrl) throw new AnimePremiumError(400, "invalid-avatar-url", "Profile photo URLs must use secure HTTPS.");
  if (source === "upload" && (!requestedData || !normalized.avatarData)) throw new AnimePremiumError(400, "invalid-avatar-image", "Upload a valid compressed WebP image.");
  return normalized;
}

function serializeProfile(id, data = {}) {
  const normalized = normalizeProfile(id, data);
  const toIso = value => {
    if (typeof value?.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return null;
  };
  return {
    ...normalized,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt)
  };
}

export async function listAccountProfiles(request, env) {
  const { db, user } = await requireProfileUser(request, env);
  await enforceRateLimit(db, user.uid, "profiles-list", 60, 60 * 1000);
  const includeAvatars = new URL(request.url).searchParams.get("includeAvatars") === "1";
  const ownerReference = db.collection("users").doc(user.uid).collection("profiles").doc(OWNER_PROFILE_ID);
  const [snapshot, migrationSnapshot] = await Promise.all([
    ownerReference.parent.get(),
    ownerReference.collection("migrations").doc("account-data-to-owner-profile-v1").get()
  ]);
  const profiles = await Promise.all(snapshot.docs.map(async item => {
    const data = item.data() || {};
    const pinReference = item.ref.collection("profileSecurity").doc("pin");
    const [avatarSnapshot, pinSnapshot] = await Promise.all([
      includeAvatars ? item.ref.collection("avatar").doc("image").get() : Promise.resolve(null),
      pinReference.get()
    ]);
    const avatarData = includeAvatars ? (avatarSnapshot?.data()?.data || data.avatarData || "") : "";
    const profile = serializeProfile(item.id, { ...data, avatarData });
    return { ...profile, hasPin: pinSnapshot.exists };
  }));
  return {
    profiles: profiles
      .filter(profile => profile.id === OWNER_PROFILE_ID || /^[A-Za-z0-9_-]{1,64}$/.test(profile.id))
      .sort((a, b) => a.id === OWNER_PROFILE_ID ? -1 : b.id === OWNER_PROFILE_ID ? 1 : String(a.createdAt || "").localeCompare(String(b.createdAt || ""))),
    migrationComplete: migrationSnapshot.data()?.status === "complete"
  };
}

export async function createAccountProfile(request, env) {
  const { db, user } = await requireProfileUser(request, env);
  await enforceRateLimit(db, user.uid, "profiles-create", 10, 60 * 60 * 1000);
  const body = await readProfileBody(request);
  if (!user.profileId) {
    throw new AnimePremiumError(403, "profile-authorization-required", "Open a viewing profile before creating another profile.");
  }
  const activeProfile = await requireUnlockedProfile(db, user, user.profileId);
  if (activeProfile.isKids === true) {
    throw new AnimePremiumError(403, "parent-authorization-required", "Kids profiles cannot create additional viewing profiles. Verify with an adult profile first.");
  }
  if (body.isKids === true && user.profileId !== OWNER_PROFILE_ID) {
    throw new AnimePremiumError(403, "parent-authorization-required", "Only the Main Profile can create a Kids profile.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new AnimePremiumError(400, "invalid-profile-name", "Enter a name for this profile.");

  const profilesRef = db.collection("users").doc(user.uid).collection("profiles");
  const now = Timestamp.fromMillis(Date.now());
  const ownerRef = profilesRef.doc(OWNER_PROFILE_ID);
  const limitRef = ownerRef.collection("profileManagement").doc("limits");
  let created;
  await db.runTransaction(async transaction => {
    const profiles = await transaction.get(profilesRef);
    const owner = await transaction.get(ownerRef);
    const limits = await transaction.get(limitRef);
    const ownerPin = await transaction.get(ownerRef.collection("profileSecurity").doc("pin"));
    if (!owner.exists || owner.data()?.isOwner !== true) {
      throw new AnimePremiumError(409, "owner-profile-required", "The main Vivid profile must be initialized before adding profiles.");
    }
    if(body.isKids===true&&!ownerPin.exists)throw new AnimePremiumError(409,"parent-pin-required","Set a PIN on the Main Profile before creating a Kids profile.");
    const currentCount = profiles.size;
    if (currentCount >= MAX_PROFILES) {
      throw new AnimePremiumError(409, "profile-limit-reached", "A Vivid account can have up to " + MAX_PROFILES + " profiles.");
    }
    const reference = profilesRef.doc();
    const normalized = cleanProfileInput(reference.id, { ...body, __profileRole: user.profileId });
    const { avatarData, ...metadata } = normalized;
    created = { ...metadata, createdAt: now, updatedAt: now };
    transaction.create(reference, created);
    if (avatarData) transaction.create(reference.collection("avatar").doc("image"), { data: avatarData, updatedAt: now });
    transaction.set(limitRef, { profileCount: currentCount + 1, updatedAt: now });
  });
  return serializeProfile(created.id, created);
}

export async function updateAccountProfile(request, env) {
  const { db, user } = await requireProfileUser(request, env);
  await enforceRateLimit(db, user.uid, "profiles-update", 30, 60 * 60 * 1000);
  const body = await readProfileBody(request);
  let profileId;
  try { profileId = normalizeProfileId(body.profileId); }
  catch { throw new AnimePremiumError(400, "invalid-profile-id", "Choose a valid Vivid profile."); }
  if (!user.profileId) {
    throw new AnimePremiumError(403, "profile-authorization-required", "Open a viewing profile before managing profile settings.");
  }
  const activeProfile = await requireUnlockedProfile(db, user, user.profileId);
  if (activeProfile.isKids === true) {
    throw new AnimePremiumError(403, "parent-authorization-required", "Kids profiles cannot manage profile settings.");
  }
  const reference = db.collection("users").doc(user.uid).collection("profiles").doc(profileId);
  const policyFields=["isKids","movieRatingLimit","tvRatingLimit","blockedGenreIds","blockedTitles","allowUnrated"];
  const hasPolicyChange=policyFields.some(key=>Object.prototype.hasOwnProperty.call(body,key));
  if(hasPolicyChange&&user.profileId!==OWNER_PROFILE_ID)throw new AnimePremiumError(403,"parent-authorization-required","Only the Main Profile can change Kids Mode and parental controls.");
  const now = Timestamp.fromMillis(Date.now());
  let updated;
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new AnimePremiumError(404, "profile-not-found", "This Vivid profile no longer exists.");
    const existing = snapshot.data() || {};
    const avatarReference = reference.collection("avatar").doc("image");
    const avatarSnapshot = await transaction.get(avatarReference);
    const ownerPinSnapshot=hasPolicyChange?await transaction.get(reference.parent.doc(OWNER_PROFILE_ID).collection("profileSecurity").doc("pin")):null;
    const existingWithAvatar = { ...existing, avatarData: avatarSnapshot.data()?.data || existing.avatarData || "" };
    if(body.isKids===true&&!ownerPinSnapshot?.exists&&existing.isKids!==true)throw new AnimePremiumError(409,"parent-pin-required","Set a PIN on the Main Profile before enabling Kids Mode.");
    if (existing.isOwner === true && body.isKids === true) {
      throw new AnimePremiumError(400, "owner-cannot-be-kids", "The main account profile cannot be changed into a Kids profile.");
    }
    const normalized = cleanProfileInput(profileId, { ...body, __profileRole: user.profileId }, existingWithAvatar);
    const { avatarData, ...metadata } = normalized;
    updated = { ...metadata, createdAt: existing.createdAt || now, updatedAt: now };
    transaction.set(reference, updated);
    if (avatarData) transaction.set(avatarReference, { data: avatarData, updatedAt: now });
    else if (avatarSnapshot.exists) transaction.delete(avatarReference);
  });
  return serializeProfile(profileId, updated);
}

async function deleteProfileCollection(db, reference) {
  const snapshot = await reference.get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = db.batch();
    snapshot.docs.slice(offset, offset + 400).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
}

export async function deleteAccountProfile(request, env) {
  const { db, user } = await requireProfileUser(request, env);
  await enforceRateLimit(db, user.uid, "profiles-delete", 5, 60 * 60 * 1000);
  const body = await readProfileBody(request);
  if (!user.profileId) {
    throw new AnimePremiumError(403, "profile-authorization-required", "Open an adult viewing profile before deleting a profile.");
  }
  const activeProfile = await requireUnlockedProfile(db, user, user.profileId);
  if (activeProfile.isKids === true) {
    throw new AnimePremiumError(403, "parent-authorization-required", "Kids profiles cannot delete other viewing profiles.");
  }
  let profileId;
  try { profileId = normalizeProfileId(body.profileId); }
  catch { throw new AnimePremiumError(400, "invalid-profile-id", "Choose a valid Vivid profile."); }
  if (profileId === OWNER_PROFILE_ID) {
    throw new AnimePremiumError(403, "owner-profile-protected", "The main profile cannot be deleted.");
  }
  const reference = db.collection("users").doc(user.uid).collection("profiles").doc(profileId);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new AnimePremiumError(404, "profile-not-found", "This Vivid profile no longer exists.");
  if (snapshot.data()?.isOwner === true) throw new AnimePremiumError(403, "owner-profile-protected", "The main profile cannot be deleted.");
  for (const collectionName of PROFILE_DELETE_COLLECTIONS) {
    await deleteProfileCollection(db, reference.collection(collectionName));
  }
  const ownerRef = reference.parent.doc(OWNER_PROFILE_ID);
  const limitRef = ownerRef.collection("profileManagement").doc("limits");
  await db.runTransaction(async transaction => {
    const current = await transaction.get(reference);
    const profiles = await transaction.get(reference.parent);
    const limits = await transaction.get(limitRef);
    if (!current.exists) throw new AnimePremiumError(404, "profile-not-found", "This Vivid profile no longer exists.");
    transaction.delete(reference);
    transaction.set(limitRef, { profileCount: Math.max(1, profiles.size - 1), updatedAt: Timestamp.fromMillis(Date.now()) });
  });
  return { id: profileId, deleted: true };
}
