const TRACK_STORAGE_KEY = "vivid:anime-audio-track:v1";

export function normalizeAnimeTrack(value) {
  return String(value || "").toLowerCase() === "dub" ? "dub" : "sub";
}

function getStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readAnimeTrackPreference(storage = getStorage()) {
  if (!storage) return "sub";
  try { return normalizeAnimeTrack(storage.getItem(TRACK_STORAGE_KEY)); } catch { return "sub"; }
}

export function writeAnimeTrackPreference(value, storage = getStorage()) {
  const track = normalizeAnimeTrack(value);
  try { storage?.setItem(TRACK_STORAGE_KEY, track); } catch { /* Playback must work when storage is blocked. */ }
  return track;
}

export function getAnimeGlobalEpisode(params, seasons = []) {
  const episode = Math.max(1, Number(params?.episode) || 1);
  if (params?.type !== "tv") return episode;
  const seasonNumber = Math.max(1, Number(params?.season) || 1);
  const ordered = (Array.isArray(seasons) ? seasons : [])
    .filter(season => Number(season?.season_number) > 0 && Number(season?.episode_count) > 0)
    .sort((a, b) => Number(a.season_number) - Number(b.season_number));
  if (!ordered.some(season => Number(season.season_number) === seasonNumber)) return episode;
  const previousEpisodes = ordered
    .filter(season => Number(season.season_number) < seasonNumber)
    .reduce((total, season) => total + Math.max(0, Number(season.episode_count) || 0), 0);
  return previousEpisodes + episode;
}
