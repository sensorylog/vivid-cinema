import { createHash, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import Parser from "rss-parser";

initializeApp();
const db = getFirestore();
const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "VividCinemaNewsBot/1.0 (+https://vivid-cinema.web.app/news.html)" },
  customFields: { item: [["media:content", "mediaContent"], ["content:encoded", "contentEncoded"]] }
});
const MAX_ITEMS_PER_SOURCE = 25;
const MAX_SUMMARY_LENGTH = 280;
const MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function cleanText(value, max) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function canonicalUrl(value, source) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== source.domain && !url.hostname.endsWith("." + source.domain)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function categoryFor(source, item) {
  const text = (String(item.title || "") + " " + String(item.contentSnippet || "")).toLowerCase();
  if (source.region === "ghana") return "ghana";
  if (/nollywood|nigerian film|nigerian actor|lagos box office/.test(text)) return "nollywood";
  if (/ghana|ghanai|kumawood|accra/.test(text)) return "ghana";
  if (/african cinema|african film|afrobeats|africa/.test(text)) return "africa";
  if (/streaming|netflix|prime video|disney\+|hbo|max /.test(text)) return "streaming";
  if (/award|oscar|emmy|bafta|golden globe|cannes/.test(text)) return "awards";
  if (/television|tv series|season finale|showrunner/.test(text)) return "television";
  if (/trailer|teaser/.test(text)) return "trailers";
  if (/actor|actress|celebrity|singer|star |married|dating/.test(text)) return "celebrity";
  if (/box office|film|movie|director|cinema/.test(text)) return "film";
  return source.category || "industry";
}

function stableId(url) {
  return createHash("sha256").update(url).digest("hex").slice(0, 40);
}

function parsePublishedAt(item) {
  const raw = item.isoDate || item.pubDate || item.published || item.date;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  if (date.getTime() > now + FUTURE_SKEW_MS || now - date.getTime() > MAX_AGE_MS) return null;
  return date;
}


async function fetchFeedText(source, initialUrl) {
  let current = new URL(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const host = current.hostname.toLowerCase();
    if (current.protocol !== "https:" || !(host === source.domain || host.endsWith("." + source.domain))) {
      throw new Error("Feed redirect left the approved HTTPS publisher domain: " + source.id);
    }
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^\d+(?:\.\d+){3}$/.test(host) || host.startsWith("[")) {
      throw new Error("Feed host is not a permitted public publisher hostname: " + source.id);
    }
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": "VividCinemaNewsBot/1.0 (+https://vivid-cinema.web.app/news.html)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain;q=0.9"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("Feed redirected too many times or omitted its redirect target: " + source.id);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error("Feed request failed with HTTP " + response.status + ": " + source.id);
    const contentType = response.headers.get("content-type") || "";
    if (!/(xml|rss|atom|text\/plain)/i.test(contentType)) throw new Error("Publisher feed returned an unexpected content type: " + source.id);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 2_000_000) throw new Error("Publisher feed exceeded the 2 MB limit: " + source.id);
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > 2_000_000) throw new Error("Publisher feed exceeded the 2 MB limit: " + source.id);
      return text;
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) {
        await reader.cancel();
        throw new Error("Publisher feed exceeded the 2 MB limit: " + source.id);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("Feed redirect handling failed: " + source.id);
}

async function ingestSource(source) {
  if (!source.approvedForUse || !source.feedUrl) return { source: source.id, skipped: true, reason: "not approved" };
  const feedUrl = new URL(source.feedUrl);
  if (feedUrl.protocol !== "https:" || (feedUrl.hostname !== source.domain && !feedUrl.hostname.endsWith("." + source.domain))) {
    throw new Error("Feed host is not on the approved source domain: " + source.id);
  }
  const xml = await fetchFeedText(source, feedUrl.toString());
  const feed = await parser.parseString(xml);
  let written = 0;
  for (const item of (feed.items || []).slice(0, MAX_ITEMS_PER_SOURCE)) {
    const sourceUrl = canonicalUrl(item.link, source);
    const headline = cleanText(item.title, 240);
    const publishedDate = parsePublishedAt(item);
    if (!sourceUrl || headline.length < 8 || !publishedDate) continue;
    const id = stableId(sourceUrl);
    const articleRef = db.collection("articles").doc(id);
    const summary = cleanText(item.contentSnippet || item.summary || item.content || "", MAX_SUMMARY_LENGTH);
    const tags = [categoryFor(source, item), source.region].filter(Boolean);
    const payload = {
      publisher: source.publisher,
      publisherId: source.id,
      sourceDomain: source.domain,
      sourceUrl,
      headline,
      summary,
      category: categoryFor(source, item),
      region: source.region,
      regionLabel: source.regionLabel,
      tags,
      publishedAt: Timestamp.fromDate(publishedDate),
      ingestedAt: Timestamp.now(),
      status: "published",
      attribution: "Publisher-provided feed metadata",
      imageUrl: null
    };
    // Never download or republish full articles. No feed-provided image is copied
    // until the publisher's image-use terms are explicitly reviewed.
    await articleRef.set(payload, { merge: true });
    written++;
  }
  return { source: source.id, written };
}

export const ingestVividNews = onSchedule({
  schedule: "every 30 minutes",
  timeZone: "UTC",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
  maxInstances: 1
}, async () => {
  // This opt-in prevents a deployment from syndicating any feed before source
  // reuse/display terms have been reviewed and the owner explicitly enables it.
  if (process.env.VIVID_NEWS_INGESTION_ENABLED !== "true") {
    logger.info("Vivid News ingestion is disabled; source approval is required.");
    return;
  }
  const sourceSnapshot = await db.collection("newsSources")
    .where("status", "==", "approved")
    .where("feedApproved", "==", true)
    .get();
  const regionLabels = { global: "Global", ghana: "Ghana", nigeria: "Nigeria / Nollywood", africa: "Wider Africa" };
  const approved = sourceSnapshot.docs.map(document => {
    const source = document.data();
    return {
      ...source,
      id: document.id,
      region: source.defaultRegion,
      regionLabel: regionLabels[source.defaultRegion] || "Global",
      category: source.defaultCategory || "industry",
      approvedForUse: source.feedApproved === true
    };
  }).filter(source => source.feedUrl && source.domain && source.publisher);
  if (!approved.length) {
    logger.info("News ingestion has no approved feed sources in the moderator registry.");
    return;
  }
  const results = await Promise.allSettled(approved.map(ingestSource));
  results.forEach((result, index) => {
    if (result.status === "rejected") logger.error("News source ingestion failed", {
      source: approved[index].id,
      message: String(result.reason?.message || result.reason)
    });
    else logger.info("News source ingestion finished", result.value);
  });
});


// Return aggregate poll results without exposing individual vote documents to clients.
export const getCommunityPollResults = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  if (!request.auth || request.auth.token.email_verified !== true) {
    throw new HttpsError("unauthenticated", "Verified sign-in is required to view poll results.");
  }
  const pollId = request.data?.pollId;
  if (typeof pollId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(pollId)) {
    throw new HttpsError("invalid-argument", "A valid poll ID is required.");
  }
  const pollSnapshot = await db.collection("communityPolls").doc(pollId).get();
  if (!pollSnapshot.exists || pollSnapshot.data().status !== "published") {
    throw new HttpsError("not-found", "This poll is not available.");
  }
  const options = pollSnapshot.data().options;
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
    throw new HttpsError("failed-precondition", "This poll has invalid options.");
  }
  const votes = await db.collection("communityPolls").doc(pollId).collection("votes").limit(500).get();
  const counts = options.map(() => 0);
  for (const vote of votes.docs) {
    const index = vote.data().optionIndex;
    if (Number.isInteger(index) && index >= 0 && index < counts.length) counts[index]++;
  }
  return { counts, total: counts.reduce((sum, count) => sum + count, 0) };
});


// -----------------------------------------------------------------------------
// Watch Rooms and Cinema Clubs — trusted lifecycle and invitation operations.
// Client SDK writes to these collections are denied by firestore.rules.
// -----------------------------------------------------------------------------

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

export const createWatchRoom = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const auth = requireVividUser(request);
  const name = boundedText(request.data?.name, "Room name", 48, true);
  const filmTitle = boundedText(request.data?.filmTitle, "Film title", 100);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + ROOM_TTL_MS);
  const roomRef = db.collection("rooms").doc();
  const memberRef = roomRef.collection("members").doc(auth.uid);
  const userRoomRef = db.collection("users").doc(auth.uid).collection("watchRooms").doc(roomRef.id);
  const member = { userId: auth.uid, displayName: displayNameFor(auth), role: "host", joinedAt: now };

  await db.runTransaction(async transaction => {
    transaction.create(roomRef, {
      schemaVersion: 1, name, filmTitle, hostUid: auth.uid,
      visibility: "invite", status: "open", memberCount: 1,
      createdAt: now, updatedAt: now, expiresAt
    });
    transaction.create(memberRef, member);
    transaction.create(userRoomRef, {
      roomId: roomRef.id, name, filmTitle, role: "host",
      status: "open", memberCount: 1, expiresAt, joinedAt: now, createdAt: now
    });
  });
  return { roomId: roomRef.id, expiresAt: expiresAt.toMillis() };
});

export const createCinemaClub = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
  const auth = requireVividUser(request);
  const name = boundedText(request.data?.name, "Club name", 48, true);
  const description = boundedText(request.data?.description, "Club description", 180);
  const now = Timestamp.now();
  const clubRef = db.collection("cinemaClubs").doc();
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
});

export const createWatchInvitation = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
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
});

export const redeemWatchInvitation = onCall({ region: "us-central1", maxInstances: 30 }, async (request) => {
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
    if (invitation.revokedAt || invitation.expiresAt.toMillis() <= now.toMillis() || invitation.useCount >= invitation.maxUses) {
      throw new HttpsError("failed-precondition", "This invitation is expired, revoked or full.");
    }
    const isRoom = invitation.targetType === "room";
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
    if (memberSnapshot.exists) return { targetType: invitation.targetType, targetId: invitation.targetId, alreadyMember: true };
    const target = targetSnapshot.data();
    if ((isRoom && (target.status !== "open" || !target.expiresAt || target.expiresAt.toMillis() <= now.toMillis())) || (!isRoom && target.status !== "active")) {
      throw new HttpsError("failed-precondition", "This space is no longer accepting members.");
    }
    const limit = isRoom ? MAX_ROOM_MEMBERS : MAX_CLUB_MEMBERS;
    if (!Number.isInteger(target.memberCount) || target.memberCount >= limit) {
      throw new HttpsError("resource-exhausted", "This space has reached its member limit.");
    }
    const role = isRoom ? "guest" : "member";
    const displayName = displayNameFor(auth);
    transaction.create(memberRef, { userId: auth.uid, displayName, role, joinedAt: now });
    transaction.create(pointerRef, {
      [isRoom ? "roomId" : "clubId"]: invitation.targetId,
      name: target.name, ...(isRoom ? { filmTitle: target.filmTitle || "" } : { description: target.description || "" }),
      role, status: target.status, memberCount: target.memberCount + 1, ...(isRoom ? { expiresAt: target.expiresAt } : {}), joinedAt: now, createdAt: now
    });
    transaction.update(targetRef, { memberCount: target.memberCount + 1, updatedAt: now });
    transaction.update(invitationRef, { useCount: invitation.useCount + 1, lastUsedAt: now });
    return { targetType: invitation.targetType, targetId: invitation.targetId, alreadyMember: false };
  });
});

export const revokeWatchInvitation = onCall({ region: "us-central1", maxInstances: 20 }, async (request) => {
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
});


// Watch Rooms Stage 4: trusted lobby, queue, chat and host-control operations.
export {
  heartbeatWatchRoom,
  addWatchRoomQueueItem,
  voteWatchRoomQueueItem,
  sendWatchRoomMessage,
  reactToWatchRoomMessage,
  updateWatchRoomSettings,
  removeWatchRoomMember,
  closeWatchRoom
} from "./watch-rooms-lobby.js";
