import { app, auth, db } from "./firebase.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
const byId = id => document.getElementById(id);
const call = name => httpsCallable(getFunctions(app, "us-central1"), name);
let room = null, lastRoom = null, stops = [], heartbeat = null;
function stop() { stops.forEach(fn => fn()); stops = []; if (heartbeat) clearInterval(heartbeat); heartbeat = null; room = null; }
function showError(error) { const n = byId("wr-stage-note"); if (n) n.textContent = error?.message || "The room action could not be completed."; }
function openLobby(data) {
  stop(); room = data; lastRoom = data;
  byId("wr-panel-rooms").hidden = true; byId("wr-panel-clubs").hidden = true; byId("wr-room-lobby").hidden = false;
  byId("wr-lobby-title").textContent = data.name || "Private screening";
  byId("wr-lobby-subtitle").textContent = data.filmTitle ? "Tonight: " + data.filmTitle : "Your crew is getting together.";
  byId("wr-host-controls").hidden = data.role !== "host";
  byId("wr-leave-room").hidden = data.role === "host";
  const settings = byId("wr-room-settings-form"); settings.elements.name.value = data.name || ""; settings.elements.allowGuestQueue.checked = data.allowGuestQueue !== false; settings.elements.allowGuestChat.checked = data.allowGuestChat !== false;
  const presence = collection(db, "rooms", data.roomId, "presence");
  const members = collection(db, "rooms", data.roomId, "members");
  let memberList = [], presenceList = [];
  const renderPresence = () => {
    const now = Date.now();
    const liveIds = new Set(presenceList.filter(item => item.expiresAt?.toMillis?.() > now).map(item => item.uid));
    byId("wr-lobby-presence-count").textContent = String(liveIds.size);
    const ul = byId("wr-lobby-presence");
    ul.replaceChildren();
    memberList.forEach(member => {
      const li = document.createElement("li"), label = document.createElement("span");
      const isSelf = member.uid === auth.currentUser?.uid;
      const isLive = liveIds.has(member.uid);
      label.textContent = isSelf ? "You · here now" : isLive ? "Vivid member · here now" : "Vivid member · away";
      li.append(label);
      if (room.role === "host" && !isSelf) {
        const remove = document.createElement("button");
        remove.type = "button"; remove.textContent = "Remove";
        remove.className = "vivid-wr-button vivid-wr-button--quiet";
        remove.addEventListener("click", () => call("removeWatchRoomMember")({ roomId: room.roomId, memberUid: member.uid }).catch(showError));
        li.append(remove);
      }
      ul.append(li);
    });
    if (!memberList.length) ul.textContent = "Waiting for your crew…";
  };
  stops.push(onSnapshot(members, snap => { memberList = snap.docs.map(document => ({ uid: document.id, ...document.data() })); renderPresence(); }, showError));
  stops.push(onSnapshot(presence, snap => { presenceList = snap.docs.map(document => document.data()); renderPresence(); }, showError));
  stops.push(onSnapshot(query(collection(db, "rooms", data.roomId, "queue"), orderBy("createdAt", "asc")), snap => { const ol = byId("wr-lobby-queue"); ol.replaceChildren(); const items = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(x => x.status === "queued").sort((a,b) => (b.voteCount || 0) - (a.voteCount || 0)); if (!items.length) ol.textContent = "No picks yet. Add the first film."; items.forEach(x => { const li = document.createElement("li"), label = document.createElement("span"), vote = document.createElement("button"); label.textContent = x.title + " · " + (x.voteCount || 0) + " votes"; vote.type = "button"; vote.textContent = "Vote"; vote.className = "vivid-wr-button vivid-wr-button--quiet"; vote.addEventListener("click", () => call("voteWatchRoomQueueItem")({ roomId:data.roomId, itemId:x.id }).catch(showError)); li.append(label,vote); if (room.role === "host" || x.addedBy === auth.currentUser?.uid) { const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.className = "vivid-wr-button vivid-wr-button--quiet"; remove.addEventListener("click", () => call("removeWatchRoomQueueItem")({ roomId:data.roomId, itemId:x.id }).catch(showError)); li.append(remove); } ol.append(li); }); }, showError));
  stops.push(onSnapshot(query(collection(db, "rooms", data.roomId, "chat"), orderBy("createdAt", "desc"), limit(80)), snap => { const log = byId("wr-lobby-chat"); log.replaceChildren(); [...snap.docs].reverse().forEach(d => { const m=d.data(), row=document.createElement("article"), p=document.createElement("p"), actions=document.createElement("div"); p.textContent=(m.uid===auth.currentUser?.uid ? "You" : "Member") + ": " + m.text; ["❤️","😂","👏","😮","🔥"].forEach(e => { const b=document.createElement("button"); b.type="button"; b.textContent=e+" "+(m.reactions?.[e]?.length||0); b.addEventListener("click",()=>call("reactToWatchRoomMessage")({roomId:data.roomId,messageId:d.id,reaction:e}).catch(showError)); actions.append(b); }); row.append(p,actions); log.append(row); }); log.scrollTop=log.scrollHeight; }, showError));
  const ping = () => call("heartbeatWatchRoom")({ roomId:data.roomId }).catch(showError); ping(); heartbeat = setInterval(ping,30000);
}
document.addEventListener("vivid:watch-room-open", e => openLobby(e.detail));
byId("wr-leave-room")?.addEventListener("click", async () => {
  if (!room || room.role === "host" || !window.confirm("Leave this Watch Room? You will need a new invitation to rejoin.")) return;
  const roomId = room.roomId;
  const button = byId("wr-leave-room");
  button.disabled = true;
  try {
    await call("leaveWatchRoom")({ roomId });
    lastRoom = null;
    stop();
    byId("wr-room-lobby").hidden = true;
    window.location.reload();
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
});
byId("wr-lobby-close")?.addEventListener("click", () => { lastRoom = null; stop(); byId("wr-room-lobby").hidden = true; byId("wr-panel-rooms").hidden = false; });
byId("wr-queue-form")?.addEventListener("submit", async e => { e.preventDefault(); if (!room) return; const input=e.currentTarget.elements.title; try { await call("addWatchRoomQueueItem")({roomId:room.roomId,title:input.value.trim(),mediaType:"movie"}); input.value=""; } catch(err) { showError(err); } });
byId("wr-chat-form")?.addEventListener("submit", async e => { e.preventDefault(); if (!room) return; const input=e.currentTarget.elements.text; try { await call("sendWatchRoomMessage")({roomId:room.roomId,text:input.value.trim()}); input.value=""; } catch(err) { showError(err); } });
byId("wr-close-room")?.addEventListener("click", async () => { if (!room || room.role !== "host" || !window.confirm("End this Watch Room for everyone?")) return; try { await call("closeWatchRoom")({ roomId: room.roomId }); lastRoom = null; stop(); byId("wr-room-lobby").hidden = true; window.location.reload(); } catch (error) { showError(error); } });
byId("wr-room-settings-form")?.addEventListener("submit", async e => { e.preventDefault(); if (!room || room.role!=="host") return; const f=e.currentTarget; try { await call("updateWatchRoomSettings")({roomId:room.roomId,settings:{name:f.elements.name.value.trim(),allowGuestQueue:f.elements.allowGuestQueue.checked,allowGuestChat:f.elements.allowGuestChat.checked}}); byId("wr-lobby-title").textContent=f.elements.name.value.trim(); } catch(err) { showError(err); } });
window.addEventListener("pagehide", () => {
  if (room) lastRoom = room;
  stop();
});
window.addEventListener("pageshow", event => {
  if (!event.persisted || !lastRoom || !auth.currentUser || auth.currentUser.isAnonymous) return;
  openLobby(lastRoom);
});
