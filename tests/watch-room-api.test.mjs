import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../api/watch-rooms.js", import.meta.url), "utf8");
const client = await readFile(new URL("../scripts/watch-room-api.js", import.meta.url), "utf8");
const clients = await Promise.all([
  "watch-rooms.js", "watch-room-lobby.js", "watch-room-clubs.js", "watch-room-playback.js"
].map(name => readFile(new URL("../scripts/" + name, import.meta.url), "utf8")));

test("Watch Rooms callable operations are served by the existing Vercel API, not Firebase Functions", () => {
  assert.ok(api.includes('from "firebase-admin/app"'));
  assert.ok(api.includes('from "firebase-admin/auth"'));
  assert.ok(api.includes('from "firebase-admin/app-check"'));
  assert.ok(api.includes('from "firebase-admin/firestore"'));
  assert.doesNotMatch(api, /firebase-functions|onCall\(/);
  assert.ok(api.includes('https://vivid-cinema.pages.dev'));
  assert.ok(api.includes('parsed.hostname.endsWith(".vivid-cinema.pages.dev")'));
  assert.ok(api.includes('getAuth(firebaseApp).verifyIdToken(match[1], true)'));
  assert.ok(api.includes('verifyToken(appCheckToken, { consume: true })'));
  for (const operation of [
    "createWatchRoom","createCinemaClub","createWatchInvitation","redeemWatchInvitation","revokeWatchInvitation","cleanupExpiredWatchRooms",
    "heartbeatWatchRoom","addWatchRoomQueueItem","removeWatchRoomQueueItem","voteWatchRoomQueueItem",
    "sendWatchRoomMessage","reactToWatchRoomMessage","updateWatchRoomSettings","removeWatchRoomMember",
    "leaveWatchRoom","closeWatchRoom","publishWatchRoomPlayback",
    "addCinemaClubWatchlistItem","removeCinemaClubWatchlistItem","recordCinemaClubScreening",
    "addCinemaClubAfterCreditsReview","addCinemaClubDiscussionMessage","leaveCinemaClub","archiveCinemaClub"
  ]) {
    assert.ok(api.includes("async function " + operation + "("), "missing API operation " + operation);
    assert.ok(api.includes('"' + operation + '"' ), "operation is not routed: " + operation);
  }
});

test("Watch Rooms browser client sends Firebase Auth and one-time App Check tokens", () => {
  assert.ok(client.includes('getLimitedUseToken(appCheck)'));
  assert.ok(client.includes('user.getIdToken()'));
  assert.ok(client.includes('"X-Firebase-AppCheck"'));
  assert.ok(client.includes('https://vivid-cinema-api.vercel.app/api/watch-rooms'));
  assert.ok(client.includes('credentials: "omit"'));
  assert.ok(client.includes('return { data: payload.data }'));
});

test("All Watch Rooms and Cinema Club clients use the shared Vercel API adapter", () => {
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


test("Watch Rooms API never exposes raw Firebase Admin errors to the browser", () => {
  assert.ok(api.includes("const safeMessage = error instanceof HttpsError && status < 500"));
  assert.ok(api.includes("Your sign-in or app verification needs refreshing."));
  assert.ok(api.includes("We couldn't complete that action right now. Please try again."));
});


test("Watch Rooms API never exposes raw Firebase Admin errors to the browser", () => {
  assert.ok(api.includes("const safeMessage = error instanceof HttpsError && status < 500"));
  assert.ok(api.includes("Your sign-in or app verification needs refreshing."));
  assert.ok(api.includes("We couldn't complete that action right now. Please try again."));
});
