import { VIVID_CONFIG } from "./config.js";
import { getMediaDate, getMediaTitle, getMediaType } from "./utils.js";

export function normalizeMedia(item = {}, type = null) {
  const mediaType = type || getMediaType(item);
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
  return results.filter((item) => item && item.id != null).map((item) => normalizeMedia(item, type));
}

export function getMediaUrl(media) {
  const id = typeof media === "object" ? media.id : media;
  const type = typeof media === "object" ? media.media_type : "movie";
  return VIVID_CONFIG.routes.title + "?" + new URLSearchParams({ id: String(id), type });
}

export function getPersonUrl(person) {
  const id = typeof person === "object" ? person.id : person;
  return "person.html?" + new URLSearchParams({ id: String(id) });
}

export function getImageUrl(path, size = "w500") {
  return path ? VIVID_CONFIG.api.tmdbImageBaseUrl + "/" + size + path : "icons/vivid-icon.svg";
}
