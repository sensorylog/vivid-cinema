import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, client, styles, legacyAnime, authRuntime, serviceWorker, sitemap, freePolicy, watchRuntime, shell] = await Promise.all([
  read("../anime-premium.html"),
  read("../scripts/anime-premium.js"),
  read("../styles/vivid-anime-premium.css"),
  read("../anime.html"),
  read("../scripts/auth.js"),
  read("../service-worker.js"),
  read("../sitemap.xml"),
  read("../scripts/anime-free-policy.js"),
  read("../scripts/watch.js"),
  read("../scripts/app-shell.js")
]);

test("Premium has its own route, namespaced assets and discoverable metadata", () => {
  assert.match(html, /data-vivid-page="anime-premium"/);
  assert.match(html, /styles\/vivid-anime-premium\.css/);
  assert.match(html, /scripts\/anime-premium\.js/);
  assert.match(html, /VIVID ANIME PREMIUM/);
  assert.match(html, /rel="canonical" href="https:\/\/vivid-cinema\.pages\.dev\/anime-premium\.html"/);
  assert.match(html, /Your anime, all in one place/);
  assert.doesNotMatch(html, /future Premium membership/);
  assert.match(styles, /\.vap-hero/);
  assert.match(styles, /padding-bottom:calc\(160px \+ env\(safe-area-inset-bottom/);
  assert.match(shell, /navLink\("anime-premium\.html", "bi-stars", "Premium"/);
  assert.match(sitemap, /https:\/\/vivid-cinema\.pages\.dev\/anime-premium\.html/);
});

test("Premium is explicitly labelled in navigation and Free Anime remains distinct", () => {
  assert.match(shell, /navLink\("anime-premium\.html", "bi-stars", "Premium"/);
  assert.match(shell, /navLink\("anime\.html", "bi-stars", "Free Anime"/);
  assert.match(shell, /page\.startsWith\("anime-premium"\)/);
});

test("Premium reuses the existing Vivid Firebase authentication instance", () => {
  assert.match(client, /import \{ auth \} from "\.\/firebase\.js"/);
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

test("Premium route and assets are included in the offline app shell", () => {
  assert.match(serviceWorker, /vivid-cinema-shell-v370/);
  assert.match(serviceWorker, /"\.\/anime-premium\.html"/);
  assert.match(serviceWorker, /"\.\/styles\/vivid-anime-premium\.css"/);
  assert.match(serviceWorker, /"\.\/scripts\/anime-premium\.js"/);
});

test("Free Anime is limited to six curated series and season one episode one", () => {
  assert.equal((freePolicy.match(/id: \"/g) || []).length, 6);
  assert.match(freePolicy, /Number\(season\) === 1/);
  assert.match(freePolicy, /Number\(episode\) === 1/);
  assert.match(legacyAnime, /FREE PREVIEW/);
  assert.match(legacyAnime, /anime-premium\.html/);
  assert.match(watchRuntime, /isFreeAnimePreviewRoute/);
  assert.match(watchRuntime, /source === \"vidapi\"/);
  assert.match(watchRuntime, /if \(!isAnimePlayback\(\)\) mountSecondaryPlayer/);
});
