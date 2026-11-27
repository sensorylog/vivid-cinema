import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_PROFILES, PROFILE_AVATARS, PROFILE_DATA_COLLECTIONS,
  normalizeAvatarData, normalizeAvatarUrl, normalizeProfile, normalizeProfileId
} from "../scripts/profile-schema.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [service, listCreate, update, remove, rules] = await Promise.all([
  read("../cloudflare/functions/lib/profile-service.js"),
  read("../cloudflare/functions/api/profiles/index.js"),
  read("../cloudflare/functions/api/profiles/update.js"),
  read("../cloudflare/functions/api/profiles/delete.js"),
  read("../firestore.rules")
]);

test("shared profile schema defines a five-profile limit and original Vivid avatar collection", () => {
  assert.equal(MAX_PROFILES, 5);
  assert.equal(PROFILE_AVATARS.length, 16);
  assert.equal(new Set(PROFILE_AVATARS.map(item => item.id)).size, PROFILE_AVATARS.length);
  assert.ok(PROFILE_DATA_COLLECTIONS.includes("progress"));
  assert.ok(PROFILE_DATA_COLLECTIONS.includes("animePreferences"));
  assert.ok(PROFILE_DATA_COLLECTIONS.includes("achievements"));
  assert.equal(normalizeProfileId("owner"), "owner");
  assert.throws(() => normalizeProfileId("../other"));
  assert.throws(() => normalizeProfileId("profile with spaces"));
});

test("profile normalization validates identity, Kids type, HTTPS photos and compressed custom avatars", () => {
  const data = "data:image/webp;base64," + "A".repeat(256);
  const profile = normalizeProfile("child_1", {
    name: "  Kids Viewer  ",
    avatarId: "nebula",
    avatarUrl: "https://lh3.googleusercontent.com/photo",
    avatarData: data,
    isKids: true
  });
  assert.equal(profile.name, "Kids Viewer");
  assert.equal(profile.avatarId, "nebula");
  assert.equal(profile.avatarUrl, "https://lh3.googleusercontent.com/photo");
  assert.equal(profile.avatarData, data);
  assert.equal(profile.avatarSource, "upload");
  assert.equal(normalizeProfile("owner", { name: "Main", avatarUrl: "https://example.com/photo.png" }).avatarSource, "google");
  assert.equal(normalizeProfile("owner", { name: "Main", avatarSource: "collection" }).avatarSource, "collection");
  assert.equal(profile.isKids, true);
  assert.equal(profile.maturityLevel, "kids");
  assert.equal(profile.isOwner, false);
  assert.equal(normalizeAvatarUrl("http://example.com/avatar.png"), "");
  assert.equal(normalizeAvatarUrl("javascript:alert(1)"), "");
  assert.equal(normalizeAvatarData("data:image/png;base64,AAAA"), "");
  assert.equal(normalizeAvatarData("data:image/webp;base64,not base64!"), "");
  assert.equal(normalizeProfile("owner", { name: "Main", isKids: true }).isKids, false);
});

test("profile APIs authenticate Firebase users, rate limit changes and enforce profile limits transactionally", () => {
  assert.match(service, /verifyFirebaseIdToken/);
  assert.match(service, /getPremiumServices\(env\)/);
  assert.match(service, /enforceRateLimit\(db, user\.uid, "profiles-create"/);
  assert.match(service, /invalid-avatar-source/);
  assert.match(service, /avatarSource/);
  assert.match(service, /transaction\.get\(profilesRef\)/);
  assert.match(service, /profiles\.size >= MAX_PROFILES/);
  assert.match(service, /owner-profile-required/);
  assert.match(service, /transaction\.create\(reference, created\)/);
  assert.match(service, /PROFILE_DELETE_COLLECTIONS/);
  assert.match(service, /reference\.delete\(\)/);
});

test("profile management API protects the owner profile and exposes only explicit methods", () => {
  assert.match(listCreate, /onRequestGet/);
  assert.match(listCreate, /onRequestPost/);
  assert.match(update, /onRequestPatch/);
  assert.match(remove, /onRequestDelete/);
  assert.match(service, /owner-profile-protected/);
  assert.match(service, /A Vivid account can have up to/);
  assert.match(service, /Access-Control-Allow-Methods/);
  assert.ok(rules.includes("match /users/{userId}/profiles/{profileId}"));
  assert.match(rules, /avatarSource.*google.*collection.*upload.*default/s);
});

test("profile metadata never stores PIN material in the public profile document schema", () => {
  assert.doesNotMatch(service, /pinHash|pinVerifier|pinSalt|pinCode/i);
  assert.doesNotMatch(rules, /pinHash|pinVerifier|pinSalt|pinCode/i);
});
