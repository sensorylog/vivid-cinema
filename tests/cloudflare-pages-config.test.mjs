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
  assert.equal(packageJson.scripts["build:static"], "node automation/build-static-dist.mjs");
  assert.equal(packageJson.scripts["build:web"], "npm run build:static && node automation/build-cloudflare-functions.mjs");
  assert.equal(packageJson.scripts["cap:sync"], "npm run build:static && cap sync android");
  assert.ok(buildScript.includes('const output = path.join(root, "dist")'));
  assert.ok(!buildScript.includes('"_headers"'));
  assert.ok(buildScript.includes("await cp(from, to)"));
  assert.ok(buildScript.includes("vivid-native-app-enhancements"));
});

test("Firebase Hosting remains a manual-only backup workflow", () => {
  assert.match(firebaseWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(firebaseWorkflow, /Netlify is the primary automatic host/);
  assert.match(firebaseWorkflow, /Cloudflare Pages is the primary static host/);
  assert.doesNotMatch(firebaseWorkflow, /firebase-tools deploy --only functions/);
});


test("Cloudflare CSP allows the active verification API and managed download function", () => {
  const csp = headers.split("\n").find(line => line.trimStart().startsWith("Content-Security-Policy:"));
  assert.ok(csp);
  assert.ok(csp.includes("https://us-central1-vivid-cinema.cloudfunctions.net"));
  assert.ok(csp.includes("https://archive.org"));
  assert.ok(csp.includes("https://commons.wikimedia.org"));
  assert.ok(csp.includes("https://vivid-cinema-api.vercel.app"));
});


test("Watch Rooms trusted API is deployed by the existing Vercel API project, not the static Pages artifact", async () => {
  const api = await readFile(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(buildScript.includes('"api"'), "static Pages build must keep server API source out of the public dist artifact");
  assert.ok(api.includes("export default async function handler"));
  assert.ok(api.includes("https://vivid-cinema.pages.dev"));
  assert.ok(api.includes("https://vivid-cinema-api.vercel.app") === false, "server route must not hard-code its own public hostname");
  assert.ok(api.includes("getAppCheck(firebaseApp).verifyToken(appCheckToken, { consume: true })"));
});

test("Cloudflare Pages Wrangler config enables Node.js compatibility for the Watch Rooms bundle", async () => {
  const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /compatibility_flags\s*=\s*\[\s*"nodejs_compat"\s*\]/);
  assert.match(config, /compatibility_date\s*=\s*"2026-/);
  assert.match(config, /pages_build_output_dir\s*=\s*"\.\/dist"/);
});

test("Cloudflare Pages bundles the Watch Rooms API from its isolated Functions directory", async () => {
  const build = await readFile(new URL("../automation/build-cloudflare-functions.mjs", import.meta.url), "utf8");
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflarePackage = JSON.parse(await readFile(new URL("../cloudflare/package.json", import.meta.url), "utf8"));
  assert.ok(build.includes("pages"));
  assert.ok(build.includes("functions"));
  assert.ok(build.includes('"--outfile", path.join(output, "_worker.js")'));
  assert.ok(build.includes('"--build-output-directory", output'));
  assert.ok(build.includes('"--compatibility-flags", "nodejs_compat"'));
  assert.ok(build.includes('"--config", path.join(root, "wrangler.toml")'));
  assert.equal(cloudflarePackage.dependencies["@ljoukov/firebase-admin-cloudflare"], "0.0.2");
  assert.ok(route.includes("verifyIdToken(match[1], true)"));
  assert.ok(route.includes("verifyToken(appCheckToken, { consume: true })"));
  assert.ok(route.includes('export async function onRequest'));
  assert.ok(route.includes('db.runTransaction'));
  assert.ok(!route.includes("vivid-cinema-api.vercel.app"));
});
