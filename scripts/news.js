import {tmdbApi, clearTmdbCache} from "./tmdb.js";
import {getImageUrl, getMediaUrl} from "./media.js";
import {escapeHtml} from "./utils.js";
import {addCinemaReminder, addCinemaReminderToCalendar, getCinemaReminders, hasCinemaReminder, startCinemaReminderLoop} from "./cinema-reminders.js";
import {enableCinemaPush, savePushReminder} from "./push-notifications.js";

const $ = id => document.getElementById(id);
const state = { stories: [] };

function today() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function pretty(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric"}) : "Date TBA";
}
function daysUntil(value) {
  const d = parseDate(value);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
function releaseLanguage(value) {
  const d = parseDate(value);
  if (!d) return "Release date TBA";
  const days = daysUntil(value);
  if (days === 0) return "Out today";
  if (days === 1) return "Out tomorrow";
  if (days > 1) return "In " + days + " days";
  if (days === -1) return "Released yesterday";
  return "Released " + pretty(value);
}
function storyCard(s) {
  const reminder = hasCinemaReminder(s.id, s.kind);
  const reminderButton = s.when
    ? '<button class="vivid-notify-release" data-id="' + s.id + '" data-type="' + s.media_type + '" data-kind="' + s.kind + '" ' + (reminder ? "disabled" : "") + '>' + (reminder ? "Reminded" : "Notify me") + '</button>'
    : "";
  const calendarButton = reminder
    ? '<button class="vivid-calendar-add" data-id="' + s.id + '" data-kind="' + s.kind + '">Add to calendar</button>'
    : "";
  return '<article class="vivid-news-card">' +
    '<a class="vivid-news-image" href="' + getMediaUrl({id: s.id, media_type: s.media_type}) + '">' +
      '<img src="' + getImageUrl(s.backdrop_path || s.poster_path, "w780") + '" alt="' + escapeHtml(s.title) + '" loading="lazy">' +
      '<span>' + escapeHtml(s.label) + '</span>' +
    '</a>' +
    '<div class="vivid-news-body">' +
      '<small>' + escapeHtml(s.meta) + '</small>' +
      '<h2>' + escapeHtml(s.headline) + '</h2>' +
      '<p>' + escapeHtml(s.copy) + '</p>' +
      '<div class="vivid-news-actions"><a href="' + getMediaUrl({id: s.id, media_type: s.media_type}) + '">Explore</a>' + reminderButton + calendarButton + '</div>' +
    '</div>' +
  '</article>';
}
function render(filter = "all") {
  const el = $("news-grid");
  if (!el) return;
  const list = filter === "all" ? state.stories : state.stories.filter(x => x.category === filter);
  el.innerHTML = list.length
    ? list.map(storyCard).join("")
    : '<div class="vivid-news-empty">Nothing fresh in this category right now.</div>';
  wire();
  const status = $("news-status");
  if (status) status.textContent = list.length + " stories · Updated just now";
}
function wire() {
  document.querySelectorAll(".vivid-news-filter").forEach(button => {
    button.onclick = () => {
      document.querySelectorAll(".vivid-news-filter").forEach(x => x.classList.remove("is-active"));
      button.classList.add("is-active");
      render(button.dataset.filter);
    };
  });
  document.querySelectorAll(".vivid-notify-release").forEach(button => {
    button.onclick = async () => {
      const s = state.stories.find(x => String(x.id) === button.dataset.id && x.media_type === button.dataset.type && x.kind === button.dataset.kind);
      if (!s) return;
      try {
        const reminder = addCinemaReminder({
          title: s.title, when: s.when, note: s.headline,
          contentId: s.id, mediaType: s.media_type, kind: s.kind
        });
        let pushEnabled = false;
        try {
          await enableCinemaPush();
          await savePushReminder(reminder);
          pushEnabled = true;
        } catch (error) {
          console.warn("Vivid background push unavailable:", error);
        }
        button.disabled = true;
        button.textContent = pushEnabled ? "Background reminder on" : "Reminder saved";
        const toast = $("news-toast");
        if (toast) {
          toast.textContent = pushEnabled
            ? "Vivid will notify you before " + s.title + " arrives."
            : "Reminder saved · Sign in and allow notifications for background delivery";
          toast.hidden = false;
          setTimeout(() => { toast.hidden = true; }, 3500);
        }
        render(document.querySelector(".vivid-news-filter.is-active")?.dataset.filter || "all");
      } catch (error) {
        const toast = $("news-toast");
        if (toast) {
          toast.textContent = error.message || "Could not save reminder.";
          toast.hidden = false;
        }
      }
    };
  });
  document.querySelectorAll(".vivid-calendar-add").forEach(button => {
    button.onclick = () => {
      const reminder = getCinemaReminders().find(x => x.contentId === button.dataset.id && x.kind === button.dataset.kind);
      if (reminder) {
        addCinemaReminderToCalendar(reminder);
        button.textContent = "Calendar added";
      }
    };
  });
}
function pushStory(stories, item, category, label, headline, copy, kind, when) {
  if (!item?.id) return;
  const mediaType = item.media_type || (item.name ? "tv" : "movie");
  stories.push({
    id: String(item.id),
    media_type: mediaType,
    title: item.title || item.name || "Untitled",
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    category, label, headline, copy, kind, when,
    meta: when ? releaseLanguage(when) : "Trending this week"
  });
}
async function load() {
  const now = today();
  const futureEnd = addDays(now, 120);
  const [future, nowPlaying, airing, trending] = await Promise.allSettled([
    tmdbApi.futureMovies(1, now, futureEnd),
    tmdbApi.nowPlayingMovies(1),
    tmdbApi.airingTodayTv(1),
    tmdbApi.trending("all", "week")
  ]);
  const stories = [];
  const seen = new Set();
  const add = (...args) => {
    const item = args[1];
    const key = String(item?.id || "") + ":" + (item?.media_type || (item?.name ? "tv" : "movie"));
    if (!item?.id || seen.has(key)) return;
    seen.add(key);
    pushStory(stories, ...args);
  };

  (future.value?.results || [])
    .filter(x => x.release_date && x.release_date >= now)
    .slice(0, 8)
    .forEach(x => add(stories, {...x, media_type: "movie"}, "releases", "RELEASE RADAR",
      daysUntil(x.release_date) <= 1 ? (x.title || "A new movie") + " arrives next." : (x.title || "A new movie") + " is on the way.",
      "A date-accurate release window, with a reminder you can turn on.", "release", x.release_date));

  (nowPlaying.value?.results || [])
    .filter(x => x.release_date && x.release_date <= now && daysUntil(x.release_date) >= -45)
    .sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)))
    .slice(0, 6)
    .forEach(x => add(stories, {...x, media_type: "movie"}, "inCinemas", "JUST RELEASED",
      (x.title || "A movie") + " is out now.",
      "Freshly released titles currently in the cinema/release cycle.", "released", x.release_date));

  (airing.value?.results || []).slice(0, 6).forEach(x => add(stories, {...x, media_type: "tv"}, "episodes", "ON TV TODAY",
    (x.name || "A series") + " is airing today.",
    "Today's television schedule, pulled fresh from the catalogue.", "episode", now));

  (trending.value?.results || []).slice(0, 6).forEach(x => add(stories, x, "trending", "TRENDING NOW",
    (x.title || x.name || "A title") + " is getting attention.",
    "Popular with viewers across Vivid's current catalogue.", "trend", null));

  state.stories = stories;
  render(document.querySelector(".vivid-news-filter.is-active")?.dataset.filter || "all");
  const loading = $("news-loading");
  if (loading) loading.hidden = true;
  const status = $("news-status");
  if (status) status.textContent = stories.length + " stories · Updated " + new Date().toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
}
async function refresh() {
  const loading = $("news-loading");
  const button = $("news-refresh");
  if (button) { button.disabled = true; button.innerHTML = '<i class="bi bi-arrow-repeat"></i> Updating…'; }
  if (loading) { loading.hidden = false; loading.textContent = "Checking the latest cinema data…"; }
  clearTmdbCache();
  try { await load(); }
  catch (error) {
    console.warn("Vivid cinema news unavailable:", error);
    if (loading) loading.textContent = "Cinema news is temporarily unavailable.";
  } finally {
    if (button) { button.disabled = false; button.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh'; }
  }
}
$("news-refresh")?.addEventListener("click", refresh);
startCinemaReminderLoop();
load().catch(error => {
  console.warn("Vivid cinema news unavailable:", error);
  const loading = $("news-loading");
  if (loading) loading.textContent = "Cinema news is temporarily unavailable.";
});
