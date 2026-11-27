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
  assert.match(page, /profile-selector-watchdog\.js/);
  assert.match(page, /id="profile-signout"/);
  assert.match(selector, /signOut\(auth\)/);
  assert.match(selector, /setActiveProfileId\(accountId, profile\.id\)/);
  assert.match(selector, /if \(profile\.hasPin\)/);
  assert.match(selector, /verifyProfilePin\(pendingProfile\.id, pin\)/);
  assert.match(selector, /finishProfileOpen\(profile, result\.customToken\)/);
  assert.match(selector, /signInWithCustomToken\(auth, customToken\)/);
  const openFlow = selector.slice(selector.indexOf("async function finishProfileOpen"), selector.indexOf("function startProfileMigration"));
  assert.ok(openFlow.indexOf("signInWithVerifiedProfileSession") < openFlow.indexOf("setActiveProfileId"),
    "the selected profile is persisted only after the server-issued claim is verified");
  assert.match(openFlow, /sessionStorage\.removeItem/);
});

test("custom-token profile sessions are force-refreshed and verified before navigation", () => {
  const verified = selector.slice(
    selector.indexOf("async function signInWithVerifiedProfileSession"),
    selector.indexOf("async function finishProfileOpen")
  );
  assert.match(verified, /selectedUser\.getIdToken\(true\)/);
  assert.match(verified, /selectedUser\.getIdTokenResult\(\)/);
  assert.match(verified, /tokenResult\.claims\.profileId !== expectedProfileId/);
  assert.match(verified, /tokenResult\.claims\.profileSessionId/);
  assert.match(selector, /signInWithVerifiedProfileSession\(migrationSession\.customToken, OWNER_PROFILE_ID, migrationUser\.uid\)/);
});

test("profile gate redirects only once per account session and clears after a valid claim", () => {
  assert.match(shell, /vivid:profile-gate-redirected:v1:/);
  assert.match(shell, /profileGateRedirectedUids/);
  assert.match(shell, /showProfileGateNotice\(\)/);
  assert.match(shell, /clearProfileGateRedirect\(user\.uid\)/);
  assert.match(shell, /clearProfileGateRedirect\(previousUid\)/);
});

test("profile selector does not expose protected global navigation before a profile is chosen", () => {
  assert.match(shell, /if \(currentPage\(\) === "profiles"\)/);
  assert.match(shell, /if \(page === "profiles"\) return/);
  assert.match(page, /class="profile-brand" href="#profile-heading"/);
});

test("profile route validation does not turn transient service failures into selector redirects", () => {
  const summary = profiles.slice(profiles.indexOf("export async function listProfileSummaries"), profiles.indexOf("export function getActiveProfileId"));
  assert.doesNotMatch(summary, /ensureAppCheck/);
  assert.match(summary, /AbortController/);
  assert.match(summary, /PROFILE_CHECK_UNAVAILABLE/);
  assert.match(shell, /temporarily unavailable; preserving the selected route/);
  assert.match(shell, /PROFILE_SESSION_REJECTED/);
});

test("profile selector waits for Firebase auth persistence before deciding a user is signed out", () => {
  const startup = selector.slice(selector.indexOf("async function startProfileAuthObserver"), selector.indexOf("void startProfileAuthObserver();"));
  assert.match(startup, /auth\.authStateReady\(\)/);
  assert.match(startup, /withProfileTimeout/);
  assert.match(startup, /Your Vivid sign-in is still being restored/);
  assert.ok(startup.indexOf("auth.authStateReady()") < startup.indexOf("onAuthStateChanged(auth"),
    "the signed-out redirect must not run before Firebase has restored persisted auth");
  assert.match(startup, /showProfileLoadError\(error\)/);
});

test("profile startup bounds Firebase token refresh and gives users a retry instead of an endless spinner", () => {
  assert.match(manager, /Promise\.race\(\[request, timeout\]\)/);
  assert.match(manager, /user\.getIdToken\(\)/);
  assert.match(manager, /Vivid's profile service took too long to respond/);
  assert.match(selector, /showProfileLoadError/);
  assert.match(selector, /profile-load-retry/);
  assert.match(selector, /console\.error\("Vivid profile selector initialization failed:/);
  assert.match(profiles, /withProfileTimeout/);
  assert.match(profiles, /Your Vivid sign-in is taking too long to refresh/);
  assert.match(profiles, /export function withProfileTimeout/);
  assert.match(profiles, /Vivid security verification is taking too long/);
  assert.match(profiles, /Vivid library setup is taking too long/);
  assert.match(selector, /Your Vivid sign-in is taking too long to verify/);
});

test("a server-issued Firebase profile claim restores a missing Safari storage selection", () => {
  assert.match(shell, /The Firebase custom-token claim is the server-issued source of truth/);
  assert.match(shell, /setActiveProfileId\(user\.uid, claimedProfileId\)/);
  assert.match(profiles, /sessionStorage\.getItem\(key\)/);
  assert.match(profiles, /sessionStorage\.setItem\(key, id\)/);
});

test("profile selector renders existing profiles before starting owner-scoped library migration", () => {
  const refreshStart = selector.indexOf("async function refreshProfiles()");
  const fetchStart = selector.indexOf("let result = await fetchProfiles();", refreshStart);
  const ownerEnsure = selector.indexOf("await ensureOwnerProfile(user);", refreshStart);
  const render = selector.indexOf("renderProfiles();", refreshStart);
  const migration = selector.indexOf("void startProfileMigration();", refreshStart);
  assert.ok(refreshStart >= 0 && fetchStart > refreshStart);
  assert.ok(ownerEnsure > fetchStart, "existing profile list must be checked before creating an owner record");
  assert.ok(render > fetchStart && migration > render, "profiles must render before background migration begins");
  assert.match(selector, /await selectProfile\(OWNER_PROFILE_ID\)/);
  assert.match(selector, /initializeProfileFoundation\(user\)/);
  assert.match(selector, /await ensureProfileMigration\(\)/);
  assert.match(profiles, /await ensureOwnerProfile\(user\)/);
  assert.match(selector, /location\.replace\(destination\(\)\)/);
});

test("profile service requests have a bounded network wait", () => {
  assert.match(manager, /new AbortController\(\)/);
  assert.match(manager, /controller\.abort\(\)/);
  assert.match(manager, /15_000/);
  assert.match(manager, /profile service took too long to respond/);
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
  assert.match(worker, /vivid-cinema-shell-v\d+/);
  assert.match(worker, /profile-selector/);
  assert.match(worker, /profile-selector-watchdog/);
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
  assert.match(selector, /validateProfileSession/);
  assert.match(selector, /timeupdate/);
  assert.match(shell, /bindProfileActivity/);
  assert.match(shell, /timeupdate/);
});



test("profile identities use the original cinematic avatar artwork and mobile sync stacks cleanly", async () => {
  const [selector, styles, artwork, accountStyles, page] = await Promise.all([
    read("../scripts/profile-selector.js"),
    read("../styles/vivid-profile-selector.css"),
    read("../assets/profile-avatars.svg"),
    read("../styles/vivid-account.css"),
    read("../profiles.html")
  ]);
  assert.match(artwork, /<svg[^>]+viewBox="0 0 1024 1024"/);
  assert.equal((artwork.match(/<g transform="translate\(/g) || []).length, 16);
  assert.match(selector, /profile-avatar-art/);
  assert.match(selector, /--avatar-x/);
  assert.match(styles, /background-image:url\("\.\.\/assets\/profile-avatars\.svg"\)/);
  assert.match(page, /phase7-profile-recovery-1/);
  assert.match(accountStyles, /\.account-page \.account-sync \.vivid-button\{flex:1 1 100%;width:100%/);
});
