const STORAGE_KEY = "vivid:library:v2";

const emptyLibrary = () => ({
  favorites: [],
  watchLater: [],
  history: []
});

export function getLocalLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      ...emptyLibrary(),
      ...(parsed && typeof parsed === "object" ? parsed : {})
    };
  } catch {
    return emptyLibrary();
  }
}

export function saveLocalLibrary(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

export function upsertLibraryItem(collection, item) {
  const library = getLocalLibrary();
  const items = Array.isArray(library[collection]) ? library[collection] : [];
  const key = String(item.mediaType || "movie") + ":" + String(item.id);

  library[collection] = [
    item,
    ...items.filter((entry) =>
      String(entry.mediaType || "movie") + ":" + String(entry.id) !== key
    )
  ];

  saveLocalLibrary(library);
  return library;
}

export function removeLibraryItem(collection, id, mediaType = "movie") {
  const library = getLocalLibrary();
  library[collection] = (library[collection] || []).filter(
    (entry) =>
      !(String(entry.id) === String(id) &&
        (entry.mediaType || "movie") === mediaType)
  );
  saveLocalLibrary(library);
  return library;
}
