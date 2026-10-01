const STORAGE_KEY = "vivid:library:v2";

const emptyLibrary = () => ({ favorites: [], watchLater: [], history: [] });

function itemKey(item) {
  const type = item.media_type || item.mediaType || "movie";
  return String(type) + ":" + String(item.id);
}

export function getLocalLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...emptyLibrary(), ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch { return emptyLibrary(); }
}

export function saveLocalLibrary(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

export function hasLibraryItem(collection, item) {
  const key = typeof item === "object" ? itemKey(item) : item;
  return (getLocalLibrary()[collection] || []).some((entry) => itemKey(entry) === key);
}

export function upsertLibraryItem(collection, item) {
  const library = getLocalLibrary();
  const items = Array.isArray(library[collection]) ? library[collection] : [];
  library[collection] = [item, ...items.filter((entry) => itemKey(entry) !== itemKey(item))];
  saveLocalLibrary(library);
  return library;
}

export function removeLibraryItem(collection, id, mediaType = "movie") {
  const library = getLocalLibrary();
  library[collection] = (library[collection] || []).filter(
    (entry) => itemKey(entry) !== String(mediaType) + ":" + String(id)
  );
  saveLocalLibrary(library);
  return library;
}

export function toggleLibraryItem(collection, item) {
  return hasLibraryItem(collection, item)
    ? removeLibraryItem(collection, item.id, item.media_type || item.mediaType || "movie")
    : upsertLibraryItem(collection, item);
}

export function clearLibraryCollection(collection) {
  const library = getLocalLibrary();
  library[collection] = [];
  saveLocalLibrary(library);
  return library;
}
