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

test("profile PINs are stored as salted PBKDF2 hashes, never plaintext", () => {
  const first = hashProfilePin("4826");
  const second = hashProfilePin("4826");
  assert.equal(first.iterations, 310000);
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
  assert.match(pinApi, /auth\.createCustomToken\(claims\.uid, \{ profileId \}\)/);
  assert.match(pinApi, /createProfileSession\(auth, profileReference, claims\.uid, profileId, record\.pinHash\)/);\n  assert.match(pinApi, /createProfileSession\(auth, profileReference, claims\.uid, profileId, hashed\.pinHash\)/);
  assert.match(pinApi, /pinSnapshot\.exists/);
});

test("normal profile-session checks do not consume the PIN-attempt rate limit", () => {
  assert.match(pinApi, /if \(action !== "validate"\) await consumeRateLimit/);
  assert.match(pinApi, /action === "validate"/);
  assert.match(pinApi, /session\.revoked === true/);
  assert.match(pinApi, /const pinMatches = !pinSnapshot\.exists \|\| session\.pinHash === pinSnapshot\.data\(\)\?\.pinHash/);
  assert.match(pinApi, /expiresAt <= Date\.now\(\)/);
});

test("Firestore denies direct client access to PIN secrets and requires a live session for PIN-locked profile data", () => {
  assert.match(rules, /match \/profileSecurity\/{securityId} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/profileSessions\/{sessionId} \{\s*allow read, write: if false;/);
  assert.match(rules, /function hasProfileSession\([\s\S]*?data\.revoked == false[\s\S]*?data\.expiresAt > request\.time/);
  assert.match(rules, /function hasCurrentPinSession\([\s\S]*?data\.pinHash[\s\S]*?data\.pinHash/);
  assert.match(rules, /request\.auth\.token\.profileId == profileId/);
  assert.match(rules, /function hasLegacyOwnerProfileAccess/);
  assert.match(rules, /request\.auth\.token\.profileId == 'owner'/);
  assert.match(rules, /!hasProfilePin\(userId, profileId\) \|\| hasCurrentPinSession\(userId, profileId\)/);
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
