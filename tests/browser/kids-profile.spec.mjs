import { test, expect } from "@playwright/test";

const authMock = `
export const auth = {
  currentUser: {
    uid: "browser-test-user",
    isAnonymous: false,
    getIdTokenResult: async () => ({ claims: window.__profileClaims || { profileId: "owner" } })
  }
};
`;

const authSdkMock = `
import { auth } from "/scripts/firebase.js";
export function onAuthStateChanged(_auth, callback) { callback(_auth.currentUser); return () => {}; }
export async function signOut(_auth) { _auth.currentUser = null; }
export async function signInWithCustomToken(_auth, token) {
  const profileId = token === "owner-session-token" ? "owner" : "kid-1";
  _auth.currentUser = {
    uid: "browser-test-user",
    isAnonymous: false,
    getIdTokenResult: async () => ({ claims: { profileId, isKids: profileId === "kid-1" } })
  };
  return { user: _auth.currentUser };
}
`;

const profilesMock = `
export const OWNER_PROFILE_ID = "owner";
export async function ensureOwnerProfile() {}
export async function initializeProfileFoundation() {}
export function getActiveProfileId() { return window.__activeProfileId || "owner"; }
export function setActiveProfileId(_uid, id) { window.__activeProfileId = id; }
export function clearActiveProfileId() { window.__activeProfileId = ""; }
export async function listProfileSummaries() {
  return { profiles: [window.__parentalPolicy || {}] };
}
`;

const managerMock = `
let profiles = window.__profiles || [
  { id: "owner", name: "Main Profile", isOwner: true, isKids: false, hasPin: true, avatarId: "aurora" }
];
export const PROFILE_AVATARS = [{ id: "aurora", label: "Aurora" }, { id: "ember", label: "Ember" }];
export const MAX_PROFILES = 5;
export async function fetchProfiles() { return { profiles: structuredClone(profiles), migrationComplete: true }; }
export async function createProfile(details) {
  window.__createdKidsProfile = structuredClone(details);
  profiles.push({ ...details, id: "kid-1", hasPin: false, isOwner: false });
  return { ...details, id: "kid-1" };
}
export async function updateProfile(id, details) {
  profiles = profiles.map(item => item.id === id ? { ...item, ...details } : item);
  return profiles.find(item => item.id === id);
}
export async function deleteProfile(id) { profiles = profiles.filter(item => item.id !== id); return { ok: true }; }
export async function compressProfileImage() { return ""; }
export async function selectProfile() { return { customToken: "owner-session-token" }; }
export async function verifyProfilePin(id, pin) {
  window.__verifiedPin = pin;
  sessionStorage.setItem("vivid:test-verified-pin", pin);
  if (pin !== "2468") throw new Error("Incorrect PIN.");
  return { customToken: "owner-session-token" };
}
export async function setProfilePin() { return { ok: true }; }
export async function removeProfilePin() { return { ok: true }; }
export async function resetProfilePin() { return { ok: true }; }
`;

async function mockProfileRuntime(page) {
  await page.route("**/scripts/firebase.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: authMock }));
  await page.route("**/scripts/profiles.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: profilesMock }));
  await page.route("**/scripts/profile-manager.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: managerMock }));
  await page.route("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: authSdkMock }));
}

test("a parent can create a Kids profile with explicit viewing limits and blocked content", async ({ page }) => {
  await mockProfileRuntime(page);
  await page.goto("/profiles.html", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Choose Main Profile" })).toBeVisible();

  await page.getByRole("button", { name: "Manage profiles" }).click();
  await page.getByRole("button", { name: "Add profile" }).click();
  await page.locator("#profile-name").fill("Kids Room");
  await page.locator("#profile-is-kids").check();
  await page.locator("#profile-movie-rating").selectOption("PG");
  await page.locator("#profile-tv-rating").selectOption("TV-PG");
  await page.locator("#profile-blocked-genres").selectOption(["27", "53"]);
  await page.locator("#profile-blocked-titles").fill("movie:123, tv:456");
  await page.getByRole("button", { name: "Create profile" }).click();

  await expect.poll(() => page.evaluate(() => window.__createdKidsProfile || null)).toMatchObject({
    name: "Kids Room",
    isKids: true,
    movieRatingLimit: "PG",
    tvRatingLimit: "TV-PG",
    blockedGenreIds: [27, 53],
    blockedTitles: ["movie:123", "tv:456"]
  });
  await expect(page.getByRole("button", { name: "Edit Kids Room" })).toBeVisible();
});

test("Vivid avatar choices support roving keyboard navigation", async ({ page }) => {
  await mockProfileRuntime(page);
  await page.goto("/profiles.html", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Manage profiles" }).click();
  await page.getByRole("button", { name: "Add profile" }).click();

  const radios = page.locator("#avatar-gallery [role=radio]");
  await expect(radios.nth(0)).toHaveAttribute("tabindex", "0");
  await expect(radios.nth(1)).toHaveAttribute("tabindex", "-1");
  await radios.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(radios.nth(1)).toBeFocused();

  await page.keyboard.press("End");
  await expect(radios.last()).toHaveAttribute("aria-checked", "true");
  await expect(radios.last()).toBeFocused();
});

test("leaving an active Kids profile requires the Main Profile PIN and only then switches profiles", async ({ page }) => {
  await page.addInitScript(() => {
    window.__profileClaims = { profileId: "kid-1", isKids: true };
    window.__activeProfileId = "kid-1";
    window.__profiles = [
      { id: "owner", name: "Main Profile", isOwner: true, isKids: false, hasPin: true, avatarId: "aurora" },
      { id: "kid-1", name: "Kids Room", isOwner: false, isKids: true, hasPin: false, avatarId: "ember" }
    ];
  });
  await mockProfileRuntime(page);
  await page.goto("/profiles.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#profile-pin-dialog")).toBeVisible();
  await expect(page.locator("#profile-pin-description")).toContainText("Main Profile");

  await page.locator("#profile-pin-input").fill("1111");
  await page.locator("#profile-pin-unlock").click();
  await expect(page.locator("#profile-pin-status-message")).toContainText("Incorrect PIN");
  await expect(page.locator("#profile-pin-dialog")).toBeVisible();
  await expect(page).not.toHaveURL(/home\.html$/);

  await page.locator("#profile-pin-input").fill("2468");
  await page.locator("#profile-pin-unlock").click();
  await expect(page).toHaveURL(/home\.html$/);
  // A successful PIN unlock navigates to a new document. sessionStorage survives
  // same-origin navigation, whereas window properties intentionally do not.
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("vivid:test-verified-pin"))).toBe("2468");
});

test("Kids policy blocks over-limit, unrated, genre-blocked and individually blocked titles", async ({ page }) => {
  await page.addInitScript(() => {
    window.__profileClaims = { profileId: "kid-1", isKids: true };
    window.__parentalPolicy = {
      id: "kid-1",
      isKids: true,
      movieRatingLimit: "PG",
      tvRatingLimit: "TV-PG",
      blockedGenreIds: [27],
      blockedTitles: ["movie:333"],
      allowUnrated: false
    };
  });
  await page.route("**/scripts/firebase.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: authMock }));
  await page.route("**/scripts/profiles.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: profilesMock }));
  await page.route("**/scripts/tmdb.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: `export const tmdbApi = {\n    movieDetails: async id => ({ id, adult: false, genre_ids: Number(id) === 107 ? [27] : [35] }),\n    tvDetails: async id => ({ id, adult: false, genre_ids: [35] }),\n    movieReleaseDates: async id => ({ results: [{ iso_3166_1: "US", release_dates: Number(id) === 109 ? [{ certification: "G" }, { certification: "PG-13" }] : [{ certification: "G" }] }] }),\n    tvContentRatings: async () => ({ results: [{ iso_3166_1: "US", rating: "TV-G" }] })\n  }` }));
  await page.route("**/scripts/provider-region.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "export function getProviderCountry() { return 'US'; }" }));

  await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  const results = await page.evaluate(async () => {
    const policy = await import("/scripts/parental-controls.js");
    const checks = await Promise.all([
      policy.isTitleAllowed({ id: 101, media_type: "movie", certification: "PG" }),
      policy.isTitleAllowed({ id: 102, media_type: "movie", certification: "PG-13" }),
      policy.isTitleAllowed({ id: 103, media_type: "movie", genre_ids: [27], certification: "G" }),
      policy.isTitleAllowed({ id: 333, media_type: "movie", certification: "G" }),
      policy.isTitleAllowed({ id: 104, media_type: "movie" }),
      policy.isTitleAllowed({ id: 105, media_type: "tv", certification: "TV-PG" }),
      policy.isTitleAllowed({ id: 106, media_type: "tv", certification: "TV-14" }),\n      policy.isTitleAllowed({ id: 107, media_type: "movie" }),\n      policy.isTitleAllowed({ id: 108, media_type: "movie" }),
      policy.isTitleAllowed({ id: 109, media_type: "movie" })
    ]);
    return checks;
  });
  expect(results).toEqual([true, false, false, false, false, true, false, false, true, false]);
});


test("Kids profiles use stricter fallback limits when parental policy services are unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    window.__profileClaims = { profileId: "kid-offline", isKids: true };
    window.__activeProfileId = "kid-offline";
  });
  const offlineProfiles = profilesMock.replace(
    "export async function listProfileSummaries() {\n  return { profiles: [window.__parentalPolicy || {}] };\n}",
    "export async function listProfileSummaries() { throw new Error('offline'); }"
  );
  await page.route("**/scripts/firebase.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: authMock }));
  await page.route("**/scripts/profiles.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: offlineProfiles }));
  await page.route("**/scripts/tmdb.js", route => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: `export const tmdbApi = {
      movieDetails: async id => ({ id, adult: false, genre_ids: [35] }),
      tvDetails: async id => ({ id, adult: false, genre_ids: [35] }),
      movieReleaseDates: async () => ({ results: [{ iso_3166_1: "US", release_dates: [{ certification: "G" }] }] }),
      tvContentRatings: async () => ({ results: [{ iso_3166_1: "US", rating: "TV-G" }] })
    }`
  }));
  await page.route("**/scripts/provider-region.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "export function getProviderCountry() { return 'US'; }" }));
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  const results = await page.evaluate(async () => {
    const policy = await import("/scripts/parental-controls.js");
    return Promise.all([
      policy.isTitleAllowed({ id: 201, media_type: "movie", certification: "PG" }),
      policy.isTitleAllowed({ id: 202, media_type: "movie", certification: "G", genre_ids: [35], adult: false }),
      policy.isTitleAllowed({ id: 203, media_type: "tv", certification: "TV-PG", genre_ids: [35], adult: false })
    ]);
  });
  expect(results).toEqual([false, true, false]);
});

test("current signed profile claims override a stale cached Kids policy", async ({ page }) => {
  await page.addInitScript(() => {
    window.__profileClaims = { profileId: "adult-offline", isKids: false };
    window.__activeProfileId = "adult-offline";
    localStorage.setItem("vivid:parental-policy:v1:browser-test-user:adult-offline", JSON.stringify({
      id: "adult-offline",
      isKids: true,
      movieRatingLimit: "G",
      tvRatingLimit: "TV-Y",
      blockedGenreIds: [27, 53, 80, 10752],
      blockedTitles: [],
      allowUnrated: false
    }));
  });
  const offlineProfiles = profilesMock.replace(
    "export async function listProfileSummaries() {\n  return { profiles: [window.__parentalPolicy || {}] };\n}",
    "export async function listProfileSummaries() { throw new Error('offline'); }"
  );
  await page.route("**/scripts/firebase.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: authMock }));
  await page.route("**/scripts/profiles.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: offlineProfiles }));
  await page.route("**/scripts/tmdb.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "export const tmdbApi = {};" }));
  await page.route("**/scripts/provider-region.js", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "export function getProviderCountry() { return 'US'; }" }));
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  const allowed = await page.evaluate(async () => {
    const policy = await import("/scripts/parental-controls.js");
    return policy.isTitleAllowed({ id: 204, media_type: "movie", certification: "PG-13" });
  });
  expect(allowed).toBe(true);
});


test("account reauthentication ignores a stale Kids selection so the parent can restore the Main Profile PIN", async ({ page }) => {
  await page.addInitScript(() => {
    window.__profileClaims = {};
    window.__activeProfileId = "kid-1";
    window.__profiles = [
      { id: "owner", name: "Main Profile", isOwner: true, isKids: false, hasPin: false, avatarId: "aurora" },
      { id: "kid-1", name: "Kids Room", isOwner: false, isKids: true, hasPin: false, avatarId: "ember" }
    ];
  });
  await mockProfileRuntime(page);
  await page.goto("/profiles.html", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Choose Main Profile" })).toBeVisible();
  await expect(page.locator("#profile-pin-dialog")).toBeHidden();
  await page.getByRole("button", { name: "Choose Main Profile" }).click();
  await expect(page).toHaveURL(/home\.html$/);
});
