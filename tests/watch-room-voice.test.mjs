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

test("Watch Room screenings stay in the lobby and minimize without stopping playback", async () => {
  const [lobbyHtml, lobby, voice, playback, watchPage, cinemaStyles, rooms] = await Promise.all([
    readFile(new URL("../watch-rooms.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-voice.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch.js", import.meta.url), "utf8"),
    readFile(new URL("../styles/vivid-watch-room-cinema.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8")
  ]);
  assert.ok(lobbyHtml.includes('id="wr-screening-player-host"'));
  assert.ok(lobbyHtml.includes('src="scripts/watch.js"'));
  assert.ok(lobbyHtml.includes('src="scripts/watch-room-playback.js"'));
  assert.ok(lobby.includes('new URL("watch-rooms.html", window.location.href)'));
  assert.ok(lobby.includes('loadedScreeningSessionId = new URLSearchParams(window.location.search).get("sessionId")'));
  assert.ok(lobby.includes('vivid:watch-room-screening-validated'));
  assert.ok(lobby.includes('activeSessionId !== loadedScreeningSessionId'));
  assert.ok(watchPage.includes('route.params.get("roomMode") === "1"'));
  assert.ok(watchPage.includes('overlay.classList.add("is-minimized")'));
  assert.ok(watchPage.includes('restorePlayer.addEventListener("click", openPlayerWindow)'));
  assert.ok(watchPage.includes('vivid:watch-room-screening-validated'));
  assert.ok(watchPage.includes("watchRoomScreeningValidated = true"));
  assert.ok(watchPage.includes('secondaryRoot.classList.remove("is-minimized")'));
  assert.ok(playback.includes('params.get("roomMode") === "1" && params.get("id")'));
  assert.ok(playback.includes('getWatchRoomPlaybackSnapshot'));
  assert.ok(voice.includes("getWatchRoomVoiceToken"));
  assert.ok(voice.includes("setMicrophoneEnabled"));
  assert.ok(cinemaStyles.includes("aspect-ratio:16/9"));
  assert.ok(cinemaStyles.includes("#player-overlay.is-minimized"));
  assert.ok(cinemaStyles.includes("#player-overlay[hidden]"));
  assert.ok(cinemaStyles.includes("#vivid-tflix-player.is-minimized"));
  assert.ok(cinemaStyles.includes(".vivid-tflix-room-minimize"));
  assert.ok(rooms.includes('requestedParams.get("roomId")'));
  assert.ok(rooms.includes('document.dispatchEvent(new CustomEvent("vivid:watch-room-open"'));
});
