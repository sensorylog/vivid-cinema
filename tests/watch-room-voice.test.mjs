import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createLiveKitAccessToken, createLiveKitRoomAdminToken } from "../cloudflare/functions/lib/livekit-token.js";

function decode(part) {
  return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

test("LiveKit access token is short-lived and scoped to one room and one member", async () => {
  const now = 1_800_000_000_000;
  const apiSecret = "a-test-only-livekit-secret-value";
  const result = await createLiveKitAccessToken({
    apiKey: "LK_TEST_KEY", apiSecret, identity: "member_123",
    roomName: "vivid-" + "a".repeat(32), displayName: "Vivid member", role: "guest", now
  });
  const [headerPart, payloadPart, signaturePart] = result.token.split(".");
  assert.equal(decode(headerPart).alg, "HS256");
  const claims = decode(payloadPart);
  assert.equal(claims.iss, "LK_TEST_KEY");
  assert.equal(claims.sub, "member_123");
  assert.equal(claims.nbf, claims.iat - 30);
  assert.equal(claims.video.room, "vivid-" + "a".repeat(32));
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.deepEqual(claims.video.canPublishSources, ["microphone"]);
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.exp - claims.iat, 4 * 60 * 60);
  assert.equal(result.expiresAt, (claims.exp) * 1000);
  assert.equal(result.token.includes(apiSecret), false);
  const expected = createHmac("sha256", apiSecret).update(headerPart + "." + payloadPart).digest("base64url");
  assert.equal(signaturePart, expected);
});


test("LiveKit token signer trims copied Cloudflare key and secret whitespace", async () => {
  const now = 1_800_000_000_000;
  const result = await createLiveKitAccessToken({
    apiKey: "  LK_TEST_KEY\n",
    apiSecret: "  a-test-only-livekit-secret-value\n",
    identity: "member_123",
    roomName: "vivid-" + "c".repeat(32),
    displayName: "Vivid member",
    role: "host",
    now
  });
  const [headerPart, payloadPart, signaturePart] = result.token.split(".");
  const claims = decode(payloadPart);
  assert.equal(claims.iss, "LK_TEST_KEY");
  assert.equal(claims.nbf, claims.iat - 30);
  const expected = createHmac("sha256", "a-test-only-livekit-secret-value")
    .update(headerPart + "." + payloadPart).digest("base64url");
  assert.equal(signaturePart, expected);
});

test("LiveKit admin token is short-lived and restricted to one room", async () => {
  const apiSecret = "a-test-only-livekit-secret-value";
  const now = 1_800_000_000_000;
  const token = await createLiveKitRoomAdminToken({
    apiKey: "LK_TEST_KEY", apiSecret, roomName: "vivid-" + "b".repeat(32), now
  });
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  const claims = decode(payloadPart);
  assert.equal(decode(headerPart).alg, "HS256");
  assert.equal(claims.video.roomAdmin, true);
  assert.equal(claims.video.room, "vivid-" + "b".repeat(32));
  assert.equal(claims.exp - claims.iat, 60);
  const expected = createHmac("sha256", apiSecret).update(headerPart + "." + payloadPart).digest("base64url");
  assert.equal(signaturePart, expected);
});

test("LiveKit token signer rejects malformed identities and unscoped room names", async () => {
  await assert.rejects(() => createLiveKitAccessToken({
    apiKey: "key", apiSecret: "a-test-only-livekit-secret-value",
    identity: "bad/identity", roomName: "public-room"
  }), /invalid/i);
});

test("Watch Room uses a dedicated cinema route instead of nesting the Watch page in an iframe", async () => {
  const [lobbyHtml, cinemaHtml, lobby, cinema, voice, playback, watchPage, cinemaStyles, rooms] = await Promise.all([
    readFile(new URL("../watch-rooms.html", import.meta.url), "utf8"),
    readFile(new URL("../watch-room-cinema.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-cinema.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-voice.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch.js", import.meta.url), "utf8"),
    readFile(new URL("../styles/vivid-watch-room-cinema.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8")
  ]);
  assert.ok(lobbyHtml.includes('name="allowGuestVoice"'));
  assert.ok(!lobbyHtml.includes('id="wr-screening-frame-wrap"'));
  assert.ok(!lobby.includes('document.createElement("iframe")'));
  assert.ok(lobby.includes('new URL("watch-room-cinema.html", window.location.href)'));
  assert.ok(lobby.includes('window.location.assign(url)'));
  assert.ok(lobby.includes('activeSessionId !== loadedScreeningSessionId'));
  assert.ok(cinemaHtml.includes('id="watch-content"'));
  assert.ok(cinemaHtml.includes('id="wr-voice-call"'));
  assert.ok(cinemaHtml.includes('src="scripts/watch-room-cinema.js"'));
  assert.ok(cinemaHtml.includes('src="scripts/watch-room-playback.js"'));
  assert.ok(cinema.includes('call("getWatchRoomLobbySnapshot")'));
  assert.ok(cinema.includes('call("getWatchRoomPlaybackSnapshot")'));
  assert.ok(cinema.includes('vivid:watch-room-open'));
  assert.ok(voice.includes("getWatchRoomVoiceToken"));
  assert.ok(voice.includes("setMicrophoneEnabled"));
  assert.ok(playback.includes("joinedPlayback = memberRole === \"guest\""));
  assert.ok(playback.includes("joinButton.hidden = true"));
  assert.ok(playback.includes('state.status === "playing" && !roomPlayerLoadRequested'));
  assert.ok(watchPage.includes('route.params.get("roomMode") === "1"'));
  assert.ok(cinemaStyles.includes(".vivid-cinema-voice"));
  assert.ok(cinemaStyles.includes(".vivid-cinema-stage"));
  assert.ok(cinemaStyles.includes("body.vivid-watch-room-mode #player-overlay"));
  assert.ok(cinemaStyles.includes("body.vivid-watch-room-mode #vivid-tflix-player"));
  assert.ok(cinemaStyles.includes("env(safe-area-inset-bottom)"));
  assert.ok(rooms.includes('requestedParams.get("roomId")'));
  assert.ok(rooms.includes('document.dispatchEvent(new CustomEvent("vivid:watch-room-open"'));
});
