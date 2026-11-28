import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hashProfilePin, verifyProfilePinHash, isAllowedOrigin } from "../api/profile-pin.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("profile PINs use salted PBKDF2 hashes and never store the raw four digits", () => {
  const record = hashProfilePin("4826");
  assert.equal(record.iterations, 600000);
  assert.equal(typeof record.pinSalt, "string");
  assert.equal(typeof record.pinHash, "string");
  assert.notEqual(record.pinHash, "4826");
  assert.notEqual(record.pinSalt, "4826");
  assert.equal(verifyProfilePinHash("4826", record), true);
  assert.equal(verifyProfilePinHash("4827", record), false);
  assert.equal(verifyProfilePinHash("4826", { ...record, pinSalt: "invalid" }), false);
  assert.throws(() => hashProfilePin("12a4"));
  assert.throws(() => hashProfilePin("123"));
  assert.throws(() => hashProfilePin("12345"));
});

test("profile PIN API accepts only HTTPS previews belonging to the Vivid Cloudflare Pages project", () => {
  assert.equal(isAllowedOrigin("https://vivid-cinema.pages.dev"), true);
  assert.equal(isAllowedOrigin("https://feature-preview.vivid-cinema.pages.dev"), true);
  assert.equal(isAllowedOrigin("https://feature-preview.vivid-cinema.pages.dev.evil.example"), false);
  assert.equal(isAllowedOrigin("https://unrelated.pages.dev"), false);
  assert.equal(isAllowedOrigin("http://feature-preview.vivid-cinema.pages.dev"), false);
});

test("profile PIN API enforces lockout, recent-auth recovery and server-issued sessions", async () => {
  const api = await read("../api/profile-pin.js");
  const rules = await read("../firestore.rules");
  const service = await read("../cloudflare/functions/lib/profile-service.js");
  assert.match(api, /PIN_ATTEMPT_LIMIT = 5/);
  assert.match(api, /PIN_LOCKOUT_MS = 15 \* 60 \* 1000/);
  assert.match(api, /PIN_RATE_LIMIT = 30/);
  assert.match(api, /pbkdf2Sync/);
  assert.match(api, /timingSafeEqual/);
  assert.match(api, /auth\.verifyIdToken\(match\[1\], true\)/);
  assert.match(api, /auth\.createCustomToken\(uid/);
  assert.match(api, /profileSessionId/);
  assert.match(api, /profileSessions/);
  assert.match(api, /email_verified === true/);
  assert.match(api, /action === "reset"/);
  assert.match(api, /action === "validate"/);
  assert.match(api, /action === "restore"/);
  assert.match(api, /profileSessionId: sessionId/);
  assert.match(api, /sessionId, sessionExpiresAt/);
  assert.match(api, /session\.uid !== claims\.uid/);
  assert.match(api, /SESSION_IDLE_TIMEOUT_MS = 30 \* 60 \* 1000/);
  assert.match(api, /lastActivityAt: Timestamp\.fromMillis\(now\)/);
  assert.match(service, /lastActivityAt <= Date\.now\(\) - PROFILE_SESSION_IDLE_TIMEOUT_MS/);
  assert.match(rules, /function hasProfilePin/);
  assert.match(rules, /function hasProfileSession/);
  assert.match(rules, /profileSessionId/);
  assert.match(rules, /match \/profileSecurity\/\{securityId\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/profileSessions\/\{sessionId\} \{\s*allow read, write: if false;/);
  assert.match(service, /hasPin: pinSnapshot\.exists/);
});

test("profile client never receives PIN hashes or salts and validates locked-profile sessions", async () => {
  const client = await read("../scripts/profiles.js");
  const shell = await read("../scripts/app-shell.js");
  const manager = await read("../scripts/profile-manager.js");
  assert.doesNotMatch(client, /pinHash|pinSalt|pinVerifier/i);
  assert.match(client, /listProfileSummaries/);
  assert.match(client, /validateProfileSession/);
  assert.match(shell, /activeProfile\.hasPin/);
  assert.match(shell, /validateProfileSession\(user, activeId\)/);
  assert.match(manager, /verifyProfilePin/);
  assert.match(manager, /setProfilePin/);
  assert.match(manager, /removeProfilePin/);
  assert.match(manager, /resetProfilePin/);
});
