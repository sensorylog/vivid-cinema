import { auth } from "./firebase.js";
import { callWatchRoomApi } from "./watch-room-api.js";

const params = new URLSearchParams(window.location.search);
const roomId = String(params.get("roomId") || "").trim();
const call = callWatchRoomApi;
const statusNode = document.getElementById("vivid-cinema-sync-status");
const roomNameNode = document.getElementById("wr-cinema-room-name");
const exitButton = document.getElementById("wr-cinema-exit");

function setStatus(message, isError = false) {
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.dataset.state = isError ? "error" : "info";
}
function returnToLobby() {
  const target = new URL("watch-rooms.html", window.location.href);
  target.searchParams.set("roomId", roomId);
  window.location.assign(target.pathname + target.search);
}
exitButton?.addEventListener("click", returnToLobby);

async function boot() {
  if (!roomId || !/^[A-Za-z0-9_-]{6,80}$/.test(roomId)) {
    setStatus("This screening link is incomplete. Return to your Watch Room.", true);
    return;
  }
  await auth.authStateReady();
  if (!auth.currentUser || auth.currentUser.isAnonymous) {
    setStatus("Sign in to your Vivid account to enter this private screening.", true);
    return;
  }
  const response = await call("getWatchRoomLobbySnapshot")({ roomId });
  const room = response.data?.room;
  if (!room?.roomId || room.roomId !== roomId) throw new Error("This Watch Room is no longer available.");
  if (!room.activeScreening || String(room.activeScreening.sessionId || "") !== String(params.get("sessionId") || "")) {
    throw new Error("The host has changed or ended this screening. Return to the room lobby.");
  }
  roomNameNode.textContent = String(room.name || "PRIVATE SCREENING").toUpperCase();
  document.title = (room.activeScreening.title || "Private Screening") + " · Vivid Cinema";
  document.dispatchEvent(new CustomEvent("vivid:watch-room-open", { detail: room }));
  setStatus(room.role === "host" ? "You’re hosting this screening." : "Following the host’s shared screening.");
}
boot().catch(error => setStatus(error?.message || "Could not connect to this private screening.", true));
