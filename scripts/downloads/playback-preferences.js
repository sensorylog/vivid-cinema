import { normalizeLanguageTag } from "./subtitle-engine.js";

const STORAGE_KEY = "vivid:offline-playback-preferences:v1";

function readStore() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

function writeStore(store) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); return true; }
  catch { return false; }
}

export function getPlaybackPreferences(profileKey) {
  const store = readStore();
  return {
    ...(store.global || {}),
    ...(store.profiles?.[String(profileKey || "default")] || {})
  };
}

export function savePlaybackPreferences(profileKey, patch) {
  const store = readStore();
  const key = String(profileKey || "default");
  store.global = { ...(store.global || {}) };
  store.profiles = { ...(store.profiles || {}) };
  const normalizedPatch = { ...patch };
  for (const field of ["audioLanguage", "subtitleLanguage"]) {
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, field)) normalizedPatch[field] = normalizeLanguageTag(normalizedPatch[field]);
  }
  store.profiles[key] = { ...(store.profiles[key] || {}), ...normalizedPatch };
  for (const field of ["audioLanguage", "subtitleLanguage"]) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) store.global[field] = normalizeLanguageTag(patch[field]);
  }
  return writeStore(store);
}

export function playbackProfileKey(job, fileIndex = 0) {
  const media = job?.media || {};
  const type = media.media_type === "tv" ? "tv" : "movie";
  const identity = media.id ? String(media.id) : String(job?.id || job?.title || "local");
  const episode = type === "tv"
    ? ":s" + String(Number(media.season) || 0) + "e" + String(Number(media.episode) || 0)
    : "";
  return type + ":" + identity + episode + ":file:" + Math.max(0, Number(fileIndex) || 0);
}
