import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, script, sw, syntax, css] = await Promise.all([
  read("../anime-premium-watch.html"),
  read("../scripts/anime-premium-watch.js"),
  read("../service-worker.js"),
  read("../automation/check-syntax.mjs"),
  read("../styles/vivid-anime-premium-watch.css")
]);

test("Premium watch page has a responsive embedded player and multi-server selector", () => {
  assert.match(html, /id="vap-player-frame"/);
  assert.match(html, /id="vap-server-list"/);
  assert.match(html, /id="vap-server-count"/);
  assert.match(html, /id="vap-server-next"/);
  assert.match(html, /data-vap-track="sub"/);
  assert.match(html, /data-vap-track="dub"/);
  assert.doesNotMatch(html, /<video[^>]+src=/i);
  assert.match(css, /\.vap-server-list/);
  assert.match(css, /\.vap-player-stage iframe/);
});

test("Premium access is verified through the existing Firebase account before a provider iframe opens", () => {
  assert.match(script, /import\("\.\/firebase\.js"\)/);
  assert.doesNotMatch(script, /^import \{ auth \}/m);
  assert.match(script, /onAuthStateChanged\(auth/);
  assert.match(script, /currentUser\.getIdToken\(\)/);
  assert.match(script, /fetch\("\/api\/anime-premium\/playback"/);
  assert.match(script, /response\.status === 403/);
  assert.match(script, /activateProvider\(first\.id\)/);
  assert.doesNotMatch(script, /initializeApp\s*\(|getAuth\s*\(/);
});

test("watch metadata and identity lookups have bounded loading times", () => {
  assert.match(script, /withTimeout\(getDetails\(titleId\), 15000/);
  assert.match(script, /withTimeout\(tmdbApi\.tvSeason/);
  assert.match(script, /withTimeout\(resolveAnimeIds\(titleName\(titleDetails\)\), 10000/);
});

test("watch page waits for optional auth restoration without blocking episode metadata", () => {
  assert.match(script, /async function bindAuth\(\)/);
  assert.match(script, /authReady = bindAuth\(\)/);
  assert.match(script, /await authReady/);
  assert.match(script, /returnTo=anime-premium-watch\.html/);
});

test("Premium watch resolves AniList and MAL identifiers independently and supports season-specific lookups", () => {
  assert.match(script, /resolveAnimeIds\(titleName\(titleDetails\)\)/);
  assert.match(script, /resolveAnimeIds\(titleName\(titleDetails\) \+ " " \+ seasonLabel\)/);
  assert.match(script, /seasonAnimeIds/);
  assert.match(script, /episodeNumber \+ offset/);
});

test("Provider fallback switches embeds without requesting arbitrary stream URLs", () => {
  assert.match(script, /function fallbackToNextPlaybackServer/);
  assert.match(script, /failedProviderIds\.add\(activeProviderId\)/);
  assert.match(script, /failedProviderIds\.has\(provider\.id\) \? "Failed · retry"/);
  assert.match(script, /failedProviderIds\.delete\(provider\.id\)/);
  assert.match(script, /providerOptions\.find\(item => item\.available && !failedProviderIds\.has\(item\.id\)\)/);
  assert.match(script, /frame\.src = provider\.url/);
  assert.match(script, /event\.origin !== expectedOrigin/);
  assert.match(script, /event\.source !== frame\.contentWindow/);
  assert.doesNotMatch(script, /ANIME_PREMIUM_STREAM_RESOLVER|excludeCandidateIds|HLS_LIBRARY_URL/);
});

test("Progress messages are origin-checked and saved through the Premium progress endpoint", () => {
  assert.match(script, /anilink-player:/);
  assert.match(script, /aniembed:play/);
  assert.match(script, /provider\.id === "vidrift"/);
  assert.match(script, /message\.type === "watching-log"/);
  assert.match(script, /if \(provider\.events\)/);
  assert.match(script, /\["vidapi", "vidsrc", "vidlink", "vidplus"\]\.includes\(provider\.id\)/);
  assert.match(script, /new URL\(provider\?\.url \|\| ""\)\.origin/);
  assert.match(script, /\["megaplay", "megaplay-legacy", "megavid", "megaflix"\]/);
  assert.match(script, /fetch\("\/api\/anime-premium\/progress"/);
  assert.match(script, /keepalive: snapshot\.keepalive/);
  assert.match(script, /Progress endpoint returned HTTP/);
});

test("Playback sessions expire and account changes stop embedded playback", () => {
  assert.match(script, /const expiresAt = Date\.parse\(playback\.expiresAt\)/);
  assert.match(script, /Playback session expired/);
  assert.match(script, /currentUser\?\.uid && currentUser\.uid !== nextUser\?\.uid/);
  assert.match(script, /frame\.src = "about:blank"/);
  assert.match(script, /window\.addEventListener\("pagehide"/);
});

test("Watch page assets are cached and syntax-checked", () => {
  assert.match(sw, /vivid-cinema-shell-v362/);
  assert.match(sw, /anime-premium-watch\.html/);
  assert.match(sw, /anime-premium-providers\.js/);
  assert.match(syntax, /scripts\/anime-premium-watch\.js/);
  assert.match(syntax, /scripts\/playback\/anime-premium-providers\.js/);
});
