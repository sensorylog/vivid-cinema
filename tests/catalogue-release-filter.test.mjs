import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canNotifyForRelease, collectWeekReleases, isReleasedMedia, normalizeResults, normalizeUpcomingResults, releaseReminderTimestamp, releaseStatus, weekWindow } from "../scripts/media.js";

test("movie catalogue filtering excludes future release dates", () => {
  assert.equal(isReleasedMedia({ media_type: "movie", release_date: "2026-10-21" }, "2026-10-20"), false);
  assert.equal(isReleasedMedia({ media_type: "movie", release_date: "2026-10-20" }, "2026-10-20"), true);
  assert.equal(isReleasedMedia({ media_type: "movie", release_date: "2020-05-01" }, "2026-10-20"), true);
});

test("TV catalogue filtering uses first air date and excludes unaired series", () => {
  assert.equal(isReleasedMedia({ media_type: "tv", first_air_date: "2026-12-01" }, "2026-10-20"), false);
  assert.equal(isReleasedMedia({ media_type: "tv", first_air_date: "2026-10-20" }, "2026-10-20"), true);
});

test("normalization applies the release gate to all catalogue result batches", () => {
  const results = normalizeResults([
    { id: 1, title: "Released movie", release_date: "2020-01-01" },
    { id: 2, title: "Future movie", release_date: "2999-01-01" },
    { id: 3, name: "Future series", first_air_date: "2999-01-01" },
    { id: 4, title: "Legacy metadata without date" }
  ], "movie");

  assert.deepEqual(results.map(item => item.id), ["1", "4"]);
});

test("missing and malformed release dates remain visible for backwards compatibility", () => {
  assert.equal(isReleasedMedia({ id: 1, title: "Undated" }, "2026-10-20"), true);
  assert.equal(isReleasedMedia({ id: 2, title: "Malformed", release_date: "TBA" }, "2026-10-20"), true);
});

// Wednesday 21 October 2026, local noon. The current week runs Mon 19 – Sun 25.
const WEDNESDAY = new Date(2026, 9, 21, 12, 0, 0);
const movie = (id, title, date) => ({ id, media_type: "movie", title, release_date: date, popularity: 10 });

test("the This Week window follows the current Monday–Sunday calendar week", () => {
  assert.deepEqual(weekWindow(WEDNESDAY), { start: "2026-10-19", end: "2026-10-25", today: "2026-10-21" });
  // A Sunday still belongs to the week that started six days earlier...
  assert.equal(weekWindow(new Date(2026, 9, 25, 23, 30)).start, "2026-10-19");
  // ...and a Monday opens the next one.
  assert.equal(weekWindow(new Date(2026, 9, 26, 0, 5)).start, "2026-10-26");
});

test("This Week keeps only titles dated inside the current week, ordered by date", () => {
  const { items, undated } = collectWeekReleases({
    movies: [
      movie(1, "Later this week", "2026-10-24"),
      movie(2, "Already out this week", "2026-10-19"),
      movie(3, "Last week", "2026-10-18"),
      movie(4, "Next week", "2026-10-26"),
      movie(5, "No date", "")
    ],
    tv: [{ id: 6, name: "Series premiere", first_air_date: "2026-10-21", popularity: 4 }],
    now: WEDNESDAY
  });
  assert.deepEqual(items.map(item => item.title), ["Already out this week", "Series premiere", "Later this week"]);
  assert.deepEqual(items.map(item => item.date), ["2026-10-19", "2026-10-21", "2026-10-24"]);
  assert.equal(items[1].media_type, "tv");
  assert.equal(undated, 1, "a missing release date is counted, never guessed");
  assert.equal(items.some(item => item.id === 3 || item.id === 4), false);
  assert.deepEqual(items.map(item => item.status.tone), ["released", "today", "upcoming"]);
});

test("This Week de-duplicates a title that arrives from more than one source", () => {
  const { items } = collectWeekReleases({
    movies: [movie(9, "Twice listed", "2026-10-22")],
    extra: [movie(9, "Twice listed", "2026-10-22")],
    now: WEDNESDAY
  });
  assert.equal(items.length, 1);
});

test("This Week labels each release against today, including titles already out", () => {
  assert.equal(releaseStatus("2026-10-21", "2026-10-21").tone, "today");
  assert.equal(releaseStatus("2026-10-21", "2026-10-21").label, "Out today");
  assert.equal(releaseStatus("2026-10-19", "2026-10-21").tone, "released");
  assert.match(releaseStatus("2026-10-19", "2026-10-21").label, /^In cinemas since /);
  assert.equal(releaseStatus("2026-10-22", "2026-10-21").label, "Out tomorrow");
  assert.equal(releaseStatus("2026-10-24", "2026-10-21").label, "In 3 days");
  const missing = releaseStatus("", "2026-10-21");
  assert.equal(missing.date, "");
  assert.equal(missing.tone, "unknown");
});

test("Coming Soon offers Notify me only for a title with a future release date", () => {
  assert.equal(canNotifyForRelease(movie(1, "Next month", "2026-11-12"), "2026-10-21"), true);
  assert.equal(canNotifyForRelease(movie(2, "Out today", "2026-10-21"), "2026-10-21"), false);
  assert.equal(canNotifyForRelease(movie(3, "Already out", "2026-09-01"), "2026-10-21"), false);
  assert.equal(canNotifyForRelease(movie(4, "No date", ""), "2026-10-21"), false);
  assert.equal(canNotifyForRelease({ id: 5, title: "Malformed", release_date: "TBA" }, "2026-10-21"), false);
  const when = releaseReminderTimestamp("2026-11-12");
  assert.ok(new Date(when).getTime() > new Date(2026, 9, 21, 12).getTime(), "the reminder keeps the movie's own release date");
  assert.equal(releaseReminderTimestamp("TBA"), "");
});

test("the Coming Soon shelf keeps the future titles the released-only gate hides", () => {
  const results = normalizeUpcomingResults([
    { id: 1, title: "Due soon", release_date: "2026-10-29", vote_average: 6 },
    { id: 2, title: "Due later", release_date: "2026-12-01", vote_average: 8 },
    { id: 3, title: "Already released", release_date: "2026-10-01" },
    { id: 4, title: "Undated" }
  ], "2026-10-21");
  assert.deepEqual(results.map(item => item.title), ["Due soon", "Due later"]);
  assert.equal(results.every(item => canNotifyForRelease(item, "2026-10-21")), true);
});

test("Coming Soon reuses the existing cinema reminder instead of a second system", async () => {
  const home = await readFile(new URL("../script.js", import.meta.url), "utf8");
  assert.match(home, /import \{ addCinemaReminder, hasCinemaReminder, startCinemaReminderLoop \} from "\.\/scripts\/cinema-reminders\.js"/);
  assert.match(home, /savePushReminder \} from "\.\/scripts\/push-notifications\.js"/);
  assert.match(home, /notify:options\.notify\|\|id==="upcoming-rail"/, "only the Coming Soon shelf asks for the Notify me button");
  assert.match(home, /data-coming-reminder=/);
  assert.doesNotMatch(home, /new Notification\(|showNotification\(/, "the page never sends its own notification");
});
