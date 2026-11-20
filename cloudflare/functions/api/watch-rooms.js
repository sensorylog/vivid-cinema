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

async function getWatchRoomDashboard(request) {
  const auth = requireVividUser(request);
  const userRef = db.collection("users").doc(auth.uid);
  const [roomSnapshot, clubSnapshot] = await Promise.all([
    userRef.collection("watchRooms").limit(100).get(),
    userRef.collection("cinemaClubs").limit(100).get()
  ]);
  const timestampMillis = value => value?.toMillis?.() ?? (typeof value === "number" ? value : null);
  const normalize = (document, idField) => {
    const data = document.data();
    return {
      ...data,
      [idField]: data[idField] || document.id,
      joinedAt: timestampMillis(data.joinedAt),
      createdAt: timestampMillis(data.createdAt),
      ...(data.expiresAt != null ? { expiresAt: timestampMillis(data.expiresAt) } : {})
    };
  };
  const newestFirst = (a, b) => Number(b.createdAt || b.joinedAt || 0) - Number(a.createdAt || a.joinedAt || 0);
  return {
    rooms: roomSnapshot.docs.map(document => normalize(document, "roomId")).sort(newestFirst),
    clubs: clubSnapshot.docs.map(document => normalize(document, "clubId")).sort(newestFirst)
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
      schemaVersion: 1, name, description, ownerUid: auth.uid,
      membership: "invite", status: "active", memberCount: 1,
      createdAt: now, updatedAt: now
    });
    transaction.create(memberRef, member);
    transaction.create(userClubRef, {
      clubId: clubRef.id, name, description, role: "owner",
      status: "active", memberCount: 1, joinedAt: now, createdAt: now
    });
  });
  return { clubId: clubRef.id };
}

async function createWatchInvitation(request) {
  const auth = requireVividUser(request);
  const targetType = request.data?.targetType;
  if (!["room", "club"].includes(targetType)) {
    throw new HttpsError("invalid-argument", "Invitation target must be a room or club.");
  }
  const targetId = validDocumentId(request.data?.targetId, "target ID");
  const collectionName = targetType === "room" ? "rooms" : "cinemaClubs";
  const ownerField = targetType === "room" ? "hostUid" : "ownerUid";
  const targetRef = db.collection(collectionName).doc(targetId);
  const memberRef = targetRef.collection("members").doc(auth.uid);
  const now = Timestamp.now();
  const defaultExpiresAt = Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS);
  let expiresAt = defaultExpiresAt;
  const code = inviteCode();
  const tokenHash = inviteHash(code);
  const invitationRef = db.collection("watchInvitations").doc(tokenHash);

  await db.runTransaction(async transaction => {
    const targetSnapshot = await transaction.get(targetRef);
    const memberSnapshot = await transaction.get(memberRef);
    if (!targetSnapshot.exists || !memberSnapshot.exists || targetSnapshot.data()[ownerField] !== auth.uid) {
      throw new HttpsError("permission-denied", "Only the room host or club owner can create invitations.");
    }
    const target = targetSnapshot.data();
    if (targetType === "room" && target.expiresAt && target.expiresAt.toMillis() < expiresAt.toMillis()) expiresAt = target.expiresAt;
    if ((targetType === "room" && (target.status !== "open" || !target.expiresAt || target.expiresAt.toMillis() <= now.toMillis())) || (targetType === "club" && target.status !== "active")) {
      throw new HttpsError("failed-precondition", "This space is not accepting invitations.");
    }
    transaction.create(invitationRef, {
      schemaVersion: 1, targetType, targetId, createdBy: auth.uid,
      createdAt: now, expiresAt, maxUses: targetType === "room" ? MAX_ROOM_MEMBERS - 1 : MAX_CLUB_MEMBERS - 1,
      useCount: 0, revokedAt: null
    });
  });
  return { inviteCode: code, expiresAt: expiresAt.toMillis() };
}

async function redeemWatchInvitation(request) {
  const auth = requireVividUser(request);
  const code = typeof request.data?.inviteCode === "string"
    ? request.data.inviteCode.trim().toUpperCase()
    : "";
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Enter a valid Vivid invitation code.");
  }
  const invitationRef = db.collection("watchInvitations").doc(inviteHash(code));
  const now = Timestamp.now();

  return db.runTransaction(async transaction => {
    const invitationSnapshot = await transaction.get(invitationRef);
    if (!invitationSnapshot.exists) throw new HttpsError("not-found", "This invitation is invalid or has expired.");
    const invitation = invitationSnapshot.data();
    const isRoom = invitation.targetType === "room";
    if (request.data?.expectedTargetType && request.data.expectedTargetType !== invitation.targetType) throw new HttpsError("failed-precondition", "This invitation is for a different Vivid space.");
    const targetCollection = isRoom ? "rooms" : invitation.targetType === "club" ? "cinemaClubs" : null;
    if (!targetCollection) throw new HttpsError("failed-precondition", "This invitation has an invalid destination.");
    const targetRef = db.collection(targetCollection).doc(invitation.targetId);
    const memberRef = targetRef.collection("members").doc(auth.uid);
    const pointerCollection = isRoom ? "watchRooms" : "cinemaClubs";
    const pointerRef = db.collection("users").doc(auth.uid).collection(pointerCollection).doc(invitation.targetId);
    const [targetSnapshot, memberSnapshot] = await Promise.all([
      transaction.get(targetRef), transaction.get(memberRef)
    ]);
    if (!targetSnapshot.exists) throw new HttpsError("not-found", "This space is no longer available.");
    const target = targetSnapshot.data();
    const targetIsActive = (isRoom && target.status === "open" && target.expiresAt && target.expiresAt.toMillis() > now.toMillis()) || (!isRoom && target.status === "active");
    if (memberSnapshot.exists) {
      if (!targetIsActive) throw new HttpsError("failed-precondition", "This space is no longer active.");
      return { targetType: invitation.targetType, targetId: invitation.targetId, alreadyMember: true };
    }
    if (invitation.revokedAt || invitation.expiresAt.toMillis() <= now.toMillis() || invitation.useCount >= invitation.maxUses) {
      throw new HttpsError("failed-precondition", "This invitation is expired, revoked or full.");
    }
    if (!targetIsActive) {
      throw new HttpsError("failed-precondition", "This space is no longer accepting members.");
    }
    const limit = isRoom ? MAX_ROOM_MEMBERS : MAX_CLUB_MEMBERS;
    if (!Number.isInteger(target.memberCount) || target.memberCount >= limit) {
      throw new HttpsError("resource-exhausted", "This space has reached its member limit.");
    }
    const existingMembers = await transaction.get(targetRef.collection("members"));
    const role = isRoom ? "guest" : "member";
    const displayName = displayNameFor(auth);
    const nextMemberCount = target.memberCount + 1;
    // Keep the private dashboard summaries in sync with the authoritative
    // parent count. These collections are deliberately capped at 12/100.
    existingMembers.docs.forEach(existingMember => {
      const existingData = existingMember.data();
      const existingPointerRef = db.collection("users").doc(existingMember.id).collection(pointerCollection).doc(invitation.targetId);
      transaction.set(existingPointerRef, {
        [isRoom ? "roomId" : "clubId"]: invitation.targetId,
        name: target.name,
        ...(isRoom ? { filmTitle: target.filmTitle || "", expiresAt: target.expiresAt } : { description: target.description || "" }),
        role: existingData.role, status: target.status, memberCount: nextMemberCount,
        joinedAt: existingData.joinedAt || now, createdAt: existingData.joinedAt || now
      }, { merge: true });
    });
    transaction.create(memberRef, { userId: auth.uid, displayName, role, joinedAt: now });
    transaction.create(pointerRef, {
      [isRoom ? "roomId" : "clubId"]: invitation.targetId,
      name: target.name, ...(isRoom ? { filmTitle: target.filmTitle || "" } : { description: target.description || "" }),
      role, status: target.status, memberCount: nextMemberCount, ...(isRoom ? { expiresAt: target.expiresAt } : {}), joinedAt: now, createdAt: now
    });
    transaction.update(targetRef, { memberCount: nextMemberCount, updatedAt: now });
    transaction.update(invitationRef, { useCount: invitation.useCount + 1, lastUsedAt: now });
    return { targetType: invitation.targetType, targetId: invitation.targetId, alreadyMember: false };
  });
}

async function revokeWatchInvitation(request) {
  const auth = requireVividUser(request);
  const code = typeof request.data?.inviteCode === "string"
    ? request.data.inviteCode.trim().toUpperCase()
    : "";
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(code)) {
    throw new HttpsError("invalid-argument", "A valid invitation code is required.");
  }
  const invitationRef = db.collection("watchInvitations").doc(inviteHash(code));
  const now = Timestamp.now();
  await db.runTransaction(async transaction => {
    const invitationSnapshot = await transaction.get(invitationRef);
    if (!invitationSnapshot.exists) throw new HttpsError("not-found", "Invitation not found.");
    const invitation = invitationSnapshot.data();
    const collectionName = invitation.targetType === "room" ? "rooms" : "cinemaClubs";
    const targetRef = db.collection(collectionName).doc(invitation.targetId);
    const targetSnapshot = await transaction.get(targetRef);
    const ownerField = invitation.targetType === "room" ? "hostUid" : "ownerUid";
    if (!targetSnapshot.exists || targetSnapshot.data()[ownerField] !== auth.uid) {
      throw new HttpsError("permission-denied", "Only the host or owner can revoke this invitation.");
    }
    if (!invitation.revokedAt) transaction.update(invitationRef, { revokedAt: now, revokedBy: auth.uid });
  });
  return { revoked: true };
}



/**
 * Retention cleanup for private Watch Rooms.
 *
 * Firestore TTL is intentionally not used as the sole cleanup mechanism:
 * deleting a parent document does not recursively delete its subcollections.
 * This bounded scheduled job removes expired invitation records, dashboard
 * pointers, and each expired room tree.
 */


const QUEUE_LIMIT = 50;
const MESSAGE_LIMIT = 500;
const ROOM_CHAT_LIMIT = 500;
const PRESENCE_TTL_MS = 90_000;

function requireUser(request) {
  if (!request.auth || request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in with a Vivid account to use this room.");
  }
  return request.auth.uid;
}

function validId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(value)) {
    throw new HttpsError("invalid-argument", "A valid " + label + " is required.");
  }
  return value;
}

function cleanText(value, label, max, required = true) {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", label + " must be text.");
  const text = value.trim();
  if ((required && !text) || text.length > max) {
    throw new HttpsError("invalid-argument", label + " must be " + (required ? "1–" : "0–") + max + " characters.");
  }
  return text;
}

async function requireRoomMember(roomId, uid) {
  const roomRef = db.collection("rooms").doc(roomId);
  const memberRef = roomRef.collection("members").doc(uid);
  const [room, member] = await Promise.all([roomRef.get(), memberRef.get()]);
  const expiresAt = room.exists ? room.data().expiresAt?.toMillis?.() : null;
  if (!room.exists || room.data().status !== "open" || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !member.exists) {
    throw new HttpsError("permission-denied", "You are not a member of an open room.");
  }
  return { roomRef, room: room.data(), memberRef, member: member.data() };
}


async function requireRoomMemberInTransaction(tx, roomId, uid) {
  const roomRef = db.collection("rooms").doc(roomId);
  const memberRef = roomRef.collection("members").doc(uid);
  const [roomSnapshot, memberSnapshot] = await Promise.all([tx.get(roomRef), tx.get(memberRef)]);
  const room = roomSnapshot.exists ? roomSnapshot.data() : null;
  const expiresAt = room?.expiresAt?.toMillis?.();
  if (!room || room.status !== "open" || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !memberSnapshot.exists) {
    throw new HttpsError("permission-denied", "You are not a member of an open room.");
  }
  return { roomRef, room, memberRef, member: memberSnapshot.data() };
}

async function requireHost(roomId, uid) {
  const context = await requireRoomMember(roomId, uid);
  if (context.room.hostUid !== uid || context.member.role !== "host") {
    throw new HttpsError("permission-denied", "Only the room host can change these settings.");
  }
  return context;
}

// Presence is a short lease, not durable membership. Clients refresh it while
// the lobby is open; stale leases naturally expire and are ignored by readers.

async function cleanupExpiredWatchRooms(request) {
  requireVividUser(request);
  const now = Timestamp.now();
  const lockRef = db.collection("system").doc("watchRoomCleanup");
  const acquired = await db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    const lastRunAt = lock.exists ? lock.data().lastRunAt?.toMillis?.() : 0;
    if (Number.isFinite(lastRunAt) && now.toMillis() - lastRunAt < 10 * 60 * 1000) return false;
    tx.set(lockRef, { lastRunAt: now, updatedAt: now }, { merge: true });
    return true;
  });
  if (!acquired) return { skipped: true, deletedRooms: 0, deletedInvitations: 0 };

  const expiredInvitations = await db.collection("watchInvitations")
    .where("expiresAt", "<=", now)
    .limit(100)
    .get();
  if (!expiredInvitations.empty) {
    const batch = db.batch();
    expiredInvitations.docs.forEach(document => batch.delete(document.ref));
    await batch.commit();
  }

  const expiredRooms = await db.collection("rooms")
    .where("expiresAt", "<=", now)
    .limit(1)
    .get();
  let deletedRooms = 0;
  for (const roomDocument of expiredRooms.docs) {
    const roomRef = roomDocument.ref;
    const members = await roomRef.collection("members").get();
    if (!members.empty) {
      const pointers = db.batch();
      members.docs.forEach(member => {
        pointers.delete(db.collection("users").doc(member.id).collection("watchRooms").doc(roomDocument.id));
      });
      await pointers.commit();
    }
    await recursiveDelete(roomRef);
    deletedRooms += 1;
  }
  await lockRef.set({
    lastCompletedAt: Timestamp.now(),
    lastDeletedRooms: deletedRooms,
    lastDeletedInvitations: expiredInvitations.size
  }, { merge: true });
  return { skipped: false, deletedRooms, deletedInvitations: expiredInvitations.size };
}

async function heartbeatWatchRoom(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const roomRef = db.collection("rooms").doc(roomId);
  const now = Date.now();
  await db.runTransaction(async tx => {
    await requireRoomMemberInTransaction(tx, roomId, uid);
    tx.set(roomRef.collection("presence").doc(uid), {
      uid, lastSeenAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + PRESENCE_TTL_MS)
    }, { merge: true });
  });
  return { expiresAt: now + PRESENCE_TTL_MS, serverTime: Date.now() };
}

async function addWatchRoomQueueItem(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const title = cleanText(request.data?.title, "Film title", 180);
  const contentId = request.data?.contentId == null ? null : cleanText(String(request.data.contentId), "Catalogue ID", 80);
  const mediaType = request.data?.mediaType ?? "movie";
  if (!["movie", "tv"].includes(mediaType)) throw new HttpsError("invalid-argument", "Media type must be movie or tv.");
  const roomRef = db.collection("rooms").doc(roomId);
  const itemRef = roomRef.collection("queue").doc(randomBytes(20).toString("hex"));
  await db.runTransaction(async tx => {
    const { room, member } = await requireRoomMemberInTransaction(tx, roomId, uid);
    if (room.allowGuestQueue === false && member.role !== "host") throw new HttpsError("permission-denied", "The host has paused guest queue suggestions.");
    const queueCount = Number(room.queueCount || 0);
    if (queueCount >= QUEUE_LIMIT) throw new HttpsError("resource-exhausted", "The room queue is full.");
    tx.create(itemRef, {
      title, contentId, mediaType, addedBy: uid, votes: [uid],
      voteCount: 1, status: "queued", createdAt: Timestamp.now()
    });
    tx.update(roomRef, { queueCount: queueCount + 1, updatedAt: Timestamp.now() });
  });
  return { itemId: itemRef.id };
}


async function removeWatchRoomQueueItem(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const itemId = validId(request.data?.itemId, "queue item ID");
  const roomRef = db.collection("rooms").doc(roomId);
  const itemRef = roomRef.collection("queue").doc(itemId);
  await db.runTransaction(async tx => {
    const { room, member } = await requireRoomMemberInTransaction(tx, roomId, uid);
    const item = await tx.get(itemRef);
    if (!item.exists || item.data().status !== "queued") throw new HttpsError("not-found", "That queue item is no longer available.");
    if (member.role !== "host" && item.data().addedBy !== uid) throw new HttpsError("permission-denied", "Only the host or the person who suggested this pick can remove it.");
    tx.delete(itemRef);
    tx.update(roomRef, { queueCount: Math.max(0, Number(room.queueCount || 0) - 1), updatedAt: Timestamp.now() });
  });
  return { removed: true };
}

async function voteWatchRoomQueueItem(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const itemId = validId(request.data?.itemId, "queue item ID");
  const roomRef = db.collection("rooms").doc(roomId);
  const itemRef = roomRef.collection("queue").doc(itemId);
  await db.runTransaction(async tx => {
    await requireRoomMemberInTransaction(tx, roomId, uid);
    const item = await tx.get(itemRef);
    if (!item.exists || item.data().status !== "queued") throw new HttpsError("not-found", "That queue item is no longer available.");
    const votes = Array.isArray(item.data().votes) ? item.data().votes : [];
    const next = votes.includes(uid) ? votes.filter(id => id !== uid) : [...votes, uid];
    tx.update(itemRef, { votes: next, voteCount: next.length, updatedAt: Timestamp.now() });
  });
  return { updated: true };
}

async function sendWatchRoomMessage(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const text = cleanText(request.data?.text, "Message", MESSAGE_LIMIT);
  const roomRef = db.collection("rooms").doc(roomId);
  const memberRef = roomRef.collection("members").doc(uid);
  const messageRef = roomRef.collection("chat").doc(randomBytes(20).toString("hex"));
  await db.runTransaction(async tx => {
    const { room, member } = await requireRoomMemberInTransaction(tx, roomId, uid);
    if (room.allowGuestChat === false && member.role !== "host") throw new HttpsError("permission-denied", "The host has paused guest chat.");
    const memberSnapshot = await tx.get(memberRef);
    const last = memberSnapshot.data()?.lastChatAt?.toMillis?.() || 0;
    if (Date.now() - last < 700) throw new HttpsError("resource-exhausted", "Please slow down before sending another message.");
    const chatCount = Number(room.chatCount || 0);
    if (chatCount >= ROOM_CHAT_LIMIT) throw new HttpsError("resource-exhausted", "This room has reached its message limit.");
    tx.update(memberRef, { lastChatAt: Timestamp.now() });
    tx.update(roomRef, { chatCount: chatCount + 1, updatedAt: Timestamp.now() });
    tx.create(messageRef, { uid, text, createdAt: Timestamp.now(), reactions: {} });
  });
  return { messageId: messageRef.id };
}

async function reactToWatchRoomMessage(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const messageId = validId(request.data?.messageId, "message ID");
  const reaction = request.data?.reaction;
  if (!["❤️", "😂", "👏", "😮", "🔥"].includes(reaction)) throw new HttpsError("invalid-argument", "That reaction is not supported.");
  const roomRef = db.collection("rooms").doc(roomId);
  const messageRef = roomRef.collection("chat").doc(messageId);
  await db.runTransaction(async tx => {
    await requireRoomMemberInTransaction(tx, roomId, uid);
    const message = await tx.get(messageRef);
    if (!message.exists) throw new HttpsError("not-found", "That message could not be found.");
    const reactions = message.data().reactions || {};
    const users = Array.isArray(reactions[reaction]) ? reactions[reaction] : [];
    const nextUsers = users.includes(uid) ? users.filter(id => id !== uid) : [...users.filter(id => typeof id === "string").slice(-99), uid];
    tx.update(messageRef, { ["reactions." + reaction]: nextUsers });
  });
  return { updated: true };
}

async function updateWatchRoomSettings(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const patch = request.data?.settings;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpsError("invalid-argument", "Room settings are required.");
  const allowed = ["name", "allowGuestQueue", "allowGuestChat"];
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new HttpsError("invalid-argument", "One or more room settings are not supported.");
  const update = {};
  if (Object.hasOwn(patch, "name")) update.name = cleanText(patch.name, "Room name", 80);
  for (const key of ["allowGuestQueue", "allowGuestChat"]) {
    if (Object.hasOwn(patch, key)) {
      if (typeof patch[key] !== "boolean") throw new HttpsError("invalid-argument", key + " must be true or false.");
      update[key] = patch[key];
    }
  }
  if (!Object.keys(update).length) throw new HttpsError("invalid-argument", "No room settings were supplied.");
  const roomRef = db.collection("rooms").doc(roomId);
  await db.runTransaction(async tx => {
    const { room, member } = await requireRoomMemberInTransaction(tx, roomId, uid);
    if (room.hostUid !== uid || member.role !== "host") throw new HttpsError("permission-denied", "Only the room host can change these settings.");
    const members = await tx.get(roomRef.collection("members"));
    const updatedAt = Timestamp.now();
    tx.update(roomRef, { ...update, updatedAt });
    members.docs.forEach(document => {
      tx.set(db.collection("users").doc(document.id).collection("watchRooms").doc(roomId), update, { merge: true });
    });
  });
  return { updated: true };
}

async function removeWatchRoomMember(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const memberUid = request.data?.memberUid;
  if (typeof memberUid !== "string" || !memberUid.length || memberUid.length > 128 || memberUid.includes("/")) throw new HttpsError("invalid-argument", "A valid member ID is required.");
  if (memberUid === uid) throw new HttpsError("failed-precondition", "The host cannot remove themselves. Close the room instead.");
  const roomRef = db.collection("rooms").doc(roomId);
  const targetRef = roomRef.collection("members").doc(memberUid);
  const pointerRef = db.collection("users").doc(memberUid).collection("watchRooms").doc(roomId);
  await db.runTransaction(async tx => {
    const { room, member } = await requireRoomMemberInTransaction(tx, roomId, uid);
    if (room.hostUid !== uid || member.role !== "host") throw new HttpsError("permission-denied", "Only the room host can remove members.");
    const target = await tx.get(targetRef);
    if (!target.exists) throw new HttpsError("not-found", "That member is not in this room.");
    const members = await tx.get(roomRef.collection("members"));
    const nextMemberCount = Math.max(1, Number(room.memberCount || 1) - 1);
    tx.delete(targetRef);
    tx.delete(roomRef.collection("presence").doc(memberUid));
    tx.delete(pointerRef);
    tx.update(roomRef, { memberCount: nextMemberCount, updatedAt: Timestamp.now() });
    members.docs.forEach(existing => {
      if (existing.id === memberUid) return;
      tx.set(db.collection("users").doc(existing.id).collection("watchRooms").doc(roomId), { memberCount: nextMemberCount }, { merge: true });
    });
  });
  return { removed: true };
}



async function leaveWatchRoom(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const roomRef = db.collection("rooms").doc(roomId);
  const memberRef = roomRef.collection("members").doc(uid);
  const pointerRef = db.collection("users").doc(uid).collection("watchRooms").doc(roomId);
  await db.runTransaction(async tx => {
    const { room, member } = await requireRoomMemberInTransaction(tx, roomId, uid);
    if (room.hostUid === uid || member.role === "host") {
      throw new HttpsError("failed-precondition", "The host must end the room instead of leaving it.");
    }
    const members = await tx.get(roomRef.collection("members"));
    const nextMemberCount = Math.max(1, Number(room.memberCount || 1) - 1);
    tx.delete(memberRef);
    tx.delete(roomRef.collection("presence").doc(uid));
    tx.delete(pointerRef);
    tx.update(roomRef, { memberCount: nextMemberCount, updatedAt: Timestamp.now() });
    members.docs.forEach(existing => {
      if (existing.id === uid) return;
      tx.set(db.collection("users").doc(existing.id).collection("watchRooms").doc(roomId), { memberCount: nextMemberCount }, { merge: true });
    });
  });
  return { left: true };
}

async function closeWatchRoom(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const roomRef = db.collection("rooms").doc(roomId);
  const closedAt = Timestamp.now();
  await db.runTransaction(async tx => {
    const { room, member } = await requireRoomMemberInTransaction(tx, roomId, uid);
    if (room.hostUid !== uid || member.role !== "host") throw new HttpsError("permission-denied", "Only the room host can close this room.");
    const members = await tx.get(roomRef.collection("members"));
    tx.update(roomRef, { status: "closed", closedAt, expiresAt: closedAt, updatedAt: closedAt });
    members.docs.forEach(document => {
      tx.set(db.collection("users").doc(document.id).collection("watchRooms").doc(roomId), { status: "closed" }, { merge: true });
    });
  });
  return { closed: true };
}


// The first synchronized adapter is limited to VidSrc's documented PLAYER_EVENT and parent-command protocol on vidsrc.sh.
async function publishWatchRoomPlayback(request) {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  if (request.data?.provider !== "vidsrc") throw new HttpsError("failed-precondition", "This provider is not enabled for synchronized playback.");
  const status = request.data?.status;
  if (!["playing", "paused", "ended"].includes(status)) throw new HttpsError("invalid-argument", "Playback status is not supported.");
  const contentId = cleanText(String(request.data?.contentId || ""), "Catalogue ID", 80);
  if (!/^(?:\d{1,12}|tt\d{5,12})$/.test(contentId)) throw new HttpsError("invalid-argument", "A valid TMDB or IMDb title ID is required.");
  const mediaType = request.data?.mediaType;
  if (!["movie", "tv"].includes(mediaType)) throw new HttpsError("invalid-argument", "Media type must be movie or tv.");
  const position = Number(request.data?.position);
  const duration = Number(request.data?.duration);
  if (!Number.isFinite(position) || position < 0 || position > 86400 || !Number.isFinite(duration) || duration < 0 || duration > 86400 || (duration > 0 && position > duration + 10)) throw new HttpsError("invalid-argument", "Playback position or duration is outside the supported range.");
  const season = mediaType === "tv" ? Number(request.data?.season) : null;
  const episode = mediaType === "tv" ? Number(request.data?.episode) : null;
  if (mediaType === "tv" && (!Number.isInteger(season) || season < 1 || season > 500 || !Number.isInteger(episode) || episode < 1 || episode > 5000)) throw new HttpsError("invalid-argument", "A valid season and episode are required.");
  const { roomRef } = await requireHost(roomId, uid);
  const stateRef = roomRef.collection("playback").doc("current");
  const now = Timestamp.now();
  return db.runTransaction(async tx => {
    const [roomSnapshot, memberSnapshot, current] = await Promise.all([
      tx.get(roomRef), tx.get(roomRef.collection("members").doc(uid)), tx.get(stateRef)
    ]);
    const roomData = roomSnapshot.exists ? roomSnapshot.data() : null;
    const memberData = memberSnapshot.exists ? memberSnapshot.data() : null;
    if (!roomData || roomData.status !== "open" || !Number.isFinite(roomData.expiresAt?.toMillis?.()) || roomData.expiresAt.toMillis() <= now.toMillis() || roomData.hostUid !== uid || memberData?.role !== "host") {
      throw new HttpsError("permission-denied", "Only the active host of an open room can publish playback.");
    }
    const previous = current.exists ? current.data() : null;
    if (previous && (previous.contentId !== contentId || previous.mediaType !== mediaType || (mediaType === "tv" && (previous.season !== season || previous.episode !== episode)))) throw new HttpsError("failed-precondition", "This room is already synchronized to a different title or episode.");
    if (previous?.lastEventAt?.toMillis && now.toMillis() - previous.lastEventAt.toMillis() < 1800 && status === "playing") return { accepted: false, reason: "rate-limited" };
    const revision = Number(previous?.revision || 0) + 1;
    tx.set(stateRef, { provider: "vidsrc", contentId, mediaType, season, episode, status, position, duration, hostUid: uid, revision, updatedAt: now, lastEventAt: now });
    return { accepted: true, revision };
  });
}

const MAX_WATCHLIST_ITEMS = 100;
const MAX_DISCUSSION_MESSAGES = 200;

function clean(value, label, max, optional = false) {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", label + " must be text.");
  const text = value.trim();
  if ((!optional && !text) || text.length > max) throw new HttpsError("invalid-argument", label + " must be " + (optional ? "0–" : "1–") + max + " characters.");
  return text;
}

function mediaIdentity(data) {
  const mediaType = data?.mediaType;
  const contentId = typeof data?.contentId === "string" ? data.contentId : "";
  if (!["movie", "tv"].includes(mediaType) || !new RegExp("^" + mediaType + ":[0-9]{1,12}$").test(contentId)) {
    throw new HttpsError("invalid-argument", "Choose a valid Vivid movie or TV catalogue item.");
  }
  return { mediaType, contentId };
}

async function requireClubMember(clubId, uid) {
  const clubRef = db.collection("cinemaClubs").doc(clubId);
  const memberRef = clubRef.collection("members").doc(uid);
  const [club, member] = await Promise.all([clubRef.get(), memberRef.get()]);
  if (!club.exists || club.data().status !== "active" || !member.exists) {
    throw new HttpsError("permission-denied", "You must be a member of an active Cinema Club.");
  }
  return { clubRef, club: club.data(), member };
}

async function addCinemaClubWatchlistItem(request) {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const { mediaType, contentId } = mediaIdentity(request.data);
  const title = clean(request.data?.title, "Film title", 180);
  const year = clean(String(request.data?.year || ""), "Release year", 10, true);
  const posterPath = clean(String(request.data?.posterPath || ""), "Poster path", 500, true);
  const { clubRef } = await requireClubMember(clubId, uid);
  const listRef = clubRef.collection("watchlist");
  const itemRef = listRef.doc(contentId.replace(":", "_"));
  await db.runTransaction(async tx => {
    const [club, member, item] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid)), tx.get(itemRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of this club.");
    if (item.exists) return;
    if (Number(club.data().watchlistCount || 0) >= MAX_WATCHLIST_ITEMS) throw new HttpsError("resource-exhausted", "This club's shared watchlist is full.");
    tx.create(itemRef, { contentId, mediaType, title, year, posterPath, addedBy: uid, createdAt: Timestamp.now() });
    tx.update(clubRef, { watchlistCount: Number(club.data().watchlistCount || 0) + 1, updatedAt: Timestamp.now() });
  });
  return { added: true, itemId: itemRef.id };
}

async function removeCinemaClubWatchlistItem(request) {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const itemId = validId(request.data?.itemId, "watchlist item ID");
  const { clubRef } = await requireClubMember(clubId, uid);
  const itemRef = clubRef.collection("watchlist").doc(itemId);
  await db.runTransaction(async tx => {
    const [club, member, item] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid)), tx.get(itemRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of an active club.");
    if (item.exists) {
      tx.delete(itemRef);
      tx.update(clubRef, { watchlistCount: Math.max(0, Number(club.data().watchlistCount || 0) - 1), updatedAt: Timestamp.now() });
    }
  });
  return { removed: true };
}

async function recordCinemaClubScreening(request) {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const { mediaType, contentId } = mediaIdentity(request.data);
  const title = clean(request.data?.title, "Film title", 180);
  const notes = clean(request.data?.notes || "", "Screening notes", 1000, true);
  const screenedAtInput = Number(request.data?.screenedAt || Date.now());
  if (!Number.isFinite(screenedAtInput) || screenedAtInput < Date.now() - 365 * 86400000 || screenedAtInput > Date.now() + 86400000) {
    throw new HttpsError("invalid-argument", "Screening date must be within the last year or next day.");
  }
  const { clubRef } = await requireClubMember(clubId, uid);
  const screeningRef = clubRef.collection("screenings").doc(randomBytes(20).toString("hex"));
  await db.runTransaction(async tx => {
    const [club, member] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid))]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of this club.");
    tx.create(screeningRef, {
      contentId, mediaType, title, notes, screenedAt: Timestamp.fromMillis(screenedAtInput),
      recordedBy: uid, reviewCount: 0, ratingTotal: 0, averageRating: 0, discussionCount: 0, createdAt: Timestamp.now()
    });
  });
  return { screeningId: screeningRef.id };
}

async function addCinemaClubAfterCreditsReview(request) {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const screeningId = validId(request.data?.screeningId, "screening ID");
  const rating = Number(request.data?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpsError("invalid-argument", "Choose a rating from 1 to 5.");
  const review = clean(request.data?.review || "", "After-Credits review", 1200, true);
  if (!review && rating < 1) throw new HttpsError("invalid-argument", "A rating is required.");
  const { clubRef } = await requireClubMember(clubId, uid);
  const screeningRef = clubRef.collection("screenings").doc(screeningId);
  const reviewRef = screeningRef.collection("afterCredits").doc(uid);
  await db.runTransaction(async tx => {
    const [club, member, screening, existing] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid)), tx.get(screeningRef), tx.get(reviewRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of an active club.");
    if (!screening.exists) throw new HttpsError("not-found", "Screening not found.");
    const oldRating = existing.exists ? Number(existing.data().rating || 0) : 0;
    const count = Number(screening.data().reviewCount || 0);
    const total = Number(screening.data().ratingTotal || 0) - oldRating + rating;
    const nextCount = count + (existing.exists ? 0 : 1);
    tx.set(reviewRef, { uid, rating, review, updatedAt: Timestamp.now() }, { merge: true });
    tx.update(screeningRef, { reviewCount: nextCount, ratingTotal: total, averageRating: Number((total / nextCount).toFixed(2)) });
  });
  return { saved: true };
}

async function addCinemaClubDiscussionMessage(request) {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const screeningId = validId(request.data?.screeningId, "screening ID");
  const message = clean(request.data?.message, "Discussion message", 1000);
  const { clubRef } = await requireClubMember(clubId, uid);
  const screeningRef = clubRef.collection("screenings").doc(screeningId);
  const messageRef = screeningRef.collection("discussion").doc(randomBytes(20).toString("hex"));
  await db.runTransaction(async tx => {
    const [club, member, screening] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid)), tx.get(screeningRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of an active club.");
    if (!screening.exists) throw new HttpsError("not-found", "Screening not found.");
    if (Number(screening.data().discussionCount || 0) >= MAX_DISCUSSION_MESSAGES) throw new HttpsError("resource-exhausted", "This screening discussion has reached its limit.");
    tx.create(messageRef, { uid, message, createdAt: Timestamp.now() });
    tx.update(screeningRef, { discussionCount: Number(screening.data().discussionCount || 0) + 1 });
  });
  return { messageId: messageRef.id };
}

async function leaveCinemaClub(request) {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const clubRef = db.collection("cinemaClubs").doc(clubId);
  const memberRef = clubRef.collection("members").doc(uid);
  const pointerRef = db.collection("users").doc(uid).collection("cinemaClubs").doc(clubId);
  await db.runTransaction(async tx => {
    const [club, member, members] = await Promise.all([
      tx.get(clubRef), tx.get(memberRef), tx.get(clubRef.collection("members"))
    ]);
    if (!club.exists || club.data().status !== "active" || !member.exists) {
      throw new HttpsError("permission-denied", "You must be a member of an active Cinema Club.");
    }
    if (member.data().role === "owner" || club.data().ownerUid === uid) {
      throw new HttpsError("failed-precondition", "The club owner must archive the club instead of leaving it.");
    }
    const nextMemberCount = Math.max(1, Number(club.data().memberCount || 1) - 1);
    tx.delete(memberRef);
    tx.delete(pointerRef);
    tx.update(clubRef, { memberCount: nextMemberCount, updatedAt: Timestamp.now() });
    members.docs.forEach(existing => {
      if (existing.id === uid) return;
      tx.set(db.collection("users").doc(existing.id).collection("cinemaClubs").doc(clubId), { memberCount: nextMemberCount }, { merge: true });
    });
  });
  return { left: true };
}

async function archiveCinemaClub(request) {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const clubRef = db.collection("cinemaClubs").doc(clubId);
  await db.runTransaction(async tx => {
    const [club, owner, members] = await Promise.all([
      tx.get(clubRef),
      tx.get(clubRef.collection("members").doc(uid)),
      tx.get(clubRef.collection("members"))
    ]);
    if (!club.exists || club.data().status !== "active") throw new HttpsError("failed-precondition", "This club is already archived.");
    if (club.data().ownerUid !== uid || !owner.exists || owner.data().role !== "owner") {
      throw new HttpsError("permission-denied", "Only the club owner can archive this Cinema Club.");
    }
    const archivedAt = Timestamp.now();
    tx.update(clubRef, { status: "archived", archivedAt, updatedAt: archivedAt });
    members.docs.forEach(member => {
      tx.delete(db.collection("users").doc(member.id).collection("cinemaClubs").doc(clubId));
    });
  });
  return { archived: true };
}

const operations = {
  createWatchRoom,
  getWatchRoomDashboard,
  createCinemaClub,
  createWatchInvitation,
  redeemWatchInvitation,
  revokeWatchInvitation,
  cleanupExpiredWatchRooms,
  heartbeatWatchRoom,
  addWatchRoomQueueItem,
  removeWatchRoomQueueItem,
  voteWatchRoomQueueItem,
  sendWatchRoomMessage,
  reactToWatchRoomMessage,
  updateWatchRoomSettings,
  removeWatchRoomMember,
  leaveWatchRoom,
  closeWatchRoom,
  publishWatchRoomPlayback,
  addCinemaClubWatchlistItem,
  removeCinemaClubWatchlistItem,
  recordCinemaClubScreening,
  addCinemaClubAfterCreditsReview,
  addCinemaClubDiscussionMessage,
  leaveCinemaClub,
  archiveCinemaClub
};

const ROUTES = new Set([
  "createWatchRoom","getWatchRoomDashboard","createCinemaClub","createWatchInvitation","redeemWatchInvitation","revokeWatchInvitation",
  "cleanupExpiredWatchRooms","heartbeatWatchRoom","addWatchRoomQueueItem","removeWatchRoomQueueItem","voteWatchRoomQueueItem",
  "sendWatchRoomMessage","reactToWatchRoomMessage","updateWatchRoomSettings","removeWatchRoomMember","leaveWatchRoom",
  "closeWatchRoom","publishWatchRoomPlayback","addCinemaClubWatchlistItem","removeCinemaClubWatchlistItem",
  "recordCinemaClubScreening","addCinemaClubAfterCreditsReview","addCinemaClubDiscussionMessage","leaveCinemaClub","archiveCinemaClub"
]);

async function authenticate(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpsError("unauthenticated", "Sign in to your Vivid account and try again.");
  const appCheckToken = String(req.headers["x-firebase-appcheck"] || "");
  if (!appCheckToken) throw new HttpsError("failed-precondition", "App Check verification is required.");
  let token;
  try {
    // Keep revocation checking enabled. It requires the service account to have
    // Firebase Authentication user-read permissions; do not disguise IAM or
    // credential failures as an expired end-user session.
    token = await verifyFirebaseIdToken(match[1], projectId, serviceAccount);
  } catch (error) {
    const code = String(error?.code || "unknown");
    console.error("Watch Rooms Firebase ID-token verification failed:", {
      code,
      message: error?.message || String(error),
      projectId: projectId || null
    });
    const invalidUserTokenCodes = new Set([
      "auth/id-token-expired",
      "auth/id-token-revoked",
      "auth/invalid-id-token",
      "auth/user-disabled"
    ]);
    if (invalidUserTokenCodes.has(code)) {
      throw new HttpsError("unauthenticated", "Your Vivid sign-in token is invalid or expired. Refresh your session and sign in again.");
    }
    // Permission, service-account, project and upstream failures are server
    // configuration errors (HTTP 500), not proof that the browser is signed out.
    throw error;
  }
  let appCheck;
  try {
    appCheck = await verifyAndConsumeAppCheckToken(appCheckToken, serviceAccount);
  } catch (error) {
    console.error("Watch Rooms App Check verification failed:", {
      code: error?.code || "unknown", message: error?.message || String(error)
    });
    throw new HttpsError("failed-precondition", "Vivid could not verify this browser. Refresh the page and try again.");
  }
  if (appCheck.alreadyConsumed) {
    throw new HttpsError("failed-precondition", "This app-verification token was already used. Refresh the page and try again.");
  }
  if (!token.uid || token.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in with a Vivid account to use Watch Rooms.");
  }
  return { uid: token.uid, token };
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".vivid-cinema.pages.dev");
  } catch { return false; }
}
function response(status, payload, origin) {
  const headers = new Headers({"Cache-Control":"no-store","Content-Type":"application/json; charset=utf-8"});
  if (origin) {
    headers.set("Access-Control-Allow-Origin",origin);
    headers.set("Access-Control-Allow-Methods","POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers","Authorization, Content-Type, X-Firebase-AppCheck");
    headers.set("Access-Control-Max-Age","600");
    headers.set("Vary","Origin");
  }
  return new Response(JSON.stringify(payload),{status,headers});
}
function optionsResponse(origin) {
  const headers = new Headers({
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Authorization, Content-Type, X-Firebase-AppCheck",
    "Access-Control-Max-Age":"600","Cache-Control":"no-store"
  });
  if (origin) { headers.set("Access-Control-Allow-Origin",origin); headers.set("Vary","Origin"); }
  return new Response(null,{status:204,headers});
}
export async function onRequest({request,env}) {
  const origin=request.headers.get("Origin")||"";
  try { initializeServices(env); }
  catch(error) {
    console.error("Vivid Watch Rooms Cloudflare configuration error:",error?.message||String(error));
    return response(500,{ok:false,code:"internal",message:"The Watch Rooms service is not configured yet."},isAllowedOrigin(origin)?origin:"");
  }
  if(!isAllowedOrigin(origin)) return response(403,{ok:false,code:"permission-denied",message:"This origin is not allowed."},origin);
  if(request.method==="OPTIONS") return optionsResponse(origin);
  if(request.method!=="POST") return response(405,{ok:false,code:"method-not-allowed",message:"Use POST for this endpoint."},origin);
  try {
    const raw=await request.text();
    if(raw.length>24000) throw new HttpsError("invalid-argument","This request is too large.");
    let body;
    try { body=JSON.parse(raw); } catch { throw new HttpsError("invalid-argument","A valid Watch Rooms request is required."); }
    if(!body||typeof body!=="object"||Array.isArray(body)) throw new HttpsError("invalid-argument","A valid Watch Rooms request is required.");
    const action=body.action;
    if(typeof action!=="string"||!ROUTES.has(action)) throw new HttpsError("invalid-argument","Unknown Watch Rooms operation.");
    const auth=await authenticate({headers:{
      authorization:request.headers.get("Authorization")||"",
      "x-firebase-appcheck":request.headers.get("X-Firebase-AppCheck")||""
    }});
    const result=await operations[action]({auth,data:body.data||{}});
    return response(200,{ok:true,data:result??null},origin);
  } catch(error) {
    const rawCode=error?.code||"internal";
    // Firestore's Google API can also return permission-denied when the
    // Cloudflare service account lacks database IAM access. That is a server
    // configuration failure, not a denial of the signed-in user's room role.
    const firestoreIamDenied = !(error instanceof HttpsError) && rawCode === "permission-denied";
    if (firestoreIamDenied) {
      console.error("Watch Rooms Firestore IAM permission denied during operation:", {
        action: body?.action || "unknown",
        code: rawCode,
        message: error?.message || String(error),
        projectId
      });
    }
    const code=firestoreIamDenied ? "internal" :
      rawCode.startsWith("app-check/") || rawCode.startsWith("appCheck/") ? "failed-precondition" : rawCode;
    const status=({
      unauthenticated:401,"permission-denied":403,"not-found":404,
      "auth/id-token-expired":401,"auth/id-token-revoked":401,"auth/invalid-id-token":401,"auth/argument-error":401,
      "app-check/invalid-argument":401,"app-check/invalid-credential":401,"app-check/app-check-token-expired":401,
      "invalid-argument":400,"failed-precondition":409,"resource-exhausted":429,"already-exists":409
    })[code]||500;
    if(!(error instanceof HttpsError)||status>=500) console.error("Vivid Watch Rooms Cloudflare API failed:",error);
    const safeMessage=error instanceof HttpsError&&status<500?error.message:
      status===401?"Your sign-in or app verification needs refreshing. Please refresh and try again.":"We couldn't complete that action right now. Please try again.";
    return response(status,{ok:false,code,message:safeMessage},origin);
  }
}
