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


test("Cinema Club writes re-check active club status inside their transactions", () => {
  const backend = readFileSync(new URL("../functions/watch-rooms-clubs.js", import.meta.url), "utf8");
  for (const operation of ["removeCinemaClubWatchlistItem","addCinemaClubAfterCreditsReview","addCinemaClubDiscussionMessage"]) {
    const start = backend.indexOf("export const " + operation);
    const end = backend.indexOf("\n});", start);
    const body = backend.slice(start, end);
    assert.ok(body.includes("tx.get(clubRef)"), operation + " must re-read the club in its transaction");
    assert.ok(body.includes('club.data().status !== "active"'), operation + " must reject archived clubs");
  }
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.ok(rules.includes("function isVividUser()"));
  assert.ok(rules.includes("request.auth.token.firebase.sign_in_provider != 'anonymous'"));
});


test("Cinema Club capacity limits use transactional counters to prevent concurrent overfill", () => {
  const backend = readFileSync(new URL("../functions/watch-rooms-clubs.js", import.meta.url), "utf8");
  const add = backend.slice(backend.indexOf("export const addCinemaClubWatchlistItem"), backend.indexOf("export const removeCinemaClubWatchlistItem"));
  const remove = backend.slice(backend.indexOf("export const removeCinemaClubWatchlistItem"), backend.indexOf("export const recordCinemaClubScreening"));
  const discussion = backend.slice(backend.indexOf("export const addCinemaClubDiscussionMessage"));
  assert.ok(add.includes("watchlistCount") && add.includes("tx.update(clubRef"), "watchlist cap must be serialized on the club document");
  assert.ok(remove.includes("watchlistCount") && remove.includes("tx.update(clubRef"), "removing a pick must decrement the shared counter");
  assert.ok(discussion.includes("discussionCount") && discussion.includes("tx.update(screeningRef"), "discussion cap must be serialized on the screening document");
  assert.doesNotMatch(discussion, /tx\.get\(screeningRef\.collection\(["']discussion["']\)\)/, "a collection-size query alone is vulnerable to concurrent inserts");
});


test("Watch Room lobby mutations revalidate membership transactionally and serialize queue capacity", () => {
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.ok(lobby.includes("async function requireRoomMemberInTransaction(tx, roomId, uid)"));
  for (const operation of ["heartbeatWatchRoom","addWatchRoomQueueItem","voteWatchRoomQueueItem","sendWatchRoomMessage","reactToWatchRoomMessage"]) {
    const start = lobby.indexOf("export const " + operation);
    const end = lobby.indexOf("\\n});", start);
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
  const backend = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const remove = backend.slice(backend.indexOf("export const removeWatchRoomQueueItem"), backend.indexOf("export const voteWatchRoomQueueItem"));
  assert.ok(remove.includes("member.role !== \"host\" && item.data().addedBy !== uid"), "only host or author may remove a queue pick");
  assert.ok(remove.includes("queueCount: Math.max(0, Number(room.queueCount || 0) - 1)"), "removal must free a queue slot transactionally");
  assert.ok(index.includes("  removeWatchRoomQueueItem,"), "callable must be exported");
  assert.ok(client.includes('call("removeWatchRoomQueueItem")'), "lobby must expose the remove action");
});

test("expired Watch Rooms and invitation records receive bounded scheduled retention cleanup", () => {
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  assert.ok(index.includes("export const cleanupExpiredWatchRooms = onSchedule("));
  assert.ok(index.includes('.where("expiresAt", "<=", now)'));
  assert.ok(index.includes("db.recursiveDelete(roomRef)"), "room cleanup must remove nested subcollections");
  assert.ok(index.includes('collection("watchRooms").doc(roomDocument.id)'), "cleanup must remove private dashboard pointers");
  assert.ok(lobby.includes("expiresAt: closedAt"), "manually closed rooms should become immediately eligible for cleanup");
});


test("Watch Room chat has a transactional per-room volume ceiling", () => {
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const send = lobby.slice(lobby.indexOf("export const sendWatchRoomMessage"), lobby.indexOf("export const reactToWatchRoomMessage"));
  assert.ok(lobby.includes("const ROOM_CHAT_LIMIT = 500"));
  assert.ok(send.includes("chatCount >= ROOM_CHAT_LIMIT"));
  assert.ok(send.includes("tx.update(roomRef, { chatCount: chatCount + 1"));
  assert.ok(lifecycle.includes("chatCount: 0"));
});


test("Watch Room guests can leave transactionally while hosts must close the room", () => {
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../watch-rooms.html", import.meta.url), "utf8");
  const leave = lobby.slice(lobby.indexOf("export const leaveWatchRoom"), lobby.indexOf("export const closeWatchRoom"));
  assert.ok(leave.includes("room.hostUid === uid || member.role === \"host\""));
  assert.ok(leave.includes("tx.delete(memberRef)") && leave.includes("tx.delete(pointerRef)"));
  assert.ok(leave.includes("memberCount: Math.max(1"));
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
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const settings = lobby.slice(lobby.indexOf("export const updateWatchRoomSettings"), lobby.indexOf("export const removeWatchRoomMember"));
  const close = lobby.slice(lobby.indexOf("export const closeWatchRoom"), lobby.indexOf("export const publishWatchRoomPlayback"));
  assert.ok(settings.includes("requireRoomMemberInTransaction(tx, roomId, uid)"));
  assert.ok(settings.includes('room.hostUid !== uid || member.role !== "host"'));
  assert.ok(settings.includes('tx.get(roomRef.collection("members"))'));
  assert.ok(close.includes("requireRoomMemberInTransaction(tx, roomId, uid)"));
  assert.ok(close.includes("expiresAt: closedAt"));
  assert.ok(close.includes('tx.set(db().collection("users")'));
});


test("Cinema Club members can leave and owners can archive with server-owned membership cleanup", () => {
  const backend = readFileSync(new URL("../functions/watch-rooms-clubs.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  const leave = backend.slice(backend.indexOf("export const leaveCinemaClub"), backend.indexOf("export const archiveCinemaClub"));
  const archive = backend.slice(backend.indexOf("export const archiveCinemaClub"));
  assert.ok(leave.includes('member.data().role === "owner" || club.data().ownerUid === uid'));
  assert.ok(leave.includes("tx.delete(memberRef)") && leave.includes("tx.delete(pointerRef)"));
  assert.ok(archive.includes('club.data().ownerUid !== uid || !owner.exists || owner.data().role !== "owner"'));
  assert.ok(archive.includes('status: "archived"'));
  assert.ok(archive.includes('tx.delete(db().collection("users")'));
  assert.ok(index.includes("  leaveCinemaClub,") && index.includes("  archiveCinemaClub"));
  assert.ok(client.includes('call(archive ? "archiveCinemaClub" : "leaveCinemaClub")'));
});


test("Host removal deletes membership, presence and dashboard pointer atomically", () => {
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const remove = lobby.slice(lobby.indexOf("export const removeWatchRoomMember"), lobby.indexOf("export const leaveWatchRoom"));
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
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const clubs = readFileSync(new URL("../functions/watch-rooms-clubs.js", import.meta.url), "utf8");
  const redeem = index.slice(index.indexOf("export const redeemWatchInvitation"), index.indexOf("export const revokeWatchInvitation"));
  assert.ok(redeem.includes('transaction.get(targetRef.collection("members"))'));
  assert.ok(redeem.includes("existingPointerRef"));
  assert.ok(redeem.includes("memberCount: nextMemberCount"));
  for (const operation of ["removeWatchRoomMember","leaveWatchRoom"]) {
    const start = lobby.indexOf("export const " + operation);
    const end = lobby.indexOf("\n});", start);
    assert.ok(lobby.slice(start, end).includes('tx.get(roomRef.collection("members"))'));
    assert.ok(lobby.slice(start, end).includes("memberCount: nextMemberCount"));
  }
  const leave = clubs.slice(clubs.indexOf("export const leaveCinemaClub"), clubs.indexOf("export const archiveCinemaClub"));
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
  assert.ok(client.includes('collection(db, "rooms", data.roomId, "members")'));
  assert.ok(client.includes('"Vivid member · away"'));
  assert.ok(client.includes('call("removeWatchRoomMember")'));
});


test("Watch Room backend and Firestore rules fail closed for missing expiry timestamps", () => {
  const lobby = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.ok(lobby.includes("!Number.isFinite(expiresAt) || expiresAt <= Date.now()"));
  assert.ok(lobby.includes("!Number.isFinite(roomData.expiresAt?.toMillis?.())"));
  assert.ok(rules.includes("room.keys().hasAll(['expiresAt'])"));
  assert.ok(rules.includes("room.expiresAt is timestamp"));
});


test("Watch Room synchronization compensates for guest device clock skew", () => {
  const backend = readFileSync(new URL("../functions/watch-rooms-lobby.js", import.meta.url), "utf8");
  const client = readFileSync(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8");
  const heartbeat = backend.slice(backend.indexOf("export const heartbeatWatchRoom"), backend.indexOf("export const addWatchRoomQueueItem"));
  assert.ok(heartbeat.includes("serverTime: Date.now()"));
  assert.ok(client.includes("clockOffsetMs = serverTime - ((startedAt + finishedAt) / 2)"));
  assert.ok(client.includes("Date.now() + clockOffsetMs - updatedAt"));
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
