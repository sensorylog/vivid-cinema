import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection, query, limit, serverTimestamp, Timestamp, deleteDoc } from "firebase/firestore";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({
  projectId: "vivid-cinema-rules-test",
  firestore: { rules }
});

test("anime library owner can save completed titles, season-scoped progress and preferences", async () => {
  const db = env.authenticatedContext("anime-owner", { profileId: "owner" }).firestore();
  await assertSucceeds(setDoc(doc(db, "users/anime-owner/completed/tv:123"), {
    id: "123", media_type: "tv", title: "Anime series", year: "2025",
    poster_path: "/anime.jpg", backdrop_path: "/anime-bg.jpg",
    updatedAt: Date.now(), completion: 100, completedAt: Date.now(), isAnime: true
  }));
  await assertSucceeds(setDoc(doc(db, "users/anime-owner/progress/tv:123:0:3"), {
    id: "123", media_type: "tv", progress: 450, duration: 1200, percentage: 37.5,
    completed: false, season: 0, episode: 3, title: "Anime special", updatedAt: Date.now(), isAnime: true
  }));
  await assertSucceeds(setDoc(doc(db, "users/anime-owner/animePreferences/default"), {
    track: "dub", autoplayNextEpisode: true, subtitleLanguage: "en",
    preferredPlayer: "auto", updatedAt: Date.now()
  }));
  await assertFails(setDoc(doc(db, "users/other/animePreferences/default"), {
    track: "dub", autoplayNextEpisode: true, subtitleLanguage: "en",
    preferredPlayer: "auto", updatedAt: Date.now()
  }));
});

test("owner can write a valid library item", async () => {
  const db = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
  await assertSucceeds(setDoc(doc(db, "users/alice/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-backdrop.jpg",
    updatedAt: Date.now(), completion: 0
  }));
});

test("users cannot write to another user's library", async () => {
  const db = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
  await assertFails(setDoc(doc(db, "users/bob/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-backdrop.jpg",
    updatedAt: Date.now()
  }));
});

test("invalid completion values are rejected", async () => {
  const db = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
  await assertFails(setDoc(doc(db, "users/alice/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-backdrop.jpg",
    updatedAt: Date.now(), completion: 101
  }));
});

test("oversized event metadata maps are rejected", async () => {
  const db = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
  const metadata = Object.fromEntries(Array.from({ length: 21 }, (_, index) => ["field" + index, index]));
  await assertFails(setDoc(doc(db, "users/alice/events/event-1"), {
    id: "event-1", type: "playback_progress", occurredAt: Date.now(),
    sessionId: "session-1", metadata
  }));
});

test("taste profile maps are bounded", async () => {
  const db = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
  const genres = Object.fromEntries(Array.from({ length: 101 }, (_, index) => ["genre" + index, 1]));
  await assertFails(setDoc(doc(db, "users/alice/taste/profile"), {
    version: 1, genres, languages: {}, countries: {}, actors: {},
    directors: {}, media: {}, decades: {}, updatedAt: Date.now()
  }));
});

test("owners can persist only known personal achievement records", async () => {
  const db = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
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
  const db = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
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
  const alice = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
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
  const regularUser = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
  await assertSucceeds(getDocs(query(collection(admin, "analyticsEvents"), limit(10))));
  await assertFails(getDocs(query(collection(regularUser, "analyticsEvents"), limit(10))));
  await assertFails(getDocs(query(collection(env.unauthenticatedContext().firestore(), "analyticsEvents"), limit(10))));
});


test("owner profile bootstrap and profile-scoped library data are private to the account", async () => {
  const alice = env.authenticatedContext("profile-alice", { profileId: "owner" }).firestore();
  const bob = env.authenticatedContext("profile-bob").firestore();
  const ownerProfile = {
    id: "owner", name: "Alice", avatarUrl: "", avatarSource: "auto",
    avatarId: "aurora", isKids: false, maturityLevel: "adult", movieRatingLimit: "NC-17", tvRatingLimit: "TV-MA", blockedGenreIds: [], blockedTitles: [], allowUnrated: true, isOwner: true, schemaVersion: 1
  };
  await assertSucceeds(setDoc(doc(alice, "users/profile-alice/profiles/owner"), ownerProfile));
  await assertSucceeds(getDoc(doc(alice, "users/profile-alice/profiles/owner")));
  await assertSucceeds(setDoc(doc(alice, "users/profile-alice/profiles/owner"), { ...ownerProfile, avatarUrl: "https://example.com/avatar.png" }));
  await assertFails(getDoc(doc(bob, "users/profile-alice/profiles/owner")));
  await assertFails(setDoc(doc(alice, "users/profile-alice/profiles/owner/avatar/image"), { data: "private-avatar-bytes" }));
  await assertFails(getDoc(doc(alice, "users/profile-alice/profiles/owner/avatar/image")));
  await assertFails(setDoc(doc(alice, "users/profile-alice/profiles/owner"), {
    ...ownerProfile, pinHash: "must-not-be-client-readable"
  }));
  await assertFails(setDoc(doc(alice, "users/profile-alice/profiles/another"), {
    ...ownerProfile, id: "another", isOwner: false
  }));
  await assertSucceeds(setDoc(doc(alice, "users/profile-alice/profiles/owner/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-bg.jpg", updatedAt: Date.now()
  }));
  await assertFails(getDoc(doc(bob, "users/profile-alice/profiles/owner/favorites/movie:550")));
  await assertFails(setDoc(doc(alice, "users/profile-alice/profiles/owner/favorites/movie:550"), {
    id: "550", media_type: "movie", title: "The Matrix", year: "1999",
    poster_path: "/matrix.jpg", backdrop_path: "/matrix-bg.jpg", updatedAt: Date.now(),
    accountUid: "profile-bob"
  }));
});

test("profile PIN sessions are enforced by Firestore and cannot be forged by local state", async () => {
  const owner = env.authenticatedContext("pin-owner").firestore();
  const unpinnedProfile = doc(owner, "users/pin-owner/profiles/owner");
  const pinnedProfile = doc(owner, "users/pin-owner/profiles/kid-1");
  const favorite = doc(owner, "users/pin-owner/profiles/kid-1/favorites/movie:pin");
  const pinRef = doc(owner, "users/pin-owner/profiles/kid-1/profileSecurity/pin");
  const sessionRef = doc(owner, "users/pin-owner/profiles/kid-1/profileSessions/session-1");
  const profileData = {
    id: "kid-1", name: "Kids", avatarId: "aurora", avatarUrl: "",
    avatarSource: "collection", isKids: false, maturityLevel: "all",
    isOwner: false, schemaVersion: 1
  };

  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, "users/pin-owner/profiles/owner"), {
      id: "owner", name: "Main Profile", avatarId: "aurora", avatarUrl: "",
      avatarSource: "auto", isKids: false, maturityLevel: "all",
      isOwner: true, schemaVersion: 1
    });
    await setDoc(doc(admin, "users/pin-owner/profiles/kid-1"), profileData);
    await setDoc(doc(admin, "users/pin-owner/profiles/kid-1/favorites/movie:pin"), {
      id: "movie:pin", title: "Private title", updatedAt: Date.now()
    });
    await setDoc(doc(admin, "users/pin-owner/profiles/kid-1/profileSecurity/pin"), {
      pinHash: "server-only-hash", pinSalt: "server-only-salt", iterations: 310000
    });
    await setDoc(doc(admin, "users/pin-owner/profiles/kid-1/profileSessions/session-1"), {
      uid: "pin-owner", profileId: "kid-1", revoked: false, pinHash: "server-only-hash",
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000)
    });
    await setDoc(doc(admin, "users/pin-owner/profiles/kid-1/profileSessions/expired"), {
      uid: "pin-owner", profileId: "kid-1", revoked: false, pinHash: "server-only-hash",
      expiresAt: Timestamp.fromMillis(Date.now() - 60 * 1000)
    });
  });

  await assertSucceeds(getDoc(unpinnedProfile));
  await assertSucceeds(getDoc(pinnedProfile));
  await assertFails(getDoc(favorite));
  await assertFails(getDoc(pinRef));
  await assertFails(getDoc(sessionRef));
  await assertFails(setDoc(pinRef, { pinHash: "forged" }));
  await assertFails(setDoc(sessionRef, { uid: "pin-owner", profileId: "kid-1", revoked: false }));

  const unlocked = env.authenticatedContext("pin-owner", {
    profileId: "kid-1", profileSessionId: "session-1"
  }).firestore();
  await assertSucceeds(getDoc(doc(unlocked, "users/pin-owner/profiles/kid-1/favorites/movie:pin")));
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "users/pin-owner/profiles/kid-1/profileSecurity/pin"), {
      pinHash: "rotated-pin-hash", pinSalt: "rotated-salt", iterations: 310000
    });
  });
  await assertFails(getDoc(doc(unlocked, "users/pin-owner/profiles/kid-1/favorites/movie:pin")));
  await assertFails(getDoc(doc(unlocked, "users/pin-owner/profiles/kid-1/profileSecurity/pin")));

  const wrongProfile = env.authenticatedContext("pin-owner", {
    profileId: "owner", profileSessionId: "session-1"
  }).firestore();
  await assertFails(getDoc(doc(wrongProfile, "users/pin-owner/profiles/kid-1/favorites/movie:pin")));

  const expired = env.authenticatedContext("pin-owner", {
    profileId: "kid-1", profileSessionId: "expired"
  }).firestore();
  await assertFails(getDoc(doc(expired, "users/pin-owner/profiles/kid-1/favorites/movie:pin")));
  await assertFails(deleteDoc(pinnedProfile));
});

test("unlocked profiles remain isolated by signed profile identity and legacy data stays owner-scoped", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, "users/profile-scope/profiles/owner"), {
      id: "owner", name: "Owner", avatarId: "aurora", avatarUrl: "",
      isOwner: true, isKids: false, maturityLevel: "adult", schemaVersion: 1
    });
    await setDoc(doc(admin, "users/profile-scope/profiles/child"), {
      id: "child", name: "Child", avatarId: "ember", avatarUrl: "",
      isOwner: false, isKids: true, maturityLevel: "kids", schemaVersion: 1
    });
    await setDoc(doc(admin, "users/profile-scope/favorites/movie:legacy"), {
      id: "legacy", media_type: "movie", title: "Legacy owner data", year: "2025",
      poster_path: "", backdrop_path: "", updatedAt: Date.now()
    });
    await setDoc(doc(admin, "users/profile-scope/profiles/owner/favorites/movie:owner"), {
      id: "owner", media_type: "movie", title: "Owner data", year: "2025",
      poster_path: "", backdrop_path: "", updatedAt: Date.now()
    });
    await setDoc(doc(admin, "users/profile-scope/profiles/child/favorites/movie:child"), {
      id: "child", media_type: "movie", title: "Child data", year: "2025",
      poster_path: "", backdrop_path: "", updatedAt: Date.now()
    });
  });

  const owner = env.authenticatedContext("profile-scope", { profileId: "owner" }).firestore();
  const child = env.authenticatedContext("profile-scope", { profileId: "child" }).firestore();
  await assertSucceeds(getDoc(doc(owner, "users/profile-scope/favorites/movie:legacy")));
  await assertSucceeds(getDoc(doc(owner, "users/profile-scope/profiles/owner/favorites/movie:owner")));
  await assertFails(getDoc(doc(owner, "users/profile-scope/profiles/child/favorites/movie:child")));
  await assertSucceeds(getDoc(doc(child, "users/profile-scope/profiles/child/favorites/movie:child")));
  await assertFails(getDoc(doc(child, "users/profile-scope/profiles/owner/favorites/movie:owner")));
  await assertFails(getDoc(doc(child, "users/profile-scope/favorites/movie:legacy")));

  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, "users/profile-scope/profiles/owner/profileSecurity/pin"), {
      pinHash: "server-only", pinSalt: "server-only", iterations: 310000
    });
    await setDoc(doc(admin, "users/profile-scope/profiles/owner/profileSessions/owner-session"), {
      uid: "profile-scope", profileId: "owner", revoked: false, pinHash: "server-only",
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000)
    });
  });
  await assertFails(getDoc(doc(owner, "users/profile-scope/favorites/movie:legacy")));
  const ownerUnlocked = env.authenticatedContext("profile-scope", {
    profileId: "owner", profileSessionId: "owner-session"
  }).firestore();
  await assertSucceeds(getDoc(doc(ownerUnlocked, "users/profile-scope/favorites/movie:legacy")));
});

test("profile data cannot be written until its parent profile exists", async () => {
  const alice = env.authenticatedContext("profile-no-parent", { profileId: "missing" }).firestore();
  await assertFails(setDoc(doc(alice, "users/profile-no-parent/profiles/missing/favorites/movie:1"), {
    id: "1", media_type: "movie", title: "Example", year: "2025",
    poster_path: "", backdrop_path: "", updatedAt: Date.now()
  }));
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
      name: "Private screening", hostUid: "room-host", status: "open", memberCount: 1,
      expiresAt: new Date(Date.now() + 60_000)
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
  const anonymous = env.authenticatedContext("anonymous-room-user", {
    firebase: { sign_in_provider: "anonymous" }
  }).firestore();

  await assertSucceeds(getDoc(doc(host, "rooms/private-room")));
  await assertFails(getDoc(doc(anonymous, "rooms/private-room")));
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
  const alice = env.authenticatedContext("alice", { profileId: "owner" }).firestore();
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
    await setDoc(doc(db, "rooms/lobby-room"), { name: "Lobby", hostUid: "host", status: "open", memberCount: 1, expiresAt: new Date(Date.now() + 60_000) });
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
    await setDoc(doc(db, "cinemaClubs/archived-club"), { name: "Archived Club", ownerUid: "archived-member", status: "archived" });
    await setDoc(doc(db, "cinemaClubs/archived-club/members/archived-member"), { userId: "archived-member", role: "owner" });
    await setDoc(doc(db, "cinemaClubs/archived-club/watchlist/movie_43"), { contentId: "movie:43", title: "Archived Film" });
    await setDoc(doc(db, "cinemaClubs/archive-club/watchlist/movie_42"), { contentId: "movie:42", title: "Example Film" });
    await setDoc(doc(db, "cinemaClubs/archive-club/screenings/screening-1"), { contentId: "movie:42", title: "Example Film" });
    await setDoc(doc(db, "cinemaClubs/archive-club/screenings/screening-1/afterCredits/archive-member"), { uid: "archive-member", rating: 5 });
    await setDoc(doc(db, "cinemaClubs/archive-club/screenings/screening-1/discussion/message-1"), { uid: "archive-member", message: "A great film." });
  });
  const member = env.authenticatedContext("archive-member").firestore();
  const outsider = env.authenticatedContext("archive-outsider").firestore();
  const archivedMember = env.authenticatedContext("archived-member").firestore();
  const anonymous = env.authenticatedContext("anonymous-club-user", {
    firebase: { sign_in_provider: "anonymous" }
  }).firestore();
  const paths = [
    "cinemaClubs/archive-club/watchlist/movie_42",
    "cinemaClubs/archive-club/screenings/screening-1",
    "cinemaClubs/archive-club/screenings/screening-1/afterCredits/archive-member",
    "cinemaClubs/archive-club/screenings/screening-1/discussion/message-1"
  ];
  await assertFails(getDoc(doc(archivedMember, "cinemaClubs/archived-club/watchlist/movie_43")));
  await assertFails(getDoc(doc(anonymous, "cinemaClubs/archive-club")));
  for (const path of paths) {
    await assertSucceeds(getDoc(doc(member, path)));
    await assertFails(getDoc(doc(outsider, path)));
    await assertFails(setDoc(doc(member, path + "-forged"), { forged: true }));
  }
});


test("Watch Room access is denied when the expiry timestamp is missing or malformed", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "rooms/no-expiry"), { status: "open", hostUid: "expiry-user" });
    await setDoc(doc(db, "rooms/no-expiry/members/expiry-user"), { role: "host" });
    await setDoc(doc(db, "rooms/bad-expiry"), { status: "open", hostUid: "expiry-user", expiresAt: "tomorrow" });
    await setDoc(doc(db, "rooms/bad-expiry/members/expiry-user"), { role: "host" });
  });
  const member = env.authenticatedContext("expiry-user").firestore();
  await assertFails(getDoc(doc(member, "rooms/no-expiry")));
  await assertFails(getDoc(doc(member, "rooms/bad-expiry")));
});


test("African Stories public catalogue projections are publicly readable and client read-only", async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "africanWorksPublic/example-film"), {
      workId: "example-film", title: "Example Film", accessState: "archive_record",
      versions: [{ versionId: "original-cut" }]
    });
  });
  const publicDb = env.unauthenticatedContext().firestore();
  const memberDb = env.authenticatedContext("african-member").firestore();
  await assertSucceeds(getDoc(doc(publicDb, "africanWorksPublic/example-film")));
  await assertFails(setDoc(doc(memberDb, "africanWorksPublic/forged-film"), {
    workId: "forged-film", title: "Forged Film", accessState: "stream_on_vivid"
  }));
  await assertFails(setDoc(doc(memberDb, "africanWorksPublic/example-film"), {
    workId: "example-film", title: "Overwritten", accessState: "archive_record"
  }));
});

test("African Stories private rights, provider and session records are inaccessible even to custom-claim clients", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "africanWorkDrafts/private-film"), { title: "Unpublished title" });
    await setDoc(doc(db, "africanRightsGrants/private-film__original-cut"), {
      status: "approved", playbackUrl: "https://provider.example/private"
    });
    await setDoc(doc(db, "africanProviderRegistryPrivate/provider-one"), {
      status: "active", agreementRef: "contract-private"
    });
    await setDoc(doc(db, "africanPlaybackSessions/session-one"), {
      userId: "rights-admin", status: "active"
    });
    await setDoc(doc(db, "africanAuditEvents/event-one"), {
      action: "rights_decision_approved"
    });
  });
  const privilegedClient = env.authenticatedContext("rights-admin", {
    africanStoriesEditor: true,
    africanStoriesPublisher: true,
    africanStoriesRightsAdmin: true,
    africanStoriesProviderAdmin: true
  }).firestore();
  await assertFails(getDoc(doc(privilegedClient, "africanWorkDrafts/private-film")));
  await assertFails(getDoc(doc(privilegedClient, "africanRightsGrants/private-film__original-cut")));
  await assertFails(getDoc(doc(privilegedClient, "africanProviderRegistryPrivate/provider-one")));
  await assertFails(getDoc(doc(privilegedClient, "africanPlaybackSessions/session-one")));
  await assertFails(getDoc(doc(privilegedClient, "africanAuditEvents/event-one")));
  await assertFails(setDoc(doc(privilegedClient, "africanRightsGrants/forged-grant"), {
    status: "approved", streamOnVivid: true
  }));
});


test("Anime Premium billing, memberships, playback sources and audit records are server-only", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "animePremiumMemberships", "premium-user"), {
      uid: "premium-user", status: "active", currentPeriodEnd: new Date(Date.now() + 86400000)
    });
    await setDoc(doc(db, "animePremiumCheckouts", "VAPTEST123"), {
      uid: "premium-user", amount: 5330, currency: "GHS", status: "pending"
    });
    await setDoc(doc(db, "animePremiumWebhookEvents", "event-one"), { event: "charge.success" });
    await setDoc(doc(db, "animePremiumPendingSubscriptions", "sub-one"), { subscriptionCode: "sub-one", customerCode: "CUS_ONE" });
    await setDoc(doc(db, "animePremiumSources", "tv_123_s1_e1"), {
      provider: "approved-provider", sourceId: "rights-cleared-source", active: true
    });
    await setDoc(doc(db, "animePremiumProfiles", "premium-user"), { favorites: [] });
    await setDoc(doc(db, "animePremiumPlaybackSessions", "session-one"), { uid: "premium-user" });
    await setDoc(doc(db, "animePremiumRateLimits", "premium-user_profile_1"), { uid: "premium-user", count: 1 });
    await setDoc(doc(db, "animePremiumAdminAudit", "audit-one"), {
      action: "membership_override", uid: "premium-user"
    });
  });
  const privilegedClient = env.authenticatedContext("premium-admin", {
    admin: true, animePremiumAdmin: true, email_verified: true
  }).firestore();
  const privatePaths = [
    "animePremiumMemberships/premium-user",
    "animePremiumCheckouts/VAPTEST123",
    "animePremiumWebhookEvents/event-one",
    "animePremiumPendingSubscriptions/sub-one",
    "animePremiumSources/tv_123_s1_e1",
    "animePremiumProfiles/premium-user",
    "animePremiumPlaybackSessions/session-one",
    "animePremiumRateLimits/premium-user_profile_1",
    "animePremiumAdminAudit/audit-one"
  ];
  for (const path of privatePaths) {
    await assertFails(getDoc(doc(privilegedClient, path)));
    await assertFails(setDoc(doc(privilegedClient, path), { forged: true }));
  }
});
