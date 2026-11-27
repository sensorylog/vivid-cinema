import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [page, selector, manager, auth, worker, account] = await Promise.all([
  read("../profiles.html"),
  read("../scripts/profile-selector.js"),
  read("../scripts/profile-manager.js"),
  read("../scripts/auth.js"),
  read("../service-worker.js"),
  read("../account.html")
]);

test("successful sign-in opens the Who's Watching profile selector by default", () => {
  assert.match(auth, /if\(!raw\)return "profiles\.html";/);
  assert.match(page, /Who's watching\?/);
  assert.match(page, /id="profile-grid"/);
  assert.match(selector, /setActiveProfileId\(user\.uid, profile\.id\)/);
});

test("profile selector initializes the owner migration before loading profile choices", () => {
  assert.match(selector, /initializeProfileFoundation\(user\)/);
  assert.match(selector, /ensureOwnerProfile\(user\)/);
  assert.match(selector, /fetchProfiles\(\)/);
  assert.match(selector, /profile\.id === profile\.id/);
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
  assert.match(selector, /updateProfile\(owner\.id/);
  assert.match(selector, /selectedAvatarUrl = ""/);
  assert.match(selector, /avatarUrl: selectedAvatarUrl/);
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
