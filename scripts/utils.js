export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

export function debounce(callback, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export function getMediaTitle(item = {}) {
  return item.title || item.name || "Untitled";
}

export function getMediaDate(item = {}) {
  return item.release_date || item.first_air_date || "";
}

export function getMediaYear(item = {}) {
  return getMediaDate(item).slice(0, 4);
}

export function getMediaType(item = {}) {
  return item.media_type || (item.first_air_date ? "tv" : "movie");
}

export function getPosterUrl(path, size = "w500") {
  return path ? "https://image.tmdb.org/t/p/" + size + path : "fav-icon.png";
}

export function getBackdropUrl(path, size = "w1280") {
  return path ? "https://image.tmdb.org/t/p/" + size + path : "";
}
