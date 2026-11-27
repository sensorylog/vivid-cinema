import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [page, selector, manager, auth, worker, account, profiles, shell, styles] = await Promise.all([
  read("../profiles.html"),
  read("../scripts/profile-selector.js"),
  read("../scripts/profile-manager.js"),
  read("../scripts/auth.js"),
  read("../service-worker.js"),
  read("../account.html"),
  read("../scripts/profiles.js"),
  read("../scripts/app-shell.js"),
  read("../styles/vivid-profile-selector.css")
]);

test("successful sign-in opens the Who's Watching profile selector by default", () => {
  assert.match(auth, /return "profiles\.html";/);
  assert.match(auth, /vivid:profile-return-to:v1/);
  assert.match(shell, /"login\.html", "forgot-password\.html"/);
  assert.match(page, /Who's watching\?/);
  assert.match(page, /id="profile-grid"/);
  assert.match(page, /id="profile-signout"/);
  assert.match(selector, /signOut\(auth\)/);
  assert.match(selector, /setActiveProfileId\(user\.uid, profile\.id\)/);
  assert.match(selector, /if \(profile\.hasPin\)/);
  assert.match(selector, /verifyProfilePin\(pendingProfile\.id, pin\)/);
  assert.match(selector, /finishProfileOpen\(profile, result\.customToken\)/);
  assert.match(selector, /signInWithCustomToken\(auth, customToken\)/);
});

test("profile selector initializes the owner migration before loading profile choices", () => {
  assert.match(selector, /initializeProfileFoundation\(user\)/);
  assert.match(profiles, /await ensureOwnerProfile\(user\)/);
  assert.match(selector, /fetchProfiles\(\)/);
  assert.match(selector, /if \(!result\.migrationComplete\)/);
  assert.match(selector, /location\.replace\(destination\(\)\)/);
});

test("profile manager uses authenticated same-origin APIs and handles create, update and delete", () => {
  assert.match(manager, /user\.getIdToken\(\)/);
  assert.match(manager, /fetch\(getCloudflareApiUrl\(path\)/);
  assert.match(manager, /credentials: "same-origin"/);
  assert.match(manager, /POST", details/);
  assert.match(manager, /PATCH", \{ profileId, \.\.\.details \}/);
  assert.match(manager, /DELETE", \{ profileId \}/);
  assert.match(manager, /requestProfilePin/);
  assert.match(manager, /includeAvatars=1/);
});

test("profile UI exposes the bounded Vivid avatar collection and compressed custom-photo upload", () => {
  assert.match(page, /id="avatar-gallery"/);
  assert.match(page, /id="profile-photo"/);
  assert.match(page, /id="profile-use-google"/);
  assert.match(page, /id="profile-pin-dialog"/);
  assert.match(page, /id="profile-pin-settings"/);
  assert.match(page, /id="profile-pin-manage"/);
  assert.match(page, /profile-is-kids/);
  assert.match(page, /profile-movie-rating/);
  assert.match(page, /profile-tv-rating/);
  assert.match(selector, /Parent verification is required to leave Kids Mode/);
  assert.match(selector, /PROFILE_AVATARS/);
  assert.match(selector, /compressProfileImage\(file\)/);
  assert.match(manager, /image\/webp/);
  assert.match(manager, /512/);
  assert.match(manager, /130 \* 1024/);
  assert.match(manager, /40000000/);
});

test("Google account photo is adopted for the owner profile and can be replaced by a chosen avatar", () => {
  assert.match(profiles, /const googlePhoto = safeAvatarUrl\(current\)/);
  assert.match(profiles, /updates\.avatarSource = "google"/);
  assert.match(selector, /selectedAvatarUrl = ""/);
  assert.match(selector, /selectedAvatarSource = "collection"/);
  assert.match(selector, /selectedAvatarSource = "upload"/);
  assert.match(selector, /avatarUrl: selectedAvatarUrl/);
  assert.match(selector, /avatarSource: selectedAvatarSource/);
  assert.match(selector, /profile-use-google/);
  assert.match(selector, /selectedAvatarSource = "google"/);
  assert.equal(selector.split('$("profile-use-google").addEventListener("click"').length - 1, 1);
  assert.match(selector, /const photo = normalizeAvatarUrl/);
  assert.match(selector, /setProfilePin\(editingId, pin, currentPin, openSession\)/);
  assert.match(selector, /removeProfilePin\(editingId, currentPin\)/);
  assert.match(selector, /resetProfilePin\(resetProfileId\)/);
  assert.match(selector, /selectProfile\(profile\.id\)/);
  assert.match(selector, /selectProfile\(OWNER_PROFILE_ID\)/);
  assert.match(selector, /finishProfileOpen\(profile, result\.customToken\)/);
});

test("profile deletion protects the owner and requires an explicit confirmation", () => {
  assert.match(selector, /if \(!profile \|\| profile\.isOwner\) return/);
  assert.match(selector, /window\.confirm\(/);
  assert.match(selector, /await deleteProfile\(editingId\)/);
});

test("profile selector assets are network refreshed and accessible from the account hub", () => {
  assert.match(worker, /vivid-cinema-shell-v374/);
  assert.match(worker, /profile-selector/);
  assert.match(worker, /profiles\.html/);
  assert.match(account, /href="profiles\.html"/);
  assert.match(styles, /grid-template-columns:repeat\(auto-fit/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(selector, /button\.tabIndex = index === tabStopIndex \? 0 : -1/);
  assert.match(selector, /ArrowRight/);
  assert.match(selector, /ArrowLeft/);
  assert.match(selector, /event\.key === "Home"/);
  assert.match(selector, /event\.key === "End"/);
});

