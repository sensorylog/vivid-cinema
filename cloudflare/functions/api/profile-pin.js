import { Timestamp } from "@ljoukov/firebase-admin-cloudflare/firestore";
import { createFirebaseCustomToken } from "../lib/firebase-token-verification.js";
import {
  AnimePremiumError, jsonResponse
} from "../lib/anime-premium-service.js";
import { requireProfileUser, validateProfileOrigin } from "../lib/profile-service.js";

const PIN_ITERATIONS = 600000;
const PIN_BYTES = 32;
const PIN_SALT_BYTES = 16;
const PIN_ATTEMPT_LIMIT = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;
const PIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const PIN_RATE_LIMIT = 30;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const RECENT_AUTH_MS = 5 * 60 * 1000;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PIN_PATTERN = /^\d{4}$/;
const OWNER_PROFILE_ID = "owner";
const encoder = new TextEncoder();

class ProfilePinError extends AnimePremiumError {
  constructor(status, code, message, details = {}) {
    super(status, code, message);
    this.details = details;
  }
}

function json(data, status, origin, env) {
  return jsonResponse(data, status, origin, env);
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
async function hashProfilePin(pin, salt = crypto.getRandomValues(new Uint8Array(PIN_SALT_BYTES))) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PIN_ITERATIONS, hash: "SHA-256" }, material, PIN_BYTES * 8);
  return { pinSalt: bytesToBase64Url(salt), pinHash: bytesToBase64Url(new Uint8Array(bits)), iterations: PIN_ITERATIONS };
}
async function verifyProfilePinHash(pin, record) {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin) || !record ||
      typeof record.pinSalt !== "string" || typeof record.pinHash !== "string") return false;
  const iterations = Number(record.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
  try {
    const salt = base64UrlToBytes(record.pinSalt);
    const expected = base64UrlToBytes(record.pinHash);
    if (salt.length !== PIN_SALT_BYTES || expected.length !== PIN_BYTES) return false;
    const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, PIN_BYTES * 8);
    const actual = new Uint8Array(bits);
    let difference = actual.length ^ expected.length;
    for (let index = 0; index < Math.min(actual.length, expected.length); index++) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch { return false; }
}
function validatePin(pin) {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) throw new ProfilePinError(400, "invalid-pin", "A profile PIN must contain exactly four digits.");
  return pin;
}
function validateProfileId(profileId) {
  if (typeof profileId !== "string" || !PROFILE_ID_PATTERN.test(profileId)) throw new ProfilePinError(400, "invalid-profile", "Choose a valid Vivid profile.");
  return profileId;
}
function isRecentAccountAuth(claims) {
  const authTime = Number(claims?.auth_time || 0) * 1000;
  const provider = String(claims?.firebase?.sign_in_provider || "");
  return authTime > 0 && Date.now() - authTime <= RECENT_AUTH_MS && claims?.email_verified === true && provider !== "custom" && provider !== "anonymous";
}
async function consumeRateLimit(db, uid, profileId) {
  const key = bytesToBase64Url(encoder.encode(uid + ":" + profileId)).slice(0, 120);
  const reference = db.collection("profilePinRateLimits").doc(key);
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const start = Number(data.windowStartedAt?.toMillis?.() || 0);
    const active = start > 0 && now - start < PIN_RATE_WINDOW_MS;
    const count = active ? Number(data.count || 0) : 0;
    if (count >= PIN_RATE_LIMIT) throw new ProfilePinError(429, "pin-rate-limited", "Too many profile security requests. Try again later.");
    transaction.set(reference, { windowStartedAt: Timestamp.fromMillis(active ? start : now), count: count + 1, expiresAt: Timestamp.fromMillis(now + 86400000) });
  });
}
function lockoutRemaining(record) {
  return Math.max(0, Number(record?.lockedUntil?.toMillis?.() || 0) - Date.now());
}
async function recordFailedPin(db, pinReference, originalHash) {
  let outcome = { locked: false, retryAfterMs: 0 };
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(pinReference);
    if (!snapshot.exists) throw new ProfilePinError(409, "pin-changed", "The profile PIN changed. Please try again.");
    const data = snapshot.data() || {};
    if (data.pinHash !== originalHash) throw new ProfilePinError(409, "pin-changed", "The profile PIN changed. Please try again.");
    const now = Date.now();
    const locked = lockoutRemaining(data);
    if (locked > 0) { outcome = { locked: true, retryAfterMs: locked }; return; }
    const failedAttempts = Number(data.failedAttempts || 0) >= PIN_ATTEMPT_LIMIT ? 1 : Number(data.failedAttempts || 0) + 1;
    const retryAfterMs = failedAttempts >= PIN_ATTEMPT_LIMIT ? PIN_LOCKOUT_MS : 0;
    transaction.set(pinReference, { failedAttempts, lockedUntil: retryAfterMs ? Timestamp.fromMillis(now + retryAfterMs) : null, updatedAt: Timestamp.fromMillis(now) }, { merge: true });
    outcome = { locked: retryAfterMs > 0, retryAfterMs };
  });
  return outcome;
}
async function clearFailedPinAttempts(db, pinReference, originalHash) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(pinReference);
    if (!snapshot.exists || snapshot.data()?.pinHash !== originalHash) throw new ProfilePinError(409, "pin-changed", "The profile PIN changed. Please try again.");
    transaction.set(pinReference, { failedAttempts: 0, lockedUntil: null, updatedAt: Timestamp.fromMillis(Date.now()) }, { merge: true });
  });
}
async function revokeProfileSessions(profileReference) {
  const snapshot = await profileReference.collection("profileSessions").get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = profileReference.firestore.batch();
    for (const item of snapshot.docs.slice(offset, offset + 400)) batch.delete(item.ref);
    await batch.commit();
  }
}
async function createProfileSession(serviceAccount, profileReference, uid, profileId, pinHash = "") {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + SESSION_TTL_MS);
  await profileReference.collection("profileSessions").doc(sessionId).create({
    uid, profileId, createdAt: Timestamp.fromMillis(now), lastActivityAt: Timestamp.fromMillis(now),
    expiresAt, revoked: false, ...(pinHash ? { pinHash } : {})
  });
  const profileSnapshot = await profileReference.get();
  const customToken = await createFirebaseCustomToken(uid, {
    profileId, profileSessionId: sessionId, isKids: profileSnapshot.data()?.isKids === true
  }, serviceAccount);
  return { customToken, sessionId, sessionExpiresAt: expiresAt.toMillis() };
}
async function verifyExistingPin(db, pinReference, pin) {
  const snapshot = await pinReference.get();
  if (!snapshot.exists) return false;
  const record = snapshot.data() || {};
  const remaining = lockoutRemaining(record);
  if (remaining > 0) throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: remaining });
  if (!await verifyProfilePinHash(pin, record)) {
    const outcome = await recordFailedPin(db, pinReference, record.pinHash);
    if (outcome.locked) throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: outcome.retryAfterMs });
    throw new ProfilePinError(401, "incorrect-pin", "That PIN is incorrect.");
  }
  await clearFailedPinAttempts(db, pinReference, record.pinHash);
  return true;
}
async function requireProfile(db, uid, profileId) {
  const reference = db.collection("users").doc(uid).collection("profiles").doc(profileId);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new ProfilePinError(404, "profile-not-found", "This profile is no longer available.");
  return reference;
}

export async function onRequestOptions({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  try {
    validateProfileOrigin(request, env);
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600",
      "Vary": "Origin", "Cache-Control": "no-store"
    }});
  } catch (error) { return json({ ok: false, code: error.code || "origin-not-allowed", message: error.message }, error.status || 403, "", env); }
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  try {
    validateProfileOrigin(request, env);
    const raw = await request.text();
    if (raw.length > 4096) throw new ProfilePinError(413, "request-too-large", "The profile security request is too large.");
    let body;
    try { body = JSON.parse(raw); } catch { throw new ProfilePinError(400, "invalid-request", "The PIN request could not be read."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProfilePinError(400, "invalid-request", "The PIN request could not be read.");
    const { db, user: claims, serviceAccount } = await requireProfileUser(request, env);
    const action = String(body.action || "");
    const profileId = validateProfileId(body.profileId);
    const profileReference = await requireProfile(db, claims.uid, profileId);
    const pinReference = profileReference.collection("profileSecurity").doc("pin");
    await consumeRateLimit(db, claims.uid, profileId);

    if (action === "select" || action === "verify") {
      const profilesCollection = db.collection("users").doc(claims.uid).collection("profiles");
      const targetSnapshot = await profileReference.get();
      const currentProfileId = String(claims.profileId || "");
      let currentIsKids = false;
      if (currentProfileId && currentProfileId !== profileId) {
        const currentSnapshot = await profilesCollection.doc(currentProfileId).get();
        currentIsKids = currentSnapshot.data()?.isKids === true;
        if (currentIsKids && profileId !== OWNER_PROFILE_ID && targetSnapshot.data()?.isKids !== true) throw new ProfilePinError(403, "parent-authorization-required", "A parent PIN is required to leave Kids Mode.");
      } else if (!currentProfileId) {
        const kidsProfiles = await profilesCollection.where("isKids", "==", true).limit(1).get();
        if (!kidsProfiles.empty && profileId !== OWNER_PROFILE_ID && targetSnapshot.data()?.isKids !== true) throw new ProfilePinError(403, "parent-authorization-required", "A parent PIN is required to leave Kids Mode.");
      }
      const pinSnapshot = await pinReference.get();
      if (action === "select") {
        if (currentIsKids && profileId === OWNER_PROFILE_ID && !pinSnapshot.exists) throw new ProfilePinError(409, "parent-pin-required", "The Main Profile needs a parent PIN. Sign out and sign back in to configure it.");
        if (pinSnapshot.exists) throw new ProfilePinError(423, "pin-required", "This profile is PIN protected. Enter its PIN to continue.");
        const session = await createProfileSession(serviceAccount, profileReference, claims.uid, profileId);
        return json({ ok: true, ...session }, 200, origin, env);
      }
      const pin = validatePin(body.pin);
      if (!pinSnapshot.exists) throw new ProfilePinError(409, "pin-not-set", "This profile no longer has a PIN.");
      const record = pinSnapshot.data() || {};
      const remaining = lockoutRemaining(record);
      if (remaining > 0) throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: remaining });
      if (!await verifyProfilePinHash(pin, record)) {
        const outcome = await recordFailedPin(db, pinReference, record.pinHash);
        if (outcome.locked) throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: outcome.retryAfterMs });
        throw new ProfilePinError(401, "incorrect-pin", "That PIN is incorrect.");
      }
      await clearFailedPinAttempts(db, pinReference, record.pinHash);
      const session = await createProfileSession(serviceAccount, profileReference, claims.uid, profileId, record.pinHash);
      return json({ ok: true, ...session }, 200, origin, env);
    }

    if (action === "restore") {
      const sessionId = String(body.sessionId || "");
      if (!PROFILE_ID_PATTERN.test(sessionId)) throw new ProfilePinError(401, "profile-session-invalid", "Choose your profile again to continue.");
      const [sessionSnapshot, pinSnapshot] = await Promise.all([
        profileReference.collection("profileSessions").doc(sessionId).get(), pinReference.get()
      ]);
      const session = sessionSnapshot.data() || {};
      const expiresAt = Number(session.expiresAt?.toMillis?.() || 0);
      const lastActivityAt = Number(session.lastActivityAt?.toMillis?.() || 0);
      const pinMatches = !pinSnapshot.exists || session.pinHash === pinSnapshot.data()?.pinHash;
      if (!sessionSnapshot.exists || session.uid !== claims.uid || session.profileId !== profileId || session.revoked === true ||
          expiresAt <= Date.now() || lastActivityAt <= Date.now() - SESSION_IDLE_TIMEOUT_MS || !pinMatches) {
        throw new ProfilePinError(401, "profile-session-expired", "Your profile session has expired. Choose your profile again.");
      }
      const targetSnapshot = await profileReference.get();
      await sessionSnapshot.ref.update({ lastActivityAt: Timestamp.fromMillis(Date.now()) });
      const customToken = await createFirebaseCustomToken(claims.uid, {
        profileId, profileSessionId: sessionId, isKids: targetSnapshot.data()?.isKids === true
      }, serviceAccount);
      return json({ ok: true, customToken, sessionId, sessionExpiresAt: expiresAt }, 200, origin, env);
    }

    if (action === "validate") {
      const sessionId = String(claims.profileSessionId || "");
      if (claims.profileId !== profileId || !PROFILE_ID_PATTERN.test(sessionId)) throw new ProfilePinError(401, "profile-session-invalid", "Unlock this profile again to continue.");
      const [sessionSnapshot, pinSnapshot] = await Promise.all([
        profileReference.collection("profileSessions").doc(sessionId).get(), pinReference.get()
      ]);
      const session = sessionSnapshot.data() || {};
      const expiresAt = Number(session.expiresAt?.toMillis?.() || 0);
      const lastActivityAt = Number(session.lastActivityAt?.toMillis?.() || 0);
      const pinMatches = !pinSnapshot.exists || session.pinHash === pinSnapshot.data()?.pinHash;
      if (!sessionSnapshot.exists || session.uid !== claims.uid || session.profileId !== profileId || session.revoked === true ||
          expiresAt <= Date.now() || lastActivityAt <= Date.now() - SESSION_IDLE_TIMEOUT_MS || !pinMatches) {
        throw new ProfilePinError(401, "profile-session-expired", "Your profile session has expired. Unlock it again.");
      }
      await sessionSnapshot.ref.update({ lastActivityAt: Timestamp.fromMillis(Date.now()) });
      return json({ ok: true, expiresAt }, 200, origin, env);
    }

    if (action === "set") {
      if (profileId === OWNER_PROFILE_ID && claims.profileId !== OWNER_PROFILE_ID) throw new ProfilePinError(403, "parent-authorization-required", "Open the Main Profile before setting its parent PIN.");
      const pin = validatePin(body.pin);
      const current = await pinReference.get();
      // PIN security is independent of the legacy library migration. A missing
      // migration marker must never prevent the owner from securing the account.
      if (current.exists) await verifyExistingPin(db, pinReference, validatePin(body.currentPin));
      const hashed = await hashProfilePin(pin);
      await pinReference.set({ ...hashed, failedAttempts: 0, lockedUntil: null, updatedAt: Timestamp.fromMillis(Date.now()) });
      await revokeProfileSessions(profileReference);
      const session = body.openSession === true ? await createProfileSession(serviceAccount, profileReference, claims.uid, profileId, hashed.pinHash) : {};
      return json({ ok: true, hasPin: true, ...session }, 200, origin, env);
    }

    if (action === "remove" || action === "reset") {
      if (action === "remove" && profileId === OWNER_PROFILE_ID) {
        const kidsProfiles = await profileReference.parent.where("isKids", "==", true).limit(1).get();
        if (!kidsProfiles.empty) throw new ProfilePinError(409, "kids-parent-pin-required", "The Main Profile PIN protects Kids Mode exit. Remove all Kids profiles before removing this PIN.");
      }
      if (action === "reset" && !isRecentAccountAuth(claims)) throw new ProfilePinError(403, "recent-sign-in-required", "Sign out and sign back in to reset this profile PIN.");
      const current = await pinReference.get();
      if (!current.exists) return json({ ok: true, hasPin: false }, 200, origin, env);
      if (action === "remove") {
        if (body.currentPin) await verifyExistingPin(db, pinReference, validatePin(body.currentPin));
        else if (!isRecentAccountAuth(claims)) throw new ProfilePinError(403, "pin-required", "Enter the current PIN or sign in again to remove it.");
      }
      await pinReference.delete();
      await revokeProfileSessions(profileReference);
      return json({ ok: true, hasPin: false }, 200, origin, env);
    }
    throw new ProfilePinError(400, "invalid-action", "Choose a valid profile security action.");
  } catch (error) {
    const status = error instanceof AnimePremiumError ? error.status : 500;
    if (status >= 500) console.error("Profile security request failed:", error?.code || error?.message || error);
    return json({
      ok: false,
      code: error?.code || "profile-security-unavailable",
      message: status >= 500 ? "Profile security is temporarily unavailable. Please retry." : error.message,
      ...(error?.details || {})
    }, status, origin, env);
  }
}
