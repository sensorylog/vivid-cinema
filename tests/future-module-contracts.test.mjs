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
    "createWatchRoom",
    "createCinemaClub",
    "redeemWatchInvitation",
    "loadDashboard(user)"
  ]) assert.ok(moduleSource.includes(required), "missing Watch Rooms interaction contract: " + required);
  assert.ok(styles.includes(".vivid-wr-dialog::backdrop"));
  assert.ok(styles.includes("@media(max-width:760px)"));
});

test("Watch Rooms dashboard uses trusted backend calls rather than local-only previews", () => {
  const moduleSource = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(moduleSource.includes("httpsCallable(functions, name)"));
  assert.ok(moduleSource.includes('collection(db, "users", user.uid, "watchRooms")'));
  assert.ok(moduleSource.includes('collection(db, "users", user.uid, "cinemaClubs")'));
  assert.ok(moduleSource.includes("createWatchInvitation"));
  assert.ok(moduleSource.includes("redeemWatchInvitation"));
  assert.ok(!moduleSource.includes("LOCAL PREVIEW · NOT SAVED"));
});


test("Watch Rooms backend exposes trusted lifecycle operations and hashed invitations", () => {
  const functions = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const callable of [
    "createWatchRoom", "createCinemaClub", "createWatchInvitation",
    "redeemWatchInvitation", "revokeWatchInvitation"
  ]) assert.ok(functions.includes("export const " + callable + " = onCall"), "missing trusted callable: " + callable);
  for (const contract of [
    "randomBytes(10)", "createHash(\"sha256\")", "expiresAt",
    "useCount", "revokedAt", "MAX_ROOM_MEMBERS", "MAX_CLUB_MEMBERS",
    "sign_in_provider === \"anonymous\""
  ]) assert.ok(functions.includes(contract), "missing backend security contract: " + contract);
  for (const contract of [
    "function isRoomMember(roomId)", "function isClubMember(clubId)",
    "match /rooms/{roomId}", "match /cinemaClubs/{clubId}",
    "match /watchInvitations/{tokenHash}", "allow create, update, delete: if false"
  ]) assert.ok(rules.includes(contract), "missing Firestore authorization contract: " + contract);
});


test("Watch Rooms Stage 4 exposes trusted lobby, queue, chat, reactions and host controls", () => {
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const name of ["heartbeatWatchRoom","addWatchRoomQueueItem","voteWatchRoomQueueItem","sendWatchRoomMessage","reactToWatchRoomMessage","updateWatchRoomSettings","removeWatchRoomMember","closeWatchRoom"]) {
    assert.ok(index.includes(name), "missing exported callable " + name);
    assert.ok(lobby.includes("export const " + name + " = onCall"), "missing trusted callable implementation " + name);
  }
  for (const id of ["wr-room-lobby","wr-lobby-presence","wr-lobby-queue","wr-lobby-chat","wr-host-controls","wr-close-room","wr-queue-form","wr-chat-form"]) assert.ok(page.includes('id="' + id + '"'));
  for (const callable of ["heartbeatWatchRoom","addWatchRoomQueueItem","voteWatchRoomQueueItem","sendWatchRoomMessage","reactToWatchRoomMessage","updateWatchRoomSettings","closeWatchRoom"]) assert.ok(client.includes('call("' + callable + '")'));
  for (const path of ["presence","queue","chat"]) assert.ok(rules.includes("match /" + path + "/{"), "missing member-readable " + path + " rules");
  assert.ok(lobby.includes("PRESENCE_TTL_MS"));
  assert.ok(lobby.includes("MAX_INSTANCES") || lobby.includes("maxInstances"));
});


test("Watch Rooms Stage 5 exposes a trusted VidSrc-only playback clock and client bridge", () => {
  const functions = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const watch = readFileSync(new URL("../scripts/watch.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch.html", import.meta.url), "utf8");
  assert.ok(functions.includes("publishWatchRoomPlayback"));
  assert.ok(backend.includes("export const publishWatchRoomPlayback = onCall"));
  assert.ok(backend.includes('request.data?.provider !== "vidsrc"'));
  assert.ok(backend.includes("requireHost(roomId, uid)"));
  assert.ok(backend.includes("tx.get(roomRef.collection(\"members\").doc(uid))"));
  assert.ok(rules.includes("match /playback/{stateId}"));
  assert.ok(client.includes('const SUPPORTED_ORIGIN = "https://vidsrc.sh"'));
  assert.ok(client.includes('postMessage({ player: true, action }, SUPPORTED_ORIGIN)'));
  assert.ok(client.includes('onSnapshot(doc(db, "rooms", roomId, "playback", "current")'));
  assert.ok(client.includes("Math.abs(expected - localPosition) > 2.5"));
  assert.ok(watch.includes('event.origin === "https://vidsrc.sh"'));
  assert.ok(watch.includes('new CustomEvent("vivid:provider-playback"'));
  assert.ok(page.includes('src="scripts/watch-room-playback.js"'));
});


test("Watch Room playback invitation form only redeems room invitations", () => {
  const functions = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  assert.ok(functions.includes("request.data?.expectedTargetType"));
  assert.ok(client.includes('expectedTargetType: "room"'));
});


test("Cinema Club Stage 6 provides persistent watchlists, screening history and After-Credits", () => {
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../functions/watch-rooms-clubs.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-clubs.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  for (const callable of ["addCinemaClubWatchlistItem","removeCinemaClubWatchlistItem","recordCinemaClubScreening","addCinemaClubAfterCreditsReview","addCinemaClubDiscussionMessage"]) {
    assert.ok(index.includes(callable), "missing Stage 6 callable export: " + callable);
    assert.ok(backend.includes("export const " + callable + " = onCall"), "missing trusted Stage 6 operation: " + callable);
  }
  assert.ok(backend.includes("requireClubMember(clubId, uid)"));
  assert.ok(backend.includes("tx.get(clubRef.collection(\"members\").doc(uid))"));
  assert.ok(rules.includes("match /watchlist/{itemId}"));
  assert.ok(rules.includes("match /screenings/{screeningId}"));
  assert.ok(rules.includes("match /afterCredits/{userId}"));
  assert.ok(rules.includes("match /discussion/{messageId}"));
  assert.ok(client.includes("vivid:cinema-club-selected"));
  assert.ok(client.includes("addCinemaClubAfterCreditsReview"));
  assert.ok(client.includes("addCinemaClubDiscussionMessage"));
  assert.ok(page.includes('src="scripts/watch-room-clubs.js"'));
});
