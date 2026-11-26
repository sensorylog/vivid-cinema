import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, client, styles, legacyAnime, authRuntime, serviceWorker, sitemap, shell] = await Promise.all([
  read("../anime-premium.html"),
  read("../scripts/anime-premium.js"),
  read("../styles/vivid-anime-premium.css"),
  read("../anime.html"),
  read("../scripts/auth.js"),
  read("../service-worker.js"),
  read("../sitemap.xml"),
  read("../scripts/app-shell.js")
]);

test("Premium has its own route, namespaced assets and discoverable metadata", () => {
  assert.match(html, /data-vivid-page="anime-premium"/);
  assert.match(html, /styles\/vivid-anime-premium\.css/);
  assert.match(html, /scripts\/anime-premium\.js/);
  assert.match(html, /VIVID ANIME PREMIUM/);
  assert.match(html, /rel="canonical" href="https:\/\/vivid-cinema\.pages\.dev\/anime-premium\.html"/);
  assert.match(styles, /\.vap-hero/);
  assert.match(sitemap, /https:\/\/vivid-cinema\.pages\.dev\/anime-premium\.html/);
});

test("Premium reuses the existing Vivid Firebase authentication instance", () => {
  assert.match(client, /import\("\.\/firebase\.js"\)/);
  assert.match(client, /onAuthStateChanged\(auth/);
  assert.match(client, /!user\.isAnonymous/);
  assert.doesNotMatch(client, /initializeApp\s*\(/);
  assert.doesNotMatch(client, /getAuth\s*\(/);
});

test("signed-out users enter the existing sign-up/login flow and return to Premium", () => {
  assert.match(html, /auth\.html\?returnTo=anime-premium\.html/);
  assert.match(client, /auth\.html\?returnTo=/);
  assert.match(client, /Sign in or create your free Vivid account/);
  assert.match(authRuntime, /function postAuthDestination\(\)/);
  assert.match(authRuntime, /target\.origin!==window\.location\.origin/);
  assert.match(authRuntime, /target\.pathname\.endsWith\("\.html"\)/);
  assert.match(authRuntime, /searchParams\.set\("returnTo",destination\)/);
});

test("Phase 1 does not grant membership or expose a Premium playback catalogue", () => {
  assert.doesNotMatch(client, /isPremium\s*=\s*true|membershipActive\s*=\s*true|grantEntitlement/i);
  assert.doesNotMatch(html, /<video\b|playbackUrl|checkout\.paystack/i);
});

test("Anime Premium is a first-class desktop destination while free anime stays separate", () => {
  assert.match(shell, /navLink\("anime-premium\.html", "bi-stars", "Anime Premium"/);
  assert.equal((shell.match(/page\.startsWith\("anime-premium"\)/g) || []).length, 2);
  assert.match(shell, /navLink\("anime\.html", "bi-stars", "Anime \(Free\)"/);
  assert.doesNotMatch(shell, /"anime-premium", "library"/);
});

test("Premium route and assets are included in the offline app shell", () => {
  assert.match(serviceWorker, /vivid-cinema-shell-v367/);
  assert.match(serviceWorker, /"\.\/anime-premium\.html"/);
  assert.match(serviceWorker, /"\.\/styles\/vivid-anime-premium\.css"/);
  assert.match(serviceWorker, /"\.\/scripts\/anime-premium\.js"/);
});

test("the free Anime destination is explicitly limited and points users to Premium", () => {
  assert.match(legacyAnime, /VIVID ANIME · FREE/);
  assert.match(legacyAnime, /six selected series and the first episode of each/);
  assert.match(legacyAnime, /anime-premium\.html/);
  assert.match(legacyAnime, /FREE SAMPLE COLLECTION/);
  assert.match(legacyAnime, /scripts\/anime\.js/);
});
