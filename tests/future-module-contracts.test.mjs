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

test("Watch Rooms dashboard uses the authenticated server API rather than client Firestore reads", () => {
  const moduleSource = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(moduleSource.includes("callWatchRoomApi"));
  assert.ok(moduleSource.includes('call("getWatchRoomDashboard")'));
  assert.ok(moduleSource.includes('void call("cleanupExpiredWatchRooms")({})'), "retention must run asynchronously after dashboard loading");
  assert.ok(moduleSource.indexOf('call("getWatchRoomDashboard")') < moduleSource.indexOf('call("cleanupExpiredWatchRooms")'), "dashboard read must precede background cleanup");
  assert.ok(moduleSource.includes("dashboardState.rooms"));
  assert.ok(moduleSource.includes("dashboardState.clubs"));
  assert.ok(!moduleSource.includes('collection(db, "users"'));
  assert.ok(moduleSource.includes("createWatchInvitation"));
  assert.ok(moduleSource.includes("redeemWatchInvitation"));
  assert.ok(!moduleSource.includes("LOCAL PREVIEW · NOT SAVED"));
});


test("Watch Rooms backend exposes trusted lifecycle operations and hashed invitations", () => {
  const functions = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const callable of [
    "createWatchRoom", "createCinemaClub", "createWatchInvitation",
    "redeemWatchInvitation", "revokeWatchInvitation"
  ]) assert.ok(functions.includes("async function " + callable + "("), "missing trusted callable: " + callable);
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
  const index = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const name of ["heartbeatWatchRoom","addWatchRoomQueueItem","voteWatchRoomQueueItem","sendWatchRoomMessage","reactToWatchRoomMessage","updateWatchRoomSettings","removeWatchRoomMember","closeWatchRoom"]) {
    assert.ok(index.includes(name), "missing exported callable " + name);
    assert.ok(lobby.includes("async function " + name + "("), "missing trusted callable implementation " + name);
  }
  for (const id of ["wr-room-lobby","wr-lobby-presence","wr-lobby-queue","wr-lobby-chat","wr-host-controls","wr-close-room","wr-queue-form","wr-chat-form"]) assert.ok(page.includes('id="' + id + '"'));
  for (const callable of ["heartbeatWatchRoom","addWatchRoomQueueItem","voteWatchRoomQueueItem","sendWatchRoomMessage","reactToWatchRoomMessage","updateWatchRoomSettings","closeWatchRoom"]) assert.ok(client.includes('call("' + callable + '")'));
  for (const path of ["presence","queue","chat"]) assert.ok(rules.includes("match /" + path + "/{"), "missing member-readable " + path + " rules");
  assert.ok(lobby.includes("PRESENCE_TTL_MS"));
  assert.ok(lobby.includes("MAX_INSTANCES") || lobby.includes("getAppCheck(firebaseApp).verifyToken"));
});


test("Watch Rooms Stage 5 exposes trusted VidSrc and CineSRC playback bridges", () => {
  const functions = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflareBackend = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const watch = readFileSync(new URL("../scripts/watch.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch.html", import.meta.url), "utf8");
  assert.ok(functions.includes("publishWatchRoomPlayback"));
  assert.ok(backend.includes("async function publishWatchRoomPlayback("));
  assert.ok(backend.includes('["vidsrc", "cinesrc"].includes(provider)'));
  assert.ok(cloudflareBackend.includes('["vidsrc", "cinesrc"].includes(provider)'));
  assert.ok(backend.includes("tx.set(stateRef, { sessionId, provider, contentId"));
  assert.ok(cloudflareBackend.includes("tx.set(stateRef, {"));
  assert.ok(cloudflareBackend.includes("schemaVersion: 1, sessionId, provider, contentId,"));
  assert.ok(cloudflareBackend.includes("expectedRevision !== currentRevision"));
  assert.ok(cloudflareBackend.includes('reason: "stale-revision"'));
  assert.ok(backend.includes('memberData.role === "guest" && roomData.allowGuestPlaybackControl === true'));
  assert.ok(backend.includes("tx.get(roomRef.collection(\"members\").doc(uid))"));
  assert.ok(rules.includes("match /playback/{stateId}"));
  assert.ok(client.includes("getProviderAdapter(activePlayerId, activeProviderId)"));
  assert.ok(client.includes("sendAdapterCommand({ adapter, frame, action, position })"));
  assert.ok(client.includes('getProviderAdapter("player1", "vidsrc")'));
  assert.ok(client.includes('getProviderAdapter("player2", "cinesrc")'));
  assert.ok(client.includes('data.type.startsWith("cinesrc:")'));
  assert.ok(client.includes('event.source !== frame.contentWindow'));
  assert.ok(client.includes('window.addEventListener("vivid:player-adapter-selected"'));
  assert.ok(client.includes('document.getElementById(activePlayerId === "player2" ? "vivid-tflix-frame" : "vidapi-player")'));
  assert.ok(client.includes('call("getWatchRoomPlaybackSnapshot")'));
  assert.ok(client.includes("getExpectedPlaybackPosition(state, { nowMs: Date.now(), clockOffsetMs })"));
  assert.ok(client.includes("shouldCorrectPlayback(expected, localPosition)"));
  assert.ok(client.includes("onSnapshot("));
  assert.ok(client.includes('doc(db, "rooms", requestedRoomId, "playback", "current")'));
  assert.ok(watch.includes('event.origin === "https://vidsrc.sh"'));
  assert.ok(watch.includes('new CustomEvent("vivid:provider-playback"'));
  assert.ok(page.includes('src="scripts/watch-room-playback.js"'));
});


test("Watch Room playback invitation form only redeems room invitations", () => {
  const functions = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  assert.ok(functions.includes("request.data?.expectedTargetType"));
  assert.ok(client.includes('expectedTargetType: "room"'));
});


test("Cinema Club Stage 6 provides persistent watchlists, screening history and After-Credits", () => {
  const index = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-clubs.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  for (const callable of ["addCinemaClubWatchlistItem","removeCinemaClubWatchlistItem","recordCinemaClubScreening","addCinemaClubAfterCreditsReview","addCinemaClubDiscussionMessage"]) {
    assert.ok(index.includes(callable), "missing Stage 6 callable export: " + callable);
    assert.ok(backend.includes("async function " + callable + "("), "missing trusted Stage 6 operation: " + callable);
  }
  assert.ok(backend.includes("requireClubMember(clubId, uid)"));
  assert.ok(backend.includes("tx.get(clubRef.collection(\"members\").doc(uid))"));
  assert.ok(rules.includes("match /cinemaClubs/{clubId}/watchlist/{itemId}"));
  assert.ok(rules.includes("match /cinemaClubs/{clubId}/screenings/{screeningId}"));
  assert.ok(rules.includes("match /afterCredits/{userId}"));
  assert.ok(rules.includes("match /discussion/{messageId}"));
  assert.ok(client.includes("vivid:cinema-club-selected"));
  assert.ok(client.includes("addCinemaClubAfterCreditsReview"));
  assert.ok(client.includes("addCinemaClubDiscussionMessage"));
  assert.ok(page.includes('src="scripts/watch-room-clubs.js"'));
});


test("Cinema Club writes re-check active club status inside their transactions", () => {
  const backend = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  for (const operation of ["removeCinemaClubWatchlistItem","addCinemaClubAfterCreditsReview","addCinemaClubDiscussionMessage"]) {
    const start = backend.indexOf("async function " + operation);
    const end = backend.indexOf("\n}", start);
    const body = backend.slice(start, end);
    assert.ok(body.includes("tx.get(clubRef)"), operation + " must re-read the club in its transaction");
    assert.ok(body.includes('club.data().status !== "active"'), operation + " must reject archived clubs");
  }
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.ok(rules.includes("function isVividUser()"));
  assert.ok(rules.includes("request.auth.token.firebase.sign_in_provider != 'anonymous'"));
});


test("Cinema Club capacity limits use transactional counters to prevent concurrent overfill", () => {
  const backend = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const add = backend.slice(backend.indexOf("async function addCinemaClubWatchlistItem"), backend.indexOf("async function removeCinemaClubWatchlistItem"));
  const remove = backend.slice(backend.indexOf("async function removeCinemaClubWatchlistItem"), backend.indexOf("async function recordCinemaClubScreening"));
  const discussion = backend.slice(backend.indexOf("async function addCinemaClubDiscussionMessage"));
  assert.ok(add.includes("watchlistCount") && add.includes("tx.update(clubRef"), "watchlist cap must be serialized on the club document");
  assert.ok(remove.includes("watchlistCount") && remove.includes("tx.update(clubRef"), "removing a pick must decrement the shared counter");
  assert.ok(discussion.includes("discussionCount") && discussion.includes("tx.update(screeningRef"), "discussion cap must be serialized on the screening document");
  assert.doesNotMatch(discussion, /tx\.get\(screeningRef\.collection\(["']discussion["']\)\)/, "a collection-size query alone is vulnerable to concurrent inserts");
});


test("Watch Room lobby mutations revalidate membership transactionally and serialize queue capacity", () => {
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(lobby.includes("async function requireRoomMemberInTransaction(tx, roomId, uid)"));
  for (const operation of ["heartbeatWatchRoom","addWatchRoomQueueItem","voteWatchRoomQueueItem","sendWatchRoomMessage","reactToWatchRoomMessage"]) {
    const start = lobby.indexOf("async function " + operation);
    const end = lobby.indexOf("\n}", start);
    assert.ok(lobby.slice(start, end).includes("requireRoomMemberInTransaction(tx, roomId, uid)"), operation + " must re-check membership and room lifecycle inside its transaction");
  }
  assert.ok(lobby.includes("queueCount >= QUEUE_LIMIT"));
  assert.ok(lobby.includes("tx.update(roomRef, { queueCount: queueCount + 1"));
  assert.ok(lifecycle.includes("memberCount: 1, queueCount: 0"));
});


test("Cinema Club discussion displays the latest bounded page in chronological order", () => {
  const client = readFileSync(new URL("../scripts/watch-room-clubs.js", import.meta.url), "utf8");
  assert.ok(client.includes('orderBy("createdAt", "desc"), limit(100)'), "load the newest discussion messages rather than the oldest page");
  assert.ok(client.includes("[...snapshot.docs].reverse()"), "render the newest page in chronological order");
});


test("Watch Room queue items can be removed by their author or host and release queue capacity", () => {
  const backend = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const remove = backend.slice(backend.indexOf("async function removeWatchRoomQueueItem"), backend.indexOf("async function voteWatchRoomQueueItem"));
  assert.ok(remove.includes("member.role !== \"host\" && item.data().addedBy !== uid"), "only host or author may remove a queue pick");
  assert.ok(remove.includes("queueCount: Math.max(0, Number(room.queueCount || 0) - 1)"), "removal must free a queue slot transactionally");
  assert.ok(index.includes("  removeWatchRoomQueueItem,"), "operation must be routed by the API");
  assert.ok(client.includes('call("removeWatchRoomQueueItem")'), "lobby must expose the remove action");
});

test("Watch Room and invitation expiry are enforced by trusted API operations", () => {
  const api = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(api.includes("invitation.expiresAt.toMillis() <= now.toMillis()"));
  assert.ok(api.includes("target.expiresAt.toMillis() > now.toMillis()"));
  assert.ok(api.includes("expiresAt: closedAt"), "closed rooms should become immediately ineligible for further mutations");
  assert.ok(api.includes("async function cleanupExpiredWatchRooms(request)"));
  assert.ok(api.includes(".limit(1)"), "recursive room deletion is bounded to one room per cleanup pass");
  assert.ok(api.includes("10 * 60 * 1000"), "cleanup is globally throttled");
  const dashboard = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(dashboard.includes('call("cleanupExpiredWatchRooms")({})'));
  assert.doesNotMatch(api, /firebase-functions|onSchedule\(/);
});


test("Watch Room chat has a transactional per-room volume ceiling", () => {
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const send = lobby.slice(lobby.indexOf("async function sendWatchRoomMessage"), lobby.indexOf("async function reactToWatchRoomMessage"));
  assert.ok(lobby.includes("const ROOM_CHAT_LIMIT = 500"));
  assert.ok(send.includes("chatCount >= ROOM_CHAT_LIMIT"));
  assert.ok(send.includes("tx.update(roomRef, { chatCount: chatCount + 1"));
  assert.ok(lifecycle.includes("chatCount: 0"));
});


test("Watch Room guests can leave transactionally while hosts must close the room", () => {
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  const leave = lobby.slice(lobby.indexOf("async function leaveWatchRoom"), lobby.indexOf("async function closeWatchRoom"));
  assert.ok(leave.includes("room.hostUid === uid || member.role === \"host\""));
  assert.ok(leave.includes("tx.delete(memberRef)") && leave.includes("tx.delete(pointerRef)"));
  assert.ok(leave.includes("memberCount: nextMemberCount"));
  assert.ok(index.includes("  leaveWatchRoom,"));
  assert.ok(client.includes('call("leaveWatchRoom")'));
  assert.ok(page.includes('id="wr-leave-room"'));
});


test("Watch Rooms dashboard ignores stale account responses after authentication changes", () => {
  const client = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(client.includes("let dashboardLoadGeneration = 0"));
  assert.ok(client.includes("generation !== dashboardLoadGeneration || auth.currentUser?.uid !== user.uid"));
});


test("Watch Room host administration revalidates authority and updates room pointers atomically", () => {
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const settings = lobby.slice(lobby.indexOf("async function updateWatchRoomSettings"), lobby.indexOf("async function removeWatchRoomMember"));
  const close = lobby.slice(lobby.indexOf("async function closeWatchRoom"), lobby.indexOf("async function publishWatchRoomPlayback"));
  assert.ok(settings.includes("requireRoomMemberInTransaction(tx, roomId, uid)"));
  assert.ok(settings.includes('room.hostUid !== uid || member.role !== "host"'));
  assert.ok(settings.includes('tx.get(roomRef.collection("members"))'));
  assert.ok(close.includes("requireRoomMemberInTransaction(tx, roomId, uid)"));
  assert.ok(close.includes("expiresAt: closedAt"));
  assert.ok(close.includes('tx.set(db.collection("users")'));
});


test("Cinema Club members can leave and owners can archive with server-owned membership cleanup", () => {
  const backend = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  const leave = backend.slice(backend.indexOf("async function leaveCinemaClub"), backend.indexOf("async function archiveCinemaClub"));
  const archive = backend.slice(backend.indexOf("async function archiveCinemaClub"));
  assert.ok(leave.includes('member.data().role === "owner" || club.data().ownerUid === uid'));
  assert.ok(leave.includes("tx.delete(memberRef)") && leave.includes("tx.delete(pointerRef)"));
  assert.ok(archive.includes('club.data().ownerUid !== uid || !owner.exists || owner.data().role !== "owner"'));
  assert.ok(archive.includes('status: "archived"'));
  assert.ok(archive.includes('tx.delete(db.collection("users")'));
  assert.ok(index.includes("  leaveCinemaClub,") && index.includes("  archiveCinemaClub"));
  assert.ok(client.includes('call(archive ? "archiveCinemaClub" : "leaveCinemaClub")'));
});


test("Host removal deletes membership, presence and dashboard pointer atomically", () => {
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const remove = lobby.slice(lobby.indexOf("async function removeWatchRoomMember"), lobby.indexOf("async function leaveWatchRoom"));
  assert.ok(remove.includes("tx.delete(targetRef)"));
  assert.ok(remove.includes("tx.delete(roomRef.collection(\"presence\").doc(memberUid))"));
  assert.ok(remove.includes("tx.delete(pointerRef)"));
  assert.doesNotMatch(remove, /\.delete\(\)\.catch\(\(\) => \{\}\)/);
});


test("Only Cinema Club owners see the invite-generation action", () => {
  const client = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(client.includes('if (club.role === "owner") actionsForClub.push(makeInviteButton("club", club.clubId, "Invite members"))'));
});


test("Invite redemption and member departures keep private dashboard counts in sync", () => {
  const index = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const clubs = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const redeem = index.slice(index.indexOf("async function redeemWatchInvitation"), index.indexOf("async function revokeWatchInvitation"));
  assert.ok(redeem.includes('transaction.get(targetRef.collection("members"))'));
  assert.ok(redeem.includes("existingPointerRef"));
  assert.ok(redeem.includes("memberCount: nextMemberCount"));
  for (const operation of ["removeWatchRoomMember","leaveWatchRoom"]) {
    const start = lobby.indexOf("async function " + operation);
    const end = lobby.indexOf("\n}", start);
    assert.ok(lobby.slice(start, end).includes('tx.get(roomRef.collection("members"))'));
    assert.ok(lobby.slice(start, end).includes("memberCount: nextMemberCount"));
  }
  const leave = clubs.slice(clubs.indexOf("async function leaveCinemaClub"), clubs.indexOf("async function archiveCinemaClub"));
  assert.ok(leave.includes('tx.get(clubRef.collection("members"))'));
  assert.ok(leave.includes("memberCount: nextMemberCount"));
});


test("Watch Room lobby tears down and restores realtime listeners across BFCache navigation", () => {
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  assert.ok(client.includes('window.addEventListener("pagehide"'));
  assert.ok(client.includes("if (room) lastRoom = room;"));
  assert.ok(client.includes('window.addEventListener("pageshow"'));
  assert.ok(client.includes("if (!event.persisted || !lastRoom"));
});


test("Watch Room host can manage offline members, not only active presence leases", () => {
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(backend.includes('roomRef.collection("members").get()'), "roster must include durable members even when their presence lease expired");
  assert.ok(client.includes('call("getWatchRoomLobbySnapshot")'));
  assert.ok(client.includes('status.className = isLive ? "is-online" : "is-away"'));
  assert.ok(client.includes('member.displayName || "Vivid member"'));
  assert.ok(client.includes('call("removeWatchRoomMember")'));
});


test("Watch Room backend and Firestore rules fail closed for missing expiry timestamps", () => {
  const lobby = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.ok(lobby.includes("!Number.isFinite(expiresAt) || expiresAt <= Date.now()"));
  assert.ok(lobby.includes("!Number.isFinite(roomData.expiresAt?.toMillis?.())"));
  assert.ok(rules.includes("room.keys().hasAll(['expiresAt'])"));
  assert.ok(rules.includes("room.expiresAt is timestamp"));
});


test("Watch Room synchronization compensates for guest device clock skew", () => {
  const backend = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const sync = readFileSync(new URL("../scripts/playback/watch-room-sync.js", import.meta.url), "utf8");
  const heartbeat = backend.slice(backend.indexOf("async function heartbeatWatchRoom"), backend.indexOf("async function addWatchRoomQueueItem"));
  assert.ok(heartbeat.includes("serverTime: Date.now()"));
  assert.ok(client.includes("clockOffsetMs = serverTime - ((startedAt + finishedAt) / 2)"));
  assert.ok(client.includes("getExpectedPlaybackPosition(state, { nowMs: Date.now(), clockOffsetMs })"));
  assert.ok(sync.includes("Number(nowMs) + Number(clockOffsetMs || 0) - updatedAt"));
  assert.ok(sync.includes("PLAYBACK_DRIFT_TOLERANCE_SECONDS = 1.5"));
});


test("Watch Room playback throttles heartbeats without dropping pause/resume transitions", () => {
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  assert.ok(client.includes('detail.status === "playing" && lastPublishedStatus === "playing"'));
  assert.ok(client.includes("lastPublishedStatus = hostStatus"));
  assert.ok(client.includes('lastPublishedStatus = "paused"'));
});


test("Watch Room creation never displays raw Firebase internal errors", () => {
  const client = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  const errors = client.slice(client.indexOf("function errorText"), client.indexOf("function openDialog"));
  assert.ok(errors.includes("return fallback"));
  assert.doesNotMatch(errors, /return error\?\.message \|\| fallback/);
  const create = client.slice(client.indexOf('byId("wr-create-room-form")'), client.indexOf('byId("wr-join-room-form")'));
  assert.ok(create.includes('console.error("Vivid Watch Room creation failed:", error)'));
  assert.ok(create.includes("We couldn't create your room just now"));
});


test("Watch Rooms API client is included in the offline application shell", () => {
  const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.ok(worker.includes('"./scripts/watch-room-api.js"'));
});


test("Watch Rooms client sends Auth and standard App Check tokens to the trusted Cloudflare verifier", () => {
  const api = readFileSync(new URL("../scripts/watch-room-api.js", import.meta.url), "utf8");
  const route = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const idToken = api.slice(api.indexOf("let idToken;"), api.indexOf("let response;"));
  assert.ok(idToken.includes("user.getIdToken()"));
  assert.ok(idToken.includes('startsWith("auth/")'));
  assert.ok(idToken.includes('"functions/unauthenticated"'));
  assert.ok(idToken.includes('"functions/unavailable"'));
  assert.ok(api.includes('getToken(appCheck, false)'));
  assert.ok(!api.includes('getLimitedUseToken(appCheck)'));
  assert.ok(api.includes('"X-Firebase-AppCheck": appCheckResult.token'));
  assert.ok(route.includes("verifyFirebaseIdToken(match[1], projectId, serviceAccount)"));
  assert.ok(route.includes("verifyAppCheckToken(appCheckToken)"));
  assert.ok(!route.includes("verifyAndConsumeAppCheckToken"));
  assert.ok(!route.includes("firebase-admin/auth") && !route.includes("firebase-admin/app-check"));
  assert.ok(route.includes('throw new HttpsError("failed-precondition"'));
  assert.ok(!idToken.includes("Promise.all"));
});


test("Watch Rooms surfaces the safe failed-precondition cause instead of hiding it", () => {
  const client = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  const errors = client.slice(client.indexOf("function errorText"), client.indexOf("function openDialog"));
  assert.ok(errors.includes('if (code.includes("failed-precondition")) return error?.message'));
  assert.ok(!errors.includes("This space is no longer available for that action."));
});


test("Firebase App Check uses Cloudflare Turnstile through the supported custom-provider flow", () => {
  const firebase = readFileSync(new URL("../scripts/firebase.js", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../scripts/turnstile-app-check.js", import.meta.url), "utf8");
  const endpoint = readFileSync(new URL("../cloudflare/functions/api/app-check.js", import.meta.url), "utf8");
  assert.ok(firebase.includes("initializeAppCheck"));
  assert.ok(firebase.includes("new CustomProvider({ getToken: getTurnstileAppCheckToken })"));
  assert.ok(firebase.includes("./turnstile-app-check.js"));
  assert.ok(provider.includes('action: "vivid_app_check"'));
  assert.ok(endpoint.includes("verifyTurnstileToken("));
  assert.ok(endpoint.includes("createFirebaseAppCheckToken("));
  assert.ok(!firebase.includes("ReCaptchaEnterpriseProvider"));
  assert.ok(!endpoint.includes("recaptchaenterprise.googleapis.com"));
});


test("Watch Room lobby shows real membership and requires a searchable catalogue pick", () => {
  const lobby = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles/vivid-watch-rooms.css", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflare = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(lobby.includes('import { tmdbApi } from "./tmdb.js"'));
  assert.ok(lobby.includes("tmdbApi.searchMulti(value, 1)"), "queue suggestions must search TMDB movies and TV");
  assert.ok(lobby.includes("selectedPick"), "users must select a catalogue result before submitting");
  assert.ok(lobby.includes("contentId: String(selectedPick.id)"), "queue writes must include the selected TMDB ID");
  assert.ok(lobby.includes("memberList.length"), "the room count must represent members, not online heartbeats");
  assert.ok(lobby.includes("member.displayName"), "the roster must show real member display names");
  assert.ok(lobby.includes('call("heartbeatWatchRoom")'), "room presence heartbeat must remain active");
  for (const id of ["wr-lobby-online-count", "wr-queue-search-results", "wr-queue-selection"]) {
    assert.ok(page.includes('id="' + id + '"'), "missing lobby experience element " + id);
  }
  assert.ok(styles.includes(".vivid-wr-queue-item"));
  for (const source of [api, cloudflare]) {
    const queue = source.slice(source.indexOf("async function addWatchRoomQueueItem"), source.indexOf("async function removeWatchRoomQueueItem"));
    assert.ok(queue.includes("posterPath") && queue.includes("releaseDate"), "queue must retain selected title artwork and release year");
    assert.ok(queue.includes("!/^\\d{1,12}$/.test(contentId)"), "queue must validate catalogue IDs");
  }
});

test("Watch Room lobby reads authoritative members, presence, queue and chat through the authenticated API", () => {
  const cloudflare = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const nodeApi = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  for (const backend of [cloudflare, nodeApi]) {
    assert.ok(backend.includes("async function getWatchRoomLobbySnapshot(request)"));
    assert.ok(backend.includes('roomRef.collection("members").get()'));
    assert.ok(backend.includes('roomRef.collection("presence").get()'));
    assert.ok(backend.includes('roomRef.collection("queue").get()'));
    assert.ok(backend.includes('roomRef.collection("chat").orderBy("createdAt", "desc").limit(80).get()'));
    assert.ok(backend.includes("getWatchRoomLobbySnapshot,"));
  }
  assert.ok(client.includes('call("getWatchRoomLobbySnapshot")'));
  assert.ok(client.includes("memberList = Array.isArray(snapshot.members) ? snapshot.members : []"));
  assert.ok(client.includes("memberList.filter(member => member.isOnline).length"));
  assert.ok(client.includes("presenceRefresh = setInterval(refreshLobby, 5000)"));
  assert.ok(client.includes("Couldn't load room members."));
  assert.doesNotMatch(client, /onSnapshot|collection\(db,/);
});


test("Watch Room Step 5 persists host-selected player and server through both trusted APIs", () => {
  const nodeApi = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflareApi = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  for (const backend of [nodeApi, cloudflareApi]) {
    const operation = backend.slice(backend.indexOf("async function setWatchRoomPlayerSelection"), backend.indexOf("async function updateWatchRoomSettings"));
    assert.ok(operation.includes("requireUser(request)"), "selection must require an authenticated account");
    assert.ok(operation.includes("requireRoomMemberInTransaction(tx, roomId, uid)"), "selection must re-check room membership transactionally");
    assert.ok(operation.includes('const isHost = room.hostUid === uid && member.role === "host"'));
    assert.ok(operation.includes('const isPermittedGuest = member.role === "guest" && room.allowGuestPlayerSelection === true'));
    assert.ok(backend.includes('player1: new Set(["vidapi", "vidsrc", "vidlink", "vidplus", "vidking", "embedwave", "vidfast", "ezvidapi", "embedapistream", "moviesapi"])'));
    assert.ok(backend.includes('player2: new Set(["moviesapi", "vidsrc-embed", "cinesrc", "vidfast", "vidlink"])'));
    assert.ok(operation.includes("selectedPlayerId: playerId, selectedProviderId: providerId"));
    assert.ok(backend.includes("  setWatchRoomPlayerSelection,"));
    assert.ok(backend.includes('"setWatchRoomPlayerSelection"'));
    const snapshotStart = backend.indexOf("async function getWatchRoomLobbySnapshot");
    const snapshotEnd = backend.indexOf("async function heartbeatWatchRoom", snapshotStart);
    const snapshot = backend.slice(snapshotStart, snapshotEnd);
    assert.ok(snapshot.includes('selectedPlayerId: room.selectedPlayerId || "player1"'));
    assert.ok(snapshot.includes('selectedProviderId: room.selectedProviderId || "vidapi"'));
  }
});


test("Watch Room Step 5 propagates the host-selected player and server to both player modules", () => {
  const roomClient = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const player1 = readFileSync(new URL("../scripts/watch.js", import.meta.url), "utf8");
  const player2 = readFileSync(new URL("../scripts/playback/tflix-secondary-player.js", import.meta.url), "utf8");
  assert.ok(roomClient.includes('call("setWatchRoomPlayerSelection")'));
  assert.ok(roomClient.includes('call("getWatchRoomLobbySnapshot")'));
  assert.ok(roomClient.includes('window.addEventListener("vivid:player-adapter-ready"'));
  assert.ok(roomClient.includes('new CustomEvent("vivid:watch-room-apply-selection"'));
  assert.ok(roomClient.includes("selectionTimer = window.setInterval"));
  assert.ok(roomClient.includes("clearInterval(selectionTimer)"));
  assert.ok(player1.includes('window.addEventListener("vivid:watch-room-apply-selection"'));
  assert.ok(player1.includes("setPlayerSource(selection.providerId, currentParams, position)"));
  assert.ok(player1.includes('new CustomEvent("vivid:player-adapter-ready"'));
  assert.ok(player2.includes('window.addEventListener("vivid:watch-room-apply-selection"'));
  assert.ok(player2.includes("loadServer(selection.providerId, selection.position)"));
  assert.ok(player2.includes('new CustomEvent("vivid:player-adapter-ready"'));
});


test("Watch Room Step 5 restores Player 2 position only after the verified CineSRC ready event", () => {
  const room = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const player2 = readFileSync(new URL("../scripts/playback/tflix-secondary-player.js", import.meta.url), "utf8");
  assert.ok(room.includes('pendingPlayer2Seek = position'));
  assert.ok(room.includes('type === "cinesrc:ready"'));
  assert.ok(room.includes('sendProviderCommand("seek", position)'));
  assert.ok(player2.includes('loadServer(selection.providerId, selection.position)'));
  assert.ok(player2.includes('return true;'));
  assert.ok(player2.includes('vivid:watch-room-selection-error'));
});

test("Watch Room Step 6 enforces granular guest permissions in both trusted APIs and the lobby", () => {
  const node = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflare = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const lobby = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  for (const backend of [node, cloudflare]) {
    assert.ok(backend.includes('member.role === "guest" && room.allowGuestPlayerSelection === true'));
    assert.ok(backend.includes("allowGuestQueueManagement !== true"));
    assert.ok(backend.includes("allowGuestVoting === false"));
    assert.ok(backend.includes("allowGuestPlayerSelection",), "snapshot/settings expose player-selection permission");
    assert.ok(backend.includes("allowGuestQueueManagement"));
  }
  for (const name of ["allowGuestQueue", "allowGuestChat", "allowGuestVoting", "allowGuestPlayerSelection", "allowGuestQueueManagement", "allowGuestPlaybackControl"]) {
    assert.ok(html.includes('name="' + name + '"'));
    assert.ok(lobby.includes("form.elements." + name));
  }
  assert.ok(lobby.includes("currentSettings.elements.allowGuestPlayerSelection"));
  assert.ok(lobby.includes("currentSettings.elements.allowGuestPlaybackControl"));
  assert.ok(lobby.includes("settings.dataset.dirty = \"true\""));
  assert.ok(lobby.includes("currentSettings.dataset.dirty !== \"true\""));
  assert.ok(lobby.includes("room.allowGuestQueueManagement === true"));
  assert.ok(lobby.includes("room.allowGuestVoting === false"));
  assert.ok(lobby.includes("control.disabled = !queueAllowed"));
  assert.ok(lobby.includes("control.disabled = !chatAllowed"));
});


test("Delegated playback control is opt-in and preserves the host as room owner", () => {
  const node = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflare = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  for (const backend of [node, cloudflare]) {
    assert.ok(backend.includes('memberData.role === "guest" && roomData.allowGuestPlaybackControl === true'));
    assert.ok(backend.includes('hostUid: roomData.hostUid, controllerUid: uid'));
  }
  assert.ok(client.includes('role === "host" && allowGuestPlaybackControl && controllerUid && controllerUid !== currentUid'));
  assert.ok(client.includes('role === "host" || allowGuestPlaybackControl'));
  assert.ok(client.includes('Date.now() < suppressPlaybackPublishUntil'));
  assert.ok(client.includes('controllerUid === currentUid'));
});


test("Watch Room player switching unloads the inactive iframe to prevent hidden audio", () => {
  const player1 = readFileSync(new URL("../scripts/watch.js", import.meta.url), "utf8");
  const player2 = readFileSync(new URL("../scripts/playback/tflix-secondary-player.js", import.meta.url), "utf8");
  assert.ok(player1.includes('if (primaryFrame) primaryFrame.src = "about:blank"'));
  assert.ok(player1.includes('primaryOverlay.hidden = true'));
  assert.ok(player2.includes('if (frame) frame.src = "about:blank"'));
});


test("Watch Room chat permission also blocks guest reactions", () => {
  const node = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflare = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  for (const backend of [node, cloudflare]) {
    const start = backend.indexOf("async function reactToWatchRoomMessage(");
    const end = backend.indexOf("async function ", start + 10);
    const implementation = backend.slice(start, end);
    assert.ok(implementation.includes("room.allowGuestChat === false"));
    assert.ok(implementation.includes("member.role !== \"host\""));
  }
});


test("Watch Room followers resync when the selected provider iframe finishes loading", () => {
  const room = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const player1 = readFileSync(new URL("../scripts/watch.js", import.meta.url), "utf8");
  const player2 = readFileSync(new URL("../scripts/playback/tflix-secondary-player.js", import.meta.url), "utf8");
  assert.ok(room.includes('window.addEventListener("vivid:player-frame-loaded"'));
  assert.ok(room.includes('applyRemoteState(true)'));
  assert.ok(room.includes("localPosition = null;"));
  assert.ok(room.includes('localStatus = "";'));
  assert.ok(player1.includes('playerId: "player1", providerId: activeSource'));
  assert.ok(player2.includes('playerId: "player2", providerId: serverId'));
});


test("Watch Room playback uses member-only realtime snapshots and trusted revision-safe writes", () => {
  const node = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflare = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  for (const backend of [node, cloudflare]) {
    const start = backend.indexOf("async function getWatchRoomPlaybackSnapshot(");
    const end = backend.indexOf("async function heartbeatWatchRoom(", start);
    const operation = backend.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.ok(operation.includes("requireUser(request)"));
    assert.ok(operation.includes("requireRoomMember(roomId, uid)"));
    assert.ok(operation.includes('collection("playback").doc("current")'));
    assert.ok(backend.includes("  getWatchRoomPlaybackSnapshot,"));
    assert.ok(backend.includes('"getWatchRoomPlaybackSnapshot"'));
    const writeStart = backend.indexOf("async function publishWatchRoomPlayback(");
    const writeEnd = backend.indexOf("const MAX_WATCHLIST_ITEMS", writeStart);
    const write = backend.slice(writeStart, writeEnd);
    assert.ok(write.includes("expectedRevision !== currentRevision"));
    assert.ok(write.includes('"stale-revision"'));
    assert.ok(write.includes("tx.get(roomRef.collection(\\"members\\").doc(uid))"));
  }
  assert.ok(client.includes('call("getWatchRoomPlaybackSnapshot")'), "trusted snapshot fetch remains available for revision conflict recovery");
  assert.ok(client.includes("playbackConnectionGeneration"));
  assert.ok(client.includes("onSnapshot("));
  assert.ok(client.includes('doc(db, "rooms", requestedRoomId, "playback", "current")'));
  assert.ok(client.includes("expectedRevision: playbackRevision"));
  assert.ok(client.includes("data.reason !== \\"stale-revision\\""));
  assert.doesNotMatch(client, /schedulePlaybackRefresh\\(|playbackPollDelayMs/);
  assert.match(rules, /match \\/playback\\/\\{stateId\\}[\\s\\S]*allow get, list: if isRoomMember\\(roomId\\);[\\s\\S]*allow create, update, delete: if false;/);
});

test("Watch Room Start Screening is host-authorized and launches the same queued title for members", () => {
  const node = readFileSync(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
  const cloudflare = readFileSync(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const lobby = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  for (const backend of [node, cloudflare]) {
    const start = backend.indexOf("async function startWatchRoomScreening(");
    const end = backend.indexOf("async function removeWatchRoomQueueItem(", start);
    const operation = backend.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.ok(operation.includes('room.hostUid !== uid || member.role !== "host"'));
    assert.ok(operation.includes('itemSnapshot.data().status !== "queued"'));
    assert.ok(operation.includes("activeScreening: screening"));
    assert.ok(operation.includes('status: "screening"'));
    assert.ok(backend.includes("  startWatchRoomScreening,"));
    assert.ok(backend.includes('"startWatchRoomScreening"'));
    assert.ok(backend.includes("activeScreening: room.activeScreening || null"));
  }
  assert.ok(lobby.includes('call("startWatchRoomScreening")'));
  assert.ok(lobby.includes("function buildScreeningUrl(screening)"));
  assert.ok(lobby.includes('url.searchParams.set("roomId", room.roomId)'));
  assert.ok(lobby.includes('join.textContent = "Join screening"'));
});


test("Vivid legal and trust pages accurately describe current product practices", () => {
  const privacy = readFileSync(new URL("../privacy.html", import.meta.url), "utf8");
  const terms = readFileSync(new URL("../terms.html", import.meta.url), "utf8");
  const cookies = readFileSync(new URL("../cookies.html", import.meta.url), "utf8");
  const contact = readFileSync(new URL("../contact.html", import.meta.url), "utf8");
  const about = readFileSync(new URL("../about.html", import.meta.url), "utf8");
  const help = readFileSync(new URL("../help.html", import.meta.url), "utf8");
  const accessibility = readFileSync(new URL("../accessibility.html", import.meta.url), "utf8");
  const pulse = readFileSync(new URL("../scripts/vivid-pulse.js", import.meta.url), "utf8");
  assert.ok(privacy.includes("does not create an anonymous Firebase account"));
  assert.ok(privacy.includes("Watch Room and Cinema Club data"));
  assert.ok(privacy.includes("does not automatically remove every contribution"));
  assert.ok(privacy.includes("Formspree"));
  assert.ok(!privacy.includes("Adcash Autotag"));
  assert.ok(cookies.includes("does not intentionally load the previously evaluated Adcash Autotag"));
  assert.ok(!cookies.includes("Vivid uses Adcash Autotag"));
  assert.ok(terms.includes("Watch Rooms and Cinema Clubs"));
  assert.ok(terms.includes("solo playback"));
  assert.ok(terms.includes("limited, non-exclusive permission"));
  assert.ok(contact.includes("https://formspree.io/f/mwpokaav"));
  assert.ok(contact.includes('name="_gotcha"'));
  assert.ok(contact.includes("Watch Rooms or Cinema Clubs"));
  assert.ok(contact.includes('href="privacy.html"'));
  assert.ok(about.includes("Johnson Kyei Baffour"));
  assert.ok(help.includes("Start Screening"));
  assert.ok(accessibility.includes("not a claim that every page or feature has been independently audited"));
  assert.ok(pulse.includes("Public visitors do not create anonymous Firebase sessions"));
  assert.ok(pulse.includes("search_performed"));
});
