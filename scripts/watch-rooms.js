import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { callWatchRoomApi } from "./watch-room-api.js";

const byId = id => document.getElementById(id);
const loading = byId("watch-rooms-loading");
const privateContent = byId("watch-rooms-private");
const errorPanel = byId("watch-rooms-error");
const errorMessage = byId("watch-rooms-error-message");
const retryButton = byId("watch-rooms-retry");
const roomDialog = byId("wr-create-room-dialog");
const joinDialog = byId("wr-join-room-dialog");
const clubDialog = byId("wr-create-club-dialog");
const call = callWatchRoomApi;
const dashboardState = { rooms: [], clubs: [], selectedClubId: null };
let dashboardLoadGeneration = 0;

function showSessionError(error) {
  if (loading) loading.hidden = true;
  if (privateContent) privateContent.hidden = true;
  if (errorMessage) errorMessage.textContent = "Vivid couldn't confirm your account. Check your connection and try again.";
  if (errorPanel) errorPanel.hidden = false;
  console.warn("Vivid Watch Rooms could not verify the current session:", error);
}

function requireVividAccount() {
  window.location.replace("auth.html?returnTo=" + encodeURIComponent("watch-rooms.html"));
}

function errorText(error, fallback) {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("unauthenticated")) return "Please sign in to your Vivid account again.";
  if (code.includes("permission-denied")) return error?.message || "You don't have permission to do that in this space.";
  if (code.includes("not-found")) return "That invitation could not be found. Check the code and try again.";
  if (code.startsWith("appcheck/")) return error?.message || ("Browser verification failed (" + code + "). Reload Vivid and try again.");
  if (code.includes("failed-precondition")) return error?.message || "Vivid could not verify this browser session. Refresh and try again.";
  if (code.includes("resource-exhausted")) return "This room or club has reached its member limit.";
  if (code.includes("invalid-argument")) return "Some of the information entered isn't valid. Check the form and try again.";
  // Callable INTERNAL/unknown messages often expose implementation details
  // such as "internal [0]". Keep those details in developer diagnostics only.
  return fallback;
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  dialog.querySelector("input,textarea,select")?.focus();
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

function setFeedback(id, message, isError = false) {
  const target = byId(id);
  if (!target) return;
  target.textContent = message;
  target.dataset.state = isError ? "error" : "info";
}

function makeInviteButton(targetType, targetId, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "vivid-wr-button vivid-wr-button--quiet";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await call("createWatchInvitation")({ targetType, targetId });
      const code = result.data.inviteCode;
      const feedbackId = targetType === "room" ? "wr-room-feedback" : "wr-club-feedback";
      const expiryLabel = targetType === "room" ? "Expires when the room closes (within 24 hours)." : "Expires in 48 hours.";
      setFeedback(feedbackId, "Your invite code (shown once): " + code + " · " + expiryLabel + " Share it privately.");
      const status = byId("wr-stage-note");
      if (status) status.textContent = "New invite code: " + code + " · " + expiryLabel + " Share it privately.";
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(code);
          if (status) status.textContent = "Invite code copied: " + code + " · " + expiryLabel
        } catch {
          // The code remains visible for manual copying when clipboard access is unavailable.
        }
      }
    } catch (error) {
      setFeedback(targetType === "room" ? "wr-room-feedback" : "wr-club-feedback", errorText(error, "Couldn't create an invite code."), true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function renderRoomPreviews() {
  const list = byId("wr-room-previews");
  const empty = byId("wr-rooms-empty");
  if (!list || !empty) return;
  empty.hidden = dashboardState.rooms.length > 0;
  byId("wr-room-count").textContent = String(dashboardState.rooms.length);
  list.replaceChildren();
  for (const room of dashboardState.rooms) {
    const card = document.createElement("article");
    card.className = "vivid-wr-preview-card";
    const meta = document.createElement("span");
    meta.className = "vivid-wr-preview-kicker";
    meta.textContent = room.role === "host" ? "YOUR ROOM · HOST" : "INVITED ROOM";
    const title = document.createElement("h3");
    title.textContent = room.name || "Private screening";
    const film = document.createElement("p");
    film.textContent = room.filmTitle ? "Screening: " + room.filmTitle : "Choose a film with your guests.";
    const expiresAt = room.expiresAt?.toMillis?.() ?? Number(room.expiresAt || 0);
    const isOpen = room.status === "open" && (!expiresAt || expiresAt > Date.now());
    const privacy = document.createElement("span");
    privacy.className = "vivid-wr-preview-private";
    privacy.textContent = isOpen ? "Invite-only" : "Expired";
    card.append(meta, title, film, privacy);
    if (isOpen) {
      const lobbyButton = document.createElement("button");
      lobbyButton.type = "button";
      lobbyButton.className = "vivid-wr-button vivid-wr-button--quiet";
      lobbyButton.textContent = "Open lobby";
      lobbyButton.addEventListener("click", () => document.dispatchEvent(new CustomEvent("vivid:watch-room-open", { detail: room })));
      card.append(lobbyButton);
    }
    if (room.role === "host" && isOpen) {
      card.append(makeInviteButton("room", room.roomId, "Create invite code"));
    }
    if (room.role === "host") {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "vivid-wr-button vivid-wr-button--danger";
      deleteButton.textContent = "Delete room";
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm("Permanently delete “" + (room.name || "this room") + "”? This removes its chat, queue, playback and room history for everyone. This cannot be undone.")) return;
        deleteButton.disabled = true;
        try {
          await call("deleteWatchRoom")({ roomId: room.roomId });
          dashboardState.rooms = dashboardState.rooms.filter(item => item.roomId !== room.roomId);
          renderRoomPreviews();
          setFeedback("wr-stage-note", "Room deleted.");
        } catch (error) {
          setFeedback("wr-stage-note", errorText(error, "Couldn't delete this room. Please try again."), true);
          deleteButton.disabled = false;
        }
      });
      card.append(deleteButton);
    }
    list.append(card);
  }
}

function renderClubPreviews() {
  const list = byId("wr-club-previews");
  const empty = byId("wr-clubs-empty");
  const layout = byId("wr-club-layout");
  if (!list || !empty || !layout) return;
  empty.hidden = dashboardState.clubs.length > 0;
  layout.hidden = dashboardState.clubs.length === 0;
  byId("wr-club-count").textContent = String(dashboardState.clubs.length);
  list.replaceChildren();
  for (const club of dashboardState.clubs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vivid-wr-club-preview" + (club.clubId === dashboardState.selectedClubId ? " is-selected" : "");
    button.setAttribute("aria-pressed", String(club.clubId === dashboardState.selectedClubId));
    const icon = document.createElement("span");
    icon.className = "vivid-wr-club-preview-icon";
    icon.innerHTML = '<i class="bi bi-people" aria-hidden="true"></i>';
    const copy = document.createElement("span");
    copy.className = "vivid-wr-club-preview-copy";
    const name = document.createElement("strong");
    name.textContent = club.name;
    const detail = document.createElement("small");
    detail.textContent = (club.role === "owner" ? "Founder" : "Member") + " · " + (club.memberCount || 1) + " members";
    copy.append(name, detail);
    const arrow = document.createElement("i");
    arrow.className = "bi bi-chevron-right";
    arrow.setAttribute("aria-hidden", "true");
    button.append(icon, copy, arrow);
    button.addEventListener("click", () => {
      dashboardState.selectedClubId = club.clubId;
      renderClubPreviews();
      renderClubDetail(club);
    });
    list.append(button);
  }
  const selected = dashboardState.clubs.find(club => club.clubId === dashboardState.selectedClubId) || dashboardState.clubs[0];
  if (selected) {
    dashboardState.selectedClubId = selected.clubId;
    renderClubDetail(selected);
  }
}

function renderClubDetail(club) {
  document.dispatchEvent(new CustomEvent("vivid:cinema-club-selected", { detail: club }));
  byId("wr-detail-name").textContent = club.name;
  byId("wr-detail-description").textContent = club.description || "A private Vivid Cinema Club. Your shared watchlist and screening history will live here.";
  byId("wr-detail-members").textContent = String(club.memberCount || 1);
  const actions = byId("wr-detail-actions");
  if (actions) {
    const actionsForClub = [];
    if (club.role === "owner") actionsForClub.push(makeInviteButton("club", club.clubId, "Invite members"));
    const membershipAction = document.createElement("button");
    membershipAction.type = "button";
    membershipAction.className = "vivid-wr-button vivid-wr-button--quiet";
    membershipAction.textContent = club.role === "owner" ? "Archive club" : "Leave club";
    membershipAction.addEventListener("click", async () => {
      const archive = club.role === "owner";
      const message = archive
        ? "Archive this Cinema Club? Members will lose access to its shared space."
        : "Leave this Cinema Club? You will need a new invitation to rejoin.";
      if (!window.confirm(message)) return;
      membershipAction.disabled = true;
      try {
        await call(archive ? "archiveCinemaClub" : "leaveCinemaClub")({ clubId: club.clubId });
        window.location.reload();
      } catch (error) {
        setFeedback("wr-club-feedback", errorText(error, archive ? "Couldn't archive this club." : "Couldn't leave this club."), true);
        membershipAction.disabled = false;
      }
    });
    actionsForClub.push(membershipAction);
    actions.replaceChildren(...actionsForClub);
  }
}

async function loadDashboard(user) {
  const generation = ++dashboardLoadGeneration;
  // Read dashboard indexes through the same authenticated server API that
  // writes them. This avoids a split client/server permission path and ensures
  // Firestore timestamps are normalized before the browser renders the list.
  const dashboard = await call("getWatchRoomDashboard")({});
  // Auth can change while the dashboard request is in flight. Never let an
  // older account's slower response overwrite the current account's view.
  if (generation !== dashboardLoadGeneration || auth.currentUser?.uid !== user.uid) return;
  dashboardState.rooms = Array.isArray(dashboard.data?.rooms) ? dashboard.data.rooms : [];
  dashboardState.clubs = Array.isArray(dashboard.data?.clubs) ? dashboard.data.clubs : [];
  if (!dashboardState.clubs.some(club => club.clubId === dashboardState.selectedClubId)) {
    dashboardState.selectedClubId = dashboardState.clubs[0]?.clubId || null;
  }
  renderRoomPreviews();
  renderClubPreviews();
  // Run bounded retention only after the dashboard is usable. The dashboard
  // request has already obtained a standard cached App Check token, so this
  // maintenance call does not require a separate attestation while that token
  // remains valid. Never make the user wait for cleanup.
  void call("cleanupExpiredWatchRooms")({}).catch(error => {
    console.warn("Vivid Watch Rooms background retention pass was skipped:", error);
  });
}

function showTab(name) {
  document.querySelectorAll("[data-wr-tab]").forEach(tab => {
    const active = tab.dataset.wrTab === name;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-wr-panel]").forEach(panel => {
    panel.hidden = panel.dataset.wrPanel !== name;
  });
}

document.querySelectorAll("[data-open-dialog]").forEach(button => {
  button.addEventListener("click", () => {
    const dialogs = {
      "create-room": roomDialog,
      "join-room": joinDialog,
      "create-club": clubDialog
    };
    openDialog(dialogs[button.dataset.openDialog]);
  });
});

document.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.addEventListener("click", () => closeDialog(button.closest("dialog")));
});

document.querySelectorAll("dialog.vivid-wr-dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog(dialog);
  });
});

document.querySelectorAll("[data-wr-tab]").forEach(tab => {
  tab.addEventListener("click", () => showTab(tab.dataset.wrTab));
  tab.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-wr-tab]")];
    const current = tabs.indexOf(tab);
    const next = tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    showTab(next.dataset.wrTab);
    next.focus();
  });
});

byId("wr-create-room-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const data = new FormData(form);
    const created = await call("createWatchRoom")({
      name: String(data.get("roomName") || "").trim(),
      filmTitle: String(data.get("filmTitle") || "").trim()
    });
    // The API now creates the room, host membership, dashboard pointer and
    // invitation atomically. Do not make a second permission-sensitive call.
    const room = created.data;
    dashboardState.rooms = [room, ...dashboardState.rooms.filter(item => item.roomId !== room.roomId)];
    renderRoomPreviews();
    showTab("rooms");
    setFeedback("wr-room-feedback", "Room created. Your invite code is " + room.inviteCode + " · Expires within 24 hours. Share it privately.");
    form.reset();

    // Dashboard refresh is secondary. A Firestore client read failure must not
    // turn a successfully-created room into a false permission-denied failure.
    try {
      await loadDashboard(auth.currentUser);
    } catch (refreshError) {
      console.error("Vivid Watch Room was created, but its dashboard refresh failed:", refreshError);
      setFeedback("wr-room-feedback", "Room created and invite code ready: " + room.inviteCode + ". Your room list couldn't refresh yet; reload the page to try again.");
    }
  } catch (error) {
    console.error("Vivid Watch Room creation failed:", error);
    setFeedback("wr-room-feedback", errorText(error, "We couldn't create your room just now. Please try again in a moment."), true);
  } finally {
    submit.disabled = false;
  }
});

byId("wr-join-room-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const input = byId("wr-invite-code");
  const code = input.value.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(code)) {
    setFeedback("wr-join-feedback", "Enter the 10-character Vivid invitation code.", true);
    input.focus();
    return;
  }
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await call("redeemWatchInvitation")({ inviteCode: code });
    await loadDashboard(auth.currentUser);
    closeDialog(joinDialog);
    input.value = "";
    if (result.data.targetType === "room") {
      const joinedRoom = dashboardState.rooms.find(item => item.roomId === result.data.targetId);
      if (!joinedRoom) throw new Error("You joined the room, but it hasn't appeared in your room list yet. Refresh your rooms to open it.");
      showTab("rooms");
      document.dispatchEvent(new CustomEvent("vivid:watch-room-open", { detail: joinedRoom }));
    } else {
      showTab("clubs");
      dashboardState.selectedClubId = result.data.targetId;
      renderClubPreviews();
      byId("wr-panel-clubs")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    setFeedback("wr-join-feedback", errorText(error, "Couldn't redeem that invitation."), true);
  } finally {
    submit.disabled = false;
  }
});

byId("wr-create-club-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const data = new FormData(form);
    const created = await call("createCinemaClub")({
      name: String(data.get("clubName") || "").trim(),
      description: String(data.get("description") || "").trim()
    });
    const invitation = await call("createWatchInvitation")({ targetType: "club", targetId: created.data.clubId });
    dashboardState.selectedClubId = created.data.clubId;
    await loadDashboard(auth.currentUser);
    showTab("clubs");
    setFeedback("wr-club-feedback", "Cinema Club created. Your invite code is " + invitation.data.inviteCode + " · Expires in 48 hours. Share it privately.");
    form.reset();
  } catch (error) {
    setFeedback("wr-club-feedback", errorText(error, "Couldn't create your Cinema Club. Please try again."), true);
    try { await loadDashboard(auth.currentUser); } catch {}
  } finally {
    submit.disabled = false;
  }
});

showTab("rooms");

retryButton?.addEventListener("click", () => window.location.reload());

async function initializeWatchRoomsAccess() {
  if (!auth) throw new Error("Firebase Authentication is unavailable.");
  if (typeof auth.authStateReady === "function") await auth.authStateReady();
  onAuthStateChanged(auth, async user => {
    if (!user || user.isAnonymous) {
      requireVividAccount();
      return;
    }
    if (loading) loading.hidden = true;
    if (errorPanel) errorPanel.hidden = true;
    if (privateContent) privateContent.hidden = false;
    document.body.dataset.vividWatchRoomsAccess = "authenticated";
    try {
      await loadDashboard(user);
      const requestedRoomId = new URLSearchParams(window.location.search).get("roomId");
      if (requestedRoomId) {
        const requestedRoom = dashboardState.rooms.find(item => item.roomId === requestedRoomId);
        if (requestedRoom) {
          showTab("rooms");
          document.dispatchEvent(new CustomEvent("vivid:watch-room-open", { detail: requestedRoom }));
        } else {
          byId("wr-stage-note").textContent = "That room is not available in your account. Reopen it with a valid invitation.";
        }
      }
    } catch (error) {
      console.error("Vivid Watch Rooms dashboard could not load:", error);
      byId("wr-stage-note").textContent = "We couldn't load your rooms and clubs. Check your connection and use Try again.";
    }
  }, showSessionError);
}

initializeWatchRoomsAccess().catch(showSessionError);
