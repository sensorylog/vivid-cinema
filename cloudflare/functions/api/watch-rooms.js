import { createHash, randomBytes } from "node:crypto";
import { verifyFirebaseIdToken, verifyAndConsumeAppCheckToken } from "../lib/firebase-token-verification.js";
import { initializeApp as initializeRestApp } from "@ljoukov/firebase-admin-cloudflare/app";
import { getFirestore, Query, Timestamp } from "@ljoukov/firebase-admin-cloudflare/firestore";

let db;
let allowedOrigins;
let serviceAccount;
let projectId;

function initializeServices(env) {
  allowedOrigins = new Set([
    "https://vivid-cinema.pages.dev", "https://vivid-cinema.web.app",
    "https://vivid-cinema.firebaseapp.com",
    ...(env.VIVID_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)
  ]);
  if (db) return;
  const serviceAccountRaw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountRaw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured for Vivid on Cloudflare Pages.");
  serviceAccount = JSON.parse(serviceAccountRaw);
  projectId = env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is incomplete.");
  }
  const restApp = initializeRestApp({ serviceAccountJson: serviceAccountRaw, projectId }, "vivid-watch-rooms-rest");
  const firestore = getFirestore(restApp);
  db = new Proxy(firestore, {
    get(target, property, receiver) {
      if (property === "runTransaction") {
        return (callback, options) => target.runTransaction(async transaction => {
          const getDocument = transaction.get.bind(transaction);
          transaction.get = async reference => {
            if (reference instanceof Query) {
              const result = await reference.get();
              const documents = await Promise.all(result.docs.map(document => getDocument(document.ref)));
              const liveDocuments = documents.filter(document => document.exists);
              return { docs: liveDocuments, empty: liveDocuments.length === 0, size: liveDocuments.length };
            }
            return getDocument(reference);
          };
          return callback(transaction);
        }, options);
      }
      if (property === "recursiveDelete") return recursiveDelete;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

async function recursiveDelete(reference) {
  const collections = await reference.listCollections();
  for (const collection of collections) {
    const documents = await collection.listDocuments({ pageSize: 1000 });
    for (const document of documents) await recursiveDelete(document);
  }
  await reference.delete();
}

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.name = "HttpsError"; this.code = code; this.details = details; }
}


const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ROOM_MEMBERS = 12;
const MAX_CLUB_MEMBERS = 100;

function requireVividUser(request) {
  if (!request.auth || request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in with a Vivid account to use Watch Rooms.");
  }
  return request.auth;
}

function boundedText(value, field, max, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", field + " must be text.");
  }
  const normalized = value.trim();
  if ((required && normalized.length < 1) || normalized.length > max) {
    throw new HttpsError("invalid-argument", field + " must be " + (required ? "1–" : "0–") + max + " characters.");
  }
  return normalized;
}

function validDocumentId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError("invalid-argument", "A valid " + field + " is required.");
  }
  return value;
}

function inviteCode() {
  const bytes = randomBytes(10);
  let code = "";
  for (const byte of bytes) code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  return code;
}

function inviteHash(code) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function displayNameFor(auth) {
  const name = typeof auth.token.name === "string" ? auth.token.name.trim().slice(0, 80) : "";
  return name || "Vivid member";
}

async function createWatchRoom(request) {
  const auth = requireVividUser(request);
  const name = boundedText(request.data?.name, "Room name", 48, true);
  const filmTitle = boundedText(request.data?.filmTitle, "Film title", 100);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + ROOM_TTL_MS);
  const roomRef = db.collection("rooms").doc(randomBytes(20).toString("hex"));
  const memberRef = roomRef.collection("members").doc(auth.uid);
  const userRoomRef = db.collection("users").doc(auth.uid).collection("watchRooms").doc(roomRef.id);
  const code = inviteCode();
  const invitationRef = db.collection("watchInvitations").doc(inviteHash(code));
  const member = { userId: auth.uid, displayName: displayNameFor(auth), role: "host", joinedAt: now };

  // Create the room, host membership, private dashboard pointer and invite in
  // one transaction. The browser must never create a room and then fail on a
  // separate invitation request, leaving the user with a misleading denial.
  await db.runTransaction(async transaction => {
    transaction.create(roomRef, {
      schemaVersion: 1, name, filmTitle, hostUid: auth.uid,
      visibility: "invite", status: "open", memberCount: 1, queueCount: 0, chatCount: 0,
      createdAt: now, updatedAt: now, expiresAt
    });
    transaction.create(memberRef, member);
    transaction.create(userRoomRef, {
      roomId: roomRef.id, name, filmTitle, role: "host",
      status: "open", memberCount: 1, expiresAt, joinedAt: now, createdAt: now
    });
    transaction.create(invitationRef, {
      schemaVersion: 1, targetType: "room", targetId: roomRef.id, createdBy: auth.uid,
      createdAt: now, expiresAt, maxUses: MAX_ROOM_MEMBERS - 1,
      useCount: 0, revokedAt: null
    });
  });
  return {
    roomId: roomRef.id, name, filmTitle, role: "host", status: "open",
    memberCount: 1, joinedAt: now.toMillis(), expiresAt: expiresAt.toMillis(),
    inviteCode: code
  };
}

async function createCinemaClub(request) {
  const auth = requireVividUser(request);
  const name = boundedText(request.data?.name, "Club name", 48, true);
  const description = boundedText(request.data?.description, "Club description", 180);
  const now = Timestamp.now();
  const clubRef = db.collection("cinemaClubs").doc(randomBytes(20).toString("hex"));
  const memberRef = clubRef.collection("members").doc(auth.uid);
  const userClubRef = db.collection("users").doc(auth.uid).collection("cinemaClubs").doc(clubRef.id);
  const member = { userId: auth.uid, displayName: displayNameFor(auth), role: "owner", joinedAt: now };

  await db.runTransaction(async transaction => {
    transaction.create(clubRef, {