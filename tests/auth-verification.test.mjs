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

test("Google redirect recovery only runs when a redirect was explicitly started", () => {
  assert.match(auth, /if\(!pending\)return/);
  assert.match(auth, /getRedirectResult\(auth\)/);
  assert.match(auth, /auth\/api-key-not-valid/);
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
  assert.match(packageJson, /"firebase-admin": "\^14\.5\.0"/);
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
  assert.ok(worker.includes("./scripts/auth.js?v=20261016-auth-audit-1"));
});


test("auth-related Firebase modules use one SDK version and fresh cache keys", async () => {
  const [auth, firebaseInit, library, account, navAuth, worker, loginPage, signupPage] = await Promise.all([
    readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/firebase.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/library.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/account.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/nav-auth.js", import.meta.url), "utf8"),
    readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../login.html", import.meta.url), "utf8"),
    readFile(new URL("../auth.html", import.meta.url), "utf8")
  ]);
  const source = [auth, firebaseInit, library, account, navAuth].join("\n");
  const versions = source.split("\n")
    .filter((line) => line.includes("https://www.gstatic.com/firebasejs/"))
    .map((line) => line.split("/firebasejs/")[1]?.split("/")[0]);
  assert.ok(versions.length >= 9, "expected to inspect all shared Firebase SDK imports");
  assert.ok(versions.every((version) => version === "12.19.0"), "Firebase SDK imports must be version-aligned");
  assert.ok(navAuth.includes("firebasejs/12.19.0/firebase-auth.js"), "nav auth must use the shared Firebase SDK version");
  assert.ok(auth.includes("./firebase.js?v=20261016-auth-sdk-refresh"));
  assert.ok(worker.includes("vivid-cinema-shell-v191"));
  assert.ok(worker.includes("./scripts/firebase.js?v=20261016-auth-sdk-refresh"));
  assert.ok(worker.includes("./scripts/auth.js?v=20261016-auth-audit-1"));
  assert.ok(loginPage.includes("scripts/auth.js?v=20261016-auth-audit-1"));
  assert.ok(signupPage.includes("scripts/auth.js?v=20261016-auth-audit-1"));
});


test("auth diagnostics probes Firebase without collecting credentials", async () => {
  const [diagnosticPage, diagnosticScript, worker] = await Promise.all([
    readFile(new URL("../auth-diagnostics.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/auth-diagnostics.js", import.meta.url), "utf8"),
    readFile(new URL("../service-worker.js", import.meta.url), "utf8")
  ]);
  assert.match(diagnosticPage, /scripts\/auth-diagnostics\.js\?v=20261016-auth-audit-1/);
  assert.match(diagnosticScript, /accounts:signInWithPassword/);
  assert.match(diagnosticScript, /body: "\{\}"/);
  assert.doesNotMatch(diagnosticScript, /type=["']password["']|login-password|login-email/);
  assert.match(diagnosticScript, /API_KEY_HTTP_REFERRER_BLOCKED/);
  assert.match(diagnosticScript, /Content Security Policy/);
  assert.match(worker, /isAuthCritical/);
  assert.match(worker, /if\(isAuthCritical\)\{event\.respondWith\(networkFirst\(request\)\);return;\}/);
});


test("Firebase App Check reCAPTCHA scripts are allowed by Hosting CSP", () => {
  const config = JSON.parse(firebaseConfig);
  const policy = config.hosting.headers.find((entry) => entry.headers.some((header) => header.key === "Content-Security-Policy"))
    .headers.find((header) => header.key === "Content-Security-Policy").value;
  const scriptSrc = policy.split(";").find((directive) => directive.trim().startsWith("script-src"));
  assert.match(scriptSrc, /https:\/\/www\.google\.com/);
  assert.match(scriptSrc, /https:\/\/www\.recaptcha\.net/);
  assert.match(policy, /https:\/\/recaptchaenterprise\.googleapis\.com/);
});
