import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeResults } from "./media.js";
import { escapeHtml, getErrorMessage } from "./utils.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { year:"numeric", month:"long", day:"numeric" }).format(date);
}

function ageFromBirthday(birthday, deathday) {
  if (!birthday) return "";
  const end = deathday ? new Date(deathday + "T00:00:00") : new Date();
  const start = new Date(birthday + "T00:00:00");
  let age = end.getFullYear() - start.getFullYear();
  const month = end.getMonth() - start.getMonth();
  if (month < 0 || (month === 0 && end.getDate() < start.getDate())) age--;
  return age > 0 ? String(age) : "";
}

function mediaTitle(item) {
  return item.title || item.name || item.original_title || item.original_name || "Untitled";
}

function mediaDate(item) {
  return item.release_date || item.first_air_date || "";
}

function creditCards(credits) {
  const seen = new Set();
  const items = (credits || [])
    .filter((item) => item && item.id && item.media_type && item.poster_path)
    .filter((item) => {
      const key = item.media_type + ":" + item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a,b) => (Number(b.popularity)||0) - (Number(a.popularity)||0))
    .slice(0, 40);
  return items.length ? items.map((item) => {
    const title = mediaTitle(item);
    const year = mediaDate(item).slice(0,4);
    const role = item.character || "";
    return '<a class="vivid-person-credit" href="' + escapeHtml(getMediaUrl({ ...item, title, media_type:item.media_type })) + '"><div class="vivid-person-credit-poster"><img loading="lazy" src="' + getImageUrl(item.poster_path, "w342") + '" alt="' + escapeHtml(title) + '"></div><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml([year, role].filter(Boolean).join(" · ")) + '</small></a>';
  }).join("") : '<p class="vivid-muted">No credits are available for this person yet.</p>';
}

function creditTable(credits, includeMediaType = false) {
  const seen = new Set();
  const items = (credits || [])
    .filter(item => item && item.id && item.media_type)
    .filter(item => {
      const key = item.media_type + ":" + item.id + ":" + (item.character || item.job || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(mediaDate(b)).localeCompare(String(mediaDate(a))));
  if (!items.length) return '<p class="vivid-muted">No credits are available for this person yet.</p>';
  return '<div class="vivid-person-credit-table-wrap"><table class="vivid-person-credit-table"><thead><tr><th scope="col">Year</th><th scope="col">Title</th><th scope="col">Role</th></tr></thead><tbody>' +
    items.map(item => {
      const title = mediaTitle(item);
      const year = mediaDate(item).slice(0, 4) || '—';
      const role = item.character || item.job || item.department || '—';
      const mediaType = item.media_type === 'tv' ? 'TV' : 'Movie';
      return '<tr><td class="vivid-person-credit-year">' + escapeHtml(year) + '</td><td><a href="' +
        escapeHtml(getMediaUrl({ ...item, title, media_type: item.media_type })) + '">' +
        escapeHtml(title) + '</a>' + (includeMediaType ? '<small>' + mediaType + '</small>' : '') +
        '</td><td>' + escapeHtml(role) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function render(person) {
  const credits = person.combined_credits || {};
  const cast = Array.isArray(credits.cast) ? credits.cast : [];
  const crew = Array.isArray(credits.crew) ? credits.crew : [];
  const movieCast = cast.filter((item) => item.media_type === "movie");
  const tvCast = cast.filter((item) => item.media_type === "tv");
  const department = String(person.known_for_department || "").toLowerCase();
  const relevantCredits = department === "acting" ? cast
    : department === "directing" || department === "writing"
      ? crew.filter(item => String(item.department || "").toLowerCase() === department ||
          String(item.job || "").toLowerCase().includes(department === "directing" ? "director" : "writer"))
      : [...cast, ...crew];
  const uniqueKnownFor = new Map();
  const creditScore = item => (Number(item.popularity) || 0) +
    Math.log10(1 + Math.max(0, Number(item.vote_count) || 0)) * 8 +
    (Number(item.vote_average) || 0) * 1.5;
  for (const item of relevantCredits) {
    if (!item?.id || !item?.media_type || !item?.poster_path) continue;
    const key = item.media_type + ":" + item.id;
    const previous = uniqueKnownFor.get(key);
    if (!previous || creditScore(item) > creditScore(previous)) uniqueKnownFor.set(key, item);
  }
  const allKnownFor = [...uniqueKnownFor.values()].sort((a,b) => creditScore(b) - creditScore(a)).slice(0,8);
  const profile = person.profile_path || person.images?.profiles?.[0]?.file_path || "";
  const age = ageFromBirthday(person.birthday, person.deathday);
  const facts = [
    ["Known for", person.known_for_department || ""],
    ["Known credits", String(new Set([...cast, ...crew].filter(item => item?.id && item?.media_type).map(item => item.media_type + ":" + item.id)).size)],
    ["Gender", person.gender === 1 ? "Female" : person.gender === 2 ? "Male" : ""],
    ["Birthday", formatDate(person.birthday)],
    ["Day of death", formatDate(person.deathday)],
    ["Place of birth", person.place_of_birth || ""],
    ["Also known as", Array.isArray(person.also_known_as) ? person.also_known_as.slice(0, 3).join(", ") : ""]
  ].filter(([,value]) => value);

  const actingCredits = cast;
  const crewCredits = crew;
  document.title = person.name + " · Vivid Cinema";
  $("person-content").innerHTML =
    '<div class="vivid-person-layout">' +
      '<aside class="vivid-person-sidebar" aria-label="Person details">' +
        '<div class="vivid-person-profile"><img src="' + getImageUrl(profile, "w500") + '" alt="' + escapeHtml(person.name) + '"></div>' +
        '<section class="vivid-person-info"><h2>Personal Info</h2><dl>' +
          facts.map(([label,value]) => '<div class="vivid-person-info-item"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>').join("") +
        '</dl></section>' +
      '</aside>' +
      '<div class="vivid-person-main">' +
        '<section class="vivid-person-overview">' +
          '<span class="vivid-title-kicker">CAST & CREW</span><h1>' + escapeHtml(person.name) + '</h1>' +
          (person.known_for_department ? '<p class="vivid-person-role">' + escapeHtml(person.known_for_department) + '</p>' : '') +
          '<h2 class="vivid-person-subheading">Biography</h2>' +
          '<p class="vivid-person-bio">' + escapeHtml(person.biography || "No biography is available for this person yet.") + '</p>' +
        '</section>' +
        (allKnownFor.length ? '<section class="vivid-person-section"><div class="vivid-section-heading"><div><span>KNOWN FOR</span><h2>Known For</h2></div></div><div class="vivid-person-credit-rail">' + creditCards(allKnownFor) + '</div></section>' : '') +
        '<section class="vivid-person-section"><div class="vivid-section-heading"><div><span>FILMOGRAPHY</span><h2>Acting</h2></div></div>' + creditTable(actingCredits, true) + '</section>' +
        (crewCredits.length ? '<section class="vivid-person-section"><div class="vivid-section-heading"><div><span>FILMOGRAPHY</span><h2>Production & crew</h2></div></div>' + creditTable(crewCredits, true) + '</section>' : '') +
      '</div>' +
    '</div>';
}

async function init() {
  const id = params.get("id");
  if (!id) {
    $("person-content").innerHTML = '<section class="vivid-title-error"><i class="bi bi-person-x"></i><h1>Person not found</h1><p>This profile link is missing a person ID.</p><a class="vivid-button vivid-button--secondary" href="home.html">Back to browse</a></section>';
    return;
  }
  try {
    const person = await tmdbApi.personDetails(id);
    if (!person?.id || !person?.name) throw new Error("This person profile is unavailable.");
    render(person);
  } catch (error) {
    $("person-content").innerHTML = '<section class="vivid-title-error"><i class="bi bi-exclamation-circle"></i><h1>We couldn’t load this profile.</h1><p>' + escapeHtml(getErrorMessage(error)) + '</p><a class="vivid-button vivid-button--secondary" href="home.html">Back to browse</a></section>';
  }
}

document.addEventListener("DOMContentLoaded", init);
