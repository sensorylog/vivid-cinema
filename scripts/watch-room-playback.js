import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { classifyPlaybackEvent, getEstimatedLocalPlaybackPosition, getExpectedPlaybackPosition, isPlaybackRevisionStale, normalizePlaybackRate, normalizePlaybackTimestamp, shouldCorrectPlayback } from "./playback/watch-room-sync.js";
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
let playbackUnsubscribe = null;
let playbackSubscriptionRetryTimer = null;
let playbackSubscriptionRetryDelayMs = 1000;
let playbackRevision = 0;
let playbackSessionId = "";
let playbackConnectionGeneration = 0;
let heartbeatTimer = null;
let selectionTimer = null;
let syncReconcileTimer = null;
let localPositionObservedAt = 0;
let lastCommandedStatus = "";
let lastCommandAt = 0;
let lastSeekCommandAt = 0;
let pendingPlaySince = 0;
let localPlaybackRate = 1;
let hostPlaybackRate = 1;
let lastRateCommandAt = 0;
let lastAppliedSelectionKey = "";
let loadedScreeningSessionId = "";
let roomPlayerLoadRequested = false;
let latestRemoteState = null;
let joinedPlayback = false;
let localPosition = null;
let localStatus = "";
let hostStatus = "paused";
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
const setNote = message => { if (note && note.textContent !== message) note.textContent = message; };


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
  const screeningSessionId = String(room.activeScreening?.sessionId || "");
  const hasActiveScreening = Boolean(screeningSessionId);
  if (key !== lastAppliedSelectionKey || (hasActiveScreening && loadedScreeningSessionId !== screeningSessionId)) {
    const position = Math.max(0, Number(localPosition ?? latestRemoteState?.position ?? lastHostPayload?.position) || 0);
    if (activePlayerId !== playerId || activeProviderId !== providerId) {
      sendProviderCommand("pause");
      localPosition = null;
      localPositionObservedAt = 0;
      localStatus = "";
      lastCommandedStatus = "";
      pendingPlaySince = 0;
      localPlaybackRate = 1;
      hostPlaybackRate = 1;
      lastRateCommandAt = 0;
    }
    activePlayerId = playerId;
    activeProviderId = providerId;
    lastAppliedSelectionKey = key;
    if (playerId === "player2" && providerId === "cinesrc") pendingPlayer2Seek = position;
    if (hasActiveScreening && (role !== "guest" || joinedPlayback)) {
      loadedScreeningSessionId = screeningSessionId;
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

function sendProviderCommand(action, position, rate) {
  const adapter = getActiveAdapter();
  const frame = getSupportedFrame();
  if (!adapter || !frame) return false;
  return sendAdapterCommand({ adapter, frame, action, position, rate });
}

function stopConnection() {
  playbackConnectionGeneration += 1;
  if (playbackUnsubscribe) playbackUnsubscribe();
  playbackUnsubscribe = null;
  if (playbackSubscriptionRetryTimer) window.clearTimeout(playbackSubscriptionRetryTimer);
  playbackSubscriptionRetryTimer = null;
  playbackSubscriptionRetryDelayMs = 1000;
  playbackRevision = 0;
  playbackSessionId = "";
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  if (selectionTimer) window.clearInterval(selectionTimer);
  heartbeatTimer = null; selectionTimer = null; if (syncReconcileTimer) window.clearInterval(syncReconcileTimer); syncReconcileTimer = null; lastAppliedSelectionKey = ""; loadedScreeningSessionId = ""; roomPlayerLoadRequested = false;
  selectionPanel.hidden = true;
  roomId = ""; role = ""; allowGuestPlayerSelection = false; allowGuestPlaybackControl = false; suppressPlaybackPublishUntil = 0; latestRemoteState = null; joinedPlayback = false; localPosition = null; localPositionObservedAt = 0; localStatus = ""; hostStatus = "paused"; lastPublishAt = 0; lastPublishedStatus = ""; lastCommandedStatus = ""; lastCommandAt = 0; lastSeekCommandAt = 0; pendingPlaySince = 0; localPlaybackRate = 1; hostPlaybackRate = 1; lastRateCommandAt = 0; publishQueue = Promise.resolve(); lastHostPayload = null; clockOffsetMs = 0;
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
  lastCommandedStatus = "paused";
  lastCommandAt = Date.now();
  pendingPlaySince = 0;
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
    pauseGuestPlayer("Your player is held until you open the active room screening.");
    return;
  }
  if (!sameTitle(state)) { setNote("This room is synced to a different title or episode. Open that exact Vivid title to join."); return; }
  if (state.provider !== activeProviderId) { setNote("The host is using " + String(state.provider || "another provider") + ". Select that same provider to join synchronized playback."); return; }
  const adapter = getActiveAdapter();
  if (!adapter?.capabilities.canPlay || !adapter.capabilities.canSeek || !adapter.capabilities.canSetRate) {
    setNote("Choose the same verified provider as the host. This player/server does not have Watch Room controls.");
    return;
  }
  const now = Date.now();
  const desiredRate = normalizePlaybackRate(state.playbackRate);
  const expected = getExpectedPlaybackPosition(state, { nowMs: now, clockOffsetMs });
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

  const estimatedLocalPosition = getEstimatedLocalPlaybackPosition({
    position: localPosition,
    status: localStatus,
    duration: state.duration,
    playbackRate: localPlaybackRate,
    observedAtMs: localPositionObservedAt
  }, { nowMs: now });
  const rateMismatch = Math.abs(desiredRate - localPlaybackRate) > 0.05;
  if (rateMismatch && now - lastRateCommandAt >= 1500) {
    suppressPlaybackPublishUntil = Math.max(suppressPlaybackPublishUntil, now + 1800);
    if (sendProviderCommand("rate", undefined, desiredRate)) {
      localPlaybackRate = desiredRate;
      lastRateCommandAt = now;
    }
  }
  const needsSeek = force || shouldCorrectPlayback(expected, estimatedLocalPosition);
  if (needsSeek && (force || now - lastSeekCommandAt >= 1500)) {
    if (sendProviderCommand("seek", expected)) lastSeekCommandAt = now;
  }

  const desiredStatus = state.status === "playing" ? "playing" : "paused";
  const statusMatches = desiredStatus === "playing"
    ? localStatus === "playing"
    : localStatus === "paused" || localStatus === "ended";
  if (needsSeek || !statusMatches) suppressPlaybackPublishUntil = Math.max(suppressPlaybackPublishUntil, now + 1800);
  if (desiredStatus !== "playing") pendingPlaySince = 0;
  const retryStatusCommand = lastCommandedStatus !== desiredStatus || now - lastCommandAt >= 2500;
  if (!statusMatches && retryStatusCommand && sendProviderCommand(desiredStatus === "playing" ? "play" : "pause")) {
    lastCommandedStatus = desiredStatus;
    lastCommandAt = now;
    if (desiredStatus === "playing" && !pendingPlaySince) pendingPlaySince = now;
  }

  if (desiredStatus === "playing" && localStatus !== "playing" && pendingPlaySince > 0 && now - pendingPlaySince >= 3500) {
    setNote("Waiting for playback permission on this device. Tap Play once in the player; Vivid will then keep you synced automatically.");
    return;
  }
  setNote("Connected to the host’s playback clock. Playback position and controls are being kept in sync.");
}

function applyPlaybackSnapshot(state, requestedRoomId, requestGeneration) {
  if (roomId !== requestedRoomId || requestGeneration !== playbackConnectionGeneration) return;
  const activeSessionId = new URLSearchParams(window.location.search).get("sessionId") || "";
  if (state && activeSessionId && state.sessionId !== activeSessionId) {
    latestRemoteState = null;
    if (role === "guest") pauseGuestPlayer("The room has moved to another screening. Waiting for its playback state.");
    setNote("The room is preparing a new screening. Playback will synchronize when it starts.");
    return;
  }
  const revision = Number(state?.revision) || 0;
  if (state && isPlaybackRevisionStale(revision, playbackRevision)) return;
  playbackRevision = Math.max(playbackRevision, revision);
  latestRemoteState = state ? {
    ...state,
    updatedAt: normalizePlaybackTimestamp(state.updatedAt)
  } : null;
  if (role !== "host" || allowGuestPlaybackControl) {
    if (latestRemoteState) applyRemoteState();
    else if (role === "guest") pauseGuestPlayer("You’re in the room. Your player is held until the host starts the screening.");
  }
}

async function refreshPlaybackSnapshot() {
  if (!roomId) return;
  const requestedRoomId = roomId;
  const requestGeneration = playbackConnectionGeneration;
  const startedAt = Date.now();
  try {
    const result = await call("getWatchRoomPlaybackSnapshot")({ roomId: requestedRoomId });
    const finishedAt = Date.now();
    if (roomId !== requestedRoomId || requestGeneration !== playbackConnectionGeneration) return;
    const serverTime = Number(result.data?.serverTime);
    if (Number.isFinite(serverTime)) clockOffsetMs = serverTime - ((startedAt + finishedAt) / 2);
    applyPlaybackSnapshot(result.data?.playback || null, requestedRoomId, requestGeneration);
  } catch (error) {
    if (roomId === requestedRoomId && requestGeneration === playbackConnectionGeneration) {
      setNote(error?.message || "Could not refresh the shared playback clock.");
    }
  }
}

function subscribeToPlayback(requestedRoomId, requestGeneration) {
  if (!requestedRoomId || roomId !== requestedRoomId || requestGeneration !== playbackConnectionGeneration || playbackUnsubscribe) return;
  try {
    playbackUnsubscribe = onSnapshot(
      doc(db, "rooms", requestedRoomId, "playback", "current"),
      { includeMetadataChanges: true },
      snapshot => {
        if (roomId !== requestedRoomId || requestGeneration !== playbackConnectionGeneration) return;
        if (snapshot.metadata?.fromCache) {
          if (!latestRemoteState) setNote("Restoring the live playback connection…");
          return;
        }
        playbackSubscriptionRetryDelayMs = 1000;
        applyPlaybackSnapshot(snapshot.exists() ? snapshot.data() : null, requestedRoomId, requestGeneration);
      },
      error => {
        if (roomId !== requestedRoomId || requestGeneration !== playbackConnectionGeneration) return;
        playbackUnsubscribe = null;
        const code = String(error?.code || "");
        if (code.endsWith("permission-denied") || code.endsWith("not-found")) {
          if (role === "guest") pauseGuestPlayer("Your Watch Room membership is no longer active. Playback has been paused.");
          stopConnection();
          setNote("This Watch Room is no longer available to your account.");
          return;
        }
        setNote("The live playback connection was interrupted. Vivid is reconnecting automatically.");
        const delay = playbackSubscriptionRetryDelayMs;
        playbackSubscriptionRetryDelayMs = Math.min(30000, playbackSubscriptionRetryDelayMs * 2);
        if (playbackSubscriptionRetryTimer) window.clearTimeout(playbackSubscriptionRetryTimer);
        playbackSubscriptionRetryTimer = window.setTimeout(() => {
          playbackSubscriptionRetryTimer = null;
          subscribeToPlayback(requestedRoomId, requestGeneration);
        }, delay);
      }
    );
  } catch (error) {
    setNote(error?.message || "Could not start the live playback connection.");
  }
}

async function publishRoomPlayback(payload) {
  const send = async () => call("publishWatchRoomPlayback")({
    ...payload,
    capturedAtMs: payload.positionAtMs,
    expectedRevision: playbackRevision
  });
  let result = await send();
  let data = result?.data || {};
  if (data.accepted === true || data.reason === "rate-limited") {
    playbackRevision = Math.max(playbackRevision, Number(data.revision) || 0);
    return result;
  }
  if (data.reason !== "stale-revision") return result;

  // A second controller may have committed first. Rebase once on the trusted
  // snapshot, then retry the newest queued local event against that revision.
  const fresh = await call("getWatchRoomPlaybackSnapshot")({ roomId: payload.roomId });
  if (roomId !== payload.roomId || fresh.data?.playback?.sessionId !== payload.sessionId) return null;
  const latest = fresh.data.playback;
  playbackRevision = Number(latest.revision) || 0;
  latestRemoteState = { ...latest, updatedAt: normalizePlaybackTimestamp(latest.updatedAt) };
  result = await send();
  data = result?.data || {};
  playbackRevision = Math.max(playbackRevision, Number(data.revision) || 0);
  return result;
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
  playbackRevision = Number(latestRemoteState?.revision) || 0;
  playbackSessionId = String(latestRemoteState?.sessionId || new URLSearchParams(window.location.search).get("sessionId") || "");
  const initialServerTime = Number(snapshot.data?.serverTime);
  if (Number.isFinite(initialServerTime)) clockOffsetMs = initialServerTime - ((initialStartedAt + initialFinishedAt) / 2);
  subscribeToPlayback(id, connectionGeneration);
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
  if (role === "guest" || role === "host") {
    syncReconcileTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && latestRemoteState) applyRemoteState();
    }, 2000);
  }
  try { await refreshRoomPlayerSelection(); } catch (error) { setNote(error?.message || "Could not load the room player selection."); }
  selectionTimer = window.setInterval(() => { refreshRoomPlayerSelection().catch(error => setNote(error?.message || "Room player selection could not refresh.")); }, 5000);
  if (role === "guest") {
    if (latestRemoteState) applyRemoteState();
    else pauseGuestPlayer("You’re in the room. Waiting for the host to start the screening.");
  } else if (latestRemoteState && allowGuestPlaybackControl) applyRemoteState();
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
  const previousLocalStatus = localStatus;
  const previousLocalPosition = localPosition;
  const previousLocalPositionObservedAt = localPositionObservedAt;
  const now = Date.now();
  localPosition = Math.max(0, Number(detail.position) || 0);
  localPositionObservedAt = now;
  localStatus = detail.status === "playing" ? "playing" : detail.status === "paused" || detail.status === "ended" ? detail.status : localStatus;
  if (localStatus === "playing" || localStatus === "paused" || localStatus === "ended") {
    lastCommandedStatus = localStatus === "playing" ? "playing" : "paused";
    pendingPlaySince = 0;
  }
  if (role === "guest" && !allowGuestPlaybackControl) {
    if (latestRemoteState) applyRemoteState();
    else if (detail.status === "playing") pauseGuestPlayer("Your player is prepared. It will start automatically with the host’s screening.");
    return;
  }
  if (!roomId) return;
  if (Date.now() < suppressPlaybackPublishUntil) return;
  if (detail.status === "playing") hostStatus = "playing";
  if (detail.status === "paused") hostStatus = "paused";
  if (detail.status === "ended") hostStatus = "ended";
  let eventType = classifyPlaybackEvent({
    event: detail.event || detail.status,
    status: detail.status,
    previousStatus: previousLocalStatus
  });
  const reportedRate = Number(detail.playbackRate);
  if (Number.isFinite(reportedRate) && reportedRate >= 0.25 && reportedRate <= 4) {
    localPlaybackRate = normalizePlaybackRate(reportedRate);
    if (role === "host" || allowGuestPlaybackControl) hostPlaybackRate = localPlaybackRate;
    eventType = "rate";
  } else if (role === "guest" && eventType === "play") {
    // The first local play gesture may be required to unlock provider commands.
    // Re-apply the room's speed immediately after that gesture.
    localPlaybackRate = 1;
  } else if (eventType === "progress" && previousLocalStatus === "playing" &&
      previousLocalPosition != null && previousLocalPositionObservedAt > 0) {
    const elapsedSeconds = (now - previousLocalPositionObservedAt) / 1000;
    const measuredRate = elapsedSeconds > 0
      ? (localPosition - previousLocalPosition) / elapsedSeconds
      : 0;
    if (measuredRate >= 0.25 && measuredRate <= 4) {
      const commonRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
      const nearestRate = commonRates.reduce((best, rate) =>
        Math.abs(rate - measuredRate) < Math.abs(best - measuredRate) ? rate : best, commonRates[0]);
      const tolerance = nearestRate === 1 ? 0.08 : 0.16;
      if (Math.abs(nearestRate - measuredRate) <= tolerance) {
        localPlaybackRate = nearestRate;
        if ((role === "host" || allowGuestPlaybackControl) && nearestRate !== hostPlaybackRate) {
          hostPlaybackRate = nearestRate;
          eventType = "rate";
        }
      }
    }
  }
  // Only progress heartbeats are coalesced. Play, pause, seek, rate and ended
  // transitions must reach the room immediately, even after a recent tick.
  if (eventType === "progress" && now - lastPublishAt < 3500) return;
  lastPublishAt = now;
  lastPublishedStatus = hostStatus;
  const sessionId = new URLSearchParams(window.location.search).get("sessionId") || "";
  const payload = { roomId, sessionId, provider: detail.provider, eventType, status: hostStatus, contentId: String(detail.contentId || ""), mediaType: detail.mediaType, season: detail.season, episode: detail.episode, position: localPosition, positionAtMs: now + clockOffsetMs, playbackRate: hostPlaybackRate, duration: Math.max(0, Number(detail.duration) || 0) };
  lastHostPayload = payload;
  publishQueue = publishQueue.then(() => roomId === payload.roomId && (role === "host" || allowGuestPlaybackControl) ? publishRoomPlayback(payload) : null).catch(error => setNote(error?.message || "Could not publish the room playback state."));
});

// CineSRC's documented bridge uses a separate command/event schema from VidSrc.
window.addEventListener("message", event => {
  const adapter = getProviderAdapter("player2", "cinesrc");
  const frame = document.getElementById("vivid-tflix-frame");
  if (!adapter || !frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== adapter.origin) return;
  const data = event.data;
  if (!data || typeof data.type !== "string" || !data.type.startsWith("cinesrc:")) return;
  const type = data.type;
  if (!["cinesrc:ready", "cinesrc:play", "cinesrc:pause", "cinesrc:timeupdate", "cinesrc:seeked", "cinesrc:ratechange", "cinesrc:ended"].includes(type)) return;
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
    if (role === "guest" && (!latestRemoteState || latestRemoteState.status !== "playing")) {
      pauseGuestPlayer("Your player is ready. Tap Play once to prepare it; it will pause and follow the host.");
    } else if ((role !== "host" && joinedPlayback) || (role === "host" && allowGuestPlaybackControl)) applyRemoteState(true);
    return;
  }
  if (type === "cinesrc:timeupdate" && status !== "playing") return;
  const reportedPosition = Number(data.currentTime);
  if (Number.isFinite(reportedPosition) && reportedPosition >= 0) {
    localPosition = reportedPosition;
    localPositionObservedAt = Date.now();
  }
  localStatus = status;
  const params = new URLSearchParams(window.location.search);
  window.dispatchEvent(new CustomEvent("vivid:provider-playback", { detail: {
    provider: "cinesrc",
    origin: event.origin,
    event: type.slice("cinesrc:".length),
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
  if (role === "guest" && (!latestRemoteState || latestRemoteState.status !== "playing")) {
    pauseGuestPlayer("Your player is ready. Tap Play once to prepare it; it will pause and follow the host.");
    return;
  }
  if ((role === "guest" && joinedPlayback) || (role === "host" && allowGuestPlaybackControl)) applyRemoteState(true);
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
      publishQueue = publishQueue.then(() => roomId === payload.roomId && role === "host" ? publishRoomPlayback(payload) : null).catch(error => setNote(error?.message || "Could not pause room sync after changing players."));
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
    else if (roomId) setNote("VidSrc is active. Your player will follow the host automatically; tap Play once if your browser blocks playback.");
    return;
  }
  if (role === "host" && roomId && (lastHostPayload || latestRemoteState?.provider === "vidsrc")) {
    hostStatus = "paused";
    const state = lastHostPayload || latestRemoteState;
    const payload = { roomId, sessionId: new URLSearchParams(window.location.search).get("sessionId") || "", provider: state.provider || "vidsrc", status: "paused", contentId: state.contentId, mediaType: state.mediaType, season: state.season, episode: state.episode, position: Math.max(0, Number(localPosition ?? state.position) || 0), duration: Number(state.duration) || 0 };
    lastHostPayload = payload;
    lastPublishAt = Date.now();
    lastPublishedStatus = "paused";
    publishQueue = publishQueue.then(() => roomId === payload.roomId && role === "host" ? publishRoomPlayback(payload) : null).catch(error => setNote(error?.message || "Could not pause room sync after changing providers."));
    setNote("Room playback paused because this provider does not expose verified sync controls. Switch back to VidSrc to resume synchronization.");
  } else if (role !== "host" && roomId) {
    setNote("This provider is not enabled for room sync. Switch to VidSrc to follow the host.");
  }
});
document.addEventListener("vivid:watch-room-closing", event => {
  const closingRoomId = String(event.detail?.roomId || "");
  if (closingRoomId && roomId === closingRoomId) stopConnection();
});

document.addEventListener("vivid:watch-room-screening-navigate", event => {
  const requestedRoomId = String(event.detail?.roomId || "");
  const requestedSessionId = String(event.detail?.screening?.sessionId || "");
  if (!requestedRoomId) return;
  if (roomId === requestedRoomId && playbackUnsubscribe) {
    if (requestedSessionId && requestedSessionId !== playbackSessionId) {
      // A new film in the same room starts a fresh playback revision sequence.
      playbackSessionId = requestedSessionId;
      playbackRevision = 0;
      latestRemoteState = null;
      localPosition = null;
      localPositionObservedAt = 0;
      localStatus = "";
      lastCommandedStatus = "";
      lastCommandAt = 0;
      lastSeekCommandAt = 0;
      pendingPlaySince = 0;
      localPlaybackRate = 1;
      hostPlaybackRate = 1;
      lastRateCommandAt = 0;
      hostStatus = "paused";
      lastPublishAt = 0;
      lastPublishedStatus = "";
      lastHostPayload = null;
    }
    void refreshRoomPlayerSelection().catch(error => setNote(error?.message || "Could not refresh the new screening's player selection."));
    return;
  }
  connectToRoom(requestedRoomId).catch(error => setNote(error?.message || "Could not connect playback to the active Watch Room."));
});

onAuthStateChanged(auth, user => {
  if (!user || user.isAnonymous) { stopConnection(); setNote("Sign in to connect a private Watch Room."); form.querySelector("button").disabled = true; return; }
  form.querySelector("button").disabled = false;
  const params = new URLSearchParams(window.location.search);
  const isLobbyOnlyRoute = document.body.dataset.vividPage === "watch-rooms" && !params.get("id");
  const existingRoomId = isLobbyOnlyRoute ? "" : params.get("roomId");
  if (existingRoomId && !roomId) connectToRoom(existingRoomId).catch(error => setNote(error?.message || "Could not reconnect to this Watch Room."));
});

window.addEventListener("online", () => {
  if (!roomId) return;
  if (!playbackUnsubscribe) subscribeToPlayback(roomId, playbackConnectionGeneration);
  void refreshPlaybackSnapshot();
});
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !roomId) return;
  if (!playbackUnsubscribe) subscribeToPlayback(roomId, playbackConnectionGeneration);
  void refreshPlaybackSnapshot();
});
window.addEventListener("pagehide", stopConnection);
window.addEventListener("pageshow", event => {
  if (!event.persisted || !auth.currentUser || auth.currentUser.isAnonymous) return;
  const params = new URLSearchParams(window.location.search);
  const isLobbyOnlyRoute = document.body.dataset.vividPage === "watch-rooms" && !params.get("id");
  const restoredRoomId = isLobbyOnlyRoute ? "" : params.get("roomId");
  if (restoredRoomId && !roomId) connectToRoom(restoredRoomId).catch(error => setNote(error?.message || "Could not reconnect to this Watch Room."));
});