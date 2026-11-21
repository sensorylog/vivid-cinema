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

test("Watch Room ships voice controls and keeps the shared player inside the room shell", async () => {
  const [html, lobby, voice, api, headers, playback] = await Promise.all([
    readFile(new URL("../watch-rooms.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-voice.js", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8"),
    readFile(new URL("../_headers", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="wr-voice-call"/);
  assert.match(html, /id="wr-screening-stage"/);
  assert.ok(html.includes('name="allowGuestVoice"'));
  assert.match(lobby, /openEmbeddedScreening\(response\.data\?\.screening\)/);
  assert.ok(lobby.includes("activeSessionId !== loadedScreeningSessionId"));
  assert.ok(lobby.includes("openEmbeddedScreening(room.activeScreening)"));
  assert.match(voice, /getWatchRoomVoiceToken/);
  assert.match(voice, /setMicrophoneEnabled/);
  assert.match(api, /async function getWatchRoomVoiceToken/);
  assert.match(api, /requireRoomMember\(roomId, uid\)/);
  assert.ok(headers.includes("microphone=(self)"));
  assert.ok(headers.includes("wss://*.livekit.cloud"));
  assert.ok(api.includes("removeAllLiveKitParticipants"));
  assert.ok(api.includes("RemoveParticipant"));
  assert.ok(api.includes("allowGuestVoice"));
  assert.ok(api.includes('member.role === "guest" && room.allowGuestVoice === false'));
  assert.ok(lobby.includes("vivid:watch-room-updated"));
  assert.ok(voice.includes("guestVoiceAllowed()"));
  assert.ok(playback.includes("This Watch Room has ended or your membership was removed"));
  assert.ok(playback.includes("pauseGuestPlayer"));
});
