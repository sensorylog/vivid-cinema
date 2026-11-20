import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { callWatchRoomApi } from "./watch-room-api.js";

const SUPPORTED_ORIGIN = "https://vidsrc.sh";
const call = callWatchRoomApi;
let roomId = "";
let role = "";
let playbackTimer = null;
let heartbeatTimer = null;
let playbackRefreshInFlight = false;
let playbackConnectionGeneration = 0;
let playbackPollDelayMs = 2500;
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
panel.innerHTML = '<div class="vivid-room-sync__head"><div><span class="vivid-room-sync__eyebrow">VIVID WATCH ROOMS</span><h2>Watch together</h2><p id="vivid-room-sync-note" role="status" aria-live="polite">Connect this title to a private screening.</p></div><span class="vivid-room-sync__provider">Room sync</span></div><form id="vivid-room-sync-form" class="vivid-room-sync__form"><label for="vivid-room-sync-code">Room invitation code</label><div><input id="vivid-room-sync-code" name="inviteCode" maxlength="10" minlength="10" autocomplete="off" autocapitalize="characters" placeholder="10-character code" required><button type="submit">Connect room</button></div></form><div class="vivid-room-sync__actions"><button type="button" id="vivid-room-sync-join" hidden>Join synced playback</button><button type="button" id="vivid-room-sync-leave" hidden>Disconnect</button></div></section>';
document.querySelector("#watch-content")?.insertAdjacentElement("afterend", panel);
const note = document.getElementById("vivid-room-sync-note");
const form = document.getElementById("vivid-room-sync-form");
const joinButton = document.getElementById("vivid-room-sync-join");
const leaveButton = document.getElementById("vivid-room-sync-leave");
const setNote = message => { if (note) note.textContent = message; };

function getSupportedFrame() {
  const frame = document.getElementById("vidapi-player");
  if (!frame?.contentWindow || !frame.src) return null;
  try { return new URL(frame.src).origin === SUPPORTED_ORIGIN ? frame : null; } catch { return null; }
}

function sendProviderCommand(action) {
  const frame = getSupportedFrame();
  if (!frame) return false;
  frame.contentWindow.postMessage({ player: true, action }, SUPPORTED_ORIGIN);
  return true;
}

function stopConnection() {
  playbackConnectionGeneration += 1;
  if (playbackTimer) window.clearTimeout(playbackTimer);
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  playbackTimer = null;
  heartbeatTimer = null;
  playbackRefreshInFlight = false;
  playbackPollDelayMs = 2500;
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
  if (!getSupportedFrame()) { setNote("Choose the room-compatible player in the server list first. Other providers are not enabled for room sync."); return; }
  const updatedAt = Number(state.updatedAt) || Date.now();
  const elapsed = state.status === "playing" ? Math.max(0, (Date.now() + clockOffsetMs - updatedAt) / 1000) : 0;
  const expected = Math.max(0, Math.min(Number(state.duration) || 86400, Number(state.position) + elapsed));
  if (force || localPosition == null || Math.abs(expected - localPosition) > 2.5) {
    sendProviderCommand("seek" + Math.floor(expected));
  }
  if (state.status === "playing" && localStatus !== "playing") sendProviderCommand("play");
  if ((state.status === "paused" || state.status === "ended") && localStatus === "playing") sendProviderCommand("pause");
  setNote("Connected to the host’s playback clock. Timing differences are corrected automatically.");
}

function schedulePlaybackRefresh(delay = playbackPollDelayMs) {
  if (!roomId) return;
  if (playbackTimer) window.clearTimeout(playbackTimer);
  playbackTimer = window.setTimeout(() => {
    playbackTimer = null;
    void refreshPlayback();
  }, delay);
}

async function refreshPlayback() {
  if (!roomId || playbackRefreshInFlight) return;
  const requestedRoomId = roomId;
  const requestGeneration = playbackConnectionGeneration;
  const startedAt = Date.now();
  playbackRefreshInFlight = true;
  try {
    const result = await call("getWatchRoomPlaybackSnapshot")({ roomId: requestedRoomId });
    const finishedAt = Date.now();
    playbackPollDelayMs = 2500;
    if (roomId !== requestedRoomId || requestGeneration !== playbackConnectionGeneration) return;
    const serverTime = Number(result.data?.serverTime);
    if (Number.isFinite(serverTime)) clockOffsetMs = serverTime - ((startedAt + finishedAt) / 2);
    latestRemoteState = result.data?.playback || null;
    if (role !== "host") {
      if (latestRemoteState) applyRemoteState();
      else setNote("Room connected. Waiting for the host to start playback.");
    }
  } catch (error) {
    if (roomId === requestedRoomId && requestGeneration === playbackConnectionGeneration) {
      playbackPollDelayMs = Math.min(15000, Math.max(2500, playbackPollDelayMs * 2));
      setNote(error?.message || "Playback sync connection was interrupted. Retrying automatically.");
    }
  } finally {
    if (requestGeneration === playbackConnectionGeneration) {
      playbackRefreshInFlight = false;
      schedulePlaybackRefresh();
    }
  }
}

async function connectToRoom(id) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("Sign in to your Vivid account before joining a Watch Room.");
  stopConnection();
  const result = await call("getWatchRoomPlaybackSnapshot")({ roomId: id });
  const memberRole = result.data?.role;
  if (memberRole !== "host" && memberRole !== "guest") throw new Error("Your Watch Room membership is not valid.");
  roomId = id; role = memberRole;
  latestRemoteState = result.data?.playback || null;
  const initialServerTime = Number(result.data?.serverTime);
  if (Number.isFinite(initialServerTime)) clockOffsetMs = initialServerTime - Date.now();
  form.hidden = true; leaveButton.hidden = false;
  joinButton.hidden = role === "host";
  setNote(role === "host" ? "You’re the host. Select a room-compatible player; your playback becomes the room’s reference clock." : "Room connected. Open the same title and player, then tap Join synced playback.");
  const ping = async () => {
    const startedAt = Date.now();
    try {
      const heartbeat = await call("heartbeatWatchRoom")({ roomId });
      const finishedAt = Date.now();
      const serverTime = Number(heartbeat.data?.serverTime);
      if (Number.isFinite(serverTime)) clockOffsetMs = serverTime - ((startedAt + finishedAt) / 2);
    } catch (error) {
      setNote(error?.message || "Room presence could not refresh.");
    }
  };
  await ping();
  await refreshPlayback();
  heartbeatTimer = window.setInterval(ping, 30000);
  schedulePlaybackRefresh();
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
  if (!getSupportedFrame() || localPosition == null) { setNote("Select the room-compatible player and start playback first. Once Vivid detects the player clock, tap Join synced playback."); return; }
  joinedPlayback = true;
  if (latestRemoteState) applyRemoteState(true);
  else setNote("You’re connected. Waiting for the host’s first playback update.");
});
leaveButton.addEventListener("click", () => { stopConnection(); const next = new URL(window.location.href); next.searchParams.delete("roomId"); window.history.replaceState({}, "", next); setNote("Disconnected from the Watch Room. Your Vivid player is still available."); });

window.addEventListener("vivid:provider-playback", event => {
  const detail = event.detail || {};
  if (detail.provider !== "vidsrc" || detail.origin !== SUPPORTED_ORIGIN) return;
  localPosition = Math.max(0, Number(detail.position) || 0);
  localStatus = detail.status === "playing" ? "playing" : detail.status === "paused" || detail.status === "ended" ? detail.status : localStatus;
  if (role !== "host" || !roomId) { if (role !== "host" && joinedPlayback) applyRemoteState(); return; }
  if (detail.status === "playing") hostStatus = "playing";
  if (detail.status === "paused") hostStatus = "paused";
  if (detail.status === "ended") hostStatus = "ended";
  const now = Date.now();
  if (detail.status === "playing" && lastPublishedStatus === "playing" && now - lastPublishAt < 3500) return;
  lastPublishAt = now;
  lastPublishedStatus = hostStatus;
  const payload = { roomId, provider: "vidsrc", status: hostStatus, contentId: String(detail.contentId || ""), mediaType: detail.mediaType, season: detail.season, episode: detail.episode, position: localPosition, duration: Math.max(0, Number(detail.duration) || 0) };
  lastHostPayload = payload;
  publishQueue = publishQueue.then(() => roomId === payload.roomId && role === "host" ? call("publishWatchRoomPlayback")(payload) : null).catch(error => setNote(error?.message || "Could not publish the host playback state."));
});

window.addEventListener("vivid:player-source-changed", event => {
  const source = event.detail?.source;
  if (source === "vidsrc") {
    if (role === "host") setNote("Room-compatible player is active. Your playback controls the room clock.");
    else if (roomId) setNote("Room-compatible player is active. Join synced playback when the player clock appears.");
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
    setNote("Room playback paused because this provider does not expose verified sync controls. Switch back to the room-compatible player to resume synchronization.");
  } else if (role !== "host" && roomId) {
    setNote("This provider is not enabled for room sync. Switch to the room-compatible player to follow the host.");
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
