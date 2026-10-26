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


test("authenticated users can create schema-valid Vivid Pulse events but cannot read the analytics collection", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertSucceeds(setDoc(doc(db, "analyticsEvents/event-valid"), {
    event: "page_view",
    platform: "web",
    userId: "alice",
    sessionId: "session-alice-1",
    timestamp: serverTimestamp(),
    appVersion: "web-current",
    details: { page: "/home.html" }
  }));
  await assertFails(getDocs(collection(db, "analyticsEvents")));
});

test("Vivid Pulse rejects forged user IDs and keeps analytics events immutable", async () => {
  const db = env.authenticatedContext("alice").firestore();
  await assertFails(setDoc(doc(db, "analyticsEvents/event-forged"), {
    event: "page_view",
    platform: "web",
    userId: "bob",
    sessionId: "session-forged",
    timestamp: serverTimestamp(),
    appVersion: "web-current",
    details: {}
  }));

  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "analyticsEvents/event-immutable"), {
      event: "page_view",
      platform: "web",
      userId: "alice",
      sessionId: "session-alice-2",
      timestamp: new Date(),
      appVersion: "web-current",
      details: {}
    });
  });
  await assertFails(setDoc(doc(db, "analyticsEvents/event-immutable"), {
    event: "page_view",
    platform: "web",
    userId: "alice",
    sessionId: "session-alice-2",
    timestamp: serverTimestamp(),
    appVersion: "web-current",
    details: {}
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
