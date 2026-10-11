import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc } from "firebase/firestore";

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

test.after(async () => {
  await env.cleanup();
});
