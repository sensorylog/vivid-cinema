import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection, query, limit, serverTimestamp } from "firebase/firestore";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "vivid-cinema-rules-test",
  firestore: { rules }
});

test("owner can write a valid library item", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertSucceeds(setDoc(doc(db, "users/alice/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-backdrop.jpg",
    updatedAt: Date.now(), completion: 0
  }));
});

test("users cannot write to another user's library", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(setDoc(doc(db, "users/bob/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-backdrop.jpg",
    updatedAt: Date.now()
  }));
});

test("invalid completion values are rejected", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(setDoc(doc(db, "users/alice/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-backdrop.jpg",
    updatedAt: Date.now(), completion: 101
  }));
});

test("oversized event metadata maps are rejected", async () => {
  const db = env.authenticatedContext("alice").firestore();
  const metadata = Object.fromEntries(Array.from({ length: 21 }, (_, index) => ["field" + index, index]));
  await assertFails(setDoc(doc(db, "users/alice/events/event-1"), {
    id: "event-1", type: "playback_progress", occurredAt: Date.now(),
    sessionId: "session-1", metadata
  }));
});

test("taste profile maps are bounded", async () => {
  const db = env.authenticatedContext("alice").firestore();
  const genres = Object.fromEntries(Array.from({ length: 101 }, (_, index) => ["genre" + index, 1]));
  await assertFails(setDoc(doc(db, "users/alice/taste/profile"), {
    version: 1, genres, languages: {}, countries: {}, actors: {},
    directors: {}, media: {}, decades: {}, updatedAt: Date.now()
  }));
});

test("owners can persist only known personal achievement records", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertSucceeds(setDoc(doc(db, "users/alice/achievements/first-favorite"), {
    id: "first-favorite", unlockedAt: Date.now(), schemaVersion: 1
  }));
  await assertFails(setDoc(doc(db, "users/alice/achievements/not-a-real-achievement"), {
    id: "not-a-real-achievement", unlockedAt: Date.now(), schemaVersion: 1
  }));
  await assertFails(setDoc(doc(db, "users/alice/achievements/queue-first"), {
    id: "queue-first", unlockedAt: Date.now(), schemaVersion: 1, rewardPoints: 1000
  }));
});

test("achievement records remain private to their owner", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(setDoc(doc(db, "users/bob/achievements/first-favorite"), {
    id: "first-favorite", unlockedAt: Date.now(), schemaVersion: 1
  }));
});

test("unauthenticated users cannot read private user documents", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users/alice/favorites/movie:550"), {
      id: "550", media_type: "movie", title: "The Matrix", year: "1999",
      poster_path: "/matrix.jpg", backdrop_path: "/matrix-backdrop.jpg",
      updatedAt: Date.now()
    });
  });
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "users/alice/favorites/movie:550")));
});


test("analytics event writes are scoped to the signed-in user", async () => {
  const alice = env.authenticatedContext("alice").firestore();
  const validEvent = {
    event: "page_view", platform: "web", userId: "alice",
    sessionId: "session-1", timestamp: serverTimestamp(),
    appVersion: "test", details: { page: "/home.html" }
  };
  await assertSucceeds(setDoc(doc(alice, "analyticsEvents/alice-event"), validEvent));
  await assertFails(setDoc(doc(alice, "analyticsEvents/forged-user"), {
    ...validEvent, userId: "bob"
  }));
  await assertFails(setDoc(doc(alice, "analyticsEvents/invalid-platform"), {
    ...validEvent, platform: "server"
  }));
});

test("pseudonymous anonymous visitors can write their own first-open event", async () => {
  const anonymousVisitor = env.authenticatedContext("anonymous-visitor-1").firestore();
  await assertSucceeds(setDoc(doc(anonymousVisitor, "analyticsEvents/anonymous-first-open"), {
    event: "app_first_open",
    platform: "android",
    userId: "anonymous-visitor-1",
    sessionId: "anonymous-session-1",
    timestamp: serverTimestamp(),
    appVersion: "web-current",
    details: { identity_type: "anonymous", signal: "native_app_launch" }
  }));
  await assertFails(setDoc(doc(anonymousVisitor, "analyticsEvents/anonymous-forged-user"), {
    event: "app_first_open",
    platform: "android",
    userId: "another-visitor",
    sessionId: "anonymous-session-1",
    timestamp: serverTimestamp(),
    appVersion: "web-current",
    details: { identity_type: "anonymous" }
  }));
});

test("analytics event collection is readable only by the configured admin", async () => {
  const admin = env.authenticatedContext("awiBvDUVZvdyKnvOpGtD0rh2nZf1").firestore();
  const regularUser = env.authenticatedContext("alice").firestore();
  await assertSucceeds(getDocs(query(collection(admin, "analyticsEvents"), limit(10))));
  await assertFails(getDocs(query(collection(regularUser, "analyticsEvents"), limit(10))));
  await assertFails(getDocs(query(collection(env.unauthenticatedContext().firestore(), "analyticsEvents"), limit(10))));
});

test.after(async () => {
  await env.cleanup();
});


test("poll votes are private to the voter and cannot be listed by clients", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "communityPolls/poll-private"), {
      authorId: "alice", authorName: "Alice", question: "Which film?",
      options: ["One", "Two"], topic: "film", status: "published",
      createdAt: new Date(), updatedAt: new Date()
    });
    await setDoc(doc(db, "communityPolls/poll-private/votes/alice"), {
      userId: "alice", optionIndex: 0, createdAt: new Date()
    });
    await setDoc(doc(db, "communityPolls/poll-private/votes/bob"), {
      userId: "bob", optionIndex: 1, createdAt: new Date()
    });
  });
  const alice = env.authenticatedContext("alice", { email_verified: true }).firestore();
  const bob = env.authenticatedContext("bob", { email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(alice, "communityPolls/poll-private/votes/alice")));
  await assertFails(getDoc(doc(alice, "communityPolls/poll-private/votes/bob")));
  await assertFails(getDocs(query(collection(alice, "communityPolls/poll-private/votes"), limit(10))));
  await assertSucceeds(getDoc(doc(bob, "communityPolls/poll-private/votes/bob")));
});


test("news discovery candidates are readable only by trusted moderators", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "newsQueue/candidate-private"), {
      headline: "A global entertainment candidate", publisher: "Example Publisher",
      sourceId: "example.com", sourceUrl: "https://example.com/story",
      canonicalUrl: "https://example.com/story", category: "film", region: "global",
      excerpt: "A short source excerpt.", publishedAt: new Date(),
      discoveredAt: new Date(), status: "pending_review"
    });
  });
  const moderatorDb = env.authenticatedContext("trusted-moderator", { moderator: true }).firestore();
  const memberDb = env.authenticatedContext("regular-member", { email_verified: true }).firestore();
  const signedOut = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(moderatorDb, "newsQueue/candidate-private")));
  await assertFails(getDoc(doc(memberDb, "newsQueue/candidate-private")));
  await assertFails(getDoc(doc(signedOut, "newsQueue/candidate-private")));
  await assertFails(setDoc(doc(memberDb, "newsQueue/forged-candidate"), {
    status: "pending_review", headline: "A forged candidate"
  }));
});


test("Watch Rooms and Cinema Clubs are readable only by their recorded members and never client-writable", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "rooms", "private-room"), {
      name: "Private screening", hostUid: "room-host", status: "open", memberCount: 1
    });
    await setDoc(doc(db, "rooms/private-room/members/room-host"), {
      userId: "room-host", role: "host", displayName: "Host"
    });
    await setDoc(doc(db, "rooms/closed-room"), {
      name: "Closed screening", hostUid: "room-host", status: "closed", memberCount: 1
    });
    await setDoc(doc(db, "rooms/closed-room/members/room-host"), {
      userId: "room-host", role: "host"
    });
    await setDoc(doc(db, "cinemaClubs", "private-club"), {
      name: "Film Society", ownerUid: "club-owner", status: "active", memberCount: 1
    });
    await setDoc(doc(db, "cinemaClubs/private-club/members/club-owner"), {
      userId: "club-owner", role: "owner", displayName: "Owner"
    });
    await setDoc(doc(db, "users/room-host/watchRooms/private-room"), {
      roomId: "private-room", name: "Private screening", role: "host"
    });
    await setDoc(doc(db, "users/club-owner/cinemaClubs/private-club"), {
      clubId: "private-club", name: "Film Society", role: "owner"
    });
  });

  const host = env.authenticatedContext("room-host").firestore();
  const guest = env.authenticatedContext("room-guest").firestore();
  const clubOwner = env.authenticatedContext("club-owner").firestore();
  const outsider = env.authenticatedContext("outsider").firestore();

  await assertSucceeds(getDoc(doc(host, "rooms/private-room")));
  await assertFails(getDoc(doc(host, "rooms/closed-room")));
  await assertSucceeds(getDoc(doc(host, "rooms/private-room/members/room-host")));
  await assertFails(getDoc(doc(guest, "rooms/private-room")));
  await assertFails(getDoc(doc(outsider, "rooms/private-room/members/room-host")));
  await assertSucceeds(getDoc(doc(clubOwner, "cinemaClubs/private-club")));
  await assertFails(getDoc(doc(outsider, "cinemaClubs/private-club")));
  await assertSucceeds(getDoc(doc(host, "users/room-host/watchRooms/private-room")));
  await assertSucceeds(getDocs(collection(host, "users/room-host/watchRooms")));
  await assertFails(getDoc(doc(outsider, "users/room-host/watchRooms/private-room")));
  await assertFails(getDocs(collection(outsider, "users/room-host/watchRooms")));

  await assertFails(setDoc(doc(host, "rooms/fake-room"), {
    name: "Forged room", hostUid: "room-host", status: "open", memberCount: 1
  }));
  await assertFails(setDoc(doc(host, "rooms/private-room/members/forged-member"), {
    userId: "forged-member", role: "host", displayName: "Fake host"
  }));
  await assertFails(setDoc(doc(clubOwner, "cinemaClubs/fake-club"), {
    name: "Forged club", ownerUid: "club-owner", status: "active", memberCount: 1
  }));
  await assertFails(setDoc(doc(guest, "watchInvitations/fake-token"), {
    targetType: "room", targetId: "private-room", useCount: 0
  }));
});

test("private dashboard indexes cannot be forged by another account", async () => {
  const alice = env.authenticatedContext("alice").firestore();
  const bob = env.authenticatedContext("bob").firestore();
  await assertFails(setDoc(doc(alice, "users/bob/watchRooms/forged-room"), {
    roomId: "forged-room", name: "Not Alice's room"
  }));
  await assertFails(setDoc(doc(alice, "users/alice/cinemaClubs/forged-club"), {
    clubId: "forged-club", name: "Forged membership"
  }));
  await assertFails(setDoc(doc(bob, "users/alice/watchRooms/forged-room"), {
    roomId: "forged-room"
  }));
});


test("room lobby presence, queue and chat are member-readable and never client-writable", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "rooms/lobby-room"), { name: "Lobby", hostUid: "host", status: "open", memberCount: 1 });
    await setDoc(doc(db, "rooms/lobby-room/members/host"), { userId: "host", role: "host" });
    await setDoc(doc(db, "rooms/lobby-room/presence/host"), { uid: "host", expiresAt: new Date(Date.now() + 60000) });
    await setDoc(doc(db, "rooms/lobby-room/queue/pick-1"), { title: "A film", votes: ["host"], voteCount: 1, status: "queued" });
    await setDoc(doc(db, "rooms/lobby-room/chat/message-1"), { uid: "host", text: "Ready?", reactions: {} });
    await setDoc(doc(db, "rooms/lobby-room/playback/current"), { provider: "vidsrc", status: "playing", position: 120, duration: 3600, hostUid: "host" });
  });
  const host = env.authenticatedContext("host").firestore();
  const outsider = env.authenticatedContext("outsider").firestore();
  for (const path of ["presence/host", "queue/pick-1", "chat/message-1", "playback/current"]) {
    await assertSucceeds(getDoc(doc(host, "rooms/lobby-room/" + path)));
    await assertFails(getDoc(doc(outsider, "rooms/lobby-room/" + path)));
    await assertFails(setDoc(doc(host, "rooms/lobby-room/" + path + "-forged"), { forged: true }));
  }
});


test("Cinema Club watchlists, screening history and After-Credits are member-readable and server-writable only", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "cinemaClubs/archive-club"), { name: "Archive Club", ownerUid: "archive-member", status: "active" });
    await setDoc(doc(db, "cinemaClubs/archive-club/members/archive-member"), { userId: "archive-member", role: "owner" });
    await setDoc(doc(db, "cinemaClubs/archive-club/watchlist/movie_42"), { contentId: "movie:42", title: "Example Film" });
    await setDoc(doc(db, "cinemaClubs/archive-club/screenings/screening-1"), { contentId: "movie:42", title: "Example Film" });
    await setDoc(doc(db, "cinemaClubs/archive-club/screenings/screening-1/afterCredits/archive-member"), { uid: "archive-member", rating: 5 });
    await setDoc(doc(db, "cinemaClubs/archive-club/screenings/screening-1/discussion/message-1"), { uid: "archive-member", message: "A great film." });
  });
  const member = env.authenticatedContext("archive-member").firestore();
  const outsider = env.authenticatedContext("archive-outsider").firestore();
  const paths = [
    "cinemaClubs/archive-club/watchlist/movie_42",
    "cinemaClubs/archive-club/screenings/screening-1",
    "cinemaClubs/archive-club/screenings/screening-1/afterCredits/archive-member",
    "cinemaClubs/archive-club/screenings/screening-1/discussion/message-1"
  ];
  for (const path of paths) {
    await assertSucceeds(getDoc(doc(member, path)));
    await assertFails(getDoc(doc(outsider, path)));
    await assertFails(setDoc(doc(member, path + "-forged"), { forged: true }));
  }
});
