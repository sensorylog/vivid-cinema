import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [auth, handler, page, worker, firebaseConfig] = await Promise.all([
  readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
  readFile(new URL("../scripts/verify-email.js", import.meta.url), "utf8"),
  readFile(new URL("../verify-email.html", import.meta.url), "utf8"),
  readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../firebase.json", import.meta.url), "utf8")
]);

test("signup and resend use Firebase Auth directly without a Vercel verification API", () => {
  assert.match(auth, /sendEmailVerification\(user,\s*\{/);
  assert.match(auth, /https:\/\/vivid-cinema\.web\.app\/verify-email\.html/);
  assert.match(auth, /handleCodeInApp:\s*false/);
  assert.doesNotMatch(auth, /vivid-cinema-api\.vercel\.app|send-verification/);
  assert.doesNotMatch(auth, /firebase-functions\.js|httpsCallable|getFunctions/);
  assert.match(auth, /Verify My Email/);
});

test("Google redirect recovery only runs when a redirect was explicitly started", () => {
  assert.match(auth, /if\(!pending\)return/);
  assert.match(auth, /getRedirectResult\(auth\)/);
  assert.match(auth, /auth\/api-key-not-valid/);
});

test("installed PWAs use redirect-based Google sign-in instead of popup flow", () => {
  assert.match(auth, /function isStandaloneApp\(\)/);
  assert.match(auth, /display-mode: standalone/);
  assert.match(auth, /if\(isStandaloneApp\(\)\)\{\s*await beginGoogleRedirect\(provider\);\s*return;/);
  assert.match(auth, /function markGoogleRedirectPending\(\)/);
  assert.match(auth, /await signInWithRedirect\(auth,provider\)/);
});

test("Firebase Hosting config has no dependency on the removed Vercel verification API", () => {
  assert.doesNotMatch(firebaseConfig, /vivid-cinema-api\.vercel\.app/);
  assert.doesNotMatch(auth, /vivid-cinema-api\.vercel\.app/);
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
  assert.ok(worker.includes("./scripts/auth.js?v=20261016-auth-runtime-audit2"));
});


test("auth-related Firebase modules use one SDK version and fresh cache keys", async () => {
  const [auth, firebaseInit, library, account, worker, loginPage, signupPage, navAuth] = await Promise.all([
    readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/firebase.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/library.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/account.js", import.meta.url), "utf8"),
    readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../login.html", import.meta.url), "utf8"),
    readFile(new URL("../auth.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/nav-auth.js", import.meta.url), "utf8")
  ]);
  const source = [auth, firebaseInit, library, account].join("\n");
  const versions = source.split("\n")
    .filter((line) => line.includes("https://www.gstatic.com/firebasejs/"))
    .map((line) => line.split("/firebasejs/")[1]?.split("/")[0]);
  assert.ok(versions.length >= 9, "expected to inspect all shared Firebase SDK imports");
  assert.ok(versions.every((version) => version === "12.19.0"), "Firebase SDK imports must be version-aligned");
  assert.ok(auth.includes("./firebase.js?v=20261016-auth-runtime-audit2"));
  assert.ok(worker.includes("./scripts/firebase.js?v=20261016-auth-runtime-audit2"));
  assert.ok(worker.includes("./scripts/auth.js?v=20261016-auth-runtime-audit2"));
  assert.ok(loginPage.includes("scripts/auth.js?v=20261016-auth-runtime-audit2"));
  assert.ok(signupPage.includes("scripts/auth.js?v=20261016-auth-runtime-audit2"));
  assert.match(worker, /isAuthDocument\|\|isAuthRuntime\)\{event\.respondWith\(networkFirst\(request\)\);return;/);
  assert.match(worker, /isAuthRuntime=.*auth\|firebase\|nav-auth/);
  assert.match(navAuth, /firebasejs\/12\.19\.0\/firebase-auth\.js/);
});


test("auth diagnostics probes Firebase without collecting credentials", async () => {
  const [diagnosticPage, diagnosticScript, worker] = await Promise.all([
    readFile(new URL("../auth-diagnostics.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/auth-diagnostics.js", import.meta.url), "utf8"),
    readFile(new URL("../service-worker.js", import.meta.url), "utf8")
  ]);
  assert.match(diagnosticPage, /scripts\/auth-diagnostics\.js\?v=20261016-auth-diagnostics-1/);
  assert.match(diagnosticScript, /accounts:signInWithPassword/);
  assert.match(diagnosticScript, /body: "\{\}"/);
  assert.doesNotMatch(diagnosticScript, /type=["']password["']|login-password|login-email/);
  assert.match(diagnosticScript, /API_KEY_HTTP_REFERRER_BLOCKED/);
  assert.match(diagnosticScript, /Content Security Policy/);
  assert.match(worker, /isAuthDocument\|\|isAuthRuntime/);
  assert.match(worker, /auth-diagnostics/);
});

test("Firebase App Check reCAPTCHA scripts are allowed by Hosting CSP", () => {
  const config = JSON.parse(firebaseConfig);
  const headerGroup = config.hosting.headers.find((entry) => entry.headers.some((header) => header.key === "Content-Security-Policy"));
  const policy = headerGroup.headers.find((header) => header.key === "Content-Security-Policy").value;
  const scriptSrc = policy.split(";").find((directive) => directive.trim().startsWith("script-src"));
  assert.match(scriptSrc, /https:\/\/www\.google\.com/);
  assert.match(scriptSrc, /https:\/\/www\.recaptcha\.net/);
  assert.match(policy, /https:\/\/recaptchaenterprise\.googleapis\.com/);
});

test("successful sign-in and Google account creation show a visible confirmation after redirect", async () => {
  const [auth, shell] = await Promise.all([
    readFile(new URL("../scripts/auth.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/app-shell.js", import.meta.url), "utf8")
  ]);
  assert.match(auth, /setPostAuthNotice\("Welcome back!/);
  assert.match(auth, /getAdditionalUserInfo\(credential\)/);
  assert.match(auth, /Account created successfully with Google!/);
  assert.match(auth, /sessionStorage\.setItem\("vivid:auth-success",message\)/);
  assert.match(shell, /function showPostAuthNotice\(\)/);
  assert.match(shell, /sessionStorage\.getItem\("vivid:auth-success"\)/);
  assert.match(shell, /setAttribute\("aria-live", "polite"\)/);
  assert.match(shell, /window\.setTimeout\(\(\) => \{/);
});
