import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../anime-premium.html", import.meta.url), "utf8");
const client = await readFile(new URL("../scripts/anime-premium.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles/vivid-anime-premium.css", import.meta.url), "utf8");
const legacyAnime = await readFile(new URL("../anime.html", import.meta.url), "utf8");

test("Premium has its own route and namespaced presentation assets", () => {
  assert.match(html, /data-vivid-page="anime-premium"/);
  assert.match(html, /styles\/vivid-anime-premium\.css/);
  assert.match(html, /scripts\/anime-premium\.js/);
  assert.match(html, /VIVID ANIME PREMIUM/);
  assert.match(styles, /\.vap-hero/);
});

test("Premium reuses the existing Vivid Firebase authentication instance", () => {
  assert.match(client, /import \{ auth \} from "\.\/firebase\.js"/);
  assert.match(client, /onAuthStateChanged\(auth/);
  assert.match(client, /!user\.isAnonymous/);
  assert.doesNotMatch(client, /initializeApp\s*\(/);
});

test("signed-out subscription entry is routed through existing Vivid authentication", () => {
  assert.match(html, /auth\.html\?returnTo=anime-premium\.html/);
  assert.match(client, /auth\.html\?returnTo=/);
  assert.match(client, /Sign in or create your free Vivid account/);
});

test("Phase 1 does not grant membership or expose a Premium playback catalogue", () => {
  assert.doesNotMatch(client, /isPremium\s*=\s*true|membershipActive\s*=\s*true|grantEntitlement/i);
  assert.doesNotMatch(html, /<video\b|playbackUrl|checkout\.paystack/i);
});

test("the legacy Anime page remains a separate untouched destination", () => {
  assert.match(legacyAnime, /data-vivid-page="anime"/);
  assert.match(legacyAnime, /scripts\/anime\.js/);
  assert.doesNotMatch(legacyAnime, /anime-premium\.html/);
});
