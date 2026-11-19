import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const byId = id => document.getElementById(id);
const loading = byId("watch-rooms-loading");
const privateContent = byId("watch-rooms-private");
const errorPanel = byId("watch-rooms-error");
const errorMessage = byId("watch-rooms-error-message");
const retryButton = byId("watch-rooms-retry");
const roomDialog = byId("wr-create-room-dialog");
const joinDialog = byId("wr-join-room-dialog");
const clubDialog = byId("wr-create-club-dialog");
const previewState = { rooms: [], clubs: [], selectedClubId: null };

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

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  const firstField = dialog.querySelector("input,textarea,select");
  firstField?.focus();
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

function renderRoomPreviews() {
  const list = byId("wr-room-previews");
  const empty = byId("wr-rooms-empty");
  if (!list || !empty) return;
  empty.hidden = previewState.rooms.length > 0;
  list.replaceChildren();
  for (const room of previewState.rooms) {
    const card = document.createElement("article");
    card.className = "vivid-wr-preview-card";
    const meta = document.createElement("span");
    meta.className = "vivid-wr-preview-kicker";
    meta.textContent = "LOCAL PREVIEW · NOT SAVED";
    const title = document.createElement("h3");
    title.textContent = room.name;
    const film = document.createElement("p");
    film.textContent = room.film ? "Screening: " + room.film : "Your screening details will appear here.";
    const privacy = document.createElement("span");
    privacy.className = "vivid-wr-preview-private";
    privacy.textContent = "Invite-only";
    card.append(meta, title, film, privacy);
    list.append(card);
  }
}

function renderClubPreviews() {
  const list = byId("wr-club-previews");
  const empty = byId("wr-clubs-empty");
  const layout = byId("wr-club-layout");
  if (!list || !empty || !layout) return;
  empty.hidden = previewState.clubs.length > 0;
  layout.hidden = previewState.clubs.length === 0;
  byId("wr-club-count").textContent = String(previewState.clubs.length);
  list.replaceChildren();
  for (const club of previewState.clubs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vivid-wr-club-preview" + (club.id === previewState.selectedClubId ? " is-selected" : "");
    button.setAttribute("aria-pressed", String(club.id === previewState.selectedClubId));
    const icon = document.createElement("span");
    icon.className = "vivid-wr-club-preview-icon";
    icon.innerHTML = '<i class="bi bi-people" aria-hidden="true"></i>';
    const copy = document.createElement("span");
    copy.className = "vivid-wr-club-preview-copy";
    const name = document.createElement("strong");
    name.textContent = club.name;
    const detail = document.createElement("small");
    detail.textContent = "Founder · 1 member";
    copy.append(name, detail);
    const arrow = document.createElement("i");
    arrow.className = "bi bi-chevron-right";
    arrow.setAttribute("aria-hidden", "true");
    button.append(icon, copy, arrow);
    button.addEventListener("click", () => {
      previewState.selectedClubId = club.id;
      renderClubPreviews();
      renderClubDetail(club);
    });
    list.append(button);
  }
  const selected = previewState.clubs.find(club => club.id === previewState.selectedClubId) || previewState.clubs[0];
  if (selected) {
    previewState.selectedClubId = selected.id;
    renderClubDetail(selected);
  }
}

function renderClubDetail(club) {
  byId("wr-detail-name").textContent = club.name;
  byId("wr-detail-description").textContent = club.description || "A private Vivid Cinema Club. Your shared watchlist and screening history will live here.";
  byId("wr-detail-members").textContent = "1";
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

byId("wr-create-room-form")?.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  previewState.rooms.unshift({
    id: "preview-" + Date.now(),
    name: String(data.get("roomName") || "").trim(),
    film: String(data.get("filmTitle") || "").trim()
  });
  renderRoomPreviews();
  setFeedback("wr-room-feedback", "Preview added on this device only. Room creation and invitations will be connected in Stage 3.");
  byId("wr-stage-note").textContent = "Preview mode · Your room is not saved or shared. Secure room creation and invitations are coming in Stage 3.";
  form.reset();
  window.setTimeout(() => closeDialog(roomDialog), 900);
});

byId("wr-join-room-form")?.addEventListener("submit", event => {
  event.preventDefault();
  const input = byId("wr-invite-code");
  const code = input.value.trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9-]{6,12}$/.test(code)) {
    setFeedback("wr-join-feedback", "Enter a valid 6–12 character invite code.", true);
    input.focus();
    return;
  }
  input.value = code;
  setFeedback("wr-join-feedback", "Code format looks good. Invitation lookup and membership checks will be connected in Stage 3. No room has been joined.");
});

byId("wr-create-club-form")?.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const club = {
    id: "preview-" + Date.now(),
    name: String(data.get("clubName") || "").trim(),
    description: String(data.get("description") || "").trim()
  };
  previewState.clubs.unshift(club);
  previewState.selectedClubId = club.id;
  renderClubPreviews();
  showTab("clubs");
  setFeedback("wr-club-feedback", "Club preview created on this device only. Secure club creation and membership will be connected in Stage 3.");
  byId("wr-stage-note").textContent = "Preview mode · Your club is not saved or shared. Secure club creation and invitations are coming in Stage 3.";
  form.reset();
  window.setTimeout(() => closeDialog(clubDialog), 900);
});

retryButton?.addEventListener("click", () => window.location.reload());

async function initializeWatchRoomsAccess() {
  if (!auth) throw new Error("Firebase Authentication is unavailable.");
  if (typeof auth.authStateReady === "function") await auth.authStateReady();
  onAuthStateChanged(auth, user => {
    if (!user || user.isAnonymous) {
      requireVividAccount();
      return;
    }
    if (loading) loading.hidden = true;
    if (errorPanel) errorPanel.hidden = true;
    if (privateContent) privateContent.hidden = false;
    document.body.dataset.vividWatchRoomsAccess = "authenticated";
  }, showSessionError);
}

initializeWatchRoomsAccess().catch(showSessionError);
