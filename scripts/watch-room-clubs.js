import { appCheck, auth, db } from "./firebase.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { callWatchRoomApi } from "./watch-room-api.js";

const byId = id => document.getElementById(id);
const call = callWatchRoomApi;
let activeClub = null;
let lastClub = null;
let activeScreeningId = null;
let stops = [];

function stopListeners() { stops.forEach(stop => stop()); stops = []; activeScreeningId = null; }
function setClubFormsEnabled(enabled) {
  ["wr-club-watchlist-form","wr-club-screening-form"].forEach(id => {
    const form = byId(id);
    if (form) form.querySelectorAll("input,button").forEach(control => { control.disabled = !enabled; });
  });
  ["wr-after-credits-form","wr-club-discussion-form"].forEach(id => {
    const form = byId(id);
    if (form) form.querySelectorAll("input,textarea,select,button").forEach(control => { control.disabled = !enabled; });
  });
}
function feedback(message, error = false) {
  const note = byId("wr-stage-note");
  if (note) { note.textContent = message; note.dataset.state = error ? "error" : "info"; }
}
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function watchlistItem(item) {
  const row = node("li", undefined, "vivid-wr-screening-item");
  row.append(node("strong", item.title));
  row.append(node("small", item.contentId + (item.year ? " · " + item.year : "")));
  const remove = node("button", "Remove from watchlist", "vivid-wr-button vivid-wr-button--quiet");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    try { await call("removeCinemaClubWatchlistItem")({ clubId: activeClub.clubId, itemId: item.id }); }
    catch (error) { feedback(error.message || "Couldn't remove that pick.", true); remove.disabled = false; }
  });
  row.append(remove);
  return row;
}
function renderWatchlist(snapshot) {
  const list = byId("wr-club-watchlist");
  byId("wr-detail-watchlist-count").textContent = String(snapshot.size);
  list.replaceChildren();
  if (snapshot.empty) list.append(node("li", "Your shared shelf is empty. Add the first film.", "vivid-wr-screening-item"));
  snapshot.forEach(doc => list.append(watchlistItem({ id: doc.id, ...doc.data() })));
}
function renderScreenings(snapshot) {
  const list = byId("wr-club-screenings");
  byId("wr-detail-screening-count").textContent = String(snapshot.size);
  list.replaceChildren();
  if (snapshot.empty) list.append(node("p", "No screenings recorded yet. Add the club's first movie night.", "vivid-wr-screening-item"));
  snapshot.forEach(doc => {
    const data = doc.data();
    const row = node("article", undefined, "vivid-wr-screening-item");
    row.append(node("strong", data.title));
    const date = data.screenedAt?.toDate?.();
    row.append(node("small", (date ? date.toLocaleDateString() : "Screening") + " · " + (data.averageRating ? data.averageRating + "/5 average" : "No ratings yet") + " · " + (data.reviewCount || 0) + " reviews"));
    if (data.notes) row.append(node("p", data.notes));
    const select = node("button", activeScreeningId === doc.id ? "Selected" : "After-Credits", "vivid-wr-button vivid-wr-button--quiet");
    select.type = "button";
    select.setAttribute("aria-pressed", String(activeScreeningId === doc.id));
    select.addEventListener("click", () => selectScreening(doc.id, data.title));
    row.append(select);
    list.append(row);
  });
}
function selectScreening(screeningId, title) {
  activeScreeningId = screeningId;
  byId("wr-after-credits").hidden = false;
  byId("wr-after-credits-title").textContent = "After-Credits · " + title;
  const clubId = activeClub.clubId;
  const reviews = query(collection(db, "cinemaClubs", clubId, "screenings", screeningId, "afterCredits"), orderBy("updatedAt", "desc"), limit(60));
  const discussion = query(collection(db, "cinemaClubs", clubId, "screenings", screeningId, "discussion"), orderBy("createdAt", "desc"), limit(100));
  const old = stops.splice(2);
  old.forEach(stop => stop());
  stops.push(onSnapshot(reviews, snapshot => {
    const list = byId("wr-after-credits-reviews");
    list.replaceChildren();
    if (snapshot.empty) list.append(node("p", "Be the first to leave an After-Credits rating.", "vivid-wr-screening-item"));
    snapshot.forEach(doc => {
      const data = doc.data();
      list.append(node("article", "★".repeat(data.rating) + "☆".repeat(5 - data.rating) + (data.review ? " · " + data.review : ""), "vivid-wr-screening-item"));
    });
  }, error => feedback(error.message, true)));
  stops.push(onSnapshot(discussion, snapshot => {
    const list = byId("wr-club-discussion");
    list.replaceChildren();
    if (snapshot.empty) list.append(node("p", "The conversation starts here.", "vivid-wr-screening-item"));
    [...snapshot.docs].reverse().forEach(doc => {
      const data = doc.data();
      list.append(node("article", data.message, "vivid-wr-screening-item"));
    });
  }, error => feedback(error.message, true)));
}
document.addEventListener("vivid:cinema-club-selected", event => {
  const club = event.detail;
  if (!club?.clubId || club.clubId === activeClub?.clubId) return;
  stopListeners();
  activeClub = club;
  lastClub = club;
  setClubFormsEnabled(true);
  byId("wr-after-credits").hidden = true;
  const base = ["cinemaClubs", club.clubId];
  stops.push(onSnapshot(query(collection(db, ...base, "watchlist"), orderBy("createdAt", "desc"), limit(100)), renderWatchlist, error => feedback(error.message, true)));
  stops.push(onSnapshot(query(collection(db, ...base, "screenings"), orderBy("screenedAt", "desc"), limit(50)), renderScreenings, error => feedback(error.message, true)));
});
byId("wr-club-watchlist-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeClub) return;
  const form = event.currentTarget;
  const title = form.elements.title.value.trim();
  const contentId = form.elements.contentId.value.trim();
  const mediaType = contentId.split(":")[0];
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await call("addCinemaClubWatchlistItem")({ clubId: activeClub.clubId, title, contentId, mediaType });
    form.reset();
    feedback("Added to the club watchlist.");
  } catch (error) { feedback(error.message || "Couldn't add that title.", true); }
  finally { button.disabled = false; }
});
byId("wr-club-screening-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeClub) return;
  const form = event.currentTarget;
  const contentId = form.elements.contentId.value.trim();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await call("recordCinemaClubScreening")({
      clubId: activeClub.clubId, title: form.elements.title.value.trim(),
      contentId, mediaType: contentId.split(":")[0], notes: form.elements.notes.value.trim()
    });
    form.reset();
    feedback("Screening added to your club history.");
  } catch (error) { feedback(error.message || "Couldn't record that screening.", true); }
  finally { button.disabled = false; }
});
byId("wr-after-credits-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeClub || !activeScreeningId) return;
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await call("addCinemaClubAfterCreditsReview")({
      clubId: activeClub.clubId, screeningId: activeScreeningId,
      rating: Number(form.elements.rating.value), review: form.elements.review.value.trim()
    });
    feedback("Your After-Credits rating is saved.");
  } catch (error) { feedback(error.message || "Couldn't save your rating.", true); }
  finally { button.disabled = false; }
});
byId("wr-club-discussion-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeClub || !activeScreeningId) return;
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await call("addCinemaClubDiscussionMessage")({
      clubId: activeClub.clubId, screeningId: activeScreeningId, message: form.elements.message.value.trim()
    });
    form.reset();
  } catch (error) { feedback(error.message || "Couldn't post your message.", true); }
  finally { button.disabled = false; }
});
setClubFormsEnabled(false);
byId("wr-detail-screening-count").textContent = "0";
byId("wr-detail-watchlist-count").textContent = "0";
byId("wr-stage-note")?.setAttribute("aria-live", "polite");
document.querySelector("[data-focus-club-screening]")?.addEventListener("click", () => {
  const title = byId("wr-club-screening-form")?.elements.title;
  title?.focus();
  title?.scrollIntoView({ behavior: "smooth", block: "center" });
});
window.addEventListener("pagehide", () => {
  stopListeners();
  activeClub = null;
  setClubFormsEnabled(false);
});
window.addEventListener("pageshow", () => {
  if (lastClub) document.dispatchEvent(new CustomEvent("vivid:cinema-club-selected", { detail: lastClub }));
});
