import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";

const db = () => getFirestore();
const ROOM_MEMBER_LIMIT = 12;
const QUEUE_LIMIT = 50;
const MESSAGE_LIMIT = 500;
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
  const roomRef = db().collection("rooms").doc(roomId);
  const memberRef = roomRef.collection("members").doc(uid);
  const [room, member] = await Promise.all([roomRef.get(), memberRef.get()]);
  const expiresAt = room.exists ? room.data().expiresAt?.toMillis?.() : 0;
  if (!room.exists || room.data().status !== "open" || (expiresAt && expiresAt <= Date.now()) || !member.exists) {
    throw new HttpsError("permission-denied", "You are not a member of an open room.");
  }
  return { roomRef, room: room.data(), memberRef, member: member.data() };
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
export const heartbeatWatchRoom = onCall({ region: "us-central1", maxInstances: 30 }, async request => {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const { roomRef } = await requireRoomMember(roomId, uid);
  const now = Date.now();
  await roomRef.collection("presence").doc(uid).set({
    uid,
    lastSeenAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + PRESENCE_TTL_MS)
  }, { merge: true });
  return { expiresAt: now + PRESENCE_TTL_MS };
});

export const addWatchRoomQueueItem = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const title = cleanText(request.data?.title, "Film title", 180);
  const contentId = request.data?.contentId == null ? null : cleanText(String(request.data.contentId), "Catalogue ID", 80);
  const mediaType = request.data?.mediaType ?? "movie";
  if (!["movie", "tv"].includes(mediaType)) throw new HttpsError("invalid-argument", "Media type must be movie or tv.");
  const { roomRef, room, member } = await requireRoomMember(roomId, uid);
  if (room.allowGuestQueue === false && member.role !== "host") throw new HttpsError("permission-denied", "The host has paused guest queue suggestions.");
  const queueRef = roomRef.collection("queue");
  const itemRef = queueRef.doc();
  await db().runTransaction(async tx => {
    const existing = await tx.get(queueRef);
    if (existing.size >= QUEUE_LIMIT) throw new HttpsError("resource-exhausted", "The room queue is full.");
    tx.create(itemRef, {
      title, contentId, mediaType, addedBy: uid, votes: [uid],
      voteCount: 1, status: "queued", createdAt: Timestamp.now()
    });
  });
  return { itemId: itemRef.id };
});

export const voteWatchRoomQueueItem = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const itemId = validId(request.data?.itemId, "queue item ID");
  const { roomRef } = await requireRoomMember(roomId, uid);
  const itemRef = roomRef.collection("queue").doc(itemId);
  await db().runTransaction(async tx => {
    const item = await tx.get(itemRef);
    if (!item.exists || item.data().status !== "queued") throw new HttpsError("not-found", "That queue item is no longer available.");
    const votes = Array.isArray(item.data().votes) ? item.data().votes : [];
    const next = votes.includes(uid) ? votes.filter(id => id !== uid) : [...votes, uid];
    tx.update(itemRef, { votes: next, voteCount: next.length, updatedAt: Timestamp.now() });
  });
  return { updated: true };
});

export const sendWatchRoomMessage = onCall({ region: "us-central1", maxInstances: 30 }, async request => {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const text = cleanText(request.data?.text, "Message", MESSAGE_LIMIT);
  const { roomRef, room, memberRef, member } = await requireRoomMember(roomId, uid);
  if (room.allowGuestChat === false && member.role !== "host") throw new HttpsError("permission-denied", "The host has paused guest chat.");
  const messageRef = roomRef.collection("chat").doc();
  await db().runTransaction(async tx => {
    const member = await tx.get(memberRef);
    const last = member.data()?.lastChatAt?.toMillis?.() || 0;
    if (Date.now() - last < 700) throw new HttpsError("resource-exhausted", "Please slow down before sending another message.");
    tx.update(memberRef, { lastChatAt: Timestamp.now() });
    tx.create(messageRef, { uid, text, createdAt: Timestamp.now(), reactions: {} });
  });
  return { messageId: messageRef.id };
});

export const reactToWatchRoomMessage = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const messageId = validId(request.data?.messageId, "message ID");
  const reaction = request.data?.reaction;
  if (!["❤️", "😂", "👏", "😮", "🔥"].includes(reaction)) throw new HttpsError("invalid-argument", "That reaction is not supported.");
  const { roomRef } = await requireRoomMember(roomId, uid);
  const messageRef = roomRef.collection("chat").doc(messageId);
  await db().runTransaction(async tx => {
    const message = await tx.get(messageRef);
    if (!message.exists) throw new HttpsError("not-found", "That message could not be found.");
    const reactions = message.data().reactions || {};
    const users = Array.isArray(reactions[reaction]) ? reactions[reaction] : [];
    const nextUsers = users.includes(uid) ? users.filter(id => id !== uid) : [...users.filter(id => typeof id === "string").slice(-99), uid];
    tx.update(messageRef, { ["reactions." + reaction]: nextUsers });
  });
  return { updated: true };
});

export const updateWatchRoomSettings = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
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
  const { roomRef } = await requireHost(roomId, uid);
  await roomRef.update({ ...update, updatedAt: Timestamp.now() });
  await db().collection("users").doc(uid).collection("watchRooms").doc(roomId).set(update, { merge: true });
  return { updated: true };
});

export const removeWatchRoomMember = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const roomId = validId(request.data?.roomId, "room ID");
  const memberUid = validId(request.data?.memberUid, "member ID");
  if (memberUid === uid) throw new HttpsError("failed-precondition", "The host cannot remove themselves. Close the room instead.");
  const { roomRef } = await requireHost(roomId, uid);
  const targetRef = roomRef.collection("members").doc(memberUid);
  await db().runTransaction(async tx => {
    const target = await tx.get(targetRef);
    if (!target.exists) throw new HttpsError("not-found", "That member is not in this room.");
    tx.delete(targetRef);
    tx.delete(roomRef.collection("presence").doc(memberUid));
    tx.update(roomRef, { memberCount: FieldValue.increment(-1), updatedAt: Timestamp.now() });
  });
  await db().collection("users").doc(memberUid).collection("watchRooms").doc(roomId).delete().catch(() => {});
  return { removed: true };
});
