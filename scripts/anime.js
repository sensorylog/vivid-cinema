import { tmdbApi } from "./tmdb.js";
import { getImageUrl, getMediaUrl, normalizeMedia } from "./media.js";
import { FREE_ANIME_PREVIEWS } from "./anime-free-policy.js";
import { escapeHtml } from "./utils.js";
import { filterAllowedTitles } from "./parental-controls.js";

const grid = document.getElementById("anime-grid");
const status = document.getElementById("anime-status");
const more = document.getElementById("anime-load-more");

function card(item) {
  const title = item.title || item.name || "Anime title";
  const year = String(item.first_air_date || "").slice(0, 4);
  const url = getMediaUrl(item) + "&anime=1";
  return '<a class="vivid-anime-card" data-anime-key="tv:' + escapeHtml(item.id) + '" href="' + escapeHtml(url) + '">' +
    '<div class="vivid-anime-poster"><img loading="lazy" decoding="async" src="' + getImageUrl(item.poster_path, "w342") + '" alt="' + escapeHtml(title) + '"><span>FREE PREVIEW</span><b>EPISODE 1</b></div>' +
    '<div class="vivid-anime-card-copy"><strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(year) + ' · Season 1, Episode 1</small></div></a>';
}

async function load() {
  if (more) more.hidden = true;
  if (status) status.textContent = "Loading your six free anime previews…";
  grid?.setAttribute("aria-busy", "true");
  try {
    const results = await Promise.all(FREE_ANIME_PREVIEWS.map(async sample => {
      try {
        const details = await tmdbApi.tvDetails(sample.id);
        return details?.id ? normalizeMedia(details, "tv") : { id: sample.id, title: sample.title, media_type: "tv" };
      } catch (error) {
        console.warn("Free anime preview unavailable:", sample.id, error);
        return null;
      }
    }));
    const resolved = results.filter(Boolean);
    const items = await filterAllowedTitles(resolved);
    if (grid) grid.innerHTML = items.map(card).join("") || '<div class="vivid-anime-empty">No free anime previews match this profile’s viewing limits.</div>';
    if (status) status.textContent = items.length
      ? items.length + " available free anime previews · one free episode per title. Unlock the full catalogue with Vivid Anime Premium."
      : resolved.length ? "No free previews match this profile’s viewing limits." : "Free anime previews are temporarily unavailable.";
  } catch (error) {
    if (grid) grid.innerHTML = '<div class="vivid-anime-empty">Anime previews are temporarily unavailable. Please try again later.</div>';
    if (status) status.textContent = "Free anime is temporarily unavailable.";
  } finally {
    grid?.removeAttribute("aria-busy");
  }
}
load();
