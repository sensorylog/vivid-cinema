import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://vivid-cinema.pages.dev",
  "https://android.vivid-cinema.pages.dev",
  "https://vivid-cinema.web.app",
  "https://vivid-cinema.firebaseapp.com",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost"
];
const PIN_ITERATIONS = 310000;
const PIN_BYTES = 32;
const PIN_SALT_BYTES = 16;
const PIN_ATTEMPT_LIMIT = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;
const PIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const PIN_RATE_LIMIT = 30;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const RECENT_AUTH_MS = 5 * 60 * 1000;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PIN_PATTERN = /^\d{4}$/;

class ProfilePinError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function allowedOrigins() {
  const configured = String(process.env.VIVID_ALLOWED_ORIGINS || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function isAllowedOrigin(origin) {
  if (allowedOrigins().has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !isAllowedOrigin(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  return true;
}

function sendError(res, status, code, message, details = {}) {
  return res.status(status).json({ ok: false, code, message, ...details });
}

function getAdminApp() {
  if (getApps().length) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const serviceAccount = JSON.parse(raw);
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service account JSON is incomplete.");
  }
  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length <= 4096) {
    try { return JSON.parse(req.body); } catch {}
  }
  throw new ProfilePinError(400, "invalid-request", "The PIN request could not be read.");
}

function validatePin(pin) {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    throw new ProfilePinError(400, "invalid-pin", "A profile PIN must contain exactly four digits.");
  }
  return pin;
}

function validateProfileId(profileId) {
  if (typeof profileId !== "string" || !PROFILE_ID_PATTERN.test(profileId)) {
    throw new ProfilePinError(400, "invalid-profile", "Choose a valid Vivid profile.");
  }
  return profileId;
}

export function hashProfilePin(pin) {
  validatePin(pin);
  const salt = randomBytes(PIN_SALT_BYTES);
  const hash = pbkdf2Sync(pin, salt, PIN_ITERATIONS, PIN_BYTES, "sha256");
  return {
    pinSalt: salt.toString("base64url"),
    pinHash: hash.toString("base64url"),
    iterations: PIN_ITERATIONS
  };
}

export function verifyProfilePinHash(pin, record) {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin) ||
      !record || typeof record.pinSalt !== "string" || typeof record.pinHash !== "string") return false;
  const iterations = Number(record.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
  try {
    const salt = Buffer.from(record.pinSalt, "base64url");
    const expected = Buffer.from(record.pinHash, "base64url");
    if (salt.length !== PIN_SALT_BYTES || expected.length !== PIN_BYTES) return false;
    const actual = pbkdf2Sync(pin, salt, iterations, PIN_BYTES, "sha256");
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function isRecentAccountAuth(claims) {
  const authTime = Number(claims?.auth_time || 0) * 1000;
  const provider = String(claims?.firebase?.sign_in_provider || "");
  return authTime > 0 && Date.now() - authTime <= RECENT_AUTH_MS && claims?.email_verified === true && provider !== "custom" && provider !== "anonymous";
}

async function consumeRateLimit(db, uid, profileId) {
  const key = Buffer.from(uid + ":" + profileId).toString("base64url").slice(0, 120);
  const reference = db.collection("profilePinRateLimits").doc(key);
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const start = Number(data.windowStartedAt?.toMillis?.() || 0);
    const active = start > 0 && now - start < PIN_RATE_WINDOW_MS;
    const count = active ? Number(data.count || 0) : 0;
    if (count >= PIN_RATE_LIMIT) {
      throw new ProfilePinError(429, "pin-rate-limited", "Too many profile security requests. Try again later.");
    }
    transaction.set(reference, {
      windowStartedAt: Timestamp.fromMillis(active ? start : now),
      count: count + 1,
      expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000)
    });
  });
}

function lockoutRemaining(record) {
  const lockedUntil = Number(record?.lockedUntil?.toMillis?.() || 0);
  return Math.max(0, lockedUntil - Date.now());
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
    if (locked > 0) {
      outcome = { locked: true, retryAfterMs: locked };
      return;
    }
    const previous = Number(data.failedAttempts || 0);
    const failedAttempts = previous >= PIN_ATTEMPT_LIMIT ? 1 : previous + 1;
    const retryAfterMs = failedAttempts >= PIN_ATTEMPT_LIMIT ? PIN_LOCKOUT_MS : 0;
    transaction.set(pinReference, {
      failedAttempts,
      lockedUntil: retryAfterMs ? Timestamp.fromMillis(now + retryAfterMs) : null,
      updatedAt: Timestamp.fromMillis(now)
    }, { merge: true });
    outcome = { locked: retryAfterMs > 0, retryAfterMs };
  });
  return outcome;
}

async function clearFailedPinAttempts(db, pinReference, originalHash) {
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(pinReference);
    if (!snapshot.exists || snapshot.data()?.pinHash !== originalHash) {
      throw new ProfilePinError(409, "pin-changed", "The profile PIN changed. Please try again.");
    }
    transaction.set(pinReference, {
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: Timestamp.fromMillis(Date.now())
    }, { merge: true });
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

async function createProfileSession(auth, profileReference, uid, profileId, pinHash = "") {
  const sessionId = randomUUID();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + SESSION_TTL_MS);
  await profileReference.collection("profileSessions").doc(sessionId).create({
    uid,
    profileId,
    createdAt: Timestamp.fromMillis(now),
    expiresAt,
    revoked: false,
    ...(pinHash ? { pinHash } : {})
  });
  const customToken = await auth.createCustomToken(uid, {
    profileId,
    profileSessionId: sessionId
  });
  return { customToken, sessionExpiresAt: expiresAt.toMillis() };
}

async function requireProfile(db, uid, profileId) {
  const reference = db.collection("users").doc(uid).collection("profiles").doc(profileId);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new ProfilePinError(404, "profile-not-found", "This profile is no longer available.");
  return reference;
}

async function verifyExistingPin(db, pinReference, pin) {
  const snapshot = await pinReference.get();
  if (!snapshot.exists) return false;
  const record = snapshot.data() || {};
  const remaining = lockoutRemaining(record);
  if (remaining > 0) {
    throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: remaining });
  }
  if (!verifyProfilePinHash(pin, record)) {
    const outcome = await recordFailedPin(db, pinReference, record.pinHash);
    if (outcome.locked) {
      throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: outcome.retryAfterMs });
    }
    throw new ProfilePinError(401, "incorrect-pin", "That PIN is incorrect.");
  }
  await clearFailedPinAttempts(db, pinReference, record.pinHash);
  return true;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    if (!setCors(req, res)) return sendError(res, 403, "origin-not-allowed", "This origin is not allowed.");
    return res.status(204).end();
  }
  if (req.method !== "POST") return sendError(res, 405, "method-not-allowed", "Use POST for profile security.");
  if (!setCors(req, res)) return sendError(res, 403, "origin-not-allowed", "This origin is not allowed.");

  try {
    if (Number(req.headers["content-length"] || 0) > 4096) {
      throw new ProfilePinError(413, "request-too-large", "The profile security request is too large.");
    }
    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new ProfilePinError(401, "unauthenticated", "Sign in to manage profile security.");

    const app = getAdminApp();
    const auth = getAuth(app);
    const db = getFirestore(app);
    const claims = await auth.verifyIdToken(match[1], true);
    const body = getBody(req);
    const action = String(body.action || "");
    const profileId = validateProfileId(body.profileId);
    const profileReference = await requireProfile(db, claims.uid, profileId);
    const pinReference = profileReference.collection("profileSecurity").doc("pin");

    if (action !== "validate") await consumeRateLimit(db, claims.uid, profileId);

    if (action === "select") {
      const pinSnapshot = await pinReference.get();
      if (pinSnapshot.exists) {
        throw new ProfilePinError(423, "pin-required", "This profile is PIN protected. Enter its PIN to continue.");
      }
      const customToken = await auth.createCustomToken(claims.uid, { profileId });
      return res.status(200).json({ ok: true, customToken });
    }

    if (action === "validate") {
      const sessionId = String(claims.profileSessionId || "");
      if (claims.profileId !== profileId || !PROFILE_ID_PATTERN.test(sessionId)) {
        throw new ProfilePinError(401, "profile-session-invalid", "Unlock this profile again to continue.");
      }
      const [sessionSnapshot, pinSnapshot] = await Promise.all([
        profileReference.collection("profileSessions").doc(sessionId).get(),
        pinReference.get()
      ]);
      const session = sessionSnapshot.data() || {};
      const expiresAt = Number(session.expiresAt?.toMillis?.() || 0);
      const pinMatches = !pinSnapshot.exists || session.pinHash === pinSnapshot.data()?.pinHash;
      if (!sessionSnapshot.exists || session.uid !== claims.uid || session.profileId !== profileId ||
          session.revoked === true || expiresAt <= Date.now() || !pinMatches) {
        throw new ProfilePinError(401, "profile-session-expired", "Your profile session has expired. Unlock it again.");
      }
      return res.status(200).json({ ok: true, expiresAt });
    }

    if (action === "verify") {
      const pin = validatePin(body.pin);
      const pinSnapshot = await pinReference.get();
      if (!pinSnapshot.exists) throw new ProfilePinError(409, "pin-not-set", "This profile no longer has a PIN.");
      const record = pinSnapshot.data() || {};
      const remaining = lockoutRemaining(record);
      if (remaining > 0) {
        throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: remaining });
      }
      if (!verifyProfilePinHash(pin, record)) {
        const outcome = await recordFailedPin(db, pinReference, record.pinHash);
        if (outcome.locked) {
          throw new ProfilePinError(423, "pin-locked", "Too many incorrect attempts. Try again after the lockout ends.", { retryAfterMs: outcome.retryAfterMs });
        }
        throw new ProfilePinError(401, "incorrect-pin", "That PIN is incorrect.");
      }
      await clearFailedPinAttempts(db, pinReference, record.pinHash);
      const session = await createProfileSession(auth, profileReference, claims.uid, profileId, record.pinHash);
      return res.status(200).json({ ok: true, ...session });
    }

    if (action === "set") {
      const pin = validatePin(body.pin);
      const current = await pinReference.get();
      const migration = await db.collection("users").doc(claims.uid).collection("profiles").doc("owner").collection("migrations").doc("account-data-to-owner-profile-v1").get();
      if (migration.data()?.status !== "complete") {
        throw new ProfilePinError(409, "profile-setup-incomplete", "Finish setting up your profile before adding a PIN.");
      }
      if (current.exists) {
        const currentPin = validatePin(body.currentPin);
        await verifyExistingPin(db, pinReference, currentPin);
      }
      const hashed = hashProfilePin(pin);
      await pinReference.set({
        ...hashed,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: Timestamp.fromMillis(Date.now())
      });
      await revokeProfileSessions(profileReference);
      let session = {};
      if (body.openSession === true) session = await createProfileSession(auth, profileReference, claims.uid, profileId, hashed.pinHash);
      return res.status(200).json({ ok: true, hasPin: true, ...session });
    }

    if (action === "remove" || action === "reset") {
      if (action === "reset" && !isRecentAccountAuth(claims)) {
        throw new ProfilePinError(403, "recent-sign-in-required", "Sign out and sign back in to reset this profile PIN.");
      }
      const current = await pinReference.get();
      if (!current.exists) return res.status(200).json({ ok: true, hasPin: false });
      if (action === "remove") {
        if (body.currentPin) await verifyExistingPin(db, pinReference, validatePin(body.currentPin));
        else if (!isRecentAccountAuth(claims)) {
          throw new ProfilePinError(403, "pin-required", "Enter the current PIN or sign in again to remove it.");
        }
      }
      await pinReference.delete();
      await revokeProfileSessions(profileReference);
      return res.status(200).json({ ok: true, hasPin: false });
    }

    throw new ProfilePinError(400, "invalid-action", "Choose a valid profile security action.");
  } catch (error) {
    if (error instanceof ProfilePinError) {
      return sendError(res, error.status, error.code, error.message, error.details);
    }
    console.error("Profile PIN request failed:", error);
    return sendError(res, 500, "profile-security-unavailable", "Profile security is temporarily unavailable.");
  }
}
