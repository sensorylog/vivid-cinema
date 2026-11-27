import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROFILES,
  OWNER_PROFILE_ID,
  PROFILE_DATA_COLLECTIONS,
  PROFILE_MIGRATION_ID,
  PROFILE_SCHEMA_VERSION,
  activeProfileStorageKey,
  normalizeProfile,
  normalizeProfileId,
  profileCollectionPath
} from "../scripts/profiles.js";
import { readFileSync } from "node:fs";

const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const manager = readFileSync(new URL("../scripts/profiles.js", import.meta.url), "utf8");

test("profile schema defines a stable owner identity and bounded household size", () => {
  assert.equal(OWNER_PROFILE_ID, "owner");
  assert.equal(PROFILE_SCHEMA_VERSION, 1);
  assert.equal(MAX_PROFILES, 5);
  assert.ok(PROFILE_DATA_COLLECTIONS.includes("favorites"));
  assert.ok(PROFILE_DATA_COLLECTIONS.includes("progress"));
  assert.ok(PROFILE_DATA_COLLECTIONS.includes("feedback"));
});

test("profile IDs reject path traversal and malformed identifiers", () => {
  assert.equal(normalizeProfileId("owner"), "owner");
  for (const value of ["", "../owner", "a/b", "profile with spaces", "x".repeat(65)]) {
    assert.throws(() => normalizeProfileId(value));
  }
});

test("normalized profile metadata never accepts an insecure avatar URL", () => {
  const profile = normalizeProfile("owner", {
    name: "  Main Viewer  ",
    avatarUrl: "http://example.com/avatar.png",
    isKids: true
  });
  assert.equal(profile.name, "Main Viewer");
  assert.equal(profile.avatarUrl, "");
  assert.equal(profile.isKids, true);
  assert.equal(profile.maturityLevel, "kids");
  assert.equal(profile.isOwner, true);
});

test("profile collection paths are account- and profile-scoped and allow only approved stores", () => {
  assert.deepEqual(profileCollectionPath("user-1", "owner", "favorites"), [
    "users", "user-1", "profiles", "owner", "favorites"
  ]);
  assert.throws(() => profileCollectionPath("user-1", "owner", "billing"));
  assert.throws(() => profileCollectionPath("../other", "owner", "favorites"));
});

test("active profile local-storage keys are isolated per authenticated account", () => {
  assert.equal(activeProfileStorageKey("alice"), "vivid:active-profile:v1:alice");
  assert.notEqual(activeProfileStorageKey("alice"), activeProfileStorageKey("bob"));
});

test("legacy migration is restartable, verifies copied document IDs and never deletes source data", () => {
  assert.match(manager, /PROFILE_MIGRATION_ID/);
  assert.match(manager, /status === "complete"/);
  assert.match(manager, /getDocsFromServer\(destinationRef\)/);
  assert.match(manager, /Profile migration verification failed/);
  assert.doesNotMatch(manager, /deleteDoc\(|batch\.delete\(/);
  assert.match(manager, /Original data remains untouched/);
});

test("PIN secrets are not part of client profile metadata or migration payloads", () => {
  assert.doesNotMatch(manager, /pinHash|pinCode|profilePin|pinSecret/i);
  assert.match(rules, /match \/users\/{userId}\/profiles\/{profileId}/);
});
