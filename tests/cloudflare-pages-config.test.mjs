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
  for (const host of [
    "identitytoolkit.googleapis.com",
    "firestore.googleapis.com",
    "firebasevertexai.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "vivid-cinema.firebaseapp.com",
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


test("Cloudflare CSP does not allow obsolete Cloud Functions or legacy Vercel API origins", () => {
  const csp = headers.split("\\n").find(line => line.trimStart().startsWith("Content-Security-Policy:"));
  assert.ok(csp);
  assert.doesNotMatch(csp, /cloudfunctions\\.net/);
  assert.doesNotMatch(csp, /vivid-cinema-api\\.vercel\\.app/);
});
