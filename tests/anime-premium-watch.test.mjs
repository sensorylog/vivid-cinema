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

test("Premium watch route provides a native protected player and episode browser", () => {
  assert.match(html, /data-vivid-page="anime-premium-watch"/);
  assert.match(html, /<video id="vap-player" controls playsinline/);
  assert.match(html, /id="vap-player-gate"/);
  assert.match(html, /id="vap-season-picker"/);
  assert.match(html, /id="vap-episode-grid"/);
  assert.match(html, /id="vap-next-episode"/);
  assert.match(html, /scripts\/anime-premium-watch\.js/);
});

test("playback requests use the existing Vivid Firebase user token and server endpoint", () => {
  assert.match(script, /import \{ auth \} from "\.\/firebase\.js"/);
  assert.match(script, /onAuthStateChanged\(auth/);
  assert.match(script, /currentUser\.getIdToken\(\)/);
  assert.match(script, /fetch\("\/api\/anime-premium\/playback"/);
  assert.match(script, /Authorization": "Bearer " \+ token/);
  assert.doesNotMatch(script, /initializeApp\s*\(|getAuth\s*\(/);
});

test("player accepts only unexpired HTTPS playback sessions returned by the server", () => {
  assert.match(script, /new URL\(playback\.url/);
  assert.match(script, /streamUrl\.protocol !== "https:"/);
  assert.match(script, /Date\.parse\(playback\.expiresAt\) <= Date\.now\(\)/);
  assert.match(script, /application\/vnd\.apple\.mpegurl/);
  assert.match(script, /video\/mp4/);
  assert.doesNotMatch(script, /vidsrc|vidlink|vidplus|vidking|embedapi|moviesapi/i);
});

test("watch page fails closed for missing sessions, missing membership and unavailable playback", () => {
  assert.match(script, /response\.status === 401/);
  assert.match(script, /response\.status === 403/);
  assert.match(script, /response\.status === 404 \|\| response\.status === 503/);
  assert.match(script, /No unverified third-party source will be substituted/);
  assert.doesNotMatch(html, /<video[^>]+src=/i);
});

test("watch route assets are cached offline and included in syntax checks", () => {
  assert.match(sw, /vivid-cinema-shell-v331/);
  assert.match(sw, /anime-premium-watch\.html/);
  assert.match(sw, /vivid-anime-premium-watch\.css/);
  assert.match(sw, /anime-premium-watch\.js/);
  assert.match(syntax, /scripts\/anime-premium-watch\.js/);
  assert.match(css, /vap-player-stage/);
});
