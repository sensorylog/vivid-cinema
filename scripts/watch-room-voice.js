import { callWatchRoomApi } from "./watch-room-api.js";

const byId = id => document.getElementById(id);
const panel = byId("wr-voice-call");
const joinButton = byId("wr-voice-join");
const muteButton = byId("wr-voice-mute");
const leaveButton = byId("wr-voice-leave");
const statusNode = byId("wr-voice-status");
const participantsNode = byId("wr-voice-participants");
const call = callWatchRoomApi;
let activeRoom = null;
let livekitRoom = null;
let sdkPromise = null;
let connectedRoomId = "";
let isMuted = false;
let audioElements = [];

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
function renderParticipants() {
  if (!participantsNode) return;
  participantsNode.replaceChildren();
  if (!livekitRoom) {
    participantsNode.textContent = "No one is connected to voice yet.";
    return;
  }
  const participants = [livekitRoom.localParticipant, ...livekitRoom.remoteParticipants.values()];
  participants.forEach(participant => {
    const item = document.createElement("li");
    item.className = "vivid-wr-voice-person";
    const name = document.createElement("strong");
    name.textContent = participantLabel(participant) + (participant === livekitRoom.localParticipant ? " · You" : "");
    const state = document.createElement("small");
    const speaking = participant.isSpeaking === true;
    const micOn = participant.isMicrophoneEnabled === true;
    state.textContent = speaking ? "Speaking" : micOn ? "Microphone on" : "Muted";
    state.dataset.speaking = String(speaking);
    item.append(name, state);
    participantsNode.append(item);
  });
  if (!participants.length) participantsNode.textContent = "Waiting for people to join.";
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
async function joinVoice() {
  if (!activeRoom || livekitRoom) return;
  joinButton.disabled = true;
  setStatus("Securing your room connection…");
  try {
    const response = await call("getWatchRoomVoiceToken")({ roomId: activeRoom.roomId });
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
    joinButton.hidden = true;
    muteButton.hidden = false;
    leaveButton.hidden = false;
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      isMuted = false;
      muteButton.textContent = "Mute microphone";
      setStatus("Voice connected · Your microphone is on.", "success");
    } catch (error) {
      isMuted = true;
      muteButton.textContent = "Enable microphone";
      setStatus("You're connected and can hear the room, but microphone access was denied or unavailable. Check browser permissions.", "warning");
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
    muteButton.textContent = isMuted ? "Unmute microphone" : "Mute microphone";
    setStatus(isMuted ? "Your microphone is muted." : "Your microphone is on.", "success");
    renderParticipants();
  } catch (error) {
    setStatus("Microphone control failed. Check your device permission and try again.", "error");
  } finally {
    muteButton.disabled = false;
  }
}
joinButton?.addEventListener("click", joinVoice);
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
  renderParticipants();
});
document.addEventListener("vivid:watch-room-closing", () => {
  activeRoom = null;
  void disconnectVoice("You left the room.");
  if (panel) panel.hidden = true;
});
window.addEventListener("pagehide", () => { if (livekitRoom) void livekitRoom.disconnect(); });
