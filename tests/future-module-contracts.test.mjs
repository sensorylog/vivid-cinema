import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMedia, normalizeResults, getMediaUrl } from "../scripts/media.js";
import { buildTitleUrl, VIVID_ROUTES } from "../scripts/routes.js";
import { readFileSync } from "node:fs";

const contract = readFileSync(new URL("../docs/architecture/vivid-future-modules-phase4.md", import.meta.url), "utf8");

test("movie and TV identities remain typed and cannot collide", () => {
  const movie = normalizeMedia({ id: 42, title: "Movie", release_date: "2024-01-01" });
  const tv = normalizeMedia({ id: 42, name: "Series", first_air_date: "2024-01-01", media_type: "tv" });

  assert.equal(movie.media_type, "movie");
  assert.equal(movie.content_id, "movie:42");
  assert.equal(tv.media_type, "tv");
  assert.equal(tv.content_id, "tv:42");
  assert.notEqual(movie.content_id, tv.content_id);
});

test("future modules reuse canonical normalized results and title URLs", () => {
  const [movie] = normalizeResults([{ id: 10, title: "Movie", release_date: "2020-01-01" }], "movie");
  const [tv] = normalizeResults([{ id: 10, name: "Series", first_air_date: "2020-01-01" }], "tv");

  assert.equal(movie.content_id, "movie:10");
  assert.equal(tv.content_id, "tv:10");
  assert.equal(getMediaUrl(movie), "title.html?id=10&type=movie");
  assert.equal(getMediaUrl(tv), "title.html?id=10&type=tv");
  assert.equal(buildTitleUrl(10, "movie"), "title.html?id=10&type=movie");
  assert.equal(buildTitleUrl(10, "tv"), "title.html?id=10&type=tv");
});

test("Phase 4 prepares contracts without adding placeholder product routes", () => {
  assert.ok(contract.includes("Vivid Universe"));
  assert.ok(contract.includes("Vivid Night"));
  assert.ok(contract.includes("device-local"));
  assert.ok(contract.includes("relationship provenance"));
  assert.ok(!Object.hasOwn(VIVID_ROUTES, "universe"));
  assert.ok(!Object.hasOwn(VIVID_ROUTES, "night"));
});

test("future-module contracts explicitly reuse existing Memory and Intelligence stores", () => {
  for (const required of [
    "getLocalLibrary()",
    "getFeedback()",
    "setFeedback()",
    "recordBehavior()",
    "getTasteProfile()",
    "getRecommendationMemory()",
    "getContinueWatching()",
    "No Cloud Functions"
  ]) {
    assert.ok(contract.includes(required), "contract should document " + required);
  }
});

test("Watch Rooms is added to the shared top tools without changing the seven mobile destinations", () => {
  const appShell = readFileSync(new URL("../scripts/app-shell.js", import.meta.url), "utf8");
  assert.ok(appShell.includes('watchRooms.className = "vivid-watch-rooms-nav"'));
  assert.ok(appShell.includes('watchRooms.href = "watch-rooms.html"'));
  const mobileStart = appShell.indexOf("function syncMobileNavigation()");
  const mobileEnd = appShell.indexOf("function syncNavigation()", mobileStart);
  const mobileBuilder = appShell.slice(mobileStart, mobileEnd);
  assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, "shared mobile navigation builder should exist");
  assert.ok(mobileBuilder, "shared mobile navigation builder should exist");
  assert.equal((mobileBuilder.match(/navLink\(/g) || []).length, 7);
  assert.doesNotMatch(mobileBuilder, /watch-rooms/);
});

test("Watch Rooms private content waits for a non-anonymous Firebase user", () => {
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  const moduleSource = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(page.includes('id="watch-rooms-private"'));
  assert.ok(page.includes('id="watch-rooms-loading"'));
  assert.ok(moduleSource.includes("auth.authStateReady()"));
  assert.ok(moduleSource.includes("user.isAnonymous"));
  assert.ok(moduleSource.includes("auth.html?returnTo="));
  assert.ok(moduleSource.includes("onAuthStateChanged(auth"));
  const authSource = readFileSync(new URL("../scripts/auth.js", import.meta.url), "utf8");
  assert.ok(authSource.includes("preservePostAuthDestination"));
});


test("Watch Rooms dashboard exposes room creation, invitation entry and club management UI", () => {
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  const moduleSource = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/vivid-watch-rooms.css", import.meta.url), "utf8");
  for (const required of [
    'data-open-dialog="create-room"',
    'data-open-dialog="join-room"',
    'data-open-dialog="create-club"',
    'id="wr-create-room-dialog"',
    'id="wr-join-room-dialog"',
    'id="wr-create-club-dialog"',
    'id="wr-panel-rooms"',
    'id="wr-panel-clubs"',
    'id="wr-room-count"',
    'id="wr-club-detail"'
  ]) assert.ok(page.includes(required), "missing Watch Rooms UI contract: " + required);
  for (const required of [
    'addEventListener("submit"',
    "renderRoomPreviews()",
    "renderClubPreviews()",
    "renderClubDetail(selected)",
    "user.isAnonymous",
    "auth.authStateReady()",
    "Invitation lookup and membership checks will be connected in Stage 3",
    "Your club is not saved or shared"
  ]) assert.ok(moduleSource.includes(required), "missing Watch Rooms interaction contract: " + required);
  assert.ok(styles.includes(".vivid-wr-dialog::backdrop"));
  assert.ok(styles.includes("@media(max-width:760px)"));
});

test("Watch Rooms preview actions never claim backend persistence or membership", () => {
  const moduleSource = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(moduleSource.includes("LOCAL PREVIEW · NOT SAVED"));
  assert.ok(moduleSource.includes("No room has been joined."));
  assert.ok(moduleSource.includes("Your club is not saved or shared."));
  assert.ok(!moduleSource.includes("addDoc("));
  assert.ok(!moduleSource.includes("setDoc("));
});
