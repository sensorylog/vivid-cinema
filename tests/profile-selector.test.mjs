import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [page, selector, manager, auth, worker, account, profiles, shell] = await Promise.all([
  read("../profiles.html"),
  read("../scripts/profile-selector.js"),
  read("../scripts/profile-manager.js"),
  read("../scripts/auth.js"),
  read("../service-worker.js"),
  read("../account.html"),
  read("../scripts/profiles.js"),
  read("../scripts/app-shell.js")
]);

test("successful sign-in opens the Who's Watching profile selector by default", () => {
  assert.match(auth, /return "profiles\.html";/);
  assert.match(auth, /vivid:profile-return-to:v1/);
  assert.match(shell, /"login\.html", "forgot-password\.html"/);
  assert.match(page, /Who's watching\?/);
  assert.match(page, /id="profile-grid"/);
  assert.match(selector, /setActiveProfileId\(user\.uid, profile\.id\)/);
});

test("profile selector initializes the owner migration before loading profile choices", () => {
  assert.match(selector, /initializeProfileFoundation\(user\)/);
  assert.match(selector, /ensureOwnerProfile\(user\)/);
  assert.match(selector, /fetchProfiles\(\)/);
  assert.match(selector, /current\.some\(item => item\.id === profile\.id\)/);
  assert.match(selector, /location\.replace\(destination\(\)\)/);
});

test("profile manager uses authenticated same-origin APIs and handles create, update and delete", () => {
  assert.match(manager, /user\.getIdToken\(\)/);
  assert.match(manager, /fetch\(path/);
  assert.match(manager, /credentials: "same-origin"/);
  assert.match(manager, /POST", details/);
  assert.match(manager, /PATCH", \{ profileId, \.\.\.details \}/);
  assert.match(manager, /DELETE", \{ profileId \}/);
});

test("profile UI exposes the bounded Vivid avatar collection and compressed custom-photo upload", () => {
  assert.match(page, /id="avatar-gallery"/);
  assert.match(page, /id="profile-photo"/);
  assert.match(selector, /PROFILE_AVATARS/);
  assert.match(selector, /compressProfileImage\(file\)/);
  assert.match(manager, /image\/webp/);
  assert.match(manager, /512/);
  assert.match(manager, /130 \* 1024/);
});

test("Google account photo is adopted for the owner profile and can be replaced by a chosen avatar", () => {
  assert.match(selector, /user\.providerData\?\.find\(item => item\.providerId === "google\.com"\)/);
  assert.match(profiles, /const googlePhoto = safeAvatarUrl\(current\)/);
  assert.match(profiles, /avatarSource: "google"/);
  assert.match(selector, /selectedAvatarUrl = ""/);
  assert.match(selector, /selectedAvatarSource = "collection"/);
  assert.match(selector, /selectedAvatarSource = "upload"/);
  assert.match(selector, /avatarUrl: selectedAvatarUrl/);
  assert.match(selector, /avatarSource: selectedAvatarSource/);
});

test("profile deletion protects the owner and requires an explicit confirmation", () => {
  assert.match(selector, /if \(!profile \|\| profile\.isOwner\) return/);
  assert.match(selector, /window\.confirm\(/);
  assert.match(selector, /await deleteProfile\(editingId\)/);
});

test("profile selector assets are network refreshed and accessible from the account hub", () => {
  assert.match(worker, /vivid-cinema-shell-v367/);
  assert.match(worker, /profile-selector/);
  assert.match(worker, /profiles\.html/);
  assert.match(account, /href="profiles\.html"/);
});


test("profile manager supports Kids designation and persistent avatar choices", () => {
  assert.match(page, /id="profile-is-kids"/);
  assert.match(page, /profile-kids-option/);
  assert.match(selector, /profile\.isKids \? "Kids profile"/);
  assert.match(selector, /\$("profile-is-kids")\.checked/);
  assert.match(selector, /isKids: \$("profile-is-kids")\.checked/);
  assert.match(selector, /selectedAvatarSource = "google"/);
  assert.match(selector, /selectedAvatarSource = "upload"/);
  assert.match(selector, /selectedAvatarSource = "collection"/);
  assert.match(selector, /includes\(owner\.avatarSource\)/);
});
