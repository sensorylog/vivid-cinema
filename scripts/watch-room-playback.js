import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { callWatchRoomApi } from "./watch-room-api.js";
import { getProviderAdapter, sendProviderCommand as sendAdapterCommand } from "./playback/provider-adapters.js";
import { getGuestPlaybackAction } from "./playback/watch-room-playback-policy.js";

let activePlayerId = "player1";
let activeProviderId = "vidapi";
let allowGuestPlayerSelection = false;
let allowGuestPlaybackControl = false;
let suppressPlaybackPublishUntil = 0;
let pendingPlayer2Seek = 0;
const call = callWatchRoomApi;
let roomId = "";
let role = "";
let playbackTimer = null;
let playbackRefreshInFlight = false;
let playbackConnectionGeneration = 0;
let playbackPollDelayMs = 2500;
let heartbeatTimer = null;
let selectionTimer = null;
let lastAppliedSelectionKey = "";
let roomPlayerLoadRequested = false;
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
panel.innerHTML = '<div class="vivid-room-sync__head"><div><span class="vivid-room-sync__eyebrow">VIVID WATCH ROOMS</span><h2>Watch together</h2><p id="vivid-room-sync-note" role="status" aria-live="polite">Connect this title to a private screening.</p></div><span class="vivid-room-sync__provider">Provider sync</span></div><form id="vivid-room-sync-form" class="vivid-room-sync__form"><label for="vivid-room-sync-code">Room invitation code</label><div><input id="vivid-room-sync-code" name="inviteCode" maxlength="10" minlength="10" autocomplete="off" autocapitalize="characters" placeholder="10-character code" required><button type="submit">Connect room</button></div></form><div id="vivid-room-sync-selection" class="vivid-room-sync__selection" hidden><p id="vivid-room-sync-selection-label">Room player selection</p><div id="vivid-room-sync-selection-controls"><label for="vivid-room-sync-player">Player</label><select id="vivid-room-sync-player"><option value="player1">Player 1</option><option value="player2">Player 2</option></select><label for="vivid-room-sync-provider">Server</label><select id="vivid-room-sync-provider"></select></div></div><div class="vivid-room-sync__actions"><button type="button" id="vivid-room-sync-join" hidden>Join synced playback</button><button type="button" id="vivid-room-sync-leave" hidden>Disconnect</button></div></section>';
document.querySelector("#watch-content")?.insertAdjacentElement("afterend", panel);
const note = document.getElementById("vivid-room-sync-note");
const form = document.getElementById("vivid-room-sync-form");
const joinButton = document.getElementById("vivid-room-sync-join");
const leaveButton = document.getElementById("vivid-room-sync-leave");
const selectionPanel = document.getElementById("vivid-room-sync-selection");
const selectionLabel = document.getElementById("vivid-room-sync-selection-label");
const selectionControls = document.getElementById("vivid-room-sync-selection-controls");
const playerSelect = document.getElementById("vivid-room-sync-player");
const providerSelect = document.getElementById("vivid-room-sync-provider");
const setNote = message => { if (note) note.textContent = message; };


const ROOM_PLAYER_OPTIONS = {
  player1: [["vidsrc", "VidSrc · synchronized"]],
  player2: [["cinesrc", "CineSRC · synchronized"]]
};

function populateRoomProviderOptions(playerId, selectedProviderId) {
  const options = ROOM_PLAYER_OPTIONS[playerId] || ROOM_PLAYER_OPTIONS.player1;
  providerSelect.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value; option.textContent = label;
    return option;
  }));
  providerSelect.value = options.some(([value]) => value === selectedProviderId) ? selectedProviderId : options[0][0];
}

function applyRoomPlayerSelection(room) {
  const playerId = room.selectedPlayerId === "player2" ? "player2" : "player1";
  const options = ROOM_PLAYER_OPTIONS[playerId];
  const requestedProviderId = String(room.selectedProviderId || options[0][0]);
  const providerId = options.some(([value]) => value === requestedProviderId) ? requestedProviderId : options[0][0];
  playerSelect.value = playerId;
  populateRoomProviderOptions(playerId, providerId);
  if (role === "host" && providerId !== requestedProviderId) {
    void saveRoomPlayerSelection();
  }
  selectionPanel.hidden = false;
  allowGuestPlayerSelection = room.allowGuestPlayerSelection === true;
  allowGuestPlaybackControl = room.allowGuestPlaybackControl === true;
  selectionControls.hidden = role !== "host" && !allowGuestPlayerSelection;
  selectionLabel.textContent = role === "host"
    ? "Choose the player and server for everyone in this room."
    : "Shared room selection: " + (playerId === "player1" ? "Player 1" : "Player 2") + " · " + providerId + ".";
  const key = playerId + ":" + providerId;
  if (key !== lastAppliedSelectionKey) {
    const position = Math.max(0, Number(localPosition ?? latestRemoteState?.position ?? lastHostPayload?.position) || 0);
    if (activePlayerId !== playerId || activeProviderId !== providerId) {
      sendProviderCommand("pause");
      localPosition = null;
      localStatus = "";
    }
    activePlayerId = playerId;
    activeProviderId = providerId;
    lastAppliedSelectionKey = key;
    if (playerId === "player2" && providerId === "cinesrc") pendingPlayer2Seek = position;
    if (role !== "guest" || (joinedPlayback && latestRemoteState?.status === "playing")) {
      roomPlayerLoadRequested = true;
      window.dispatchEvent(new CustomEvent("vivid:watch-room-apply-selection", {
        detail: { playerId, providerId, position }
      }));
    }
  }
}

async function refreshRoomPlayerSelection() {
  if (!roomId) return;
  const requestedRoomId = roomId;
  const requestGeneration = playbackConnectionGeneration;
  const response = await call("getWatchRoomLobbySnapshot")({ roomId: requestedRoomId });
  if (roomId !== requestedRoomId || requestGeneration !== playbackConnectionGeneration) return;
  const room = response.data?.room || {};
  const sessionId = String(room.activeScreening?.sessionId || "");
  const nextUrl = new URL(window.location.href);
  if (sessionId) nextUrl.searchParams.set("sessionId", sessionId);
  else nextUrl.searchParams.delete("sessionId");
  if (nextUrl.search !== window.location.search) window.history.replaceState({}, "", nextUrl);
  applyRoomPlayerSelection(room);
}

async function saveRoomPlayerSelection() {
  if (!roomId || (role !== "host" && !allowGuestPlayerSelection)) return;
  const playerId = playerSelect.value;
  const providerId = providerSelect.value;
  providerSelect.disabled = true;
  playerSelect.disabled = true;
  try {
    await call("setWatchRoomPlayerSelection")({ roomId, playerId, providerId });
    await refreshRoomPlayerSelection();
    setNote("Shared player selection saved. The room is switching to " + playerId + " · " + providerId + ".");
  } catch (error) {
    setNote(error?.message || "Could not update the room player selection.");
    try { await refreshRoomPlayerSelection(); } catch {}
  } finally {
    playerSelect.disabled = role !== "host" && !allowGuestPlayerSelection;
    providerSelect.disabled = role !== "host" && !allowGuestPlayerSelection;
  }
}

playerSelect.addEventListener("change", () => {
  populateRoomProviderOptions(playerSelect.value, ROOM_PLAYER_OPTIONS[playerSelect.value][0][0]);
  void saveRoomPlayerSelection();
});
providerSelect.addEventListener("change", () => { void saveRoomPlayerSelection(); });

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
  playbackConnectionGeneration += 1;
  if (playbackTimer) window.clearTimeout(playbackTimer);
  playbackTimer = null;
  playbackRefreshInFlight = false;
  playbackPollDelayMs = 2500;
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  if (selectionTimer) window.clearInterval(selectionTimer);
  heartbeatTimer = null; selectionTimer = null; lastAppliedSelectionKey = ""; roomPlayerLoadRequested = false;
  selectionPanel.hidden = true;
  roomId = ""; role = ""; allowGuestPlayerSelection = false; allowGuestPlaybackControl = false; suppressPlaybackPublishUntil = 0; latestRemoteState = null; joinedPlayback = false; localPosition = null; localStatus = ""; hostStatus = "playing"; lastPublishAt = 0; lastPublishedStatus = ""; publishQueue = Promise.resolve(); lastHostPayload = null; clockOffsetMs = 0;
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

function pauseGuestPlayer(message) {
  if (role !== "guest") return;
  sendProviderCommand("pause");
  localStatus = "paused";
  if (message) setNote(message);
}

function applyRemoteState(force = false) {
  const state = latestRemoteState;
  const controllerUid = state?.controllerUid || state?.hostUid;
  const currentUid = auth.currentUser?.uid;
  const delegatedHostFollow = role === "host" && allowGuestPlaybackControl && controllerUid && controllerUid !== currentUid;
  if (!state || controllerUid === currentUid || (!delegatedHostFollow && role === "host")) return;
  const guestAction = getGuestPlaybackAction({ role, joinedPlayback, playbackStatus: state.status });
  if (guestAction === "pause" && state.status === "playing") {
    pauseGuestPlayer("The host is playing. Tap Join synced playback when you’re ready to watch together.");
    return;
  }
  if (!sameTitle(state)) { setNote("This room is synced to a different title or episode. Open that exact Vivid title to join."); return; }
  if (state.provider !== activeProviderId) { setNote("The host is using " + String(state.provider || "another provider") + ". Select that same provider to join synchronized playback."); return; }
  const adapter = getActiveAdapter();
  if (!adapter?.capabilities.canPlay || !adapter.capabilities.canSeek) {
    setNote("Choose the same verified provider as the host. This player/server does not have Watch Room controls.");
    return;
  }
  const updatedAt = Number(state.updatedAt) || Date.now();
  const elapsed = state.status === "playing" ? Math.max(0, (Date.now() + clockOffsetMs - updatedAt) / 1000) : 0;
  const expected = Math.max(0, Math.min(Number(state.duration) || 86400, Number(state.position) + elapsed));
  if (!getSupportedFrame()) {
    if (role === "guest" && joinedPlayback && state.status === "playing" && !roomPlayerLoadRequested) {
      roomPlayerLoadRequested = true;
      window.dispatchEvent(new CustomEvent("vivid:watch-room-apply-selection", {
        detail: { playerId: activePlayerId, providerId: activeProviderId, position: expected }
      }));
    }
    setNote("Loading the shared player. Playback will follow the host.");
    return;
  }
  suppressPlaybackPublishUntil = Date.now() + 1800;
  if (force || localPosition == null || Math.abs(expected - localPosition) > 2.5) {
    sendProviderCommand("seek", expected);
  }
  if (state.status === "playing" && localStatus !== "playing") sendProviderCommand("play");
  if (state.status === "paused" || state.status === "ended") {
    sendProviderCommand("pause");
    localStatus = "paused";
  }
  setNote("Connected to the host’s playback clock. Small timing differences are corrected automatically.");
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
    if (role !== "host" || allowGuestPlaybackControl) {
      if (latestRemoteState) applyRemoteState();
      else if (role === "guest") pauseGuestPlayer("You’re in the room. Your player is held until the host starts the screening.");
    }
  } catch (error) {
    if (roomId === requestedRoomId && requestGeneration === playbackConnectionGeneration) {
      const errorCode = String(error?.code || "");
      if (role === "guest" && (errorCode.endsWith("permission-denied") || errorCode.endsWith("not-found"))) {
        pauseGuestPlayer("This Watch Room has ended or your membership was removed. Playback is paused.");
        stopConnection();
        setNote("The Watch Room is no longer active. Your player has been paused.");
        return;
      }
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
  const connectionGeneration = playbackConnectionGeneration;
  const initialStartedAt = Date.now();
  const snapshot = await call("getWatchRoomPlaybackSnapshot")({ roomId: id });
  const initialFinishedAt = Date.now();
  if (connectionGeneration !== playbackConnectionGeneration) return;
  const memberRole = snapshot.data?.role;
  if (memberRole !== "host" && memberRole !== "guest") throw new Error("Your Watch Room membership is not valid.");
  roomId = id;
  role = memberRole;
  // Watch Room guests follow the host automatically; the embedded cinema
  // route intentionally has no separate "join playback" panel or button.
  joinedPlayback = memberRole === "guest";
  latestRemoteState = snapshot.data?.playback || null;
  const initialServerTime = Number(snapshot.data?.serverTime);
  if (Number.isFinite(initialServerTime)) clockOffsetMs = initialServerTime - ((initialStartedAt + initialFinishedAt) / 2);
  form.hidden = true; leaveButton.hidden = false;
  joinButton.hidden = true;
  setNote(role === "host" ? "You’re the host. Select a room-compatible player; your playback becomes the room’s reference clock." : "Room connected. Your player will stay paused until the host starts the screening.");
  const ping = async () => {
    const startedAt = Date.now();
    try {
      const result = await call("heartbeatWatchRoom")({ roomId: id });
      const finishedAt = Date.now();
      if (roomId !== id || connectionGeneration !== playbackConnectionGeneration) return;
      const serverTime = Number(result.data?.serverTime);
      if (Number.isFinite(serverTime)) clockOffsetMs = serverTime - ((startedAt + finishedAt) / 2);
    } catch (error) {
      if (roomId === id && connectionGeneration === playbackConnectionGeneration) {
        setNote(error?.message || "Room presence could not refresh.");
      }
    }
  };
  await ping();
  if (roomId !== id || connectionGeneration !== playbackConnectionGeneration) return;
  heartbeatTimer = window.setInterval(ping, 30000);
  try { await refreshRoomPlayerSelection(); } catch (error) { setNote(error?.message || "Could not load the room player selection."); }
  selectionTimer = window.setInterval(() => { refreshRoomPlayerSelection().catch(error => setNote(error?.message || "Room player selection could not refresh.")); }, 5000);
  if (role === "guest") {
    if (latestRemoteState) applyRemoteState();
    else pauseGuestPlayer("You’re in the room. Waiting for the host to start the screening.");
  } else if (latestRemoteState && allowGuestPlaybackControl) applyRemoteState();
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
  joinedPlayback = true;
  if (latestRemoteState?.status === "playing") applyRemoteState(true);
  else setNote("You’re ready. Your player will load when the host starts playback.");
});
leaveButton.addEventListener("click", () => { stopConnection(); const next = new URL(window.location.href); next.searchParams.delete("roomId"); window.history.replaceState({}, "", next); setNote("Disconnected from the Watch Room. Your Vivid player is still available."); });

window.addEventListener("vivid:provider-playback", event => {
  const detail = event.detail || {};
  const eventAdapter = detail.provider === "cinesrc"
    ? getProviderAdapter("player2", "cinesrc")
    : detail.provider === "vidsrc" ? getProviderAdapter("player1", "vidsrc") : null;
  if (!eventAdapter || detail.origin !== eventAdapter.origin) return;
  localPosition = Math.max(0, Number(detail.position) || 0);
  localStatus = detail.status === "playing" ? "playing" : detail.status === "paused" || detail.status === "ended" ? detail.status : localStatus;
  if (!roomId || (role !== "host" && !allowGuestPlaybackControl)) { if (role !== "host" && joinedPlayback) applyRemoteState(); return; }
  if (Date.now() < suppressPlaybackPublishUntil) return;
  if (detail.status === "playing") hostStatus = "playing";
  if (detail.status === "paused") hostStatus = "paused";
  if (detail.status === "ended") hostStatus = "ended";
  const now = Date.now();
  // Throttle periodic playing heartbeats, but never drop a real pause/resume
  // transition just because it follows a recent progress update.
  if (detail.status === "playing" && lastPublishedStatus === "playing" && now - lastPublishAt < 3500) return;
  lastPublishAt = now;
  lastPublishedStatus = hostStatus;
  const sessionId = new URLSearchParams(window.location.search).get("sessionId") || "";
  const payload = { roomId, sessionId, provider: detail.provider, status: hostStatus, contentId: String(detail.contentId || ""), mediaType: detail.mediaType, season: detail.season, episode: detail.episode, position: localPosition, duration: Math.max(0, Number(detail.duration) || 0) };
  lastHostPayload = payload;
  publishQueue = publishQueue.then(() => roomId === payload.roomId && (role === "host" || allowGuestPlaybackControl) ? call("publishWatchRoomPlayback")(payload) : null).catch(error => setNote(error?.message || "Could not publish the room playback state."));
});

// CineSRC's documented bridge uses a separate command/event schema from VidSrc.
window.addEventListener("message", event => {
  const adapter = getProviderAdapter("player2", "cinesrc");
  const frame = document.getElementById("vivid-tflix-frame");
  if (!adapter || !frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== adapter.origin) return;
  const data = event.data;
  if (!data || typeof data.type !== "string" || !data.type.startsWith("cinesrc:")) return;
  const type = data.type;
  if (!["cinesrc:ready", "cinesrc:play", "cinesrc:pause", "cinesrc:timeupdate", "cinesrc:ended"].includes(type)) return;
  let status = localStatus;
  if (type === "cinesrc:play") status = "playing";
  else if (type === "cinesrc:pause") status = "paused";
  else if (type === "cinesrc:ended") status = "ended";
  if (type === "cinesrc:ready") {
    if (pendingPlayer2Seek > 0) {
      const position = pendingPlayer2Seek;
      pendingPlayer2Seek = 0;
      sendProviderCommand("seek", position);
    }
    if (role === "guest" && !joinedPlayback) pauseGuestPlayer("Your player is ready and paused. Waiting for the host to start the screening.");
    else if ((role !== "host" && joinedPlayback) || (role === "host" && allowGuestPlaybackControl)) applyRemoteState(true);
    return;
  }
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


window.addEventListener("vivid:player-frame-loaded", event => {
  const detail = event.detail || {};
  if (detail.playerId !== activePlayerId || detail.providerId !== activeProviderId) return;
  roomPlayerLoadRequested = false;
  if (role === "guest" && !joinedPlayback && (!latestRemoteState || latestRemoteState.status !== "playing")) {
    pauseGuestPlayer("Your player is ready and paused. Waiting for the host to start the screening.");
    return;
  }
  if ((role === "guest" && joinedPlayback) || (role === "host" && allowGuestPlaybackControl)) applyRemoteState(true);
  else if (role === "guest") pauseGuestPlayer("Your player is held until you join the shared screening.");
});

window.addEventListener("vivid:watch-room-selection-error", event => {
  const detail = event.detail || {};
  setNote("The selected " + String(detail.providerId || "server") + " is blocked or unavailable for this title on this device. Choose another server.");
});

window.addEventListener("vivid:player-adapter-ready", event => {
  const readyPlayerId = event.detail?.playerId;
  const [selectedPlayerId, providerId] = lastAppliedSelectionKey.split(":");
  if (!readyPlayerId || readyPlayerId !== selectedPlayerId || !providerId) return;
  window.dispatchEvent(new CustomEvent("vivid:watch-room-apply-selection", {
    detail: { playerId: selectedPlayerId, providerId, position: Number(latestRemoteState?.position) || 0 }
  }));
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
      const payload = { roomId, sessionId: new URLSearchParams(window.location.search).get("sessionId") || "", provider: state.provider || "vidsrc", status: "paused", contentId: state.contentId, mediaType: state.mediaType, season: state.season, episode: state.episode, position: Math.max(0, Number(localPosition ?? state.position) || 0), duration: Number(state.duration) || 0 };
      hostStatus = "paused";
      lastHostPayload = payload;
      lastPublishAt = Date.now();
      lastPublishedStatus = "paused";
      publishQueue = publishQueue.then(() => roomId === payload.roomId && role === "host" ? call("publishWatchRoomPlayback")(payload) : null).catch(error => setNote(error?.message || "Could not pause room sync after changing players."));
    }
    setNote("Room playback is paused for this player/server because it has no verified remote-control bridge. Switch to Player 1 · VidSrc or Player 2 · CineSRC to resume synchronized screening.");
  } else if (role !== "host" && roomId && (!adapter || !adapter.capabilities.canPlay || !adapter.capabilities.canSeek)) {
    setNote("This player/server has no verified Watch Room control bridge. Switch to the same supported provider as the host to follow synchronized playback.");
  } else if (role === "host" && roomId && playerId === "player2" && providerId === "cinesrc") {
    setNote("CineSRC is active. Its verified player controls and playback clock are connected to this room.");
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
    const payload = { roomId, sessionId: new URLSearchParams(window.location.search).get("sessionId") || "", provider: state.provider || "vidsrc", status: "paused", contentId: state.contentId, mediaType: state.mediaType, season: state.season, episode: state.episode, position: Math.max(0, Number(localPosition ?? state.position) || 0), duration: Number(state.duration) || 0 };
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
  const params = new URLSearchParams(window.location.search);
  const isLobbyOnlyRoute = document.body.dataset.vividPage === "watch-rooms" && !params.get("id");
  const existingRoomId = isLobbyOnlyRoute ? "" : params.get("roomId");
  if (existingRoomId && !roomId) connectToRoom(existingRoomId).catch(error => setNote(error?.message || "Could not reconnect to this Watch Room."));
});

window.addEventListener("pagehide", stopConnection);
window.addEventListener("pageshow", event => {
  if (!event.persisted || !auth.currentUser || auth.currentUser.isAnonymous) return;
  const params = new URLSearchParams(window.location.search);
  const isLobbyOnlyRoute = document.body.dataset.vividPage === "watch-rooms" && !params.get("id");
  const restoredRoomId = isLobbyOnlyRoute ? "" : params.get("roomId");
  if (restoredRoomId && !roomId) connectToRoom(restoredRoomId).catch(error => setNote(error?.message || "Could not reconnect to this Watch Room."));
});