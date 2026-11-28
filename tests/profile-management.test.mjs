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


test("household profile API stays on the native Cloudflare Firebase service", () => {
  assert.match(listCreate, /createAccountProfile/);
  assert.match(listCreate, /listAccountProfiles/);
  assert.match(listCreate, /profileErrorResponse/);
  assert.match(listCreate, /validateProfileOrigin/);
  assert.doesNotMatch(listCreate, /vivid-cinema-api\\.vercel\\.app/);
  assert.match(service, /verifyFirebaseIdToken/);
  assert.match(service, /Vivid profile service failure/);
  assert.match(service, /safeProfileErrorMessage/);
  assert.match(service, /REDACTED_TOKEN/);
  assert.match(service, /safeValidationIssues/);
  assert.match(service, /validationIssues: safeValidationIssues/);
  assert.match(service, /transaction\.create\(reference, created\)/);
});

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
  assert.equal(normalizeProfile("owner", { name: "Main" }).avatarSource, "auto");
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
  assert.match(service, /const initialProfiles = await profilesRef\.get\(\)/);
  assert.match(service, /initialProfileCount/);
  assert.doesNotMatch(service, /transaction\.get\(profilesRef\)/);
  assert.match(service, /currentCount >= MAX_PROFILES/);
  assert.match(service, /owner-profile-required/);
  assert.match(service, /transaction\.create\(reference, created\)/);
  assert.match(service, /PROFILE_DELETE_COLLECTIONS/);
  assert.match(service, /collection\("avatar"\)\.doc\("image"\)/);
  assert.match(service, /includeAvatars/);
  assert.match(service, /"avatar"/);
  assert.match(service, /transaction\.delete\(reference\)/);
  assert.match(service, /The household chooser is available before a viewing profile is opened/);
  assert.match(service, /existingKids = await profilesRef\.where\("isKids", "==", true\)/);
});


test("privileged profile writes require a live, PIN-bound active profile session", () => {
  assert.match(service, /export async function requireUnlockedProfile/);
  assert.match(service, /user\.profileSessionId/);
  assert.match(service, /session\.uid !== user\.uid/);
  assert.match(service, /session\.profileId !== profileId/);
  assert.match(service, /session\.revoked === true/);
  assert.match(service, /lastActivityAt <= Date\.now\(\) - PROFILE_SESSION_IDLE_TIMEOUT_MS/);
  assert.match(service, /expiresAt <= Date\.now\(\)/);
  assert.match(service, /session\.pinHash !== pinSnapshot\.data\(\)\?\.pinHash/);
  assert.equal(service.match(/requireUnlockedProfile\(db, user, user\.profileId\)/g)?.length, 3);
  assert.match(service, /Open the Main Profile before creating a Kids profile/);
  assert.match(service, /Only the Main Profile can change Kids Mode and parental controls/);
  assert.match(service, /Restore the Main Profile PIN before managing profiles while Kids profiles exist/);
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
  assert.match(rules, /match \/avatar\/\{avatarId\} \{\s*allow read, write: if false;/);
  assert.doesNotMatch(rules.slice(rules.indexOf("function validViewingProfile"), rules.indexOf("function hasViewingProfile")), /avatarData/);
  assert.match(rules, /avatarSource.*auto.*google.*collection.*upload/s);
  assert.equal(rules.split("match /users/{userId}/profiles/{profileId}").length - 1, 1);
  assert.equal(rules.split("match /{document=**}").length - 1, 1);
});

test("profile metadata never stores PIN material in the public profile document schema", () => {
  const profileSchema = rules.slice(rules.indexOf("function validViewingProfile"), rules.indexOf("match /users/{userId}/profiles/{profileId}"));
  assert.doesNotMatch(profileSchema, /pinHash|pinVerifier|pinSalt|pinCode/i);
  assert.match(service, /profileSecurity/);
  assert.match(service, /session\.pinHash/);
});

test("Firebase service-account project ID is normalized before strict adapter validation", async () => {
  const firebaseService = await read("../cloudflare/functions/lib/anime-premium-service.js");
  assert.match(firebaseService, /configuredProjectId = String\(env\.FIREBASE_PROJECT_ID/);
  assert.match(firebaseService, /serviceAccountProjectId/);
  assert.match(firebaseService, /firebase-project-mismatch/);
  assert.match(firebaseService, /normalizedServiceAccountJson/);
  assert.match(firebaseService, /project_id: projectId/);
  assert.match(firebaseService, /serviceAccountJson: normalizedServiceAccountJson/);
});
