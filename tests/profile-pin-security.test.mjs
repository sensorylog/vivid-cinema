import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashProfilePin, verifyProfilePinHash } from "../api/profile-pin.js";

const pinApi = readFileSync(new URL("../api/profile-pin.js", import.meta.url), "utf8");
const selector = readFileSync(new URL("../scripts/profile-selector.js", import.meta.url), "utf8");
const manager = readFileSync(new URL("../scripts/profile-manager.js", import.meta.url), "utf8");
const shell = readFileSync(new URL("../scripts/app-shell.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const page = readFileSync(new URL("../profiles.html", import.meta.url), "utf8");
const profileService = readFileSync(new URL("../cloudflare/functions/lib/profile-service.js", import.meta.url), "utf8");
const cloudflareApi = readFileSync(new URL("../scripts/cloudflare-api.js", import.meta.url), "utf8");
const cloudflareService = readFileSync(new URL("../cloudflare/functions/lib/anime-premium-service.js", import.meta.url), "utf8");

test("profile PINs are stored as salted PBKDF2 hashes, never plaintext", () => {
  const first = hashProfilePin("4826");
  const second = hashProfilePin("4826");
  assert.equal(first.iterations, 600000);
  assert.notEqual(first.pinSalt, second.pinSalt);
  assert.notEqual(first.pinHash, second.pinHash);
  assert.equal("pin" in first, false);
  assert.equal(verifyProfilePinHash("4826", first), true);
  assert.equal(verifyProfilePinHash("4827", first), false);
  assert.equal(verifyProfilePinHash("4826", second), true);
});

test("profile PIN validation rejects malformed and non-numeric values", () => {
  for (const pin of ["", "123", "12345", "12a4", "１２３４", 1234, null]) {
    assert.throws(() => hashProfilePin(pin));
  }
  assert.equal(verifyProfilePinHash("1234", { pinSalt: "bad", pinHash: "bad", iterations: 310000 }), false);
});

test("server PIN endpoint verifies Firebase identity and applies brute-force protections", () => {
  assert.match(pinApi, /auth\.verifyIdToken\(match\[1\], true\)/);
  assert.match(pinApi, /PIN_ATTEMPT_LIMIT = 5/);
  assert.match(pinApi, /PIN_LOCKOUT_MS = 15 \* 60 \* 1000/);
  assert.match(pinApi, /timingSafeEqual\(actual, expected\)/);
  assert.match(pinApi, /recordFailedPin\(db, pinReference/);
  assert.match(pinApi, /consumeRateLimit\(db, claims\.uid, profileId\)/);
  assert.match(pinApi, /isRecentAccountAuth\(claims\)/);
  assert.match(pinApi, /auth\.createCustomToken\(uid/);
  assert.match(pinApi, /action === "select"/);
  assert.match(pinApi, /auth\.createCustomToken\(claims\.uid, \{ profileId, isKids: targetSnapshot\.data\(\)\?\.isKids === true \}\)/);
  assert.match(pinApi, /createProfileSession\(auth, profileReference, claims\.uid, profileId, record\.pinHash\)/);
  assert.match(pinApi, /createProfileSession\(auth, profileReference, claims\.uid, profileId, hashed\.pinHash\)/);
  assert.match(pinApi, /pinSnapshot\.exists/);
  assert.match(pinApi, /session\.pinHash === pinSnapshot\.data\(\)\?\.pinHash/);
});

test("profile session validation is rate-limited and refreshes idle activity", () => {
  assert.match(pinApi, /await consumeRateLimit\(db, claims\.uid, profileId\)/);
  assert.match(pinApi, /action === "validate"/);
  assert.match(pinApi, /SESSION_IDLE_TIMEOUT_MS = 30 \* 60 \* 1000/);
  assert.match(pinApi, /lastActivityAt: Timestamp\.fromMillis\(now\)/);
  assert.match(pinApi, /session\.revoked === true/);
  assert.match(pinApi, /const pinMatches = !pinSnapshot\.exists \|\| session\.pinHash === pinSnapshot\.data\(\)\?\.pinHash/);
  assert.match(pinApi, /lastActivityAt <= now - SESSION_IDLE_TIMEOUT_MS/);
});

test("Firestore denies direct client access to PIN secrets and requires a live session for PIN-locked profile data", () => {
  assert.match(rules, /match \/profileSecurity\/{securityId} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/profileSessions\/{sessionId} \{\s*allow read, write: if false;/);
  assert.match(rules, /function hasProfileSession\([\s\S]*?session\.revoked == false[\s\S]*?session\.get\('expiresAt', null\) is timestamp[\s\S]*?session\.get\('expiresAt',[\s\S]*?> request\.time[\s\S]*?session\.get\('lastActivityAt', null\) is timestamp[\s\S]*?session\.get\('lastActivityAt',[\s\S]*?> request\.time - duration\.value\(30, 'm'\)/);
  assert.match(rules, /function hasCurrentPinSession\([\s\S]*?session\.get\('pinHash', null\)[\s\S]*?pin\.get\('pinHash', null\)/);
  assert.match(rules, /request\.auth\.token\.profileId == profileId/);
  assert.match(rules, /function hasLegacyOwnerProfileAccess/);
  assert.match(rules, /request\.auth\.token\.profileId == 'owner'/);
  assert.match(rules, /!hasProfilePin\(userId, profileId\) \|\| hasCurrentPinSession\(userId, profileId\)/);
});

test("profile APIs resolve to the hosted Pages origin from Android and Electron local runtimes", async () => {
  const { getCloudflareApiUrl } = await import("../scripts/cloudflare-api.js");
  const originalWindow = globalThis.window;
  try {
    globalThis.window = {
      location: { origin: "http://localhost:34871" },
      vividDownloads: { available: true }
    };
    assert.equal(getCloudflareApiUrl("/api/profiles"), "https://vivid-cinema.pages.dev/api/profiles");
    globalThis.window = {
      location: { origin: "https://android.vivid-cinema.pages.dev" },
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" }
    };
    assert.equal(getCloudflareApiUrl("/api/profiles"), "https://vivid-cinema.pages.dev/api/profiles");
    globalThis.window = { location: { origin: "https://vivid-cinema.pages.dev" } };
    assert.equal(getCloudflareApiUrl("/api/profiles"), "https://vivid-cinema.pages.dev/api/profiles");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
  assert.match(manager, /getCloudflareApiUrl\(path\)/);
  assert.match(readFileSync(new URL("../scripts/profiles.js", import.meta.url), "utf8"), /getCloudflareApiUrl\("\/api\/profiles"\)/);
  assert.match(cloudflareApi, /vividDownloads\?\.available === true/);
  assert.match(cloudflareService, /parsed\.hostname === "localhost" && \["http:", "https:", "capacitor:"\]\.includes\(parsed\.protocol\)/);
  assert.match(pinApi, /parsed\.protocol === "http:" && parsed\.hostname === "localhost"/);
});

test("profile listing exposes only a PIN-enabled flag and never returns the stored PIN hash", () => {
  const listing = profileService.match(/export async function listAccountProfiles[\s\S]*?(?=\nexport async function|\nfunction )/)?.[0] || "";
  assert.match(listing, /hasPin: pinSnapshot\.exists/);
  assert.doesNotMatch(listing, /pinHash/);
});

test("profile chooser exposes PIN setup, unlock, and recovery without persisting the PIN in browser storage", () => {
  assert.match(page, /id="profile-pin-dialog"/);
  assert.match(page, /id="profile-pin-settings"/);
  assert.match(page, /id="profile-pin-forgot"/);
  assert.match(selector, /verifyProfilePin\(pendingProfile\.id, pin\)/);
  assert.match(selector, /setProfilePin\(editingId, pin, currentPin, openSession\)/);
  assert.match(selector, /resetProfilePin\(resetProfileId\)/);
  assert.doesNotMatch(selector, /localStorage\.setItem\([^\n]*pin/i);
  assert.match(manager, /cache: "no-store"/);
});

test("every protected page validates the server-issued profile session before proceeding", () => {
  assert.match(shell, /tokenResult\.claims\.profileId !== activeId/);
  assert.match(shell, /activeProfile/);
  assert.match(shell, /tokenResult\.claims\.profileSessionId/);
  assert.match(shell, /validateProfileSession\(user, activeId\)/);
});
