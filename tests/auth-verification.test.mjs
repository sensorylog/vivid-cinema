import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [auth, handler, page, worker, api, firebaseConfig, packageJson, functionsIndex] = await Promise.all([
  readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/verify-email.js", import.meta.url), "utf8"),
  readFile(new URL("../verify-email.html", import.meta.url), "utf8"),
  readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../api/send-verification.js", import.meta.url), "utf8"),
  readFile(new URL("../firebase.json", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../functions/index.js", import.meta.url), "utf8")
]);

test("signup and resend use the authenticated external verification API", () => {
  assert.match(auth, /https:\/\/vivid-cinema-api\.vercel\.app\/api\/send-verification/);
  assert.match(auth, /user\.getIdToken\(\)/);
  assert.match(auth, /Authorization: "Bearer " \+ token/);
  assert.doesNotMatch(auth, /firebase-functions\.js|httpsCallable|getFunctions/);
  assert.doesNotMatch(auth, /sendEmailVerification/);
  assert.match(auth, /Verify My Email/);
});

test("external API verifies Firebase identity before sending a custom email", () => {
  assert.match(api, /verifyIdToken\(match\[1\], true\)/);
  assert.match(api, /getUser\(decoded\.uid\)/);
  assert.match(api, /generateEmailVerificationLink\(user\.email/);
  assert.match(api, /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(api, /RESEND_API_KEY/);
  assert.match(api, /VIVID_EMAIL_FROM/);
  assert.match(api, /https:\/\/api\.resend\.com\/emails/);
  assert.match(api, /emailVerificationRateLimits/);
  assert.match(api, /Access-Control-Allow-Origin/);
  assert.match(api, /DEFAULT_ALLOWED_ORIGINS/);
  assert.match(packageJson, /"firebase-admin": "\\^14\\.5\\.0"/);
  assert.match(firebaseConfig, /https:\/\/vivid-cinema-api\.vercel\.app/);
  assert.doesNotMatch(functionsIndex, /sendVividVerificationEmail.*email-verification\.js/);
});

test("verification handler applies Firebase action code before showing success", () => {
  assert.match(handler, /params\.get\("mode"\)/);
  assert.match(handler, /params\.get\("oobCode"\)/);
  assert.match(handler, /await applyActionCode\(auth, code\)/);
  assert.match(handler, /Email verified successfully!/);
  assert.match(handler, /expired or already been used/);
});

test("verification page is precached and loads its handler", () => {
  assert.match(page, /scripts\/verify-email\.js/);
  assert.match(worker, /"\.\/verify-email\.html"/);
  assert.match(worker, /"\.\/scripts\/verify-email\.js"/);
  assert.match(worker, /const CACHE_NAME = "vivid-cinema-shell-v\d+"/);
  assert.match(worker, /scripts\/auth\.js\?v=20261014-authfix2/);
});
