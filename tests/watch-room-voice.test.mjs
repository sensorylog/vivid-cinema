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

test("Watch Room screenings stay embedded in the lobby and float without stopping playback", async () => {
  const [lobbyHtml, lobby, voice, playback, watchPage, cinemaStyles, experienceStyles, rooms, legacyPage] = await Promise.all([
    readFile(new URL("../watch-rooms.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-lobby.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-voice.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-room-playback.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch.js", import.meta.url), "utf8"),
    readFile(new URL("../styles/vivid-watch-room-cinema.css", import.meta.url), "utf8"),
    readFile(new URL("../styles/vivid-watch-room-experience.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/watch-rooms.js", import.meta.url), "utf8"),
    readFile(new URL("../watch-room-cinema.html", import.meta.url), "utf8")
  ]);
  assert.ok(legacyPage.includes('new URL("watch-rooms.html", window.location.href)'));
  assert.ok(legacyPage.includes("window.location.replace(target.href)"));
  assert.ok(lobbyHtml.includes('id="wr-screening-player-host"'));
  assert.ok(lobbyHtml.indexOf('id="wr-screening-player-host"') < lobbyHtml.indexOf('</section>\n            <aside class="vivid-wr-room-sidebar"'));
  assert.ok(lobbyHtml.includes('id="wr-voice-count"'));
  assert.ok(lobbyHtml.includes('styles/vivid-watch-room-experience.css'));
  assert.ok(lobbyHtml.includes('id="wr-cinema-stage"'));
  assert.ok(lobbyHtml.includes('data-room-view="queue"'));
  assert.ok(lobbyHtml.includes('data-room-view="chat"'));
  assert.ok(lobbyHtml.includes('data-room-view="members"'));
  assert.ok(lobbyHtml.includes('id="wr-voice-call"'));
  assert.ok(lobbyHtml.indexOf('id="wr-voice-call"') < lobbyHtml.indexOf('<aside class="vivid-wr-room-sidebar"'));
  assert.ok(lobbyHtml.includes('id="wr-link-club-select"'));
  assert.ok(lobbyHtml.includes('id="wr-linked-club-watchlist"'));
  assert.ok(lobbyHtml.includes('id="wr-open-linked-club"'));
  assert.ok(lobbyHtml.includes('src="scripts/watch.js"'));
  assert.ok(lobbyHtml.includes('src="scripts/watch-room-playback.js"'));
  assert.ok(lobby.includes('new URL("watch-rooms.html", window.location.href)'));
  assert.ok(lobby.includes("function setRoomView("));
  assert.ok(lobby.includes('event.key === "ArrowRight"'));
  assert.ok(lobby.includes('event.key === "ArrowLeft"'));
  assert.ok(lobby.includes('event.key === "Home"'));
  assert.ok(lobby.includes('event.key === "End"'));
  assert.ok(lobby.includes("setRoomView(roomViewButtons[next].dataset.roomView)"));
  assert.ok(lobbyHtml.includes('role="log" aria-live="polite"'));
  assert.ok(lobby.includes("function renderCinemaStage()"));
  assert.ok(lobby.includes("function subscribeClubWatchlist(clubId)"));
  assert.ok(lobby.includes("linkedClubId: form.elements.linkedClubId.value || null"));
  assert.ok(lobby.includes('vivid:cinema-clubs-updated'));
  assert.ok(lobby.includes('vivid:open-linked-club'));
  assert.ok(rooms.includes('vivid:open-linked-club'));
  assert.ok(lobby.includes("function subscribeRoomRealtime(roomId)"));
  assert.ok(lobby.includes('onSnapshot(queueRef'));
  assert.ok(lobby.includes('onSnapshot(chatRef'));
  assert.ok(lobby.includes('onSnapshot(presenceRef'));
  assert.ok(lobby.includes("const wasAtBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48"));
  assert.ok(lobby.includes('button.disabled = room.role !== "host" && room.allowGuestChat === false'));
  assert.ok(lobby.includes("result.data?.voiceEvicted === false"));
  assert.ok(lobby.includes("heartbeat = setInterval(ping, 30000)"));
  assert.ok(!lobby.includes("setInterval(refreshLobby, 5000)"), "room activity should update from realtime subscriptions, not five-second polling");
  assert.ok(lobby.includes('byId("wr-cinema-open")?.addEventListener("click"'));
  assert.ok(!lobby.includes("window.location.assign(url)"), "starting a screening must not reload the page and drop LiveKit voice");
  assert.ok(lobby.includes("vivid:watch-room-screening-navigate"));
  assert.ok(lobby.includes("vivid:watch-room-screening-focus"));
  assert.ok(lobby.includes('loadedScreeningSessionId = new URLSearchParams(window.location.search).get("sessionId")'));
  assert.ok(lobby.includes('vivid:watch-room-screening-validated'));
  assert.ok(lobby.includes('activeSessionId !== loadedScreeningSessionId'));
  assert.ok(watchPage.includes('route.params.get("roomMode") === "1"'));
  assert.ok(watchPage.includes('document.addEventListener("vivid:watch-room-screening-navigate"'));
  assert.ok(watchPage.includes("let roomOpenPlayerWindow = null"));
  assert.ok(watchPage.includes("roomOpenPlayerWindow = openPlayerWindow"));
  assert.ok(watchPage.includes('document.addEventListener("vivid:watch-room-closing"'));
  assert.ok(playback.includes('document.addEventListener("vivid:watch-room-closing"'));
  assert.ok(lobby.includes("function handleRoomAccessLost("));
  assert.ok(watchPage.includes("route.params = params"));
  assert.ok(playback.includes('document.addEventListener("vivid:watch-room-screening-navigate"'));
  assert.ok(playback.includes("playbackSessionId = requestedSessionId"));
  assert.ok(playback.includes("playbackRevision = 0;"));
  assert.ok(watchPage.includes("mountWatchRoomPlayerLayout({ slot, overlay: overlayForRoom })"));
  assert.ok(watchPage.includes('slot.append(overlayForRoom)'));
  assert.ok(watchPage.includes('slot.append(secondaryForRoom)'));
  assert.ok(watchPage.includes("watchContentForRoom?.replaceChildren()"));
  assert.ok(watchPage.includes("host.hidden = true"));
  assert.ok(!watchPage.includes("host.remove()"), "the screening host must remain reusable for the next movie");
  assert.ok(watchPage.includes('roomPlayerSlot?.querySelectorAll("iframe")'));
  assert.ok(watchPage.includes('if (isWatchRoomCinemaMode) return;'));
  assert.ok(watchPage.includes('roomPlayerSlot.dataset.activePlayer = "secondary"'));
  assert.ok(watchPage.includes('roomPlayerLayout?.focus()'));
  assert.ok(!watchPage.includes('overlay.classList.add("is-minimized")'), "Watch Room playback must not use the old close-to-minimize modal flow");
  assert.ok(watchPage.includes('const restoringMiniPlayer = !isWatchRoomCinemaMode && overlay.classList.contains("is-minimized") && playerHasOpened'));
  assert.ok(watchPage.includes("if (restoringMiniPlayer)"));
  assert.ok(watchPage.includes('returnInlineButton?.addEventListener("click", () => roomPlayerLayout?.focus())'));
  assert.ok(watchPage.includes('vivid:watch-room-screening-validated'));
  assert.ok(watchPage.includes("watchRoomScreeningValidated = true"));
  assert.ok(watchPage.includes("watchRoomScreeningValidated) return"));
  assert.ok(watchPage.includes('secondaryRoot.classList.remove("is-minimized")'));
  assert.ok(playback.includes('document.body.dataset.vividPage === "watch-rooms" && !params.get("id")'));
  assert.ok(playback.includes('existingRoomId = isLobbyOnlyRoute ? "" : params.get("roomId")'));
  assert.ok(playback.includes('getWatchRoomPlaybackSnapshot'));
  assert.ok(voice.includes("getWatchRoomVoiceToken"));
  assert.ok(voice.includes("setMicrophoneEnabled"));
  assert.ok(voice.includes("VOICE_INTENT_KEY"));
  assert.ok(voice.includes("sessionStorage.setItem(VOICE_INTENT_KEY"));
  assert.ok(voice.includes("persistVoiceIntent(connectedRoomId, isMuted)"));
  assert.ok(lobby.includes("stop(false)"), "page lifecycle cleanup must not be treated as an intentional room leave");
  assert.ok(voice.includes('joinVoice({ restore: true, muted: intent.muted === true })'));
  assert.ok(voice.includes("clearVoiceIntent(connectedRoomId || activeRoom?.roomId)"));
  assert.ok(cinemaStyles.includes("aspect-ratio:16/9"));
  assert.ok(experienceStyles.includes("overflow-y:auto!important"));
  assert.ok(experienceStyles.includes("#player-overlay.is-floating"));
  assert.ok(experienceStyles.includes("#vivid-tflix-player"));
  assert.ok(experienceStyles.includes("#player-status"));
  assert.ok(experienceStyles.includes("aspect-ratio:16/9!important"));
  assert.ok(experienceStyles.includes("position:relative!important;top:auto!important"), "voice panel must flow with the room instead of sticking over the player");
  assert.ok(voice.includes("participantInitials(participant)"));
  assert.ok(voice.includes("is-speaking"));
  assert.ok(voice.includes("RoomEvent.TrackMuted"));
  assert.ok(voice.includes("RoomEvent.TrackUnmuted"));

  const roomStyles = await readFile(new URL("../styles/vivid-watch-rooms.css", import.meta.url), "utf8");
  assert.ok(roomStyles.includes(".vivid-wr-room-layout"));
  assert.ok(roomStyles.includes(".vivid-wr-room-tabs"));
  assert.ok(roomStyles.includes(".vivid-wr-linked-club-shelf"));
  assert.ok(roomStyles.includes(".vivid-wr-club-link-setting"));
  assert.ok(roomStyles.includes("overflow-y:auto!important"));
  assert.ok(!roomStyles.includes("body.vivid-wr-screening-open"), "obsolete full-screen lobby overlay styles should be removed");
  assert.ok(cinemaStyles.includes("#player-overlay[hidden]"));
  assert.ok(cinemaStyles.includes("body.vivid-watch-rooms-page.vivid-watch-room-mode .vivid-topbar{display:none!important}"));
  assert.ok(watchPage.includes("playerInfo.outerHTML = playerInfoMarkup()"));
  assert.ok(watchPage.includes('runtime + " min episode"'));
  assert.ok(watchPage.includes("TV episode scores stay episode-specific"));
  assert.ok(watchPage.includes("episode.vote_average : media?.vote_average"));
  assert.ok(watchPage.includes('vivid-player-rating'));
  assert.ok(watchPage.includes('TMDB'));
  assert.ok(watchPage.includes('vivid-player-genre-list'));
  assert.ok(watchPage.includes('vivid-player-fact'));
  assert.ok(watchPage.includes('production_companies'));
  assert.ok(watchPage.includes('number_of_episodes'));
  assert.ok(cinemaStyles.includes('.vivid-player-info::before'));
  assert.ok(cinemaStyles.includes('.vivid-player-rating'));
  assert.ok(cinemaStyles.includes('.vivid-player-fact'));
  assert.ok(rooms.includes('requestedParams.get("roomId")'));
  assert.ok(rooms.includes('document.dispatchEvent(new CustomEvent("vivid:watch-room-open"'));
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
