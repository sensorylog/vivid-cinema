import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../scripts/watch-room-api.js", import.meta.url), "utf8");
const clients = await Promise.all([
  "watch-rooms.js", "watch-room-lobby.js", "watch-room-clubs.js", "watch-room-playback.js"
].map(name => readFile(new URL("../scripts/" + name, import.meta.url), "utf8")));

test("Watch Rooms browser client sends Firebase Auth and standard App Check tokens", async () => {
  assert.ok(client.includes('getToken(appCheck, false)'));
  const firebase = await readFile(new URL("../scripts/firebase.js", import.meta.url), "utf8");
  assert.match(firebase, /isTokenAutoRefreshEnabled:\s*false/);
  const dashboard = await readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(dashboard.includes('void call("cleanupExpiredWatchRooms")({})'), "retention remains scheduled as a non-blocking background task");
  assert.ok(dashboard.indexOf('call("getWatchRoomDashboard")') < dashboard.indexOf('call("cleanupExpiredWatchRooms")'), "dashboard must load before maintenance starts");
  assert.doesNotMatch(client, /getLimitedUseToken/);
  assert.ok(client.includes('user.getIdToken()'));
  assert.ok(client.includes('"X-Firebase-AppCheck"'));
  assert.ok(client.includes('const API_URL = "/api/watch-rooms"'));
  assert.ok(client.includes('credentials: "omit"'));
  assert.ok(client.includes('return { data: payload.data }'));
});

test("All Watch Rooms and Cinema Club clients use the shared same-origin API adapter", () => {
  for (const source of clients) {
    assert.ok(source.includes('import { callWatchRoomApi } from "./watch-room-api.js"'));
    assert.ok(source.includes("const call = callWatchRoomApi"));
    assert.doesNotMatch(source, /firebase-functions\.js|getFunctions\(|httpsCallable\(/);
  }
});


test("Watch Rooms are no longer exported from the Firebase Functions codebase", async () => {
  const functionsIndex = await readFile(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(functionsIndex, /createWatchRoom|createCinemaClub|createWatchInvitation|redeemWatchInvitation|publishWatchRoomPlayback|archiveCinemaClub|watch-rooms-lobby|watch-rooms-clubs|cleanupExpiredWatchRooms/);
});


test("Cloudflare Watch Rooms route preserves every trusted operation and signed App Check checks", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  for (const operation of [
    "createWatchRoom","deleteWatchRoom","createCinemaClub","createWatchInvitation","redeemWatchInvitation","revokeWatchInvitation","cleanupExpiredWatchRooms",
    "heartbeatWatchRoom","addWatchRoomQueueItem","removeWatchRoomQueueItem","voteWatchRoomQueueItem",
    "sendWatchRoomMessage","reactToWatchRoomMessage","updateWatchRoomSettings","removeWatchRoomMember",
    "leaveWatchRoom","closeWatchRoom","publishWatchRoomPlayback",
    "addCinemaClubWatchlistItem","removeCinemaClubWatchlistItem","recordCinemaClubScreening",
    "addCinemaClubAfterCreditsReview","addCinemaClubDiscussionMessage","leaveCinemaClub","archiveCinemaClub"
  ]) {
    assert.ok(route.includes("async function " + operation + "("), "missing Cloudflare operation " + operation);
    assert.ok(route.includes('"' + operation + '"'), "Cloudflare route does not allow " + operation);
  }
  assert.ok(route.includes("verifyFirebaseIdToken(match[1], projectId, serviceAccount)"));
  assert.ok(route.includes("verifyAppCheckToken(appCheckToken)"));
  assert.ok(!route.includes("firebase-admin/auth") && !route.includes("firebase-admin/app-check"));
  assert.ok(!route.includes("getAuth(") && !route.includes("getAppCheck("));
  assert.ok(route.includes("invalidUserTokenCodes"));
  assert.ok(!route.includes('rawCode.startsWith("auth/")'), "server-side Firebase Admin errors must not be mislabeled as user sign-in failures");
  assert.ok(route.includes('rawCode.startsWith("appCheck/")'));
  assert.ok(route.includes('"auth/id-token-revoked"'));
  assert.ok(route.includes('"Watch Rooms Firebase ID-token verification failed:"'));
  assert.ok(!route.includes('String(error?.code || "").startsWith("auth/")'));
  assert.ok(route.includes("verifyAppCheckToken(appCheckToken)"));
  assert.ok(!route.includes("verifyAndConsumeAppCheckToken"));
  assert.ok(route.includes("recursiveDelete(reference)"));
  assert.ok(route.includes("reference instanceof Query"));
});


test("Cloudflare Firebase token verification uses Web Crypto and Google REST APIs, not Node HTTPS", async () => {
  const verifier = await readFile(new URL("../cloudflare/functions/lib/firebase-token-verification.js", import.meta.url), "utf8");
  assert.match(verifier, /crypto\.subtle\.verify/);
  assert.match(verifier, /securetoken@system\.gserviceaccount\.com/);
  assert.match(verifier, /identitytoolkit\.googleapis\.com/);
  assert.match(verifier, /firebaseappcheck\.googleapis\.com\/v1\/jwks/);
  assert.match(verifier, /verifyAppCheckToken/);
  assert.doesNotMatch(verifier, /alreadyConsumed|:verifyAppCheckToken/);
  assert.doesNotMatch(verifier, /https\.request|firebase-admin\/auth|firebase-admin\/app-check/);
});

test("Cloudflare classifies Firestore IAM permission failures as server errors, not user access denials", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(route.includes('const firestoreIamDenied = !(error instanceof HttpsError) && rawCode === "permission-denied"'));
  assert.ok(route.includes('code=firestoreIamDenied ? "internal"'));
  assert.ok(route.includes('"Watch Rooms Firestore IAM permission denied during operation:"'));
});


test("Watch Room creation commits its invite and dashboard record atomically", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const createRoom = route.slice(route.indexOf("async function createWatchRoom("), route.indexOf("async function createCinemaClub("));
  assert.match(createRoom, /const code = inviteCode\(\)/);
  assert.match(createRoom, /transaction\.create\(invitationRef/);
  assert.match(createRoom, /targetType: "room", targetId: roomRef\.id/);
  assert.match(createRoom, /inviteCode: code/);
  assert.match(createRoom, /transaction\.create\(userRoomRef/);
  const page = await readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  const handler = page.slice(page.indexOf('byId("wr-create-room-form")'), page.indexOf('byId("wr-join-room-form")'));
  assert.match(handler, /room\.inviteCode/);
  assert.doesNotMatch(handler, /call\("createWatchInvitation"\)/);
  assert.match(handler, /dashboard refresh failed/);
});


test("Watch Rooms dashboard is loaded through the authenticated server API", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const clientPage = await readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  const dashboard = route.slice(route.indexOf("async function getWatchRoomDashboard("), route.indexOf("async function createCinemaClub("));
  assert.ok(dashboard.includes('db.collection("users").doc(auth.uid)'));
  assert.match(dashboard, /collection\("watchRooms"\)/);
  assert.match(dashboard, /collection\("cinemaClubs"\)/);
  assert.match(dashboard, /timestampMillis/);
  assert.match(clientPage, /call\("getWatchRoomDashboard"\)/);
  assert.doesNotMatch(clientPage, /getDocs\(|collection\(db, "users"/);
});


test("Joining a room opens its lobby immediately after the dashboard refresh", async () => {
  const dashboard = await readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(dashboard.includes('closeDialog(joinDialog)'));
  assert.ok(dashboard.includes('new CustomEvent("vivid:watch-room-open"'));
  assert.ok(dashboard.includes('dashboardState.rooms.find(item => item.roomId === result.data.targetId)'));
});

test("Only the host can permanently delete a room and all room data", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const start = route.indexOf("async function deleteWatchRoom(");
  const end = route.indexOf("async function publishWatchRoomPlayback(", start);
  const implementation = route.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(implementation, /room\.hostUid !== uid/);
  assert.match(implementation, /member\.role !== "host"/);
  assert.match(implementation, /collection\("watchRooms"\)/);
  assert.match(implementation, /recursiveDelete\(roomRef\)/);
});


test("Cloudflare Watch Rooms logs safe operation-level rejection details and preserves permission messages", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const rooms = await readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(route.includes('console.warn("Vivid Watch Rooms request rejected:"'));
  assert.ok(route.includes('{ action, code, message: error.message }'));
  assert.ok(route.includes('console.warn("Vivid Watch Rooms rejected request origin:"'));
  assert.ok(rooms.includes('if (code.includes("permission-denied")) return error?.message ||'));
});


test("authoritative playback writes are screening-scoped, revision-safe and realtime-readable", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const start = route.indexOf("async function publishWatchRoomPlayback(");
  const end = route.indexOf("\nasync function ", start + 10);
  const publish = route.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(publish, /expectedRevision/);
  assert.match(publish, /stale-revision/);
  assert.match(publish, /activeScreening\.contentId/);
  assert.match(publish, /activeScreening\.mediaType/);
  assert.match(publish, /schemaVersion: 1/);
  assert.match(rules, /match \/playback\/{stateId}/);
  assert.match(rules, /allow get, list: if isRoomMember\(roomId\)/);
  assert.match(rules, /allow create, update, delete: if false/);
});

test("Realtime permission errors are verified by the trusted API before the lobby closes", async () => {
  const lobby = await readFile(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8");
  const start = lobby.indexOf("function subscribeRoomRealtime(");
  const end = lobby.indexOf("\nfunction openLobby(", start);
  const realtime = lobby.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(realtime, /call\("getWatchRoomLobbySnapshot"\)/);
  assert.match(realtime, /if \(error\?\.code === "permission-denied"\) \{\s*realtimeFallback = true;\s*void verifyRoomAccess\(\);/);
  assert.match(realtime, /code\.includes\("permission-denied"\).*handleRoomAccessLost/s);
  assert.match(realtime, /if \(realtimeFallback && !accessVerification\) \{\s*void refreshTrustedSnapshot\(\)/);
  assert.doesNotMatch(realtime, /if \(error\?\.code === "permission-denied"\) \{\s*handleRoomAccessLost/);
});
