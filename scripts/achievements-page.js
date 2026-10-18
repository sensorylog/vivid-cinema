import { getAchievementSnapshot } from "./achievements.js";

const $ = (id) => document.getElementById(id);
let activeFilter = "all";
let lastTrigger = null;

function makeArt(item, className = "") {
  const art = document.createElement("span");
  art.className = "achievement-art" + (className ? " " + className : "");
  art.dataset.achievement = item.id;
  art.setAttribute("aria-hidden", "true");
  const rune = document.createElement("span");
  rune.className = "achievement-art-rune";
  rune.textContent = item.icon || "✦";
  const glint = document.createElement("span");
  glint.className = "achievement-art-glint";
  art.append(rune, glint);
  return art;
}

function setProgress(track, item) {
  if (!track) return;
  const target = track.classList.contains("achievement-progress-track") ? track : track.querySelector(".achievement-progress-track");
  if (!target) return;
  target.style.setProperty("--progress", item.percentage + "%");
  const fill = target.querySelector(":scope > span");
  if (fill) fill.style.width = item.percentage + "%";
}

function openDetail(item, trigger) {
  const dialog = $("achievement-detail-dialog");
  if (!dialog) return;
  lastTrigger = trigger;
  const artHost = $("achievement-detail-art");
  artHost.replaceChildren(makeArt(item));
  $("achievement-detail-category").textContent = item.category;
  $("achievement-detail-title").textContent = item.title;
  $("achievement-detail-description").textContent = item.description;
  $("achievement-detail-status").textContent = item.earned
    ? "✦  Unlocked" + (item.unlockedAt ? " · " + new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(item.unlockedAt)) : "")
    : item.current + " / " + item.target + " " + item.unit;
  const progress = $("achievement-detail-progress");
  progress.hidden = item.earned;
  setProgress(progress, item);
  $("achievement-detail-progress-copy").textContent = item.current + " of " + item.target + " " + item.unit;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function render() {
  const data = getAchievementSnapshot();
  const earned = data.items.filter(item => item.earned).length;
  const percent = data.totalCount ? Math.round(earned / data.totalCount * 100) : 0;
  $("achievement-total-count").textContent = String(data.totalCount);
  $("achievement-earned-count").textContent = String(earned);
  $("achievement-completion-count").textContent = percent + "%";
  $("achievement-hero-progress").style.setProperty("--progress", percent + "%");
  $("achievement-hero-progress").setAttribute("aria-valuenow", String(percent));
  $("achievement-hero-progress").querySelector(":scope > span").style.width = percent + "%";

  const next = data.items.filter(item => !item.earned)
    .sort((a, b) => b.percentage - a.percentage || a.title.localeCompare(b.title))[0];
  const featured = $("achievement-featured");
  if (next) {
    $("achievement-featured-art").replaceChildren(makeArt(next));
    $("achievement-featured-category").textContent = next.category;
    $("achievement-featured-title").textContent = next.title;
    $("achievement-featured-description").textContent = next.description;
    $("achievement-featured-progress-label").textContent = next.current + " / " + next.target + " " + next.unit;
    featured.hidden = false;
    setProgress($("achievement-featured-progress"), next);
    $("achievement-featured-link").href = "library.html";
    $("achievement-featured-link").textContent = "Keep building your library";
  } else {
    featured.hidden = true;
  }

  const grid = $("achievement-gallery");
  const filtered = data.items.filter(item => activeFilter === "all" || (activeFilter === "earned" ? item.earned : !item.earned))
    .sort((a, b) => Number(b.earned) - Number(a.earned) || b.percentage - a.percentage || a.title.localeCompare(b.title));
  grid.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "achievement-empty";
    empty.textContent = activeFilter === "earned"
      ? "Your first milestone is waiting to be discovered."
      : "Every milestone is yours. Take a moment to enjoy the collection.";
    grid.append(empty);
  }
  for (const item of filtered) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "achievement-card " + (item.earned ? "is-earned" : "is-locked");
    card.dataset.achievement = item.id;
    card.setAttribute("aria-label", item.title + (item.earned ? ", unlocked" : ", " + item.current + " of " + item.target + " " + item.unit));
    const artWrap = document.createElement("span");
    artWrap.className = "achievement-card-art-wrap";
    artWrap.append(makeArt(item));
    const category = document.createElement("span");
    category.className = "achievement-category";
    category.textContent = item.category;
    const title = document.createElement("span");
    title.className = "achievement-card-title";
    title.textContent = item.title;
    const footer = document.createElement("span");
    footer.className = "achievement-card-footer";
    const status = document.createElement("span");
    status.textContent = item.earned ? "Unlocked" : item.current + " / " + item.target;
    const marker = document.createElement("strong");
    marker.className = item.earned ? "achievement-lock" : "achievement-lock";
    marker.textContent = item.earned ? "✦" : "◌";
    footer.append(status, marker);
    card.append(artWrap, category, title, footer);
    card.addEventListener("click", () => openDetail(item, card));
    grid.append(card);
  }
  document.querySelectorAll("[data-achievement-filter]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.achievementFilter === activeFilter));
  });
}

document.querySelectorAll("[data-achievement-filter]").forEach(button => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.achievementFilter;
    render();
  });
});
$("achievement-detail-close")?.addEventListener("click", () => $("achievement-detail-dialog")?.close());
$("achievement-detail-done")?.addEventListener("click", () => $("achievement-detail-dialog")?.close());
$("achievement-detail-dialog")?.addEventListener("click", event => {
  if (event.target === $("achievement-detail-dialog")) $("achievement-detail-dialog").close();
});
$("achievement-detail-dialog")?.addEventListener("close", () => {
  if (lastTrigger?.isConnected) lastTrigger.focus({ preventScroll: true });
});
window.addEventListener("vivid:achievements-changed", render);
window.addEventListener("vivid:library-changed", render);
window.addEventListener("storage", event => {
  if (event.key === "vivid:achievements:v1" || event.key === "vivid:library:v2") render();
});
render();
