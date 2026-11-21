import { auth } from "./firebase.js";
import { callWatchRoomApi } from "./watch-room-api.js";
import { tmdbApi } from "./tmdb.js";

const byId = id => document.getElementById(id);
const call = callWatchRoomApi;
let room = null, lastRoom = null, stops = [], heartbeat = null, presenceRefresh = null;
let memberList = [], selectedPick = null, searchTimer = null, searchGeneration = 0;
let loadedScreeningSessionId = "", dismissedScreeningSessionId = "";

function stop() {
  if (room) document.dispatchEvent(new CustomEvent("vivid:watch-room-closing", { detail: { roomId: room.roomId } }));
  stops.forEach(fn => fn());
  stops = [];
  if (heartbeat) clearInterval(heartbeat);
  if (presenceRefresh) clearInterval(presenceRefresh);
  if (searchTimer) clearTimeout(searchTimer);
  heartbeat = null;
  presenceRefresh = null;
  searchTimer = null;
  room = null;
}
function setFeedback(message, isError = false) {
  const note = byId("wr-stage-note");
  if (!note) return;
  note.textContent = message;
  note.dataset.state = isError ? "error" : "success";
}
function showError(error) {
  setFeedback(error?.message || "The room action could not be completed. Please try again.", true);
}
function renderPresence() {
  if (!room) return;
  const count = byId("wr-lobby-presence-count");
  const online = byId("wr-lobby-online-count");
  if (count) count.textContent = String(memberList.length);
  if (online) online.textContent = memberList.filter(member => member.isOnline).length + " online";
  const list = byId("wr-lobby-presence");
  if (!list) return;
  list.replaceChildren();
  memberList.forEach(member => {
    const li = document.createElement("li");
    li.className = "vivid-wr-member-row";
    const identity = document.createElement("span");
    identity.className = "vivid-wr-member-identity";
    const name = document.createElement("strong");
    const isSelf = member.uid === auth.currentUser?.uid;
    name.textContent = isSelf ? (member.displayName || "You") + " · You" : member.displayName || "Vivid member";
    const status = document.createElement("small");
    const isLive = member.isOnline === true;
    status.textContent = (member.role === "host" ? "Host" : "Member") + " · " + (isLive ? "Online" : "Away");
    status.className = isLive ? "is-online" : "is-away";
    identity.append(name, status);
    li.append(identity);
    if (room.role === "host" && !isSelf) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.className = "vivid-wr-button vivid-wr-button--quiet";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try { await call("removeWatchRoomMember")({ roomId: room.roomId, memberUid: member.uid }); }
        catch (error) { showError(error); remove.disabled = false; }
      });
      li.append(remove);
    }
    list.append(li);
  });
  if (!memberList.length) list.textContent = "Your room connection is confirmed, but the member roster came back empty. Refresh the room and try again.";
}
function setSearchMessage(message, isError = false) {
  const results = byId("wr-queue-search-results");
  if (!results) return;
  results.replaceChildren();
  results.hidden = !message;
  if (message) {
    const note = document.createElement("p");
    note.className = isError ? "vivid-wr-search-message is-error" : "vivid-wr-search-message";
    note.textContent = message;
    results.append(note);
  }
}
function renderSearchResults(items) {
  const results = byId("wr-queue-search-results");
  if (!results) return;
  results.replaceChildren();
  results.hidden = items.length === 0;
  items.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vivid-wr-title-result";
    const poster = document.createElement("img");
    poster.alt = "";
    poster.loading = "lazy";
    if (item.posterPath) poster.src = "https://image.tmdb.org/t/p/w92" + item.posterPath;
    else poster.hidden = true;
    const copy = document.createElement("span");
    copy.className = "vivid-wr-title-result-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("small");
    meta.textContent = (item.mediaType === "tv" ? "TV series" : "Film") + (item.year ? " · " + item.year : "");
    copy.append(title, meta);
    button.append(poster, copy);
    button.addEventListener("click", () => {
      selectedPick = item;
      const form = byId("wr-queue-form");
      form.elements.title.value = item.title;
      form.elements.contentId.value = String(item.id);
      form.elements.mediaType.value = item.mediaType;
      form.elements.posterPath.value = item.posterPath || "";
      form.elements.releaseDate.value = item.releaseDate || "";
      results.replaceChildren();
      results.hidden = true;
      byId("wr-queue-selection").textContent = "Selected: " + item.title + ". Tap Add to share it with the room.";
      byId("wr-queue-selection").hidden = false;
    });
    results.append(button);
  });
}
async function searchQueueTitles(value, generation) {
  try {
    const data = await tmdbApi.searchMulti(value, 1);
    if (generation !== searchGeneration || !room) return;
    const items = (data.results || []).filter(item =>
      (item.media_type === "movie" || item.media_type === "tv") && Number.isInteger(Number(item.id)) && item.id > 0 && !item.adult
    ).slice(0, 8).map(item => {
      const mediaType = item.media_type;
      const title = String(mediaType === "movie" ? item.title || "" : item.name || "").trim();
      const releaseDate = String(mediaType === "movie" ? item.release_date || "" : item.first_air_date || "");
      return {
        id: Number(item.id), title, mediaType, posterPath: item.poster_path || "",
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : "",
        year: releaseDate.slice(0, 4)
      };
    }).filter(item => item.title);
    if (!items.length) setSearchMessage("No films or series found. Try another title.");
    else renderSearchResults(items);
  } catch (error) {
    if (generation !== searchGeneration) return;
    setSearchMessage("Film search is temporarily unavailable. Please try again.", true);
  }
}
function renderChat(messages) {
  const log = byId("wr-lobby-chat");
  if (!log) return;
  log.replaceChildren();
  messages.forEach(message => {
    const member = memberList.find(item => item.uid === message.uid);
    const row = document.createElement("article");
    row.className = "vivid-wr-chat-message";
    const text = document.createElement("p");
    text.textContent = (message.uid === auth.currentUser?.uid ? "You" : member?.displayName || "Member") + ": " + message.text;
    const actions = document.createElement("div");
    actions.className = "vivid-wr-chat-reactions";
    ["❤️", "😂", "👏", "😮", "🔥"].forEach(reaction => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = reaction + " " + (message.reactions?.[reaction]?.length || 0);
      button.addEventListener("click", () => call("reactToWatchRoomMessage")({ roomId: room.roomId, messageId: message.id, reaction }).catch(showError));
      actions.append(button);
    });
    row.append(text, actions);
    log.append(row);
  });
  if (!messages.length) log.textContent = "No messages yet. Say hello to your crew.";
  log.scrollTop = log.scrollHeight;
}

function applyRoomPermissions() {
  if (!room) return;
  const isHost = room.role === "host";
  const queueAllowed = isHost || room.allowGuestQueue !== false;
  const chatAllowed = isHost || room.allowGuestChat !== false;
  const queueForm = byId("wr-queue-form");
  const chatForm = byId("wr-chat-form");
  if (queueForm) queueForm.querySelectorAll("input, button").forEach(control => { control.disabled = !queueAllowed; });
  if (chatForm) chatForm.querySelectorAll("input, button").forEach(control => { control.disabled = !chatAllowed; });
}
function buildScreeningUrl(screening) {
  const contentId = String(screening?.contentId || "");
  const mediaType = screening?.mediaType === "tv" ? "tv" : "movie";
  if (!/^\d{1,12}$/.test(contentId)) return "";
  const url = new URL("watch-room-cinema.html", window.location.href);
  url.searchParams.set("id", contentId);
  url.searchParams.set("type", mediaType);
  url.searchParams.set("roomId", room.roomId);
  url.searchParams.set("roomMode", "1");
  if (screening.sessionId) url.searchParams.set("sessionId", String(screening.sessionId));
  if (mediaType === "tv") {
    url.searchParams.set("season", String(Math.max(1, Number(screening.season) || 1)));
    url.searchParams.set("episode", String(Math.max(1, Number(screening.episode) || 1)));
  }
  return url.pathname + url.search;
}

function navigateToCinemaScreening(screening) {
  if (!room) return;
  const url = buildScreeningUrl(screening);
  if (!url) { setFeedback("The room screening does not contain a valid Vivid title.", true); return; }
  loadedScreeningSessionId = String(screening.sessionId || "");
  dismissedScreeningSessionId = "";
  window.location.assign(url);
}
// The dedicated cinema route returns to this lobby when closed.

function renderQueue(items) {
  const list = byId("wr-lobby-queue");
  if (!list) return;
  list.replaceChildren();
  if (room?.activeScreening) {
    const active = document.createElement("li");
    active.className = "vivid-wr-queue-item vivid-wr-active-screening";
    const copy = document.createElement("div");
    copy.className = "vivid-wr-queue-copy";
    const title = document.createElement("strong");
    title.textContent = "Now screening: " + String(room.activeScreening.title || "Selected title");
    const meta = document.createElement("small");
    meta.textContent = "The host started this room screening.";
    copy.append(title, meta);
    const join = document.createElement("a");
    join.className = "vivid-wr-button vivid-wr-button--primary";
    join.textContent = "Join screening";
    join.href = buildScreeningUrl(room.activeScreening) || "#wr-screening-stage";
    join.addEventListener("click", event => {
      event.preventDefault();
      const next = new URL(window.location.href);
      next.searchParams.delete("suppressScreening");
      window.history.replaceState({}, "", next);
      navigateToCinemaScreening(room.activeScreening);
    });
    active.append(copy, join);
    list.append(active);
  }
  items = (Array.isArray(items) ? items : []).filter(item => item.status === "queued")
    .sort((a, b) => (Number(b.voteCount) || 0) - (Number(a.voteCount) || 0));
  if (!items.length) {
    if (!room?.activeScreening) list.textContent = "No film picks yet. Search for a title above to add the first one.";
    else {
      const empty = document.createElement("li");
      empty.textContent = "No other picks in the queue.";
      list.append(empty);
    }
    return;
  }
  items.forEach(item => {
    const li = document.createElement("li");
    li.className = "vivid-wr-queue-item";
    const poster = document.createElement("img");
    poster.className = "vivid-wr-queue-poster";
    poster.alt = "";
    poster.loading = "lazy";
    if (item.posterPath) poster.src = "https://image.tmdb.org/t/p/w92" + item.posterPath;
    else poster.hidden = true;
    const details = document.createElement("div");
    details.className = "vivid-wr-queue-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("small");
    const year = String(item.releaseDate || "").slice(0, 4);
    meta.textContent = (item.mediaType === "tv" ? "TV series" : "Film") + (year ? " · " + year : "") + " · " + (Number(item.voteCount) || 0) + " votes";
    details.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "vivid-wr-queue-actions";
    const voted = Array.isArray(item.votes) && item.votes.includes(auth.currentUser?.uid);
    const vote = document.createElement("button");
    vote.type = "button";
    vote.textContent = voted ? "Voted ✓" : "Vote";
    vote.className = "vivid-wr-button vivid-wr-button--quiet";
    vote.setAttribute("aria-pressed", String(Boolean(voted)));
    vote.disabled = room.role !== "host" && room.allowGuestVoting === false;
    vote.addEventListener("click", () => call("voteWatchRoomQueueItem")({ roomId: room.roomId, itemId: item.id }).catch(showError));
    actions.append(vote);
    if (room.role === "host" && /^\d{1,12}$/.test(String(item.contentId || ""))) {
      const start = document.createElement("button");
      start.type = "button";
      start.textContent = item.mediaType === "tv" ? "Start Screening · S1 E1" : "Start Screening";
      start.className = "vivid-wr-button vivid-wr-button--primary";
      start.addEventListener("click", async () => {
        start.disabled = true;
        try {
          const response = await call("startWatchRoomScreening")({ roomId: room.roomId, itemId: item.id });
          const url = buildScreeningUrl(response.data?.screening);
          if (!url) throw new Error("The server returned an invalid screening title.");
          navigateToCinemaScreening(response.data?.screening);
        } catch (error) {
          showError(error);
          start.disabled = false;
        }
      });
      actions.append(start);
    }
    const openTitle = document.createElement("a");
    openTitle.className = "vivid-wr-button vivid-wr-button--quiet";
    openTitle.textContent = "View title";
    if (item.contentId && /^\d{1,12}$/.test(String(item.contentId))) {
      openTitle.href = "title.html?id=" + encodeURIComponent(item.contentId) + "&type=" + (item.mediaType === "tv" ? "tv" : "movie");
      openTitle.target = "_blank";
      openTitle.rel = "noopener";
      actions.append(openTitle);
    }
    if (room.role === "host" || item.addedBy === auth.currentUser?.uid || room.allowGuestQueueManagement === true) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.className = "vivid-wr-button vivid-wr-button--quiet";
      remove.addEventListener("click", () => call("removeWatchRoomQueueItem")({ roomId: room.roomId, itemId: item.id }).catch(showError));
      actions.append(remove);
    }
    li.append(poster, details, actions);
    list.append(li);
  });
}
function openLobby(data) {
  stop();
  searchGeneration += 1;
  selectedPick = null;
  byId("wr-queue-form")?.reset();
  byId("wr-queue-selection").hidden = true;
  setSearchMessage("");
  room = data;
  lastRoom = data;
  applyRoomPermissions();
  memberList = [];
  byId("wr-panel-rooms").hidden = true;
  byId("wr-panel-clubs").hidden = true;
  byId("wr-room-lobby").hidden = false;
  byId("wr-lobby-title").textContent = data.name || "Private screening";
  byId("wr-lobby-subtitle").textContent = data.filmTitle ? "Tonight: " + data.filmTitle : "Your crew is getting together.";
  byId("wr-host-controls").hidden = data.role !== "host";
  byId("wr-leave-room").hidden = data.role === "host";
  byId("wr-lobby-presence-count").textContent = "…";
  byId("wr-lobby-online-count").textContent = "Checking…";
  byId("wr-lobby-presence").textContent = "Loading your room members…";
  byId("wr-lobby-queue").textContent = "Loading film picks…";
  byId("wr-lobby-chat").textContent = "Loading room chat…";
  const settings = byId("wr-room-settings-form");
  settings.elements.name.value = data.name || "";
  settings.elements.allowGuestQueue.checked = data.allowGuestQueue !== false;
  settings.elements.allowGuestChat.checked = data.allowGuestChat !== false;
  settings.elements.allowGuestVoting.checked = data.allowGuestVoting !== false;
  settings.elements.allowGuestPlayerSelection.checked = data.allowGuestPlayerSelection === true;
  settings.elements.allowGuestQueueManagement.checked = data.allowGuestQueueManagement === true;
  settings.elements.allowGuestPlaybackControl.checked = data.allowGuestPlaybackControl === true;
  settings.elements.allowGuestVoice.checked = data.allowGuestVoice !== false;
  settings.addEventListener("change", () => { settings.dataset.dirty = "true"; });
  const refreshLobby = async () => {
    if (!room || room.roomId !== data.roomId) return;
    try {
      const response = await call("getWatchRoomLobbySnapshot")({ roomId: data.roomId });
      if (!room || room.roomId !== data.roomId) return;
      const snapshot = response.data || {};
      if (snapshot.room) {
        room = { ...room, ...snapshot.room };
        document.dispatchEvent(new CustomEvent("vivid:watch-room-updated", { detail: room }));
        const activeSessionId = String(room.activeScreening?.sessionId || "");
        const screeningSuppressed = new URLSearchParams(window.location.search).get("suppressScreening") === "1";
        if (!screeningSuppressed && activeSessionId && activeSessionId !== loadedScreeningSessionId && activeSessionId !== dismissedScreeningSessionId) {
          navigateToCinemaScreening(room.activeScreening);
        }
        const currentSettings = byId("wr-room-settings-form");
        if (room.role === "host" && currentSettings && currentSettings.dataset.dirty !== "true") {
          currentSettings.elements.allowGuestQueue.checked = room.allowGuestQueue !== false;
          currentSettings.elements.allowGuestChat.checked = room.allowGuestChat !== false;
          currentSettings.elements.allowGuestVoting.checked = room.allowGuestVoting !== false;
          currentSettings.elements.allowGuestPlayerSelection.checked = room.allowGuestPlayerSelection === true;
          currentSettings.elements.allowGuestQueueManagement.checked = room.allowGuestQueueManagement === true;
          currentSettings.elements.allowGuestPlaybackControl.checked = room.allowGuestPlaybackControl === true;
          currentSettings.elements.allowGuestVoice.checked = room.allowGuestVoice !== false;
        }
      }
      applyRoomPermissions();
      memberList = Array.isArray(snapshot.members) ? snapshot.members : [];
      renderPresence();
      renderQueue(Array.isArray(snapshot.queue) ? snapshot.queue : []);
      renderChat(Array.isArray(snapshot.chat) ? snapshot.chat : []);
      const note = byId("wr-stage-note");
      if (note?.dataset.state === "lobby-load-error") {
        note.textContent = "Room connected. Members and film picks are up to date.";
        note.dataset.state = "success";
      }
    } catch (error) {
      if (!room || room.roomId !== data.roomId) return;
      const message = error?.message || "We couldn't load this room right now.";
      byId("wr-lobby-presence-count").textContent = "—";
      byId("wr-lobby-online-count").textContent = "Unavailable";
      byId("wr-lobby-presence").textContent = "Couldn't load room members. " + message;
      byId("wr-lobby-queue").textContent = "Couldn't load film picks. " + message;
      byId("wr-lobby-chat").textContent = "Couldn't load room chat. " + message;
      setFeedback("Room data couldn't be refreshed: " + message, true);
      const note = byId("wr-stage-note");
      if (note) note.dataset.state = "lobby-load-error";
    }
  };
  const ping = () => call("heartbeatWatchRoom")({ roomId: data.roomId })
    .then(() => refreshLobby())
    .catch(error => {
      showError(error);
      byId("wr-lobby-presence").textContent = "Couldn't confirm your room connection. " + (error?.message || "Try reopening the room.");
    });
  ping();
  heartbeat = setInterval(ping, 30000);
  presenceRefresh = setInterval(refreshLobby, 5000);
}
document.addEventListener("vivid:watch-room-open", event => openLobby(event.detail));
const queueTitleInput = byId("wr-queue-form")?.elements.title;
queueTitleInput?.addEventListener("input", () => {
  selectedPick = null;
  const form = byId("wr-queue-form");
  form.elements.contentId.value = "";
  form.elements.mediaType.value = "";
  form.elements.posterPath.value = "";
  form.elements.releaseDate.value = "";
  byId("wr-queue-selection").hidden = true;
  if (searchTimer) clearTimeout(searchTimer);
  const value = queueTitleInput.value.trim();
  const generation = ++searchGeneration;
  if (value.length < 2) {
    setSearchMessage("");
    return;
  }
  setSearchMessage("Searching films and series…");
  searchTimer = setTimeout(() => searchQueueTitles(value, generation), 300);
});
byId("wr-queue-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!room) return;
  const form = event.currentTarget;
  if (!selectedPick || !form.elements.contentId.value) {
    setFeedback("Choose a film or series from the search results before adding it.", true);
    queueTitleInput?.focus();
    return;
  }
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await call("addWatchRoomQueueItem")({
      roomId: room.roomId, title: selectedPick.title, contentId: String(selectedPick.id),
      mediaType: selectedPick.mediaType, posterPath: selectedPick.posterPath, releaseDate: selectedPick.releaseDate
    });
    form.reset();
    selectedPick = null;
    byId("wr-queue-selection").hidden = true;
    setSearchMessage("");
    setFeedback("Added to Up next. Everyone in the room can now see and vote on this pick.");
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
});
byId("wr-chat-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!room) return;
  const input = event.currentTarget.elements.text;
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await call("sendWatchRoomMessage")({ roomId: room.roomId, text: input.value.trim() });
    input.value = "";
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
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
byId("wr-lobby-close")?.addEventListener("click", () => {
  lastRoom = null;
  stop();
  byId("wr-room-lobby").hidden = true;
  byId("wr-panel-rooms").hidden = false;
});
byId("wr-close-room")?.addEventListener("click", async () => {
  if (!room || room.role !== "host" || !window.confirm("End this Watch Room for everyone?")) return;
  try {
    await call("closeWatchRoom")({ roomId: room.roomId });
    lastRoom = null;
    stop();
    byId("wr-room-lobby").hidden = true;
    window.location.reload();
  } catch (error) { showError(error); }
});
byId("wr-delete-room")?.addEventListener("click", async () => {
  if (!room || room.role !== "host" || !window.confirm("Permanently delete this room and all its chat, queue, playback and history for everyone? This cannot be undone.")) return;
  const button = byId("wr-delete-room");
  button.disabled = true;
  try {
    await call("deleteWatchRoom")({ roomId: room.roomId });
    lastRoom = null;
    stop();
    byId("wr-room-lobby").hidden = true;
    window.location.reload();
  } catch (error) {
    showError(error);
    button.disabled = false;
  }
});
byId("wr-room-settings-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!room || room.role !== "host") return;
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await call("updateWatchRoomSettings")({
      roomId: room.roomId,
      settings: {
        name: form.elements.name.value.trim(),
        allowGuestQueue: form.elements.allowGuestQueue.checked,
        allowGuestChat: form.elements.allowGuestChat.checked,
        allowGuestVoting: form.elements.allowGuestVoting.checked,
        allowGuestPlayerSelection: form.elements.allowGuestPlayerSelection.checked,
        allowGuestQueueManagement: form.elements.allowGuestQueueManagement.checked,
        allowGuestPlaybackControl: form.elements.allowGuestPlaybackControl.checked,
        allowGuestVoice: form.elements.allowGuestVoice.checked
      }
    });
    form.dataset.dirty = "false";
    byId("wr-lobby-title").textContent = form.elements.name.value.trim();
    if (form.elements.allowGuestVoice.checked === false && result.data?.voiceEvicted === false) {
      setFeedback("Guest voice is blocked for new joins, but LiveKit did not confirm every active disconnection. Check the voice service.", true);
    } else setFeedback("Room settings saved.");
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
window.addEventListener("pagehide", () => {
  if (room) lastRoom = room;
  stop();
});
window.addEventListener("pageshow", event => {
  if (!event.persisted || !lastRoom || !auth.currentUser || auth.currentUser.isAnonymous) return;
  openLobby(lastRoom);
});
