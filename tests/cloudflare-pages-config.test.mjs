import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");
const buildScript = await readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const firebaseWorkflow = await readFile(new URL("../.github/workflows/firebase-hosting-deploy.yml", import.meta.url), "utf8");

test("Cloudflare Pages headers preserve core security policy", () => {
  for (const header of [
    "Strict-Transport-Security:",
    "Cross-Origin-Opener-Policy: same-origin-allow-popups",
    "X-Content-Type-Options: nosniff",
    "X-Permitted-Cross-Domain-Policies: none",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "Content-Security-Policy:",
    "Permissions-Policy:"
  ]) {
    assert.ok(headers.includes(header), `Missing header directive: ${header}`);
  }
});

test("Cloudflare Content Security Policy keeps existing Firebase and provider endpoints", () => {
  const csp = headers.split("\n").find(line => line.trimStart().startsWith("Content-Security-Policy:"));
  assert.ok(csp);
  assert.ok(csp.includes("media-src"));
  assert.ok(csp.includes("vivid-media:"), "CSP must allow Vivid local offline playback");
  for (const host of [
    "identitytoolkit.googleapis.com",
    "firestore.googleapis.com",
    "firebasevertexai.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "vivid-cinema.firebaseapp.com",
    "api.github.com",
    "api.themoviedb.org",
    "checkout.paystack.com",
    "www.youtube.com",
    "vidlink.pro"
  ]) {
    assert.ok(csp.includes(host), `CSP is missing existing allowed host ${host}`);
  }
});

test("Cloudflare Pages keeps the existing HTML and static asset cache policies", () => {
  assert.match(headers, /\/\*\.html\s+Cache-Control: no-cache, max-age=0, must-revalidate/);
  assert.match(headers, /\/\*\.js\s+Cache-Control: public, max-age=86400, stale-while-revalidate=604800/);
  assert.match(headers, /\/\*\.css\s+Cache-Control: public, max-age=86400, stale-while-revalidate=604800/);
  assert.match(headers, /\/\*\.png\s+Cache-Control: public, max-age=604800, stale-while-revalidate=2592000/);
});

test("Google Search Console verification token is copied into the Cloudflare Pages artifact", async () => {
  const verification = await readFile(new URL("../googlec7ad9951d02b4b4f.html", import.meta.url), "utf8");
  assert.equal(verification.trim(), "google-site-verification: googlec7ad9951d02b4b4f.html");
  assert.ok(buildScript.includes('const googleVerificationFile = "googlec7ad9951d02b4b4f.html"'));
  assert.ok(buildScript.includes("path.join(output, googleVerificationFile)"));
});

test("shared static build publishes dist and retains Capacitor enhancements", () => {
  assert.equal(packageJson.scripts["build:web"], "node automation/build-static-dist.mjs");
  assert.ok(buildScript.includes('const output = path.join(root, "dist")'));
  assert.ok(!buildScript.includes('"_headers"'));
  assert.ok(buildScript.includes("await cp(from, to)"));
  assert.ok(buildScript.includes("vivid-native-app-enhancements"));
});

test("Firebase Hosting remains a manual-only backup workflow", () => {
  assert.match(firebaseWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(firebaseWorkflow, /Netlify is the primary automatic host/);
  assert.match(firebaseWorkflow, /Cloudflare Pages is the primary static host/);
});


test("Cloudflare CSP allows the managed download function but blocks obsolete Vercel APIs", () => {
  const csp = headers.split("\n").find(line => line.trimStart().startsWith("Content-Security-Policy:"));
  assert.ok(csp);
  assert.ok(csp.includes("https://us-central1-vivid-cinema.cloudfunctions.net"));
  assert.ok(csp.includes("https://archive.org"));
  assert.ok(csp.includes("https://commons.wikimedia.org"));
  assert.doesNotMatch(csp, /vivid-cinema-api\.vercel\.app/);
});
