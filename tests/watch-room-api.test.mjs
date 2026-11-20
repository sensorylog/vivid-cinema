import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const client = await readFile(new URL("../scripts/watch-room-api.js", import.meta.url), "utf8");
const clients = await Promise.all([
  "watch-rooms.js", "watch-room-lobby.js", "watch-room-clubs.js", "watch-room-playback.js"
].map(name => readFile(new URL("../scripts/" + name, import.meta.url), "utf8")));

test("Watch Rooms browser client uses Firebase Auth and a cached Cloudflare attestation session", async () => {
  assert.ok(client.includes('user.getIdToken()'));
  assert.ok(client.includes('"X-Vivid-Room-Session"'));
  assert.ok(client.includes('action: "attestBrowser"'));
  assert.ok(client.includes('action: "watch_rooms"'));
  assert.ok(client.includes('SESSION_REFRESH_SKEW_MS'));
  assert.doesNotMatch(client, /getToken\\(appCheck|X-Firebase-AppCheck|appCheckError/);
  const firebase = await readFile(new URL("../scripts/firebase.js", import.meta.url), "utf8");
  assert.match(firebase, /initializeAppCheck/);
  assert.match(firebase, /isTokenAutoRefreshEnabled:\\s*false/);
  const dashboard = await readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8");
  assert.ok(dashboard.includes('void call("cleanupExpiredWatchRooms")({})'), "retention remains scheduled as a non-blocking background task");
  assert.ok(dashboard.indexOf('call("getWatchRoomDashboard")') < dashboard.indexOf('call("cleanupExpiredWatchRooms")'), "dashboard must load before maintenance starts");
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


test("Cloudflare Watch Rooms route preserves operations and requires signed Turnstile sessions", async () => {
  const route = await readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8");
  for (const operation of [
    "createWatchRoom","getWatchRoomDashboard","createCinemaClub","createWatchInvitation","redeemWatchInvitation","revokeWatchInvitation","cleanupExpiredWatchRooms",
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
  assert.ok(route.includes("verifyTurnstileToken("));
  assert.ok(route.includes("createWatchRoomSession("));
  assert.ok(route.includes("verifyWatchRoomSession("));
  assert.ok(route.includes('action === "attestBrowser"'));
  assert.ok(route.includes("TURNSTILE_SITE_KEY"));
  assert.ok(route.includes("TURNSTILE_SECRET_KEY"));
  assert.ok(route.includes("WATCH_ROOMS_SESSION_SECRET"));
  assert.ok(route.includes('"X-Vivid-Room-Session"'));
  assert.doesNotMatch(route, /verifyAppCheckToken|X-Firebase-AppCheck/);
  assert.ok(!route.includes("firebase-admin/auth") && !route.includes("firebase-admin/app-check"));
  assert.ok(!route.includes("getAuth(") && !route.includes("getAppCheck("));
  assert.ok(route.includes("invalidUserTokenCodes"));
  assert.ok(route.includes('"auth/id-token-revoked"'));
  assert.ok(route.includes('"Watch Rooms Firebase ID-token verification failed:"'));
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


test("Turnstile-backed Watch Rooms sessions are signed, short-lived and bound to user and origin", async () => {
  const { createWatchRoomSession, verifyWatchRoomSession } = await import("../cloudflare/functions/lib/watch-room-attestation.js");
  const secret = "vivid-watch-rooms-test-secret-with-more-than-32-characters";
  const now = 1_800_000_000_000;
  const session = await createWatchRoomSession("user-123", "https://vivid-cinema.pages.dev", secret, now);
  const claims = await verifyWatchRoomSession(session.token, "user-123", "https://vivid-cinema.pages.dev", secret, now + 1000);
  assert.equal(claims.sub, "user-123");
  assert.equal(claims.origin, "https://vivid-cinema.pages.dev");
  assert.equal(session.expiresAt, (Math.floor(now / 1000) + 1800) * 1000);
  await assert.rejects(
    verifyWatchRoomSession(session.token, "another-user", "https://vivid-cinema.pages.dev", secret, now + 1000),
    error => error.code === "room-session-invalid"
  );
  await assert.rejects(
    verifyWatchRoomSession(session.token, "user-123", "https://evil.example", secret, now + 1000),
    error => error.code === "room-session-invalid"
  );
  await assert.rejects(
    verifyWatchRoomSession(session.token, "user-123", "https://vivid-cinema.pages.dev", secret, now + 31 * 60 * 1000),
    error => error.code === "room-session-expired"
  );
  const tampered = session.token.slice(0, -1) + (session.token.endsWith("a") ? "b" : "a");
  await assert.rejects(
    verifyWatchRoomSession(tampered, "user-123", "https://vivid-cinema.pages.dev", secret, now + 1000),
    error => error.code === "room-session-invalid"
  );
});

test("Turnstile verification checks the server verdict, hostname and action", async () => {
  const { verifyTurnstileToken } = await import("../cloudflare/functions/lib/watch-room-attestation.js");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.method, "POST");
      return new Response(JSON.stringify({
        success: true, hostname: "vivid-cinema.pages.dev", action: "watch_rooms"
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    await verifyTurnstileToken("valid-turnstile-token", "test-secret", "vivid-cinema.pages.dev", "203.0.113.4");
    await assert.rejects(
      verifyTurnstileToken("valid-turnstile-token", "test-secret", "evil.example", ""),
      error => error.code === "turnstile/claims-mismatch"
    );
    globalThis.fetch = async () => new Response(JSON.stringify({
      success: true, hostname: "vivid-cinema.pages.dev", action: "login"
    }), { status: 200 });
    await assert.rejects(
      verifyTurnstileToken("valid-turnstile-token", "test-secret", "vivid-cinema.pages.dev", ""),
      error => error.code === "turnstile/claims-mismatch"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});