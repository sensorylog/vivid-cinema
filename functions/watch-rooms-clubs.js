import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";

const db = () => getFirestore();
const MAX_WATCHLIST_ITEMS = 100;
const MAX_DISCUSSION_MESSAGES = 200;

function requireUser(request) {
  if (!request.auth || request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", "Sign in with a Vivid account to use Cinema Clubs.");
  }
  return request.auth.uid;
}

function validId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(value)) {
    throw new HttpsError("invalid-argument", "A valid " + label + " is required.");
  }
  return value;
}

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
  const clubRef = db().collection("cinemaClubs").doc(clubId);
  const memberRef = clubRef.collection("members").doc(uid);
  const [club, member] = await Promise.all([clubRef.get(), memberRef.get()]);
  if (!club.exists || club.data().status !== "active" || !member.exists) {
    throw new HttpsError("permission-denied", "You must be a member of an active Cinema Club.");
  }
  return { clubRef, club: club.data(), member };
}

export const addCinemaClubWatchlistItem = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const { mediaType, contentId } = mediaIdentity(request.data);
  const title = clean(request.data?.title, "Film title", 180);
  const year = clean(String(request.data?.year || ""), "Release year", 10, true);
  const posterPath = clean(String(request.data?.posterPath || ""), "Poster path", 500, true);
  const { clubRef } = await requireClubMember(clubId, uid);
  const listRef = clubRef.collection("watchlist");
  const itemRef = listRef.doc(contentId.replace(":", "_"));
  await db().runTransaction(async tx => {
    const [club, member, item] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid)), tx.get(itemRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of this club.");
    if (item.exists) return;
    if (Number(club.data().watchlistCount || 0) >= MAX_WATCHLIST_ITEMS) throw new HttpsError("resource-exhausted", "This club's shared watchlist is full.");
    tx.create(itemRef, { contentId, mediaType, title, year, posterPath, addedBy: uid, createdAt: Timestamp.now() });
    tx.update(clubRef, { watchlistCount: Number(club.data().watchlistCount || 0) + 1, updatedAt: Timestamp.now() });
  });
  return { added: true, itemId: itemRef.id };
});

export const removeCinemaClubWatchlistItem = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const itemId = validId(request.data?.itemId, "watchlist item ID");
  const { clubRef } = await requireClubMember(clubId, uid);
  const itemRef = clubRef.collection("watchlist").doc(itemId);
  await db().runTransaction(async tx => {
    const [club, member, item] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid)), tx.get(itemRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of an active club.");
    if (item.exists) {
      tx.delete(itemRef);
      tx.update(clubRef, { watchlistCount: Math.max(0, Number(club.data().watchlistCount || 0) - 1), updatedAt: Timestamp.now() });
    }
  });
  return { removed: true };
});

export const recordCinemaClubScreening = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
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
  const screeningRef = clubRef.collection("screenings").doc();
  await db().runTransaction(async tx => {
    const [club, member] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid))]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of this club.");
    tx.create(screeningRef, {
      contentId, mediaType, title, notes, screenedAt: Timestamp.fromMillis(screenedAtInput),
      recordedBy: uid, reviewCount: 0, ratingTotal: 0, averageRating: 0, discussionCount: 0, createdAt: Timestamp.now()
    });
  });
  return { screeningId: screeningRef.id };
});

export const addCinemaClubAfterCreditsReview = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
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
  await db().runTransaction(async tx => {
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
});

export const addCinemaClubDiscussionMessage = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const screeningId = validId(request.data?.screeningId, "screening ID");
  const message = clean(request.data?.message, "Discussion message", 1000);
  const { clubRef } = await requireClubMember(clubId, uid);
  const screeningRef = clubRef.collection("screenings").doc(screeningId);
  const messageRef = screeningRef.collection("discussion").doc();
  await db().runTransaction(async tx => {
    const [club, member, screening] = await Promise.all([tx.get(clubRef), tx.get(clubRef.collection("members").doc(uid)), tx.get(screeningRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) throw new HttpsError("permission-denied", "You are no longer a member of an active club.");
    if (!screening.exists) throw new HttpsError("not-found", "Screening not found.");
    if (Number(screening.data().discussionCount || 0) >= MAX_DISCUSSION_MESSAGES) throw new HttpsError("resource-exhausted", "This screening discussion has reached its limit.");
    tx.create(messageRef, { uid, message, createdAt: Timestamp.now() });
    tx.update(screeningRef, { discussionCount: Number(screening.data().discussionCount || 0) + 1 });
  });
  return { messageId: messageRef.id };
});

export const leaveCinemaClub = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const clubRef = db().collection("cinemaClubs").doc(clubId);
  const memberRef = clubRef.collection("members").doc(uid);
  const pointerRef = db().collection("users").doc(uid).collection("cinemaClubs").doc(clubId);
  await db().runTransaction(async tx => {
    const [club, member] = await Promise.all([tx.get(clubRef), tx.get(memberRef)]);
    if (!club.exists || club.data().status !== "active" || !member.exists) {
      throw new HttpsError("permission-denied", "You must be a member of an active Cinema Club.");
    }
    if (member.data().role === "owner" || club.data().ownerUid === uid) {
      throw new HttpsError("failed-precondition", "The club owner must archive the club instead of leaving it.");
    }
    tx.delete(memberRef);
    tx.delete(pointerRef);
    tx.update(clubRef, { memberCount: Math.max(1, Number(club.data().memberCount || 1) - 1), updatedAt: Timestamp.now() });
  });
  return { left: true };
});

export const archiveCinemaClub = onCall({ region: "us-central1", maxInstances: 20 }, async request => {
  const uid = requireUser(request);
  const clubId = validId(request.data?.clubId, "club ID");
  const clubRef = db().collection("cinemaClubs").doc(clubId);
  await db().runTransaction(async tx => {
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
      tx.delete(db().collection("users").doc(member.id).collection("cinemaClubs").doc(clubId));
    });
  });
  return { archived: true };
});

