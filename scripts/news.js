import {tmdbApi, clearTmdbCache} from "./tmdb.js";
import {getImageUrl, getMediaUrl} from "./media.js";
import {escapeHtml} from "./utils.js";
import {getTasteProfile, getNotForMeKeys} from "./intelligence.js";
import {addCinemaReminder, addCinemaReminderToCalendar, getCinemaReminders, hasCinemaReminder, startCinemaReminderLoop} from "./cinema-reminders.js";
import {enableCinemaPush, savePushReminder} from "./push-notifications.js";

const $ = id => document.getElementById(id);
const state = { stories: [], hero: null, calendar: [], lastUpdated: 0 };

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

function reminderMarkup(s) {
  if (!s.when || s.kind === "trend") return "";
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
    feed.innerHTML = list.length ? section(
      filter === "today" ? "What's new today" : filter === "week" ? "This week's watchlist" : filter === "coming" ? "Coming up" : filter === "episodes" ? "TV to catch today" : filter === "trending" ? "Trending now" : "Picked for you",
      filter === "forYou" ? "PERSONALIZED" : filter.toUpperCase(),
      list, "filtered-feed"
    ) : emptyState();
    wire();
    updateStatus(list.length);
    return;
  }
  const by = category => all.filter(x => x.category === category);
  const forYou = by("forYou");
  feed.innerHTML =
    section("Fresh today", "TODAY", by("today"), "today-feed", "New releases and episodes that are actually dated for today.") +
    section("This week", "THIS WEEK", by("week"), "week-feed", "A focused shortlist of what is newly arriving around the current week.") +
    section("Coming up", "RELEASE RADAR", by("coming"), "coming-feed", "Upcoming titles only — past releases are rejected before they reach this feed.") +
    section(forYou.length ? "Picked for you" : "Worth a look", forYou.length ? "PERSONALIZED" : "CURATED", forYou, "for-you-feed", forYou.length ? "Built from your Vivid taste signals." : "Strong catalogue picks while Vivid learns what you like.") +
    section("On the radar", "TRENDING", by("trending"), "trending-feed", "Titles gaining attention right now.") +
    section("Trailer watch", "TRAILERS", by("trailers"), "trailer-feed", "Titles with fresh video material worth checking out.") ||
    emptyState();
  wire();
  updateStatus(all.length);
}
function updateStatus(count) {
  const status = $("news-status");
  if (status) status.textContent = count + " useful updates · refreshed " + new Date(state.lastUpdated || Date.now()).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  const updated = $("news-updated");
  if (updated) updated.textContent = "TMDB catalogue checked live";
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
  const weekEnd = addDays(now, 7);
  const futureEnd = addDays(now, 45);
  const [trending, todayMovies, todayTv, weekMovies, weekTv, future, futureTv, popularMovies, popularTv, tasteResult] = await Promise.allSettled([
    tmdbApi.trending("all", "day"),
    tmdbApi.newMovies(1, now, now),
    tmdbApi.newTv(1, now, now),
    tmdbApi.newMovies(1, now, weekEnd),
    tmdbApi.newTv(1, now, weekEnd),
    tmdbApi.futureMovies(1, now, futureEnd),
    tmdbApi.futureTv(1, now, futureEnd),
    tmdbApi.popularMovies(1),
    tmdbApi.popularTv(1),
    getTasteProfile()
  ]);
  const seen = new Set(), stories = [];
  const add = s => addUnique(stories, seen, s);
  const todayItems = [...(todayMovies.value?.results || []).map(x=>({...x,media_type:"movie"})), ...(todayTv.value?.results || []).map(x=>({...x,media_type:"tv"}))]
    .filter(x => (x.release_date || x.first_air_date) === now)
    .sort((a,b)=>Number(b.popularity||0)-Number(a.popularity||0));
  todayItems.slice(0, 8).forEach(x => add(story(x,"today","NEW TODAY",titleOf(x) + " is new today.",safeOverview(x.overview,"A fresh title just entered the catalogue."),"new",now)));
  const weekItems = [...(weekMovies.value?.results || []).map(x=>({...x,media_type:"movie"})), ...(weekTv.value?.results || []).map(x=>({...x,media_type:"tv"}))]
    .filter(x => { const d=x.release_date||x.first_air_date; return d && d >= now && d <= weekEnd && d !== now; })
    .sort((a,b)=>String(a.release_date||a.first_air_date).localeCompare(String(b.release_date||b.first_air_date)));
  weekItems.slice(0, 10).forEach(x => add(story(x,"week","THIS WEEK",titleOf(x) + " arrives this week.",safeOverview(x.overview,"A newly arriving title worth keeping on your radar."),"week",x.release_date||x.first_air_date)));
  const coming = [...(future.value?.results || []).map(x=>({...x,media_type:"movie"})), ...(futureTv.value?.results || []).map(x=>({...x,media_type:"tv"}))]
    .filter(x => { const d=x.release_date||x.first_air_date; return d && d > weekEnd && d <= futureEnd; })
    .sort((a,b)=>String(a.release_date||a.first_air_date).localeCompare(String(b.release_date||b.first_air_date)));
  coming.slice(0, 12).forEach(x => add(story(x,"coming","COMING UP",titleOf(x) + " is on the way.",releaseLanguage(x.release_date||x.first_air_date) + " · " + safeOverview(x.overview,"A future release worth tracking."),"release",x.release_date||x.first_air_date)));
  const trendItems = (trending.value?.results || []).filter(x => ["movie","tv"].includes(mediaType(x)));
  trendItems.slice(0, 10).forEach(x => add(story(x,"trending","TRENDING NOW",titleOf(x) + " is heating up.",safeOverview(x.overview,"A title drawing attention across the current catalogue."),"trend",null)));
  const taste = tasteResult.status === "fulfilled" ? tasteResult.value : null;
  let forYouItems = [];
  if (taste) {
    const params = tasteParams(taste);
    const [m,t] = await Promise.allSettled([tmdbApi.discoverMovies(params), tmdbApi.discoverTv({...params, sort_by:"popularity.desc"})]);
    forYouItems = [...(m.value?.results || []).map(x=>({...x,media_type:"movie"})), ...(t.value?.results || []).map(x=>({...x,media_type:"tv"}))]
      .filter(x=>!getNotForMeKeys().has(keyOf(x)))
      .sort((a,b)=>scoreStory(b)-scoreStory(a)).slice(0,8);
  }
  if (!forYouItems.length) forYouItems = [...(popularMovies.value?.results || []).map(x=>({...x,media_type:"movie"})), ...(popularTv.value?.results || []).map(x=>({...x,media_type:"tv"}))].sort((a,b)=>scoreStory(b)-scoreStory(a)).slice(0,8);
  forYouItems.forEach(x=>add(story(x,"forYou","FOR YOU",titleOf(x) + " might be your kind of watch.",safeOverview(x.overview,"A Vivid pick based on catalogue signals."),"recommend",x.release_date||x.first_air_date||null)));
  const trailerSource = [...todayItems,...weekItems,...trendItems,...coming];
  const trailerStories = [];
  await addTrailerStories(trailerStories, trailerSource, new Set(), 8);
  trailerStories.forEach(add);
  state.stories = stories.sort((a,b) => scoreStory(b)-scoreStory(a));
  state.calendar = [...coming, ...weekItems].map(item=>({item,date:item.release_date||item.first_air_date,title:titleOf(item),media_type:mediaType(item)}))
    .filter(x=>x.date).sort((a,b)=>x.date.localeCompare(b.date)).slice(0,10);
  state.hero = trendItems[0] || coming[0] || todayItems[0] || null;
  state.lastUpdated = Date.now();
  render(document.querySelector(".vivid-news-filter.is-active")?.dataset.filter || "all");
  renderHero();
  const loading = $("news-loading"); if (loading) loading.hidden = true;
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
$("news-search")?.addEventListener("keydown", event => {
  if(event.key !== "Enter") return;
  const q=event.currentTarget.value.trim();
  if(q) window.location.href="discover.html?q="+encodeURIComponent(q);
});
startCinemaReminderLoop();
load().catch(e=>{console.warn("Vivid cinema news unavailable:",e);const loading=$("news-loading");if(loading)loading.textContent="Cinema news is temporarily unavailable.";});
