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
    return /^\\d{4}-\\d{2}-\\d{2}$/.test(date) ? date : "";
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
