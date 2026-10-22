import {tmdbApi, clearTmdbCache} from "./tmdb.js";
import {collectWeekReleases, getImageUrl, getMediaUrl, releaseStatus, weekWindow} from "./media.js";
import {escapeHtml} from "./utils.js";
import {getTasteProfile, getNotForMeKeys} from "./intelligence.js?v=20261018-feedback-sync-3";
import {addCinemaReminder, addCinemaReminderToCalendar, getCinemaReminders, hasCinemaReminder, startCinemaReminderLoop} from "./cinema-reminders.js";
import {enableCinemaPush, savePushReminder} from "./push-notifications.js";

const $ = id => document.getElementById(id);
const state = { stories: [], hero: null, calendar: [], lastUpdated: 0, weekWindow: null, weekDateKey: "" };

function localDateKey(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}
function addDays(iso, days) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function dateLabel(value, options = {month: "short", day: "numeric"}) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString(undefined, options) : "Date TBA";
}
function daysUntil(value) {
  const d = parseDate(value);
  if (!d) return null;
  const today = parseDate(localDateKey());
  return Math.round((d - today) / 86400000);
}
function releaseLanguage(value) {
  const days = daysUntil(value);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 14) return "In " + days + " days";
  if (days === -1) return "Yesterday";
  if (days < 0) return dateLabel(value) + " release";
  return "Coming " + dateLabel(value);
}
function mediaType(item) {
  return item?.media_type || (item?.name ? "tv" : "movie");
}
function titleOf(item) {
  return item?.title || item?.name || "Untitled";
}
function keyOf(item) {
  return String(item?.id || "") + ":" + mediaType(item);
}
function hrefFor(s) {
  return getMediaUrl({id: s.id, media_type: s.media_type});
}
function safeOverview(text, fallback) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 180) + (clean.length > 180 ? "…" : "") : fallback;
}
function story(item, category, label, headline, copy, kind, when = null, extra = {}) {
  return {
    id: String(item.id), media_type: mediaType(item), title: titleOf(item),
    poster_path: item.poster_path || "", backdrop_path: item.backdrop_path || "",
    overview: item.overview || "", vote_average: Number(item.vote_average || 0),
    popularity: Number(item.popularity || 0), date: when || item.release_date || item.first_air_date || "",
    category, label, headline, copy, kind, when, ...extra
  };
}
function scoreStory(s) {
  return Number(s.vote_average || 0) * 7 + Math.min(35, Number(s.popularity || 0) / 2);
}

function releaseRow(s) {
  const status = s.releaseStatus;
  if (!status || !status.date) return "";
  return '<div class="vivid-news-release is-' + escapeHtml(status.tone) + '">' +
    '<i class="bi bi-calendar-event" aria-hidden="true"></i>' +
    '<span>' + escapeHtml(dateLabel(status.date, {weekday:"short", month:"short", day:"numeric"})) + "</span>" +
    "<strong>" + escapeHtml(status.label) + "</strong></div>";
}
function reminderMarkup(s) {
  if (!s.when || s.kind === "trend") return "";
  // A date that already passed cannot be reminded about, so the button is only
  // offered while the release is still ahead. This week can hold both cases.
  const status = s.releaseStatus || releaseStatus(s.when);
  if (!(Number(status?.days) > 0)) return "";
  const reminded = hasCinemaReminder(s.id, s.kind);
  return '<button class="vivid-notify-release" data-id="' + s.id + '" data-type="' + s.media_type + '" data-kind="' + s.kind + '" ' + (reminded ? "disabled" : "") + '>' +
    (reminded ? "Reminder saved" : "Notify me") + "</button>" +
    (reminded ? '<button class="vivid-calendar-add" data-id="' + s.id + '" data-kind="' + s.kind + '">Calendar</button>' : "");
}
function card(s, compact = false) {
  const meta = s.when ? releaseLanguage(s.when) : (s.media_type === "tv" ? "TV series" : "Movie");
  return '<article class="vivid-news-card ' + (compact ? "is-compact" : "") + '">' +
    '<a class="vivid-news-image" href="' + escapeHtml(hrefFor(s)) + '">' +
      '<img src="' + getImageUrl(s.backdrop_path || s.poster_path, compact ? "w500" : "w780") + '" alt="' + escapeHtml(s.title) + '" loading="lazy" decoding="async">' +
      '<span>' + escapeHtml(s.label) + '</span>' +
      (s.videoKey ? '<span class="vivid-news-play"><i class="bi bi-play-fill"></i> Trailer</span>' : "") +
    "</a>" +
    '<div class="vivid-news-body"><small>' + escapeHtml(meta) + (s.vote_average ? " · ★ " + s.vote_average.toFixed(1) : "") + "</small>" +
    "<h3>" + escapeHtml(s.headline) + "</h3>" +
    releaseRow(s) +
    "<p>" + escapeHtml(s.copy) + "</p>" +
    '<div class="vivid-news-actions"><a href="' + escapeHtml(hrefFor(s)) + '">Explore <i class="bi bi-arrow-right"></i></a>' + reminderMarkup(s) + "</div></div></article>";
}
function section(title, kicker, items, id, description = "") {
  if (!items.length) return "";
  return '<section class="vivid-news-section" id="' + id + '">' +
    '<div class="vivid-news-section-head"><div><span>' + escapeHtml(kicker) + "</span><h2>" + escapeHtml(title) + "</h2>" +
    (description ? "<p>" + escapeHtml(description) + "</p>" : "") + '</div><a href="discover.html">Explore more <i class="bi bi-arrow-up-right"></i></a></div>' +
    '<div class="vivid-news-grid">' + items.map(x => card(x)).join("") + "</div></section>";
}
function weekSection(items = []) {
  const window = state.weekWindow || weekWindow();
  const range = window.start && window.end
    ? dateLabel(window.start, {weekday:"short", month:"short", day:"numeric"}) + " – " + dateLabel(window.end, {weekday:"short", month:"short", day:"numeric"})
    : "this week";
  const head = '<div class="vivid-news-section-head"><div><span>THIS WEEK</span><h2>This week</h2>' +
    "<p>Releases dated inside the current week (" + escapeHtml(range) + "). Every date is checked against today, and the list rebuilds when the week changes.</p></div>" +
    '<a href="discover.html">Explore more <i class="bi bi-arrow-up-right"></i></a></div>';
  const dated = [...items].sort((a, b) => String(a.when || "").localeCompare(String(b.when || "")));
  if (!dated.length) {
    return '<section class="vivid-news-section" id="week-feed">' + head +
      '<div class="vivid-news-empty"><i class="bi bi-calendar3"></i><h2>No dated releases in this window.</h2>' +
      "<p>Titles without a confirmed release date stay out of this list instead of being given a guessed date. The release calendar below covers the weeks ahead.</p></div></section>";
  }
  return '<section class="vivid-news-section" id="week-feed">' + head +
    '<div class="vivid-news-grid">' + dated.map(x => card(x)).join("") + "</div></section>";
}
function scheduleWeekRollover() {
  window.clearTimeout(scheduleWeekRollover.timer);
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 10);
  const delay = Math.max(5000, nextMidnight.getTime() - now.getTime());
  scheduleWeekRollover.timer = window.setTimeout(() => {
    clearTmdbCache();
    load().catch(error => console.warn("Vivid week rollover failed:", error));
  }, delay);
}
function renderFinderResults(results, query) {
  const el = $("news-search-results");
  if (!el) return;
  el.hidden = false;
  if (!results.length) {
    el.innerHTML = '<div class="vivid-news-search-empty"><strong>No match found in Vivid.</strong><span>Try the title name, a shorter phrase, or open Discover.</span><a href="discover.html?q=' + encodeURIComponent(query) + '">Open Discover</a></div>';
    return;
  }
  el.innerHTML = '<div class="vivid-news-search-head"><div><span>VIVID SEARCH</span><h2>Here’s what I found</h2></div><button type="button" id="news-search-close" aria-label="Close search results"><i class="bi bi-x-lg"></i></button></div><div class="vivid-news-search-grid">' +
    results.slice(0,8).map(item => '<a class="vivid-news-search-card" href="' + escapeHtml(getMediaUrl(item)) + '"><img src="' + getImageUrl(item.poster_path || item.backdrop_path, "w342") + '" alt="' + escapeHtml(titleOf(item)) + '" loading="lazy"><div><strong>' + escapeHtml(titleOf(item)) + '</strong><small>' + escapeHtml(mediaType(item) === "tv" ? "TV series" : "Movie") + (item.release_date || item.first_air_date ? " · " + escapeHtml((item.release_date || item.first_air_date).slice(0,4)) : "") + (item.vote_average ? " · ★ " + Number(item.vote_average).toFixed(1) : "") + '</small><p>' + escapeHtml(safeOverview(item.overview, "Open the title for the full cinema brief.")) + '</p><span>Open cinema brief <i class="bi bi-arrow-right"></i></span></div></a>').join("") +
    '</div>';
  $("news-search-close")?.addEventListener("click", () => { el.hidden = true; });
}
async function runNewsSearch(query) {
  const q = String(query || "").trim();
  if (!q) return;
  const el = $("news-search-results");
  if (el) { el.hidden = false; el.innerHTML = '<div class="vivid-news-search-empty"><i class="bi bi-search"></i><strong>Searching Vivid…</strong><span>Checking movies and series in the catalogue.</span></div>'; }
  try {
    const data = await tmdbApi.searchMulti(q);
    const results = (data.results || []).filter(item => ["movie","tv"].includes(mediaType(item)));
    renderFinderResults(results, q);
  } catch (error) {
    console.warn("Vivid News search unavailable:", error);
    if (el) el.innerHTML = '<div class="vivid-news-search-empty"><strong>Search is temporarily unavailable.</strong><span>You can still browse the live cinema feed below.</span></div>';
  }
}
function emptyState() {
  return '<div class="vivid-news-empty"><i class="bi bi-stars"></i><h2>Nothing new here yet.</h2><p>Try Everything or Discover for the full catalogue.</p><a href="discover.html">Open Discover</a></div>';
}
function renderHero() {
  const hero = state.hero;
  const art = $("news-hero-art"), meta = $("news-hero-meta");
  if (!hero || !art) return;
  art.style.backgroundImage = "url('" + getImageUrl(hero.backdrop_path || hero.poster_path, "w1280") + "')";
  if (meta) meta.innerHTML = '<span>IN THE SPOTLIGHT</span><strong>' + escapeHtml(hero.title) + '</strong><small>' +
    (hero.media_type === "tv" ? "TV" : "Movie") + " · ★ " + (hero.vote_average ? hero.vote_average.toFixed(1) : "—") + "</small>";
}
function renderCalendar(filter = "all") {
  const el = $("news-calendar");
  if (!el) return;
  const days = state.calendar.slice(0, 10);
  if (!days.length || filter !== "all") { el.innerHTML = ""; return; }
  el.innerHTML = '<div class="vivid-calendar-head"><div><span>RELEASE CALENDAR</span><h2>What lands next</h2><p>Dates are checked against the current day, not a stale upcoming list.</p></div></div>' +
    '<div class="vivid-calendar-list">' + days.map(day => '<a class="vivid-calendar-day" href="' + escapeHtml(hrefFor(day.item)) + '"><span>' + escapeHtml(dateLabel(day.date, {weekday:"short",month:"short",day:"numeric"})) +
      '</span><strong>' + escapeHtml(day.title) + '</strong><small>' + escapeHtml(day.media_type === "tv" ? "Series" : "Movie") + '</small><i class="bi bi-chevron-right"></i></a>').join("") + "</div>";
}
function render(filter = "all") {
  const feed = $("news-feed");
  if (!feed) return;
  const all = state.stories;
  let list = all;
  if (filter !== "all") list = all.filter(x => x.category === filter);
  renderCalendar(filter);
  if (filter !== "all") {
    feed.innerHTML = filter === "week" ? weekSection(list) : list.length ? section(
      filter === "today" ? "What's new today" : filter === "coming" ? "Coming up" : filter === "episodes" ? "TV to catch today" : filter === "trending" ? "Trending now" : "Picked for you",
      filter === "forYou" ? "PERSONALIZED" : filter.toUpperCase(),
      list, "filtered-feed"
    ) : emptyState();
    wire();
    updateStatus(list.length);
    return;
  }
  const by = category => all.filter(x => x.category === category);
  const forYou = by("forYou");
  const sections =
    section("Fresh today", "TODAY", by("today"), "today-feed", "New releases and episodes dated for today.") +
    weekSection(by("week")) +
    section("Coming up", "RELEASE RADAR", by("coming"), "coming-feed", "Upcoming titles only — past releases are rejected before they reach this feed.") +
    section(forYou.length ? "Picked for you" : "Worth a look", forYou.length ? "PERSONALIZED" : "CURATED", forYou, "for-you-feed", forYou.length ? "Built from your Vivid taste signals." : "Strong catalogue picks while Vivid learns what you like.") +
    section("On the radar", "TRENDING", by("trending"), "trending-feed", "Titles gaining attention right now.") +
    section("Trailer watch", "TRAILERS", by("trailers"), "trailer-feed", "Titles with fresh video material worth checking out.");
  feed.innerHTML = all.some(item => item && item.id) ? sections : emptyState();
  wire();
  updateStatus(all.length);
}
function updateStatus(count) {
  const status = $("news-status");
  if (status) status.textContent = count + " useful updates · refreshed " + new Date(state.lastUpdated || Date.now()).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  const updated = $("news-updated");
  if (updated) updated.textContent = "Catalogue data · TMDB";
}
function addUnique(target, seen, s) {
  if (!s?.id) return;
  const key = s.category + ":" + keyOf(s);
  if (seen.has(key)) return;
  seen.add(key); target.push(s);
}
async function addTrailerStories(target, source, seen, limit = 8) {
  const candidates = source.slice(0, 10);
  const results = await Promise.allSettled(candidates.map(x => mediaType(x) === "tv" ? tmdbApi.tvVideos(x.id) : tmdbApi.movieVideos(x.id)));
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const videos = (r.value?.results || []).filter(v => v.site === "YouTube" && v.key && ["Trailer","Teaser"].includes(v.type));
    const chosen = videos.find(v => v.type === "Trailer") || videos[0];
    if (!chosen) return;
    const x = candidates[i];
    addUnique(target, seen, story(x, "trailers", "TRAILER WATCH", titleOf(x) + " has something to watch.", safeOverview(x.overview, "Open the title for the latest trailer, cast and details."), "trailer", x.release_date || x.first_air_date || null, {videoKey: chosen.key}));
  });
  return target.slice(0, limit);
}
function tasteParams(taste) {
  const genres = Object.entries(taste?.genres || {}).sort((a,b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
  return genres.length ? {with_genres: genres.join("|"), sort_by: "popularity.desc", "vote_count.gte": "50"} : {sort_by: "popularity.desc", "vote_count.gte": "200"};
}
async function load() {
  const now = localDateKey();
  // "This week" follows the current Monday–Sunday week, not a rolling seven
  // days, so the list changes when the week changes instead of sliding daily.
  const currentWeek = weekWindow();
  const weekStart = currentWeek.start;
  const weekEnd = currentWeek.end;
  state.weekWindow = currentWeek;
  state.weekDateKey = now;
  const futureEnd = addDays(now, 45);
  const core = await Promise.allSettled([
    tmdbApi.trending("all", "day"),
    tmdbApi.newMovies(1, now, now),
    tmdbApi.newTv(1, now, now),
    tmdbApi.newMovies(1, weekStart, weekEnd),
    tmdbApi.newTv(1, weekStart, weekEnd),
    tmdbApi.futureMovies(1, now, futureEnd),
    tmdbApi.futureTv(1, now, futureEnd),
    tmdbApi.popularMovies(1),
    tmdbApi.popularTv(1),
    // TMDB sorts discovery results by popularity, not release date. Fetch more
    // than one page so quieter releases from Monday/Tuesday are not silently
    // omitted from the weekly radar.
    tmdbApi.newMovies(2, weekStart, weekEnd),
    tmdbApi.newMovies(3, weekStart, weekEnd),
    tmdbApi.newTv(2, weekStart, weekEnd),
    tmdbApi.newTv(3, weekStart, weekEnd)
  ]);
  const coreNames = ["trending","new movies today","new TV today","movies this week","TV this week","future movies","future TV","popular movies","popular TV","movies this week page 2","movies this week page 3","TV this week page 2","TV this week page 3"];
  const failedCore = core.map((result, i) => result.status === "rejected" ? {endpoint:coreNames[i], error:String(result.reason?.message || result.reason || "Unknown error")} : null).filter(Boolean);
  if (failedCore.length) console.warn("Vivid News catalogue requests failed:", failedCore);
  const value = i => core[i]?.status === "fulfilled" ? core[i].value : {results:[]};
  if (failedCore.length === core.length) {
    console.error("Vivid News cannot load any catalogue data. Check TMDB API key, network/CSP, and request failures above.", failedCore);
    const feed = $("news-feed");
    if (feed) feed.innerHTML = '<div class="vivid-news-empty"><i class="bi bi-wifi-off"></i><h2>We couldn’t reach the cinema catalogue.</h2><p>The news feed is online, but all catalogue requests failed. Check your connection and try Refresh.</p><button type="button" id="news-retry-core">Try again</button></div>';
    const loading = $("news-loading"); if (loading) loading.hidden = true;
    const status = $("news-status"); if (status) status.textContent = "Catalogue connection failed";
    $("news-retry-core")?.addEventListener("click", () => { clearTmdbCache(); load().catch(error => console.error("Vivid News retry failed:", error)); });
    return;
  }
  const seen = new Set(), stories = [];
  const add = s => addUnique(stories, seen, s);

  const todayItems = [
    ...(value(1).results || []).map(x=>({...x,media_type:"movie"})),
    ...(value(2).results || []).map(x=>({...x,media_type:"tv"}))
  ].filter(x => (x.release_date || x.first_air_date) === now)
   .sort((a,b)=>Number(b.popularity||0)-Number(a.popularity||0));

  todayItems.slice(0, 8).forEach(x => {
    const type = mediaType(x);
    add(story(x, type === "tv" ? "episodes" : "today", type === "tv" ? "TV TODAY" : "NEW TODAY",
      titleOf(x) + (type === "tv" ? " is airing today." : " is new today."),
      safeOverview(x.overview, type === "tv" ? "A new episode or series entry is landing today." : "A fresh title just entered the catalogue."),
      "new", now));
  });

  // One dated list for the current week, drawn from every catalogue request the
  // page already makes. Titles with no usable date are counted, never guessed.
  const week = collectWeekReleases({
    movies: [3,9,10].flatMap(i => value(i).results || []).map(x=>({...x,media_type:"movie"})),
    tv: [4,11,12].flatMap(i => value(i).results || []).map(x=>({...x,media_type:"tv"})),
    extra: [
      ...todayItems,
      ...(value(5).results || []).map(x=>({...x,media_type:"movie"})),
      ...(value(6).results || []).map(x=>({...x,media_type:"tv"}))
    ]
  });
  const weekItems = week.items;
  state.weekWindow = week.window;

  weekItems.slice(0, 30).forEach(x => {
    const headline = x.status.tone === "released"
      ? titleOf(x) + " was released earlier this week."
      : x.status.tone === "today"
        ? titleOf(x) + " is released today."
        : titleOf(x) + " is due later this week.";
    const summary = x.status.tone === "released"
      ? x.status.label + ". " + safeOverview(x.overview,"This title has already arrived this week.")
      : x.status.tone === "today"
        ? "Release day is today. " + safeOverview(x.overview,"A fresh title arriving today.")
        : safeOverview(x.overview,"A newly arriving title worth keeping on your radar.");
    add(story(x,"week","THIS WEEK",headline,summary,"week",x.date,{releaseStatus:x.status}));
  });

  const coming = [
    ...(value(5).results || []).map(x=>({...x,media_type:"movie"})),
    ...(value(6).results || []).map(x=>({...x,media_type:"tv"}))
  ].filter(x => {
    const d=x.release_date||x.first_air_date;
    return d && d > weekEnd && d <= futureEnd;
  }).sort((a,b)=>String(a.release_date||a.first_air_date).localeCompare(String(b.release_date||b.first_air_date)));

  coming.slice(0, 12).forEach(x => add(story(x,"coming","COMING UP",
    titleOf(x) + " is on the way.",
    releaseLanguage(x.release_date||x.first_air_date) + " · " + safeOverview(x.overview,"A future release worth tracking."),
    "release",x.release_date||x.first_air_date)));

  const trendItems = (value(0).results || []).filter(x => ["movie","tv"].includes(mediaType(x)));
  trendItems.slice(0, 10).forEach(x => add(story(x,"trending","TRENDING NOW",
    titleOf(x) + " is heating up.",
    safeOverview(x.overview,"A title drawing attention across the current catalogue."),
    "trend",null)));

  // Render the core feed immediately. Optional intelligence must never blank the News page.
  state.stories = stories;
  state.calendar = [...coming, ...weekItems].map(item=>({
    item,date:item.release_date||item.first_air_date,title:titleOf(item),media_type:mediaType(item)
  })).filter(x=>x.date).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(0,10);
  state.hero = trendItems[0] || coming[0] || todayItems[0] || null;
  state.lastUpdated = Date.now();
  // Never leave the page in an empty loading state when the catalogue returns no matching rows.
  // The feed itself is rendered before optional personalization/trailer work begins.
  render(document.querySelector(".vivid-news-filter.is-active")?.dataset.filter || "all");
  renderHero();
  const loading = $("news-loading"); if (loading) loading.hidden = true;

  // Personalization is progressive: if it fails, curated popular titles remain.
  try {
    const taste = await getTasteProfile();
    const params = tasteParams(taste);
    const [m,t] = await Promise.allSettled([
      tmdbApi.discoverMovies(params),
      tmdbApi.discoverTv({...params, sort_by:"popularity.desc"})
    ]);
    let forYouItems = [
      ...(m.status === "fulfilled" ? (m.value?.results || []) : []).map(x=>({...x,media_type:"movie"})),
      ...(t.status === "fulfilled" ? (t.value?.results || []) : []).map(x=>({...x,media_type:"tv"}))
    ].filter(x=>!getNotForMeKeys().has(keyOf(x))).sort((a,b)=>scoreStory(b)-scoreStory(a)).slice(0,8);
    if (!forYouItems.length) forYouItems = [
      ...(value(7).results || []).map(x=>({...x,media_type:"movie"})),
      ...(value(8).results || []).map(x=>({...x,media_type:"tv"}))
    ].sort((a,b)=>scoreStory(b)-scoreStory(a)).slice(0,8);
    forYouItems.forEach(x=>add(story(x,"forYou","FOR YOU",
      titleOf(x) + " might be your kind of watch.",
      safeOverview(x.overview,"A Vivid pick based on catalogue signals."),
      "recommend",x.release_date||x.first_air_date||null)));
  } catch (error) {
    console.warn("Vivid News personalization unavailable:", error);
    [
      ...(value(7).results || []).map(x=>({...x,media_type:"movie"})),
      ...(value(8).results || []).map(x=>({...x,media_type:"tv"}))
    ].sort((a,b)=>scoreStory(b)-scoreStory(a)).slice(0,8).forEach(x=>add(story(x,"forYou","CURATED",
      titleOf(x) + " is worth a look.",
      safeOverview(x.overview,"A strong catalogue pick."),
      "recommend",x.release_date||x.first_air_date||null)));
  }

  // Trailer discovery is also progressive and never blocks the main feed.
  try {
    const trailerStories = [];
    await addTrailerStories(trailerStories, [...todayItems,...weekItems,...trendItems,...coming], new Set(), 8);
    trailerStories.forEach(add);
  } catch (error) {
    console.warn("Vivid News trailer discovery unavailable:", error);
  }
  state.stories = stories.sort((a,b) => scoreStory(b)-scoreStory(a));
  render(document.querySelector(".vivid-news-filter.is-active")?.dataset.filter || "all");
  renderHero();
  scheduleWeekRollover();
}
function wire() {
  document.querySelectorAll(".vivid-news-filter").forEach(button => {
    button.onclick = () => {
      document.querySelectorAll(".vivid-news-filter").forEach(x=>x.classList.remove("is-active"));
      button.classList.add("is-active"); render(button.dataset.filter);
    };
  });
  document.querySelectorAll(".vivid-notify-release").forEach(button => {
    button.onclick = async () => {
      const s = state.stories.find(x=>String(x.id)===button.dataset.id && x.media_type===button.dataset.type && x.kind===button.dataset.kind);
      if (!s) return;
      try {
        const reminder = addCinemaReminder({title:s.title,when:s.when,note:s.headline,contentId:s.id,mediaType:s.media_type,kind:s.kind});
        let pushEnabled = false;
        try { await enableCinemaPush(); await savePushReminder(reminder); pushEnabled=true; } catch {}
        const toast=$("news-toast");
        if (toast) { toast.textContent=pushEnabled ? "Vivid will remind you before " + s.title + "." : "Reminder saved. Allow notifications for background delivery."; toast.hidden=false; setTimeout(()=>toast.hidden=true,3500); }
        render(document.querySelector(".vivid-news-filter.is-active")?.dataset.filter||"all");
      } catch (e) {
        const toast=$("news-toast"); if(toast){toast.textContent=e.message||"Could not save reminder.";toast.hidden=false;}
      }
    };
  });
  document.querySelectorAll(".vivid-calendar-add").forEach(button => {
    button.onclick=()=>{ const r=getCinemaReminders().find(x=>x.contentId===button.dataset.id&&x.kind===button.dataset.kind); if(r){addCinemaReminderToCalendar(r);button.textContent="Added";} };
  });
}
async function refresh() {
  const button=$("news-refresh"),loading=$("news-loading");
  if(button){button.disabled=true;button.innerHTML='<i class="bi bi-arrow-repeat"></i> Updating…';}
  if(loading){loading.hidden=false;loading.textContent="Refreshing the cinema intelligence feed…";}
  clearTmdbCache();
  try { await load(); } catch(e) { console.warn("Vivid news refresh failed:",e); if(loading)loading.textContent="Could not refresh right now. Try again in a moment."; }
  finally { if(button){button.disabled=false;button.innerHTML='<i class="bi bi-arrow-clockwise"></i> Refresh';} }
}
$("news-refresh")?.addEventListener("click", refresh);
$("news-search-form")?.addEventListener("submit", event => {
  event.preventDefault();
  void runNewsSearch($("news-search")?.value);
});
$("news-search")?.addEventListener("keydown", event => {
  if(event.key !== "Enter") return;
  const q=event.currentTarget.value.trim();
  if(q) window.location.href="discover.html?q="+encodeURIComponent(q);
});
startCinemaReminderLoop();
// A page left open overnight must not keep yesterday's week on screen.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!state.weekDateKey || state.weekDateKey === localDateKey()) return;
  clearTmdbCache();
  load().catch(error => console.warn("Vivid week refresh failed:", error));
});
load().catch(e=>{console.warn("Vivid cinema news unavailable:",e);const loading=$("news-loading");if(loading)loading.textContent="Cinema news is temporarily unavailable.";});
