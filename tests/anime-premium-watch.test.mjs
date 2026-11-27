import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, script, sw, syntax, css, playbackApi] = await Promise.all([
  read("../anime-premium-watch.html"),
  read("../scripts/anime-premium-watch.js"),
  read("../service-worker.js"),
  read("../automation/check-syntax.mjs"),
  read("../styles/vivid-anime-premium-watch.css"),
  read("../cloudflare/functions/api/anime-premium/playback.js")
]);

test("Premium watch page has a responsive embedded player and multi-server selector", () => {
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /Premium access required/);
  assert.match(html, /id="vap-player-frame"/);
  assert.match(html, /id="vap-server-list"/);
  assert.match(html, /id="vap-server-count"/);
  assert.match(html, /id="vap-server-next"/);
  assert.match(html, /VIVID PREMIUM PLAYER/);
  assert.match(html, /MEMBERSHIP VERIFIED BEFORE PLAYBACK/);
  assert.match(html, /data-vap-track="sub"/);
  assert.match(html, /data-vap-track="dub"/);
  assert.doesNotMatch(html, /<video[^>]+src=/i);
  assert.match(css, /\.vap-server-list/);
  assert.match(css, /\.vap-player-stage iframe/);
});

test("Premium access is verified through the existing Firebase account before a provider iframe opens", () => {
  assert.match(script, /import \{ auth \} from "\.\/firebase\.js"/);
  assert.match(script, /onAuthStateChanged\(auth/);
  assert.match(script, /isAnimeMetadata\(titleDetails\)/);
  assert.match(script, /Verify your Vivid email/);
  assert.match(playbackApi, /isAnimeMetadata\(metadata\)/);
  assert.match(playbackApi, /anime-title-not-eligible/);
  assert.match(script, /currentUser\.getIdToken\(true\)/);
  assert.match(script, /fetch\("\/api\/anime-premium\/playback"/);
  assert.match(script, /response\.status === 403/);
  assert.match(script, /activateProvider\(first\.id\)/);
  assert.match(script, /label: "Server " \+ \(index \+ 1\)/);
  assert.match(script, /server option/);
  assert.doesNotMatch(script, /provider\.note/);
  assert.doesNotMatch(script, /ID matched/);
  assert.doesNotMatch(script, /initializeApp\s*\(|getAuth\s*\(/);
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
  assert.match(script, /page opened\. Playback is not confirmed yet/);
  assert.doesNotMatch(script, /player loaded\. If the episode does not start/);
  assert.match(script, /event\.origin !== expectedOrigin/);
  assert.match(script, /event\.source !== frame\.contentWindow/);
  assert.doesNotMatch(script, /ANIME_PREMIUM_STREAM_RESOLVER|excludeCandidateIds|HLS_LIBRARY_URL/);
});

test("A slow provider is not automatically marked failed before a real playback error", () => {
  const timer = script.slice(script.indexOf("providerLoadTimer = window.setTimeout"), script.indexOf("return true;", script.indexOf("providerLoadTimer = window.setTimeout")));
  assert.match(timer, /has not confirmed playback/);
  assert.doesNotMatch(timer, /fallbackToNextPlaybackServer/);
  assert.match(script, /frame\.onerror = \(\) =>/);
  assert.match(script, /reported a playback error/);
});

test("Progress messages are origin-checked and saved through the Premium progress endpoint", () => {
  assert.match(script, /anilink-player:/);
  assert.match(script, /aniembed:play/);
  assert.match(script, /provider\.id === "vidrift"/);
  assert.match(script, /message\.type === "watching-log"/);
  assert.doesNotMatch(script, /if \(provider\.events\)/);
  assert.match(script, /has not confirmed playback\. The player may still be loading/);
  assert.match(script, /is ready\. Press play in the player/);
  assert.match(script, /const confirmedPlaying =/);
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
  assert.match(sw, /vivid-cinema-shell-v\d+/);
  assert.match(sw, /anime-premium-watch\.html/);
  assert.match(sw, /anime-premium-providers\.js/);
  assert.match(syntax, /scripts\/anime-premium-watch\.js/);
  assert.match(syntax, /scripts\/playback\/anime-premium-providers\.js/);
});


test("profile changes leave premium anime playback before loading another profile", () => {
  assert.match(script, /vivid:profile-changed/);
  assert.match(script, /window\.location\.replace\("home\.html"\)/);
});
