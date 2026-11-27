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
  "profilePreferences"
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
  const avatarUrl = body.avatarUrl == null ? String(existing.avatarUrl || "") : String(body.avatarUrl);
  const avatarData = body.avatarData == null ? String(existing.avatarData || "") : String(body.avatarData);
  const isKids = body.isKids == null ? existing.isKids === true : body.isKids === true;
  const normalized = normalizeProfile(profileId, { name, avatarId, avatarUrl, avatarData, isKids });
  if (!normalized.name || normalized.avatarId !== avatarId) {
    throw new AnimePremiumError(400, "invalid-profile", "The profile details are not valid.");
  }
  if (avatarUrl && !normalized.avatarUrl) throw new AnimePremiumError(400, "invalid-avatar-url", "Profile photo URLs must use secure HTTPS.");
  if (avatarData && !normalized.avatarData) throw new AnimePremiumError(400, "invalid-avatar-image", "Upload a valid compressed WebP image.");
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
  const snapshot = await db.collection("users").doc(user.uid).collection("profiles").get();
  return snapshot.docs
    .map(item => serializeProfile(item.id, item.data()))
    .filter(profile => profile.id === OWNER_PROFILE_ID || /^[A-Za-z0-9_-]{1,64}$/.test(profile.id))
    .sort((a, b) => a.id === OWNER_PROFILE_ID ? -1 : b.id === OWNER_PROFILE_ID ? 1 : String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export async function createAccountProfile(request, env) {
  const { db, user } = await requireProfileUser(request, env);
  await enforceRateLimit(db, user.uid, "profiles-create", 10, 60 * 60 * 1000);
  const body = await readProfileBody(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new AnimePremiumError(400, "invalid-profile-name", "Enter a name for this profile.");
  const profilesRef = db.collection("users").doc(user.uid).collection("profiles");
  const now = Timestamp.fromMillis(Date.now());
  let created;
  await db.runTransaction(async transaction => {
    const profiles = await transaction.get(profilesRef);
    const owner = await transaction.get(profilesRef.doc(OWNER_PROFILE_ID));
    if (!owner.exists || owner.data()?.isOwner !== true) {
      throw new AnimePremiumError(409, "owner-profile-required", "The main Vivid profile must be initialized before adding profiles.");
    }
    if (profiles.size >= MAX_PROFILES) {
      throw new AnimePremiumError(409, "profile-limit-reached", "A Vivid account can have up to " + MAX_PROFILES + " profiles.");
    }
    const reference = profilesRef.doc();
    const normalized = cleanProfileInput(reference.id, body);
    created = { ...normalized, createdAt: now, updatedAt: now };
    transaction.create(reference, created);
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
  const reference = db.collection("users").doc(user.uid).collection("profiles").doc(profileId);
  const now = Timestamp.fromMillis(Date.now());
  let updated;
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new AnimePremiumError(404, "profile-not-found", "This Vivid profile no longer exists.");
    const existing = snapshot.data() || {};
    if (existing.isOwner === true && body.isKids === true) {
      throw new AnimePremiumError(400, "owner-cannot-be-kids", "The main account profile cannot be changed into a Kids profile.");
    }
    const normalized = cleanProfileInput(profileId, body, existing);
    updated = { ...normalized, createdAt: existing.createdAt || now, updatedAt: now };
    transaction.set(reference, updated);
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
  await reference.delete();
  return { id: profileId, deleted: true };
}
