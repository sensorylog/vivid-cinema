import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getImageUrl } from "./media.js";
import { escapeHtml } from "./utils.js";
import { getAnimeLibrarySnapshot, removeAnimeFromWatchlist, unmarkAnimeCompleted, removeAnimeFavorite, saveAnimeLibraryPreferences, syncAnimePreferencesForUser } from "./anime-library.js";
import { syncLibraryForUser } from "./library.js";
import { syncPlaybackProgressForUser } from "./recommendations.js";
import { filterAllowedTitles } from "./parental-controls.js";

const $ = id => document.getElementById(id);
let currentUser = null;
let membershipChecked = false;
let renderRevision = 0;

function showGate(title, copy, href, label) {
  $("vap-library-gate-title").textContent = title;
  $("vap-library-gate-copy").textContent = copy;
  $("vap-library-gate-link").href = href;
  $("vap-library-gate-link").textContent = label;
  $("vap-library-gate").hidden = false;
  $("vap-library-content").hidden = true;
}

function titleHref(item) {
  return "anime-premium-title.html?id=" + encodeURIComponent(item.id) + "&type=" + encodeURIComponent(item.media_type || "tv");
}

function watchHref(item) {
  if (item.media_type !== "tv") return titleHref(item);
  const season = Math.max(0, Number(item.season ?? 1));
  const episode = Math.max(1, Number(item.episode ?? 1));
  return "anime-premium-watch.html?id=" + encodeURIComponent(item.id) + "&type=tv&season=" + season + "&episode=" + episode;
}

function card(item, section) {
  const title = escapeHtml(item.title || "Anime title");
  const year = escapeHtml(item.year || "");
  const image = escapeHtml(getImageUrl(item.poster_path, "w342"));
  const progress = Math.max(0, Math.min(100, Number(item.percentage) || 0));
  const href = ["continue", "episodes"].includes(section) ? watchHref(item) : titleHref(item);
  const episodeLabel = item.media_type === "tv" && item.episode
    ? "S" + String(item.season ?? 1) + " · E" + String(item.episode)
    : (year || (item.media_type === "movie" ? "Anime film" : "Anime series"));
  let progressMarkup = "";
  if (section === "continue") progressMarkup = '<div class="vap-library-progress" aria-label="' + Math.round(progress) + '% watched"><span style="width:' + progress + '%"></span></div>';
  let action = "";
  if (section === "watchlist") action = '<div class="vap-library-card-actions"><button type="button" data-remove-watchlist="' + escapeHtml(item.id) + '" data-media-type="' + escapeHtml(item.media_type) + '">Remove</button></div>';
  if (section === "completed") action = '<div class="vap-library-card-actions"><button type="button" data-uncomplete="' + escapeHtml(item.id) + '" data-media-type="' + escapeHtml(item.media_type) + '">Undo</button></div>';
  if (section === "favorites") action = '<div class="vap-library-card-actions"><button type="button" data-unfavorite="' + escapeHtml(item.id) + '" data-media-type="' + escapeHtml(item.media_type) + '">Remove</button></div>';
  return '<article class="vap-library-card"><a href="' + href + '"><img src="' + image + '" alt="" loading="lazy"><div class="vap-library-card-copy"><h3>' + title + '</h3><p>' + escapeHtml(episodeLabel) + '</p>' + progressMarkup + '</div></a>' + action + '</article>';
}

function renderSection(id, items, section, empty) {
  const target = $(id);
  if (!target) return;
  target.innerHTML = items.length ? items.map(item => card(item, section)).join("") : '<p class="vap-library-empty">' + empty + '</p>';
}

async function render() {
  const revision = ++renderRevision;
  const userId = currentUser?.uid || "";
  try {
    const source = getAnimeLibrarySnapshot();
    const [continueWatching, watchlist, completed, favorites, history, completedEpisodes] = await Promise.all([
      filterAllowedTitles(source.continueWatching || []),
      filterAllowedTitles(source.watchlist || []),
      filterAllowedTitles(source.completed || []),
      filterAllowedTitles(source.favorites || []),
      filterAllowedTitles(source.history || []),
      filterAllowedTitles(source.completedEpisodes || [])
    ]);
    if (revision !== renderRevision || (userId && currentUser?.uid !== userId)) return;
    const data = { ...source, continueWatching, watchlist, completed, favorites, history, completedEpisodes };
    $("vap-library-stats").innerHTML = [
      ["IN PROGRESS", data.continueWatching.length],
      ["WATCHLIST", data.watchlist.length],
      ["COMPLETED", data.completed.length],
      ["HISTORY", data.history.length]
    ].map(([label, value]) => '<div class="vap-library-stat"><b>' + value + '</b><span>' + label + '</span></div>').join("");
    renderSection("vap-library-continue", data.continueWatching, "continue", "Start an episode in Premium and your progress will appear here.");
    renderSection("vap-library-watchlist", data.watchlist, "watchlist", "Save anime from its title page and it will appear here.");
    renderSection("vap-library-completed", data.completed, "completed", "Mark a title as completed from its Premium title page.");
    renderSection("vap-library-favorites", data.favorites, "favorites", "Your favourite anime titles will appear here.");
    renderSection("vap-library-history", data.history, "history", "Your watched anime will appear here once you start playback.");
    renderSection("vap-library-episodes", data.completedEpisodes, "episodes", "Completed episode progress will appear here.");
    $("vap-pref-track").value = data.preferences.track;
    $("vap-pref-autoplay").checked = data.preferences.autoplayNextEpisode;
    $("vap-pref-language").value = data.preferences.subtitleLanguage;
    $("vap-pref-player").value = data.preferences.preferredPlayer;
  } catch (error) {
    if (revision !== renderRevision) return;
    console.warn("Vivid Anime Premium library viewing limits could not be verified:", error);
    showGate("Viewing settings unavailable", "We could not verify this profile’s viewing limits. Reload the page and try again before opening saved titles.", "anime-premium.html", "Back to Premium");
  }
}

async function verifyMembership(user) {
  const response = await fetch("/api/anime-premium/membership", {
    headers: { Authorization: "Bearer " + await user.getIdToken(true) },
    cache: "no-store"
  });
  if (response.status === 401) return { active: false, reason: "signin" };
  if (response.status === 403) return { active: false, reason: "verify" };
  if (!response.ok) throw new Error("Membership check returned HTTP " + response.status);
  const payload = await response.json();
  return { active: payload?.membership?.active === true, reason: "membership" };
}

async function openLibrary(user) {
  try {
    const membership = await verifyMembership(user);
    if (!membership.active) {
      if (membership.reason === "verify") showGate("Verify your Vivid email", "Email verification is required before Premium account features can be opened.", "verify-email.html", "Verify email");
      else if (membership.reason === "signin") showGate("Sign in again", "Your Vivid session needs to be refreshed before we can check your membership.", "auth.html?returnTo=anime-premium-library.html", "Sign in to Vivid");
      else showGate("Premium membership required", "Your private anime library is available to active VIVID ANIME PREMIUM members.", "anime-premium-membership.html", "Explore membership");
      return;
    }
    $("vap-library-gate").hidden = true;
    $("vap-library-content").hidden = false;
    await Promise.allSettled([syncLibraryForUser(user), syncPlaybackProgressForUser(user), syncAnimePreferencesForUser(user)]);
    if (currentUser?.uid !== user.uid) return;
    await render();
  } catch (error) {
    console.warn("Vivid Anime Premium library could not load:", error);
    showGate("Your library could not be loaded", "Vivid could not verify your membership or sync your private library. Check your connection and try again.", "anime-premium.html", "Back to Premium");
  }
}

document.addEventListener("click", event => {
  const button = event.target.closest("button[data-remove-watchlist],button[data-uncomplete],button[data-unfavorite]");
  if (!button) return;
  const id = button.dataset.removeWatchlist || button.dataset.uncomplete || button.dataset.unfavorite;
  const type = button.dataset.mediaType || "tv";
  if (button.hasAttribute("data-remove-watchlist")) removeAnimeFromWatchlist(id, type);
  else if (button.hasAttribute("data-uncomplete")) unmarkAnimeCompleted(id, type);
  else removeAnimeFavorite(id, type);
  void render();
});

for (const id of ["vap-pref-track", "vap-pref-player", "vap-pref-language", "vap-pref-autoplay"]) {
  $(id).addEventListener("change", () => {
    const prefs = saveAnimeLibraryPreferences({
      track: $("vap-pref-track").value,
      preferredPlayer: $("vap-pref-player").value,
      subtitleLanguage: $("vap-pref-language").value,
      autoplayNextEpisode: $("vap-pref-autoplay").checked
    });
    $("vap-pref-status").textContent = "Saved · " + prefs.track.toUpperCase() + " · " + (prefs.autoplayNextEpisode ? "Autoplay on" : "Autoplay off");
  });
}

window.addEventListener("vivid:library-changed", () => { void render(); });
window.addEventListener("vivid:progress-changed", () => { void render(); });
window.addEventListener("vivid:anime-preferences-changed", () => { void render(); });

onAuthStateChanged(auth, user => {
  currentUser = user && !user.isAnonymous ? user : null;
  if (!currentUser) {
    renderRevision += 1;
    showGate("Sign in to see your anime", "Use your existing Vivid account to open your private Premium library.", "auth.html?returnTo=anime-premium-library.html", "Sign in to Vivid");
    return;
  }
  void openLibrary(currentUser);
}, error => {
  console.warn("Vivid Anime Premium library authentication failed:", error);
  showGate("Sign in to continue", "Vivid could not verify your account. Please sign in again.", "auth.html?returnTo=anime-premium-library.html", "Sign in to Vivid");
});
