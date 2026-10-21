import { VIVID_CONFIG } from "./config.js";
import { getMediaDate, getMediaTitle, getMediaType } from "./utils.js";

/**
 * TMDB discovery/search feeds can include announced titles before their
 * first public release. Keep unknown/missing dates for backwards compatibility,
 * but never surface a title with a valid release date after today.
 *
 * The date is compared as an ISO calendar date (not a local midnight timestamp)
 * so titles released today remain visible regardless of the user's timezone.
 */
export function isReleasedMedia(item = {}, today = new Date().toISOString().slice(0, 10)) {
  const type = getMediaType(item);
  const date = String(type === "tv"
    ? (item.first_air_date || item.release_date || "")
    : (item.release_date || item.first_air_date || "")).trim();

  // Missing or malformed TMDB dates should not unexpectedly erase older records.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return true;
  return date <= today;
}

export function normalizeMedia(item = {}, type = null) {
  // Mixed-media sections use "all" as a filter, not a real media type.
  // Only trust explicit movie/tv overrides; otherwise preserve the item's TMDB type.
  const detectedType = getMediaType(item);
  const mediaType = type === "movie" || type === "tv"
    ? type
    : detectedType === "tv" ? "tv" : "movie";
  const id = item.id == null ? "" : String(item.id);
  return Object.freeze({
    id,
    media_type: mediaType === "tv" ? "tv" : "movie",
    content_id: mediaType + ":" + id,
    title: getMediaTitle(item),
    date: getMediaDate(item),
    year: getMediaDate(item).slice(0, 4),
    overview: item.overview || "",
    poster_path: item.poster_path || "",
    backdrop_path: item.backdrop_path || "",
    vote_average: Number(item.vote_average || 0),
    raw: item
  });
}

export function normalizeResults(results = [], type = null) {
  return results
    .filter((item) => item && item.id != null && isReleasedMedia(item))
    .map((item) => normalizeMedia(item, type));
}

/**
 * Apply the selected catalogue sort to the current result page. Keep undated
 * titles at the end for date sorts instead of letting missing dates appear first.
 */
export function sortMediaItems(items = [], sort = "popularity.desc") {
  const dateValue = (item) => {
    const date = String(item?.date || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  };
  const ratingValue = (item) => Number(item?.vote_average || 0);
  if (sort === "vote_average.desc") {
    return [...items].sort((a, b) => ratingValue(b) - ratingValue(a));
  }
  if (sort === "primary_release_date.desc" || sort === "first_air_date.desc") {
    return [...items].sort((a, b) =>
      dateValue(b).localeCompare(dateValue(a)) ||
      ratingValue(b) - ratingValue(a)
    );
  }
  if (sort === "primary_release_date.asc" || sort === "first_air_date.asc") {
    return [...items].sort((a, b) => {
      const left = dateValue(a);
      const right = dateValue(b);
      if (!left && !right) return 0;
      if (!left) return 1;
      if (!right) return -1;
      return left.localeCompare(right) || ratingValue(b) - ratingValue(a);
    });
  }
  return [...items];
}

export function getMediaUrl(media) {
  const id = typeof media === "object" ? media.id : media;
  const type = typeof media === "object" ? media.media_type : "movie";
  return VIVID_CONFIG.routes.title + "?" + new URLSearchParams({ id: String(id), type });
}

export function getPersonUrl(person) {
  const id = typeof person === "object" ? person.id : person;
  return VIVID_CONFIG.routes.title + "?" + new URLSearchParams({ person: String(id) });
}

export function getImageUrl(path, size = "w500") {
  return path ? VIVID_CONFIG.api.tmdbImageBaseUrl + "/" + size + path : "icons/vivid-icon.svg";
}

// ---------------------------------------------------------------------------
// Release windows, release status and reminder eligibility.
//
// The News "This week" section and the Home "Coming soon" shelf share these
// rules, so a title is never presented as an arrival after it has already been
// released and a reminder is only offered for a date still ahead. Everything
// here is pure and takes the current day as a LOCAL "YYYY-MM-DD" key, which
// keeps the behaviour testable outside a browser.
// ---------------------------------------------------------------------------
const RELEASE_DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function currentDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/** A TMDB date or timestamp as a local calendar key, or "" when unusable. */
export function releaseDateKey(value) {
  const key = String(value || "").trim().slice(0, 10);
  return RELEASE_DATE_KEY.test(key) ? key : "";
}

export function addDaysToDateKey(key, days) {
  const base = releaseDateKey(key);
  if (!base) return "";
  const date = new Date(base + "T12:00:00");
  date.setDate(date.getDate() + Math.trunc(Number(days) || 0));
  return currentDateKey(date);
}

/** Whole days from today to the release date (negative when already out). */
export function releaseDayOffset(dateKey, todayKey = currentDateKey()) {
  const from = releaseDateKey(todayKey), to = releaseDateKey(dateKey);
  if (!from || !to) return null;
  const start = new Date(from + "T12:00:00").getTime(), end = new Date(to + "T12:00:00").getTime();
  return Math.round((end - start) / 86400000);
}

/** The calendar week that contains `now`: Monday to Sunday, local dates. */
export function weekWindow(now = new Date()) {
  const today = currentDateKey(now);
  if (!today) return { start: "", end: "", today: "" };
  const weekday = (new Date(today + "T12:00:00").getDay() + 6) % 7; // Monday = 0
  return { start: addDaysToDateKey(today, -weekday), end: addDaysToDateKey(today, 6 - weekday), today };
}

function shortReleaseDate(dateKey) {
  return new Date(releaseDateKey(dateKey) + "T12:00:00")
    .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Where a release date stands today, in words the page can print as-is. */
export function releaseStatus(value, todayKey = currentDateKey()) {
  const date = releaseDateKey(value);
  const days = date ? releaseDayOffset(date, todayKey) : null;
  if (days === null) return { date: "", days: null, tone: "unknown", label: "Release date to be announced" };
  if (days === 0) return { date, days, tone: "today", label: "Out today" };
  if (days < 0) return { date, days, tone: "released", label: "In cinemas since " + shortReleaseDate(date) };
  if (days === 1) return { date, days, tone: "upcoming", label: "Out tomorrow" };
  if (days < 7) return { date, days, tone: "upcoming", label: "In " + days + " days" };
  return { date, days, tone: "upcoming", label: "Out " + shortReleaseDate(date) };
}

function releaseDateOf(item = {}) {
  return item.date || (getMediaType(item) === "tv"
    ? item.first_air_date || item.release_date
    : item.release_date || item.first_air_date) || "";
}

/** True when the title's own release date is today or later. */
export function isUpcomingMedia(item = {}, todayKey = currentDateKey()) {
  const date = releaseDateKey(releaseDateOf(item));
  const today = releaseDateKey(todayKey);
  return Boolean(date) && Boolean(today) && date >= today;
}

/**
 * TMDB discovery for a "coming soon" shelf asks for release dates from today
 * onwards, and the released-only catalogue gate then removed every future
 * title. This keeps the future dates that shelf was asked for, nearest first.
 */
export function normalizeUpcomingResults(results = [], todayKey = currentDateKey()) {
  return results
    .filter((item) => item && item.id != null && isUpcomingMedia(item, todayKey))
    .map((item) => normalizeMedia(item, getMediaType(item) === "tv" ? "tv" : "movie"))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(b.vote_average || 0) - Number(a.vote_average || 0));
}

/** The Coming Soon shelf offers a reminder only for a date still ahead. */
export function canNotifyForRelease(item = {}, todayKey = currentDateKey()) {
  const date = releaseDateKey(releaseDateOf(item));
  const today = releaseDateKey(todayKey);
  return Boolean(date) && Boolean(today) && date > today;
}

/** A reminder timestamp for a release date: local noon, so no timezone drift. */
export function releaseReminderTimestamp(value) {
  const date = releaseDateKey(value);
  if (!date) return "";
  const local = new Date(date + "T12:00:00");
  return Number.isNaN(local.getTime()) ? "" : local.toISOString();
}

/**
 * Every dated release inside the current week, from the catalogue sources the
 * News page already loads. Undated titles are counted and left out instead of
 * being shown with a guessed date.
 */
export function collectWeekReleases({ movies = [], tv = [], extra = [], now = new Date() } = {}) {
  const window = weekWindow(now);
  const rows = [
    ...movies.map((item) => ({ item, mediaType: "movie" })),
    ...tv.map((item) => ({ item, mediaType: "tv" })),
    ...extra.map((item) => ({ item, mediaType: getMediaType(item) === "tv" ? "tv" : "movie" }))
  ];
  const seen = new Set();
  const items = [];
  let undated = 0;
  for (const { item, mediaType } of rows) {
    if (!item || item.id == null) continue;
    const date = releaseDateKey(releaseDateOf(item));
    if (!date) { undated += 1; continue; }
    if (!window.start || !window.end || date < window.start || date > window.end) continue;
    const identity = mediaType + ":" + String(item.id);
    if (seen.has(identity)) continue;
    seen.add(identity);
    items.push({
      ...item,
      media_type: mediaType,
      title: getMediaTitle(item),
      date,
      release_date: mediaType === "movie" ? date : item.release_date || "",
      first_air_date: mediaType === "tv" ? date : item.first_air_date || "",
      status: releaseStatus(date, window.today)
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.popularity || 0) - Number(a.popularity || 0));
  return { items, window, undated };
}
