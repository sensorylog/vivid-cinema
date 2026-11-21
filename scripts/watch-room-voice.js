import { callWatchRoomApi } from "./watch-room-api.js";

const byId = id => document.getElementById(id);
const panel = byId("wr-voice-call");
const joinButton = byId("wr-voice-join");
const muteButton = byId("wr-voice-mute");
const leaveButton = byId("wr-voice-leave");
const statusNode = byId("wr-voice-status");
const participantsNode = byId("wr-voice-participants");
const participantCountNode = byId("wr-voice-count");
const call = callWatchRoomApi;
const VOICE_INTENT_KEY = "vivid:watch-room-voice-intent:v1";
const VOICE_INTENT_TTL_MS = 45_000;
let activeRoom = null;
let livekitRoom = null;
let sdkPromise = null;
let connectedRoomId = "";
let isMuted = false;
let audioElements = [];

function readVoiceIntent() {
  try {
    const intent = JSON.parse(sessionStorage.getItem(VOICE_INTENT_KEY) || "null");
    if (!intent || typeof intent.roomId !== "string" || !Number.isFinite(Number(intent.expiresAt)) || Number(intent.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(VOICE_INTENT_KEY);
      return null;
    }
    return intent;
  } catch {
    return null;
  }
}
function persistVoiceIntent(roomId, muted = isMuted) {
  if (!roomId) return;
  try {
    sessionStorage.setItem(VOICE_INTENT_KEY, JSON.stringify({
      roomId,
      muted: Boolean(muted),
      expiresAt: Date.now() + VOICE_INTENT_TTL_MS
    }));
  } catch {}
}
function clearVoiceIntent(roomId) {
  try {
    const intent = readVoiceIntent();
    if (!roomId || !intent || intent.roomId === roomId) sessionStorage.removeItem(VOICE_INTENT_KEY);
  } catch {}
}

function guestVoiceAllowed() {
  return activeRoom?.role === "host" || activeRoom?.allowGuestVoice !== false;
}
function syncVoicePermission() {
  if (!joinButton) return;
  joinButton.disabled = !guestVoiceAllowed();
  if (!guestVoiceAllowed()) setStatus("The host has disabled guest voice for this room.", "warning");
}
function setStatus(message, state = "info") {
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.dataset.state = state;
}
function cleanupAudio() {
  audioElements.forEach(element => {
    try { element.pause(); element.srcObject = null; element.remove(); } catch {}
  });
  audioElements = [];
}
function participantLabel(participant) {
  return participant.name || participant.identity || "Vivid member";
}
function participantInitials(participant) {
  return participantLabel(participant).trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => Array.from(part)[0] || "").join("").toUpperCase() || "V";
}
function renderParticipants() {
  if (!participantsNode) return;
  participantsNode.replaceChildren();
  const participants = livekitRoom
    ? [livekitRoom.localParticipant, ...livekitRoom.remoteParticipants.values()]
    : [];
  if (participantCountNode) {
    participantCountNode.textContent = livekitRoom ? participants.length + (participants.length === 1 ? " person connected" : " people connected") : "Not connected";
    participantCountNode.dataset.connected = String(Boolean(livekitRoom));
  }
  panel?.classList.toggle("is-connected", Boolean(livekitRoom));
  if (!livekitRoom) {
    const empty = document.createElement("li");
    empty.className = "vivid-wr-voice-empty";
    empty.textContent = "Join voice when ready. Movie playback continues independently.";
    participantsNode.append(empty);
    return;
  }
  participants.forEach(participant => {
    const item = document.createElement("li");
    const speaking = participant.isSpeaking === true;
    const micOn = participant.isMicrophoneEnabled === true;
    const isLocal = participant === livekitRoom.localParticipant;
    item.className = "vivid-wr-voice-person";
    item.classList.toggle("is-speaking", speaking);
    item.dataset.local = String(isLocal);
    item.title = participantLabel(participant) + (speaking ? " is speaking" : micOn ? " microphone on" : " muted");
    const avatar = document.createElement("span");
    avatar.className = "vivid-wr-voice-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = participantInitials(participant);
    const name = document.createElement("strong");
    name.textContent = participantLabel(participant) + (isLocal ? " · You" : "");
    const state = document.createElement("small");
    state.textContent = speaking ? "Speaking" : micOn ? "Mic on" : "Muted";
    state.dataset.speaking = String(speaking);
    item.append(avatar, name, state);
    participantsNode.append(item);
  });
}
function attachAudio(track) {
  const element = track.attach();
  element.autoplay = true;
  element.playsInline = true;
  element.setAttribute("aria-hidden", "true");
  element.className = "vivid-wr-voice-audio";
  document.body.append(element);
  audioElements.push(element);
  element.play?.().catch(() => setStatus("Voice is connected. Tap the page if your browser blocks audio playback.", "warning"));
}
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import("https://cdn.jsdelivr.net/npm/livekit-client@2.24.1/dist/livekit-client.esm.mjs")
      .catch(error => {
        sdkPromise = null;
        throw new Error("The voice calling library could not load. Check your connection and retry.");
      });
  }
  return sdkPromise;
}
async function disconnectVoice(message = "You left the voice call.") {
  clearVoiceIntent(connectedRoomId || activeRoom?.roomId);
  const current = livekitRoom;
  livekitRoom = null;
  connectedRoomId = "";
  if (current) {
    try { await current.disconnect(); } catch {}
  }
  cleanupAudio();
  if (joinButton) joinButton.hidden = !activeRoom;
  if (muteButton) muteButton.hidden = true;
  if (leaveButton) leaveButton.hidden = true;
  renderParticipants();
  if (activeRoom) setStatus(message);
}
async function joinVoice(options = {}) {
  if (!activeRoom || livekitRoom) return;
  const targetRoomId = activeRoom.roomId;
  const restoreMuted = options?.restore === true && options?.muted === true;
  joinButton.disabled = true;
  setStatus("Securing your room connection…");
  try {
    const response = await call("getWatchRoomVoiceToken")({ roomId: targetRoomId });
    const credentials = response.data;
    if (!credentials?.token || !credentials?.url) throw new Error("The voice service returned incomplete connection details.");
    const sdk = await loadSdk();
    const room = new sdk.Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
    livekitRoom = room;
    connectedRoomId = activeRoom.roomId;
    room.on(sdk.RoomEvent.ParticipantConnected, renderParticipants);
    room.on(sdk.RoomEvent.ParticipantDisconnected, renderParticipants);
    room.on(sdk.RoomEvent.ActiveSpeakersChanged, renderParticipants);
    room.on(sdk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === sdk.Track.Kind.Audio) attachAudio(track);
      renderParticipants();
    });
    room.on(sdk.RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === sdk.Track.Kind.Audio) {
        try { track.detach().forEach(element => { element.pause?.(); element.remove(); }); } catch {}
      }
      renderParticipants();
    });
    room.on(sdk.RoomEvent.Reconnecting, () => setStatus("Voice connection interrupted. Reconnecting…", "warning"));
    room.on(sdk.RoomEvent.Reconnected, () => setStatus("Voice connected · Reconnected", "success"));
    room.on(sdk.RoomEvent.Disconnected, () => {
      if (livekitRoom === room) {
        livekitRoom = null;
        connectedRoomId = "";
        cleanupAudio();
        joinButton.hidden = !activeRoom;
        muteButton.hidden = true;
        leaveButton.hidden = true;
        setStatus("Voice disconnected. You can rejoin when ready.", "warning");
        renderParticipants();
      }
    });
    await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
    if (!activeRoom || activeRoom.roomId !== targetRoomId || livekitRoom !== room) {
      try { await room.disconnect(); } catch {}
      return;
    }
    joinButton.hidden = true;
    muteButton.hidden = false;
    leaveButton.hidden = false;
    try {
      await room.localParticipant.setMicrophoneEnabled(!restoreMuted);
      isMuted = restoreMuted;
      muteButton.innerHTML = isMuted ? '<i class="bi bi-mic-mute-fill" aria-hidden="true"></i> Unmute microphone' : '<i class="bi bi-mic-fill" aria-hidden="true"></i> Mute microphone';
      muteButton.setAttribute("aria-pressed", String(isMuted));
      setStatus(isMuted ? "Voice connected · Your microphone is muted." : "Voice connected · Your microphone is on.", "success");
      persistVoiceIntent(targetRoomId, isMuted);
    } catch (error) {
      isMuted = true;
      muteButton.innerHTML = '<i class="bi bi-mic-fill" aria-hidden="true"></i> Enable microphone';
      muteButton.setAttribute("aria-pressed", "true");
      setStatus("You're connected and can hear the room, but microphone access was denied or unavailable. Check browser permissions.", "warning");
      persistVoiceIntent(targetRoomId, true);
    }
    renderParticipants();
  } catch (error) {
    if (livekitRoom) {
      try { await livekitRoom.disconnect(); } catch {}
      livekitRoom = null;
    }
    connectedRoomId = "";
    joinButton.hidden = false;
    setStatus(error?.message || "Could not join the voice call. Try again.", "error");
  } finally {
    joinButton.disabled = false;
  }
}
async function toggleMute() {
  if (!livekitRoom) return;
  muteButton.disabled = true;
  try {
    const nextMuted = !isMuted;
    await livekitRoom.localParticipant.setMicrophoneEnabled(!nextMuted);
    isMuted = nextMuted;
    muteButton.innerHTML = isMuted ? '<i class="bi bi-mic-mute-fill" aria-hidden="true"></i> Unmute microphone' : '<i class="bi bi-mic-fill" aria-hidden="true"></i> Mute microphone';
    muteButton.setAttribute("aria-pressed", String(isMuted));
    setStatus(isMuted ? "Your microphone is muted." : "Your microphone is on.", "success");
    renderParticipants();
  } catch (error) {
    setStatus("Microphone control failed. Check your device permission and try again.", "error");
  } finally {
    muteButton.disabled = false;
  }
}
joinButton?.addEventListener("click", () => { void joinVoice(); });
muteButton?.addEventListener("click", toggleMute);
leaveButton?.addEventListener("click", () => disconnectVoice());

document.addEventListener("vivid:watch-room-open", async event => {
  const nextRoom = event.detail;
  if (!nextRoom?.roomId) return;
  if (connectedRoomId && connectedRoomId !== nextRoom.roomId) await disconnectVoice("Switched rooms. Join voice again.");
  activeRoom = nextRoom;
  panel.hidden = false;
  joinButton.hidden = Boolean(livekitRoom);
  setStatus("Voice is separate from movie playback. Join when you're ready to talk.");
  syncVoicePermission();
  renderParticipants();
  const intent = readVoiceIntent();
  if (intent?.roomId === nextRoom.roomId && guestVoiceAllowed()) {
    setStatus("Restoring your room voice connection…");
    void joinVoice({ restore: true, muted: intent.muted === true });
  } else if (intent?.roomId === nextRoom.roomId && !guestVoiceAllowed()) {
    clearVoiceIntent(nextRoom.roomId);
  }
});
document.addEventListener("vivid:watch-room-updated", event => {
  if (!activeRoom || event.detail?.roomId !== activeRoom.roomId) return;
  activeRoom = { ...activeRoom, ...event.detail };
  syncVoicePermission();
  if (!guestVoiceAllowed() && livekitRoom) void disconnectVoice("The host disabled guest voice.");
});
document.addEventListener("vivid:watch-room-closing", () => {
  activeRoom = null;
  void disconnectVoice("You left the room.");
  if (panel) panel.hidden = true;
});
window.addEventListener("pagehide", () => {
  if (!livekitRoom || !connectedRoomId) return;
  // A screening transition reloads the lobby URL. Preserve only short-lived
  // reconnect intent (never credentials) so voice can rejoin the same room.
  persistVoiceIntent(connectedRoomId, isMuted);
  const current = livekitRoom;
  livekitRoom = null;
  connectedRoomId = "";
  void current.disconnect();
});
