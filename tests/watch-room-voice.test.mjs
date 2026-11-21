import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createLiveKitAccessToken } from "../cloudflare/functions/lib/livekit-token.js";

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
  assert.equal(claims.video.canSubscribe, true);
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(result.expiresAt, (claims.exp) * 1000);
  assert.equal(result.token.includes(apiSecret), false);
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
  const [html, lobby, voice, api] = await Promise.all([
    readFile(new URL("../watch-rooms.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-voice.js", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare/functions/api/watch-rooms.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="wr-voice-call"/);
  assert.match(html, /id="wr-screening-stage"/);
  assert.match(lobby, /openEmbeddedScreening\(response\.data\?\.screening\)/);
  assert.match(voice, /getWatchRoomVoiceToken/);
  assert.match(voice, /setMicrophoneEnabled/);
  assert.match(api, /async function getWatchRoomVoiceToken/);
  assert.match(api, /requireRoomMember\(roomId, uid\)/);
});
