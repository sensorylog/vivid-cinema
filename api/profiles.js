import { getApp, getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  MAX_PROFILES, OWNER_PROFILE_ID, PROFILE_AVATAR_IDS, PROFILE_ID_PATTERN,
  normalizeProfile
} from "../scripts/profile-schema.js";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://vivid-cinema.pages.dev",
  "https://android.vivid-cinema.pages.dev",
  "https://vivid-cinema.web.app",
  "https://vivid-cinema.firebaseapp.com",
  "https://localhost",
  "capacitor://localhost",
  "http://localhost"
]);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

class ProfilesApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getAdminApp() {
  if (getApps().length) return getApp();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new ProfilesApiError(503, "firebase-not-configured", "Vivid profile storage is not configured on the server.");
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw); }
  catch { throw new ProfilesApiError(503, "firebase-not-configured", "Vivid profile storage credentials are invalid."); }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new ProfilesApiError(503, "firebase-not-configured", "Vivid profile storage credentials are incomplete.");
  }
  return initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
}

function allowedOrigin(origin) {
  if (!origin || DEFAULT_ALLOWED_ORIGINS.has(origin)) return Boolean(origin);
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".vivid-cinema.pages.dev");
  } catch { return false; }
}

function cors(req, res) {
  const origin = req.headers.origin || "";
  if (!allowedOrigin(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
  return true;
}

function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || "profile-service-unavailable";
  if (status >= 500) console.error("Vivid profiles API failed", { code, message: String(error?.message || error), stack: error?.stack });
  return res.status(status).json({
    ok: false,
    code,
    message: status >= 500
      ? (code === "firebase-not-configured" ? "Vivid profile storage is not configured. Please contact support." : "Vivid profiles are temporarily unavailable.")
      : error.message
  });
}

function getBody(req) {
  let body = req.body && typeof req.body === "object" ? req.body : null;
  if (!body && typeof req.body === "string") {
    try { body = JSON.parse(req.body); }
    catch { throw new ProfilesApiError(400, "invalid-request", "A valid profile request is required."); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProfilesApiError(400, "invalid-request", "A valid profile request is required.");
  }
  return body;
}

async function authenticate(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ProfilesApiError(401, "unauthenticated", "Sign in with your Vivid account to manage profiles.");
  const app = getAdminApp();
  let user;
  try { user = await getAuth(app).verifyIdToken(match[1], true); }
  catch { throw new ProfilesApiError(401, "invalid-id-token", "Your Vivid sign-in needs refreshing. Please sign in again."); }
  return { app, db: getFirestore(app), auth: getAuth(app), user };
}

async function rateLimit(db, uid, action, limit) {
  const ref = db.collection("profileApiRateLimits").doc(uid + "_" + action);
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const windowStart = Number(data.windowStart || 0);
    const count = windowStart > now - 60 * 60 * 1000 ? Number(data.count || 0) : 0;
    if (count >= limit) throw new ProfilesApiError(429, "rate-limited", "Too many profile requests. Please wait and try again.");
    transaction.set(ref, { windowStart: count ? windowStart : now, count: count + 1, updatedAt: Timestamp.fromMillis(now) });
  });
}

async function requireUnlockedProfile(db, user, profileId) {
  if (!user?.uid || user.profileId !== profileId) {
    throw new ProfilesApiError(403, "profile-authorization-required", "Open the Main Profile before managing household profiles.");
  }
  const reference = db.collection("users").doc(user.uid).collection("profiles").doc(profileId);
  const [profileSnapshot, pinSnapshot] = await Promise.all([
    reference.get(),
    reference.collection("profileSecurity").doc("pin").get()
  ]);
  if (!profileSnapshot.exists) throw new ProfilesApiError(404, "profile-not-found", "This Vivid profile no longer exists.");
  const profile = profileSnapshot.data() || {};
  if (profileId === OWNER_PROFILE_ID && profile.isOwner !== true) {
    throw new ProfilesApiError(409, "owner-profile-required", "The Main Profile is not initialized correctly.");
  }
  if (!pinSnapshot.exists) return profile;
  const sessionId = String(user.profileSessionId || "");
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new ProfilesApiError(401, "profile-session-required", "Unlock this profile again before managing profiles.");
  const sessionSnapshot = await reference.collection("profileSessions").doc(sessionId).get();
  const session = sessionSnapshot.data() || {};
  const expiresAt = Number(session.expiresAt?.toMillis?.() || 0);
  const lastActivityAt = Number(session.lastActivityAt?.toMillis?.() || 0);
  if (!sessionSnapshot.exists || session.uid !== user.uid || session.profileId !== profileId ||
      session.revoked === true || expiresAt <= Date.now() ||
      lastActivityAt <= Date.now() - SESSION_IDLE_TIMEOUT_MS ||
      session.pinHash !== pinSnapshot.data()?.pinHash) {
    throw new ProfilesApiError(401, "profile-session-expired", "This profile unlock has expired. Enter its PIN again.");
  }
  return profile;
}

function serializeProfile(id, data = {}, avatarData = "") {
  const normalized = normalizeProfile(id, { ...data, avatarData });
  const iso = value => typeof value?.toDate === "function" ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : null;
  return { ...normalized, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt) };
}

async function listProfiles(req, res) {
  const { db, user } = await authenticate(req);
  await rateLimit(db, user.uid, "list", 90);
  const includeAvatars = new URL(req.url, "https://vivid-cinema-api.vercel.app").searchParams.get("includeAvatars") === "1";
  const profilesRef = db.collection("users").doc(user.uid).collection("profiles");
  const ownerRef = profilesRef.doc(OWNER_PROFILE_ID);
  const [snapshot, migrationSnapshot] = await Promise.all([
    profilesRef.get(),
    ownerRef.collection("migrations").doc("account-data-to-owner-profile-v1").get()
  ]);
  const profiles = await Promise.all(snapshot.docs.map(async doc => {
    const ref = doc.ref;
    const [pinSnapshot, avatarSnapshot] = await Promise.all([
      ref.collection("profileSecurity").doc("pin").get(),
      includeAvatars ? ref.collection("avatar").doc("image").get() : Promise.resolve(null)
    ]);
    const avatarData = includeAvatars ? (avatarSnapshot?.data()?.data || doc.data()?.avatarData || "") : "";
    return { ...serializeProfile(doc.id, doc.data() || {}, avatarData), hasPin: pinSnapshot.exists };
  }));
  const validProfiles = profiles.filter(profile => profile.id === OWNER_PROFILE_ID || PROFILE_ID_PATTERN.test(profile.id));
  validProfiles.sort((a, b) => a.id === OWNER_PROFILE_ID ? -1 : b.id === OWNER_PROFILE_ID ? 1 : String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return res.status(200).json({ ok: true, profiles: validProfiles, migrationComplete: migrationSnapshot.data()?.status === "complete" });
}

function cleanProfileInput(profileId, body, role) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 48) throw new ProfilesApiError(400, "invalid-profile-name", "Profile names must contain 1–48 characters.");
  const avatarId = String(body.avatarId || "aurora");
  if (!PROFILE_AVATAR_IDS.has(avatarId)) throw new ProfilesApiError(400, "invalid-avatar", "Choose an avatar from the Vivid collection.");
  const avatarSource = String(body.avatarSource || (profileId === OWNER_PROFILE_ID ? "auto" : "collection"));
  if (!["auto", "google", "collection", "upload"].includes(avatarSource) ||
      (avatarSource === "auto" && profileId !== OWNER_PROFILE_ID)) {
    throw new ProfilesApiError(400, "invalid-avatar-source", "Choose a valid profile photo source.");
  }
  const avatarUrl = avatarSource === "auto" || avatarSource === "google" ? String(body.avatarUrl || "") : "";
  const avatarData = avatarSource === "upload" ? String(body.avatarData || "") : "";
  if (avatarUrl && !/^https:\/\//i.test(avatarUrl)) throw new ProfilesApiError(400, "invalid-avatar-url", "Profile photo URLs must use secure HTTPS.");
  if (avatarSource === "upload" && (!avatarData.startsWith("data:image/webp;base64,") || avatarData.length > 180000)) {
    throw new ProfilesApiError(400, "invalid-avatar-image", "Upload a valid compressed WebP image.");
  }
  const policyFields = ["isKids", "movieRatingLimit", "tvRatingLimit", "blockedGenreIds", "blockedTitles", "allowUnrated"];
  if (policyFields.some(key => Object.prototype.hasOwnProperty.call(body, key)) && role !== OWNER_PROFILE_ID) {
    throw new ProfilesApiError(403, "parent-authorization-required", "Only the Main Profile can configure Kids Mode and parental controls.");
  }
  return normalizeProfile(profileId, {
    name, avatarId, avatarSource, avatarUrl, avatarData,
    isKids: body.isKids === true,
    movieRatingLimit: body.movieRatingLimit,
    tvRatingLimit: body.tvRatingLimit,
    blockedGenreIds: body.blockedGenreIds,
    blockedTitles: body.blockedTitles,
    allowUnrated: body.allowUnrated
  });
}

async function createProfile(req, res) {
  const { db, user } = await authenticate(req);
  await rateLimit(db, user.uid, "create", 10);
  const body = getBody(req);
  const profilesRef = db.collection("users").doc(user.uid).collection("profiles");
  if (user.profileId) {
    const active = await requireUnlockedProfile(db, user, user.profileId);
    if (active.isKids) throw new ProfilesApiError(403, "parent-authorization-required", "Kids profiles cannot create additional profiles.");
  } else {
    const kids = await profilesRef.where("isKids", "==", true).limit(1).get();
    if (!kids.empty) throw new ProfilesApiError(403, "parent-authorization-required", "Open the Main Profile before managing profiles while Kids profiles exist.");
  }
  if (body.isKids === true && user.profileId !== OWNER_PROFILE_ID) {
    throw new ProfilesApiError(403, "parent-authorization-required", "Open the Main Profile before creating a Kids profile.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 48) throw new ProfilesApiError(400, "invalid-profile-name", "Enter a profile name between 1 and 48 characters.");
  const now = Timestamp.fromMillis(Date.now());
  const ownerRef = profilesRef.doc(OWNER_PROFILE_ID);
  const limitRef = ownerRef.collection("profileManagement").doc("limits");
  let created;
  await db.runTransaction(async transaction => {
    const [profiles, owner, limits, ownerPin] = await Promise.all([
      transaction.get(profilesRef),
      transaction.get(ownerRef),
      transaction.get(limitRef),
      transaction.get(ownerRef.collection("profileSecurity").doc("pin"))
    ]);
    if (!owner.exists || owner.data()?.isOwner !== true) {
      throw new ProfilesApiError(409, "owner-profile-required", "The Main Profile must be initialized before adding profiles.");
    }
    if (body.isKids === true && !ownerPin.exists) {
      throw new ProfilesApiError(409, "parent-pin-required", "Set a PIN on the Main Profile before creating a Kids profile.");
    }
    if (profiles.size >= MAX_PROFILES) throw new ProfilesApiError(409, "profile-limit-reached", "A Vivid account can have up to " + MAX_PROFILES + " profiles.");
    const ref = profilesRef.doc();
    const normalized = cleanProfileInput(ref.id, body, user.profileId || "");
    const { avatarData, ...metadata } = normalized;
    created = { ...metadata, createdAt: now, updatedAt: now };
    transaction.create(ref, created);
    if (avatarData) transaction.create(ref.collection("avatar").doc("image"), { data: avatarData, updatedAt: now });
    transaction.set(limitRef, { profileCount: profiles.size + 1, updatedAt: now });
  });
  return res.status(201).json({ ok: true, profile: serializeProfile(created.id, created) });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    if (!cors(req, res)) return res.status(403).json({ ok: false, code: "origin-not-allowed", message: "This origin is not allowed." });
    return res.status(204).end();
  }
  if (!cors(req, res)) return res.status(403).json({ ok: false, code: "origin-not-allowed", message: "This origin is not allowed." });
  try {
    if (req.method === "GET") return await listProfiles(req, res);
    if (req.method === "POST") return await createProfile(req, res);
    return res.status(405).json({ ok: false, code: "method-not-allowed", message: "Use GET or POST for profile management." });
  } catch (error) {
    return sendError(res, error);
  }
}
