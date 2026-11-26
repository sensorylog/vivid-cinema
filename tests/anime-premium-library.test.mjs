import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [html, titleHtml, script, module, watch, title, library, recommendations, rules, shell, syntax] = await Promise.all([
  read("../anime-premium-library.html"),
  read("../anime-premium-title.html"),
  read("../scripts/anime-premium-library.js"),
  read("../scripts/anime-library.js"),
  read("../scripts/anime-premium-watch.js"),
  read("../scripts/anime-premium-title.js"),
  read("../scripts/library.js"),
  read("../scripts/recommendations.js"),
  read("../firestore.rules"),
  read("../service-worker.js"),
  read("../automation/check-syntax.mjs")
]);

test("private Premium Anime Library is no-index and has membership-gated sections", () => {
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /scripts\/google-tag\.js/);
  for (const id of ["vap-library-gate", "vap-library-content", "vap-library-continue", "vap-library-watchlist", "vap-library-completed", "vap-library-history", "vap-library-episodes", "vap-pref-track", "vap-pref-autoplay"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(script, /fetch\("\/api\/anime-premium\/membership"/);
  assert.match(script, /payload\?\.membership\?\.active === true/);
  assert.match(script, /reason === "verify"/);
  for (const provider of ["vidplus", "vidlink", "vidsrc", "anixo", "anilink", "megaplay", "megaplay-legacy", "megavid", "megaflix", "vidapi", "embedwave", "vidfast", "embedapistream", "vidrift"]) assert.ok(html.includes('value="' + provider + '"'));
  assert.match(script, /auth\.html\?returnTo=anime-premium-library\.html/);
  assert.match(script, /anime-premium-membership\.html/);
});

test("private library shows a sync state and bounds cloud data loading", () => {
  assert.match(script, /Syncing your private anime library/);
  assert.match(script, /withTimeout\(syncLibraryForUser\(user\), 10000/);
  assert.match(script, /withTimeout\(syncPlaybackProgressForUser\(user\), 10000/);
  assert.match(script, /withTimeout\(syncAnimePreferencesForUser\(user\), 10000/);
});

test("private library route includes the shared app shell and recovers from auth loading failures", () => {
  assert.match(html, /scripts\/app-shell\.js/);
  assert.match(html, /scripts\/anime-premium\.js/);
  assert.match(script, /async function initAuth\(\)/);
  assert.match(script, /import\("\.\/firebase\.js"\)/);
  assert.match(script, /AbortSignal\.timeout\(10000\)/);
});

test("Anime library reuses Vivid's canonical shared library and playback progress stores", () => {
  assert.match(module, /getLocalLibrary/);
  assert.match(module, /getAllPlaybackProgress/);
  assert.match(module, /upsertLibraryItem\("watchLater"/);
  assert.match(module, /upsertLibraryItem\("completed"/);
  assert.match(library, /const COLLECTIONS=\["favorites","watchLater","history","completed"\]/);
  assert.match(recommendations, /export function getAllPlaybackProgress\(\)/);
});

test("Premium watch saves episode progress and playback history without inventing progress", () => {
  assert.match(watch, /savePlaybackProgress\(contentId, progressData\)/);
  assert.match(watch, /completePlaybackProgress\(contentId, progressData\)/);
  assert.match(watch, /flushAllPlaybackProgress\(\)/);
  assert.match(recommendations, /export async function flushAllPlaybackProgress\(\)/);
  assert.match(watch, /recordAnimeHistory\(currentTime, total\)/);
  assert.match(watch, /isAnime: true/);
  assert.match(watch, /getAnimeLibraryPreferences\(\)\.autoplayNextEpisode/);
  assert.match(watch, /preferredPlayer/);
});

test("Premium title page supports Watch Later and explicit completed-title state", () => {
  assert.match(title, /isAnime: true/);
  assert.match(title, /markAnimeCompleted/);
  assert.match(title, /unmarkAnimeCompleted/);
  assert.match(title, /addAnimeFavorite/);
  assert.match(title, /removeAnimeFavorite/);
  assert.match(titleHtml, /vap-title-star/);
  assert.match(titleHtml, /vap-title-completed/);
});

test("Anime preferences sync to the authenticated Vivid account and are owner-protected", () => {
  assert.match(module, /syncAnimePreferencesForUser/);
  assert.match(module, /import\("\.\/firebase\.js"\)/);
  assert.match(module, /await authPromise/);
  assert.doesNotMatch(module, /^import \{ auth \}/m);
  assert.match(module, /getDocFromServer/);
  assert.match(module, /setDoc\(reference, local/);
  assert.match(rules, /match \/animePreferences\/\{preferenceId\}/);
  assert.match(rules, /preferenceId == "default" && validAnimePreferences\(\)/);
  assert.match(rules, /function validAnimePreferences\(\)/);
});

test("Firestore rules support season-scoped progress IDs and private completed anime records", () => {
  assert.match(rules, /function validProgressId\(contentId\)/);
  assert.match(rules, /tv:\[0-9\]\+:\[0-9\]\+:\[0-9\]\+/);
  assert.match(rules, /match \/completed\/\{contentId\}/);
  assert.match(rules, /request\.resource\.data\.isAnime is bool/);
});

test("Premium Anime Library assets are precached and syntax checked", () => {
  assert.match(shell, /anime-premium-library\.html/);
  assert.match(shell, /scripts\/anime-premium-library\.js/);
  assert.match(shell, /scripts\/anime-library\.js/);
  assert.match(shell, /styles\/vivid-anime-premium-library\.css/);
  assert.match(syntax, /scripts\/anime-premium-library\.js/);
  assert.match(syntax, /scripts\/anime-library\.js/);
});
