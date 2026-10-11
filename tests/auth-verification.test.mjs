import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [auth, handler, page, worker, emailFunction, functionsIndex] = await Promise.all([
  readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/verify-email.js", import.meta.url), "utf8"),
  readFile(new URL("../verify-email.html", import.meta.url), "utf8"),
  readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/email-verification.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/index.js", import.meta.url), "utf8")
]);

test("signup and resend use the server-side custom email sender", () => {
  assert.match(auth, /httpsCallable\(getFunctions\(app, "us-central1"\), "sendVividVerificationEmail"\)/);
  assert.doesNotMatch(auth, /sendEmailVerification/);
  assert.match(auth, /Verify My Email/);
});

test("verification handler applies Firebase action code before showing success", () => {
  assert.match(handler, /params\.get\("mode"\)/);
  assert.match(handler, /params\.get\("oobCode"\)/);
  assert.match(handler, /await applyActionCode\(auth, code\)/);
  assert.match(handler, /Email verified successfully!/);
  assert.match(handler, /expired or already been used/);
});

test("custom email function keeps Admin SDK and provider secrets server-side", () => {
  assert.match(emailFunction, /generateEmailVerificationLink\(user\.email/);
  assert.match(emailFunction, /defineSecret\("RESEND_API_KEY"\)/);
  assert.match(emailFunction, /defineSecret\("VIVID_EMAIL_FROM"\)/);
  assert.match(emailFunction, /Authorization.*Bearer/);
  assert.match(emailFunction, /Verify My Email/);
  assert.match(emailFunction, /emailVerificationRateLimits/);
  assert.match(emailFunction, /request\.auth\.uid/);
  assert.match(functionsIndex, /sendVividVerificationEmail.*email-verification\.js/);
});

test("verification page is precached and loads its handler", () => {
  assert.match(page, /scripts\/verify-email\.js/);
  assert.match(worker, /"\.\/verify-email\.html"/);
  assert.match(worker, /"\.\/scripts\/verify-email\.js"/);
  assert.match(worker, /vivid-cinema-shell-v159/);
});
