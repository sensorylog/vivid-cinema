import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createLiveKitAccessToken, createLiveKitRoomAdminToken } from "../cloudflare/functions/lib/livekit-token.js";
import { mountWatchRoomPlayerLayout } from "../scripts/watch-room-player-layout.js";

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

test("Retired Watch Rooms routes do not expose the lobby playback experience", async () => {
  const [lobbyHtml, legacyPage] = await Promise.all([
    readFile(new URL("../watch-rooms.html", import.meta.url), "utf8"),
    readFile(new URL("../watch-room-cinema.html", import.meta.url), "utf8")
  ]);
  assert.match(legacyPage, /Watch Rooms have ended/);
  assert.match(lobbyHtml, /Watch Rooms have ended/);
  assert.ok(lobbyHtml.includes('name="robots" content="noindex,follow"'));
  assert.doesNotMatch(lobbyHtml, /wr-screening-player-host|wr-cinema-stage|wr-voice-call|watch-room-playback\.js|watch-room-lobby\.js/);
  assert.doesNotMatch(legacyPage, /window\.location\.replace\(target\.href\)/);
});
test("Watch Room player uses scroll-aware floating presentation with hysteresis", () => {
  const classes = () => {
    const values = new Set();
    return {
      values,
      toggle(name, force) {
        if (force === undefined ? !values.has(name) : force) values.add(name);
        else values.delete(name);
        return values.has(name);
      },
      contains(name) { return values.has(name); }
    };
  };
  let observerCallback;
  let observerOptions;
  let observedTarget;
  class FakeIntersectionObserver {
    constructor(callback, options) {
      observerCallback = callback;
      observerOptions = options;
      this.options = options;
    }
    observe(target) { observedTarget = target; }
    unobserve() { observedTarget = null; }
    disconnect() { observedTarget = null; }
  }
  const slot = { classList: classes(), scrollIntoView() { this.scrolled = true; } };
  const overlay = { classList: classes(), dataset: {}, setAttribute(name, value) { this[name] = value; }, querySelector() { return null; } };
  const presentations = [];
  const layout = mountWatchRoomPlayerLayout({
    slot, overlay, Observer: FakeIntersectionObserver,
    onPresentation: state => presentations.push(state.floating)
  });
  layout.setActive(true);
  assert.equal(observedTarget, slot);
  assert.deepEqual(observerOptions.threshold, [0, 0.12, 0.45]);
  assert.equal(observerOptions.root, null);
  observerCallback([{ target: slot, isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(overlay.classList.contains("is-floating"), true);
  observerCallback([{ target: slot, isIntersecting: true, intersectionRatio: 0.2 }]);
  assert.equal(overlay.classList.contains("is-floating"), true, "the player should not flicker near the viewport boundary");
  observerCallback([{ target: slot, isIntersecting: true, intersectionRatio: 0.5 }]);
  assert.equal(overlay.classList.contains("is-floating"), false);
  layout.focus();
  assert.equal(slot.scrolled, true);
  layout.setActive(false);
  assert.equal(observedTarget, null);
  layout.destroy();
  assert.deepEqual(presentations, [true, false]);
});
