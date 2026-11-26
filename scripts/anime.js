import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia } from "./media.js";
import { escapeHtml } from "./utils.js";
import { FREE_ANIME_SAMPLE_IDS } from "./anime-free-policy.js";

const grid = document.getElementById("anime-grid");
const status = document.getElementById("anime-status");
const more = document.getElementById("anime-load-more");

function card(item) {
  const href = getMediaUrl({ ...item, media_type: "tv" }) + "&anime=1";
  const title = item.title || item.name || "Anime title";
  return '<a class="vivid-anime-card vivid-free-anime-card" href="' + escapeHtml(href) + '">' +
    '<div class="vivid-anime-poster"><img loading="lazy" decoding="async" src="' + escapeHtml(getImageUrl(item.poster_path, "w342")) + '" alt="' + escapeHtml(title) + '">' +
    '<span>FREE SAMPLE</span><b>EPISODE 1</b></div>' +
    '<div class="vivid-anime-card-copy"><strong>' + escapeHtml(title) + '</strong><small>One episode preview</small></div></a>';
}
async function load() {
  if (more) more.hidden = true;
  if (grid) {
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = '<div class="vivid-anime-loading">' + Array.from({ length: 6 }, () => '<div class="vivid-anime-skeleton"></div>').join("") + '</div>';
  }
  if (status) status.textContent = "Loading the free sample collection…";
  const results = await Promise.allSettled(FREE_ANIME_SAMPLE_IDS.map(id => tmdbApi.tvDetails(id)));
  const items = results
    .filter(result => result.status === "fulfilled")
    .map(result => normalizeMedia(result.value, "tv"))
    .filter(item => item?.id && Number(item.id) > 0);
  if (!items.length) {
    if (grid) grid.innerHTML = '<div class="vivid-anime-empty">The free sample collection is temporarily unavailable. <button type="button" data-anime-retry>Try again</button></div>';
    if (status) status.textContent = "Free anime samples unavailable.";
  } else {
    if (grid) grid.innerHTML = items.map(card).join("");
    if (status) status.textContent = items.length + " free sample series · one episode per series. The full anime catalogue is part of Vivid Anime Premium.";
  }
  grid?.removeAttribute("aria-busy");
}
grid?.addEventListener("click", event => {
  if (event.target.closest("[data-anime-retry]")) void load();
});
void load();
