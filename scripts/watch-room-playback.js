import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { callWatchRoomApi } from "./watch-room-api.js";
import { getProviderAdapter, sendProviderCommand as sendAdapterCommand } from "./playback/provider-adapters.js";

let activePlayerId = "player1";
let activeProviderId = "vidapi";
const call = callWatchRoomApi;
let roomId = "";
let role = "";
let unsubscribePlayback = null;
let heartbeatTimer = null;
let latestRemoteState = null;
let joinedPlayback = false;
let localPosition = null;
let localStatus = "";
let hostStatus = "playing";
let lastPublishAt = 0;
let lastPublishedStatus = "";
let publishQueue = Promise.resolve();
let lastHostPayload = null;
let clockOffsetMs = 0;

const panel = document.createElement("section");
panel.className = "vivid-room-sync";
panel.id = "vivid-room-sync";
panel.innerHTML = '<div class="vivid-room-sync__head"><div><span class="vivid-room-sync__eyebrow">VIVID WATCH ROOMS</span><h2>Watch together</h2><p id="vivid-room-sync-note" role="status" aria-live="polite">Connect this title to a private screening.</p></div><span class="vivid-room-sync__provider">VidSrc sync</span></div><form id="vivid-room-sync-form" class="vivid-room-sync__form"><label for="vivid-room-sync-code">Room invitation code</label><div><input id="vivid-room-sync-code" name="inviteCode" maxlength="10" minlength="10" autocomplete="off" autocapitalize="characters" placeholder="10-character code" required><button type="submit">Connect room</button></div></form><div class="vivid-room-sync__actions"><button type="button" id="vivid-room-sync-join" hidden>Join synced playback</button><button type="button" id="vivid-room-sync-leave" hidden>Disconnect</button></div></section>';
document.querySelector("#watch-content")?.insertAdjacentElement("afterend", panel);
const note = document.getElementById("vivid-room-sync-note");
const form = document.getElementById("vivid-room-sync-form");
const joinButton = document.getElementById("vivid-room-sync-join");
const leaveButton = document.getElementById("vivid-room-sync-leave");
const setNote = message => { if (note) note.textContent = message; };

function getActiveAdapter() {
  return getProviderAdapter(activePlayerId, activeProviderId);
}

function getSupportedFrame() {
  const adapter = getActiveAdapter();
  const frame = document.getElementById(activePlayerId === "player2" ? "vivid-tflix-frame" : "vidapi-player");
  if (!adapter || !frame?.contentWindow || !frame.src) return null;
  try { return new URL(frame.src).origin === adapter.origin ? frame : null; } catch { return null; }
}

function sendProviderCommand(action, position) {
  const adapter = getActiveAdapter();
  const frame = getSupportedFrame();
  if (!adapter || !frame) return false;
  return sendAdapterCommand({ adapter, frame, action, position });
}

function stopConnection() {
  if (unsubscribePlayback) unsubscribePlayback();
  unsubscribePlayback = null;
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  roomId = ""; role = ""; latestRemoteState = null; joinedPlayback = false; localPosition = null; localStatus = ""; hostStatus = "playing"; lastPublishAt = 0; lastPublishedStatus = ""; publishQueue = Promise.resolve(); lastHostPayload = null; clockOffsetMs = 0;
  joinButton.hidden = true; leaveButton.hidden = true; form.hidden = false;
}

function sameTitle(state) {
  const current = new URLSearchParams(window.location.search);
  const id = String(current.get("id") || "");
  const type = current.get("type") === "tv" ? "tv" : "movie";
  if (String(state.contentId || "") !== id || state.mediaType !== type) return false;
  if (type === "tv" && (Number(state.season) !== Number(current.get("season") || 1) || Number(state.episode) !== Number(current.get("episode") || 1))) return false;
  return true;
}

function applyRemoteState(force = false) {
  const state = latestRemoteState;
  if (!state || role === "host" || !joinedPlayback) return;
  if (!sameTitle(state)) { setNote("This room is synced to a different title or episode. Open that exact Vivid title to join."); return; }
  if (state.provider !== activeProviderId) { setNote("The host is using " + String(state.provider || "another provider") + ". Select that same provider to join synchronized playback."); return; }
  const adapter = getActiveAdapter();
  if (!adapter?.capabilities.canPlay || !adapter.capabilities.canSeek) {
    setNote("Choose Player 1 · VidSrc first. This player/server does not have verified Watch Room controls.");
    return;
  }
  if (!getSupportedFrame()) { setNote("Choose VidSrc in the player’s server list first. Other providers are not enabled for room sync."); return; }
  const updatedAt = state.updatedAt?.toMillis?.() || Date.now();
  const elapsed = state.status === "playing" ? Math.max(0, (Date.now() + clockOffsetMs - updatedAt) / 1000) : 0;
  const expected = Math.max(0, Math.min(Number(state.duration) || 86400, Number(state.position) + elapsed));
  if (force || localPosition == null || Math.abs(expected - localPosition) > 2.5) {
    sendProviderCommand("seek", expected);
  }
  if (state.status === "playing" && localStatus !== "playing") sendProviderCommand("play");
  if ((state.status === "paused" || state.status === "ended") && localStatus === "playing") sendProviderCommand("pause");
  setNote("Connected to the host’s playback clock. Small timing differences are corrected automatically.");
}

async function connectToRoom(id) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("Sign in to your Vivid account before joining a Watch Room.");
  stopConnection();
  const membership = await getDoc(doc(db, "rooms", id, "members", user.uid));
  if (!membership.exists()) throw new Error("You are not a member of this Watch Room. Use a valid invitation code.");
  const memberData = membership.data();
  if (memberData.role !== "host" && memberData.role !== "guest") throw new Error("Your Watch Room membership is not valid.");
  roomId = id; role = memberData.role;
  form.hidden = true; leaveButton.hidden = false;
  joinButton.hidden = role === "host";
  setNote(role === "host" ? "You’re the host. Select VidSrc in the player; your playback becomes the room’s reference clock." : "Room connected. Start the same title with VidSrc, then tap Join synced playback.");
  const ping = async () => {
    const startedAt = Date.now();
    try {
      const result = await call("heartbeatWatchRoom")({ roomId });
      const finishedAt = Date.now();
      const serverTime = Number(result.data?.serverTime);
      if (Number.isFinite(serverTime)) clockOffsetMs = serverTime - ((startedAt + finishedAt) / 2);
    } catch (error) {
      setNote(error?.message || "Room presence could not refresh.");
    }
  };
  await ping(); heartbeatTimer = window.setInterval(ping, 30000);
  unsubscribePlayback = onSnapshot(doc(db, "rooms", roomId, "playback", "current"), snapshot => {
    if (!snapshot.exists()) { latestRemoteState = null; if (role !== "host") setNote("Connected. Waiting for the host to start playback."); return; }
    latestRemoteState = snapshot.data();
    if (role !== "host") applyRemoteState();
  }, error => setNote(error?.message || "Playback sync connection was interrupted."));
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const input = form.elements.inviteCode;
  const code = String(input.value || "").trim().toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(code)) { setNote("Enter the 10-character Watch Room invitation code."); return; }
  const button = form.querySelector("button"); button.disabled = true;
  try {
    const result = await call("redeemWatchInvitation")({ inviteCode: code, expectedTargetType: "room" });
    if (result.data.targetType !== "room") throw new Error("That code is for a Cinema Club, not a Watch Room.");
    await connectToRoom(result.data.targetId);
    const next = new URL(window.location.href); next.searchParams.set("roomId", result.data.targetId); window.history.replaceState({}, "", next);
  } catch (error) { setNote(error?.message || "Could not connect to that Watch Room."); }
  finally { button.disabled = false; }
});

joinButton.addEventListener("click", () => {
  if (!getSupportedFrame() || localPosition == null) { setNote("Select VidSrc and start playback first. Once Vivid detects the player clock, tap Join synced playback."); return; }
  joinedPlayback = true;
  if (latestRemoteState) applyRemoteState(true);
  else setNote("You’re connected. Waiting for the host’s first playback update.");
});
leaveButton.addEventListener("click", () => { stopConnection(); const next = new URL(window.location.href); next.searchParams.delete("roomId"); window.history.replaceState({}, "", next); setNote("Disconnected from the Watch Room. Your Vivid player is still available."); });

window.addEventListener("vivid:provider-playback", event => {
  const detail = event.detail || {};
  const vidsrcAdapter = getProviderAdapter("player1", "vidsrc");
  if (detail.provider !== "vidsrc" || detail.origin !== vidsrcAdapter?.origin) return;
  localPosition = Math.max(0, Number(detail.position) || 0);
  localStatus = detail.status === "playing" ? "playing" : detail.status === "paused" || detail.status === "ended" ? detail.status : localStatus;
  if (role !== "host" || !roomId) { if (role !== "host" && joinedPlayback) applyRemoteState(); return; }
  if (detail.status === "playing") hostStatus = "playing";
  if (detail.status === "paused") hostStatus = "paused";
  if (detail.status === "ended") hostStatus = "ended";
  const now = Date.now();
  // Throttle periodic playing heartbeats, but never drop a real pause/resume
  // transition just because it follows a recent progress update.
  if (detail.status === "playing" && lastPublishedStatus === "playing" && now - lastPublishAt < 3500) return;
  lastPublishAt = now;
  lastPublishedStatus = hostStatus;
  const payload = { roomId, provider: "vidsrc", status: hostStatus, contentId: String(detail.contentId || ""), mediaType: detail.mediaType, season: detail.season, episode: detail.episode, position: localPosition, duration: Math.max(0, Number(detail.duration) || 0) };
  lastHostPayload = payload;
  publishQueue = publishQueue.then(() => roomId === payload.roomId && role === "host" ? call("publishWatchRoomPlayback")(payload) : null).catch(error => setNote(error?.message || "Could not publish the host playback state."));
});

// CineSRC's documented bridge uses a separate command/event schema from VidSrc.
window.addEventListener("message", event => {
  const adapter = getProviderAdapter("player2", "cinesrc");
  const frame = document.getElementById("vivid-tflix-frame");
  if (!adapter || !frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== adapter.origin) return;
  const data = event.data;
  if (!data || typeof data.type !== "string" || !data.type.startsWith("cinesrc:")) return;
  const type = data.type;
  if (!["cinesrc:play", "cinesrc:pause", "cinesrc:timeupdate", "cinesrc:ended"].includes(type)) return;
  let status = localStatus;
  if (type === "cinesrc:play") status = "playing";
  else if (type === "cinesrc:pause") status = "paused";
  else if (type === "cinesrc:ended") status = "ended";
  if (type === "cinesrc:timeupdate" && status !== "playing") return;
  localPosition = Math.max(0, Number(data.currentTime) || 0);
  localStatus = status;
  const params = new URLSearchParams(window.location.search);
  window.dispatchEvent(new CustomEvent("vivid:provider-playback", { detail: {
    provider: "cinesrc",
    origin: event.origin,
    status,
    position: localPosition,
    duration: Math.max(0, Number(data.duration) || 0),
    contentId: String(params.get("id") || ""),
    mediaType: params.get("type") === "tv" ? "tv" : "movie",
    season: params.get("type") === "tv" ? Number(params.get("season") || 1) : null,
    episode: params.get("type") === "tv" ? Number(params.get("episode") || 1) : null
  }}));
});

window.addEventListener("vivid:player-adapter-selected", event => {
  const playerId = event.detail?.playerId;
  const providerId = event.detail?.providerId;
  if (!["player1", "player2"].includes(playerId) || typeof providerId !== "string") return;
  activePlayerId = playerId;
  activeProviderId = providerId;
  const adapter = getActiveAdapter();
  if (role === "host" && roomId && (!adapter || !adapter.capabilities.canPlay || !adapter.capabilities.canSeek)) {
    const state = lastHostPayload || latestRemoteState;
    if (state?.contentId && state?.mediaType) {
      const payload = { roomId, provider: "vidsrc", status: "paused", contentId: state.contentId, mediaType: state.mediaType, season: state.season, episode: state.episode, position: Math.max(0, Number(localPosition ?? state.position) || 0), duration: Number(state.duration) || 0 };
      hostStatus = "paused";
      lastHostPayload = payload;
      lastPublishAt = Date.now();
      lastPublishedStatus = "paused";
      publishQueue = publishQueue.then(() => roomId === payload.roomId && role === "host" ? call("publishWatchRoomPlayback")(payload) : null).catch(error => setNote(error?.message || "Could not pause room sync after changing players."));
    }
    setNote("Room playback is paused for this player/server because it has no verified remote-control bridge. Switch to Player 1 · VidSrc to resume synchronized screening.");
  } else if (role !== "host" && roomId && (!adapter || !adapter.capabilities.canPlay || !adapter.capabilities.canSeek)) {
    setNote("This player/server has no verified Watch Room control bridge. Switch to Player 1 · VidSrc to follow synchronized playback.");
  }
});

window.addEventListener("vivid:player-source-changed", event => {
  const source = event.detail?.source;
  if (source === "vidsrc") {
    if (role === "host") setNote("VidSrc is active. Your playback controls the room clock.");
    else if (roomId) setNote("VidSrc is active. Join synced playback when the player clock appears.");
    return;
  }
  if (role === "host" && roomId && (lastHostPayload || latestRemoteState?.provider === "vidsrc")) {
    hostStatus = "paused";
    const state = lastHostPayload || latestRemoteState;
    const payload = { roomId, provider: "vidsrc", status: "paused", contentId: state.contentId, mediaType: state.mediaType, season: state.season, episode: state.episode, position: Math.max(0, Number(localPosition ?? state.position) || 0), duration: Number(state.duration) || 0 };
    lastHostPayload = payload;
    lastPublishAt = Date.now();
    lastPublishedStatus = "paused";
    publishQueue = publishQueue.then(() => roomId === payload.roomId && role === "host" ? call("publishWatchRoomPlayback")(payload) : null).catch(error => setNote(error?.message || "Could not pause room sync after changing providers."));
    setNote("Room playback paused because this provider does not expose verified sync controls. Switch back to VidSrc to resume synchronization.");
  } else if (role !== "host" && roomId) {
    setNote("This provider is not enabled for room sync. Switch to VidSrc to follow the host.");
  }
});
onAuthStateChanged(auth, user => {
  if (!user || user.isAnonymous) { stopConnection(); setNote("Sign in to connect a private Watch Room."); form.querySelector("button").disabled = true; return; }
  form.querySelector("button").disabled = false;
  const existingRoomId = new URLSearchParams(window.location.search).get("roomId");
  if (existingRoomId && !roomId) connectToRoom(existingRoomId).catch(error => setNote(error?.message || "Could not reconnect to this Watch Room."));
});

window.addEventListener("pagehide", stopConnection);
window.addEventListener("pageshow", event => {
  if (!event.persisted || !auth.currentUser || auth.currentUser.isAnonymous) return;
  const restoredRoomId = new URLSearchParams(window.location.search).get("roomId");
  if (restoredRoomId && !roomId) connectToRoom(restoredRoomId).catch(error => setNote(error?.message || "Could not reconnect to this Watch Room."));
});