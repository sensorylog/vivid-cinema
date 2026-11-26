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

export function getAnimeEpisodeOffset(params, seasons = []) {
  if (params?.type !== "tv") return 0;
  const seasonNumber = Math.max(1, Number(params?.season) || 1);
  const ordered = (Array.isArray(seasons) ? seasons : [])
    .filter(season => Number(season?.season_number) > 0 && Number(season?.episode_count) > 0)
    .sort((a, b) => Number(a.season_number) - Number(b.season_number));
  if (!ordered.some(season => Number(season.season_number) === seasonNumber)) return 0;
  return ordered
    .filter(season => Number(season.season_number) < seasonNumber)
    .reduce((total, season) => total + Math.max(0, Number(season.episode_count) || 0), 0);
}

export function getAnimeGlobalEpisode(params, seasons = []) {
  return Math.max(1, Number(params?.episode) || 1) + getAnimeEpisodeOffset(params, seasons);
}

const ANIME_PROVIDER_EVENTS = new Set(["ready", "play", "playing", "pause", "paused", "buffering", "progress", "timeupdate", "seeked", "ended", "error"]);

export function normalizeAnimeProviderMessage(provider, rawPayload) {
  let payload = rawPayload;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const message = payload.data && typeof payload.data === "object" ? payload.data : payload;
  if (provider === "animeembed" && (payload.channel !== "animeembed" || payload.version !== 1)) return null;
  if (!["animeembed", "vidy"].includes(provider)) return null;
  const event = String(payload.event || message.event || "").toLowerCase();
  if (!ANIME_PROVIDER_EVENTS.has(event)) return null;
  const details = message.data && typeof message.data === "object" ? message.data : message;
  return {
    type: "PLAYER_EVENT",
    data: {
      ...details,
      event,
      player_status: event === "progress" ? "timeupdate" : event,
      player_progress: details.currentTime ?? details.progress ?? details.position ?? message.currentTime ?? message.progress ?? 0,
      player_duration: details.duration ?? message.duration ?? 0
    }
  };
}
