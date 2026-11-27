import { test, expect } from "@playwright/test";

const firebaseMock = `
const makeUser = profileId => ({
  uid: "profile-restore-browser-user",
  isAnonymous: false,
  getIdToken: async () => "browser-test-id-token",
  getIdTokenResult: async () => ({ claims: profileId ? { profileId } : {} })
});
const restoredProfileId = sessionStorage.getItem("vivid:test-auth-profile") || "";
export const auth = {
  currentUser: restoredProfileId ? makeUser(restoredProfileId) : null,
  __ready: Boolean(restoredProfileId),
  authStateReady: () => auth.__ready ? Promise.resolve() : readyPromise
};
let resolveReady;
const readyPromise = new Promise(resolve => {
  resolveReady = () => {
    auth.currentUser = makeUser("");
    auth.__ready = true;
    resolve();
  };
});
if (!auth.__ready) {
  window.__releaseProfileAuth = () => resolveReady();
}
`;

const authSdkMock = `
import { auth } from "/scripts/firebase.js";
const listeners = new Set();
export function onAuthStateChanged(_auth, callback) {
  listeners.add(callback);
  if (_auth.__ready) callback(_auth.currentUser);
  else _auth.authStateReady().then(() => {
    if (listeners.has(callback)) callback(_auth.currentUser);
  });
  return () => listeners.delete(callback);
}
export async function signInWithCustomToken(_auth, token) {
  const profileId = String(token).replace(/^profile:/, "");
  _auth.currentUser = {
    uid: "profile-restore-browser-user",
    isAnonymous: false,
    getIdToken: async () => "browser-test-id-token",
    getIdTokenResult: async () => ({ claims: { profileId } })
  };
  _auth.__ready = true;
  sessionStorage.setItem("vivid:test-auth-profile", profileId);
  for (const listener of listeners) listener(_auth.currentUser);
  return { user: _auth.currentUser };
}
export async function signOut(_auth) {
  _auth.currentUser = null;
  sessionStorage.removeItem("vivid:test-auth-profile");
  for (const listener of listeners) listener(null);
}
`;

const profilesMock = `
export const OWNER_PROFILE_ID = "owner";
export async function ensureOwnerProfile() {}
export async function initializeProfileFoundation() {}
export function getActiveProfileId(uid) {
  return localStorage.getItem("vivid:active-profile:v1:" + uid) || "owner";
}
export function setActiveProfileId(uid, id) {
  localStorage.setItem("vivid:active-profile:v1:" + uid, id);
}
export function clearActiveProfileId(uid) {
  localStorage.removeItem("vivid:active-profile:v1:" + uid);
}
export async function withProfileTimeout(promise) { return await promise; }
export async function validateProfileSession() { return true; }
export async function listProfileSummaries() {
  return {
    profiles: [{ id: "owner", name: "Main Profile", isOwner: true, isKids: false, hasPin: false }],
    migrationComplete: true
  };
}
`;

const managerMock = `
const owner = { id: "owner", name: "Main Profile", isOwner: true, isKids: false, hasPin: false, avatarId: "aurora" };
export const PROFILE_AVATARS = [{ id: "aurora", label: "Aurora" }];
export const MAX_PROFILES = 5;
export async function fetchProfiles() { return { profiles: [owner], migrationComplete: true }; }
export async function createProfile() { throw new Error("not used"); }
export async function updateProfile() { throw new Error("not used"); }
export async function deleteProfile() { throw new Error("not used"); }
export async function compressProfileImage() { return ""; }
export async function selectProfile(profileId) { return { customToken: "profile:" + profileId }; }
export async function verifyProfilePin() { throw new Error("not used"); }
export async function setProfilePin() { throw new Error("not used"); }
export async function removeProfilePin() { throw new Error("not used"); }
export async function resetProfilePin() { return { ok: true }; }
`;


const firebaseFailureMock = `
export const auth = {
  currentUser: null,
  authStateReady: () => Promise.reject(new Error("Firebase could not restore IndexedDB auth persistence."))
};
`;

const authFailureSdkMock = `
export function onAuthStateChanged(_auth, callback) {
  callback(null);
  return () => {};
}
export async function signOut() {}
export async function signInWithCustomToken() { throw new Error("not used"); }
`;

test("profile selector waits for persisted Firebase auth before deciding to redirect", async ({ page }) => {
  await page.route("**/scripts/firebase.js*", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: firebaseMock
  }));
  await page.route("**/scripts/profiles.js*", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: profilesMock
  }));
  await page.route("**/scripts/profile-manager.js*", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: managerMock
  }));
  await page.route("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: authSdkMock
  }));

  await page.goto("/profiles.html", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/profiles\.html$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.vividReady)).toBe("true");
  await expect(page.locator(".vivid-mobile-nav")).toHaveCount(0);
  await expect(page.locator("[data-vivid-back]")).toHaveCount(0);
  await expect(page.locator(".profile-brand")).toHaveAttribute("href", "#profile-heading");
  await expect.poll(() => page.evaluate(() => typeof window.__releaseProfileAuth)).toBe("function");

  // Safari may not have restored Firebase's persisted user at module startup.
  // The selector must remain on this page rather than treating the pending
  // restoration as a signed-out account and bouncing to login.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/profiles\.html$/);
  await page.evaluate(() => window.__releaseProfileAuth());

  await expect(page.getByRole("button", { name: "Choose Main Profile" })).toBeVisible();
  await page.getByRole("button", { name: "Choose Main Profile" }).click();
  await expect(page).toHaveURL(/home\.html$/);
  await page.waitForTimeout(1800);
  await expect(page).toHaveURL(/home\.html$/);
});
test("failed Firebase persistence initialization shows recovery instead of a login redirect", async ({ page }) => {
  await page.route("**/scripts/firebase.js*", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: firebaseFailureMock
  }));
  await page.route("**/scripts/profiles.js*", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: profilesMock
  }));
  await page.route("**/scripts/profile-manager.js*", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: managerMock
  }));
  await page.route("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js", route => route.fulfill({
    status: 200, contentType: "text/javascript", body: authFailureSdkMock
  }));

  await page.goto("/profiles.html", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/profiles\.html$/);
  await expect(page.locator("#profile-grid .profile-load-retry")).toBeVisible();
  await expect(page.locator("#profile-grid .profile-load-error")).toContainText("Firebase could not restore IndexedDB auth persistence");
  await expect(page).not.toHaveURL(/login\.html$/);
});

