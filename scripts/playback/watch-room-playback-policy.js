/**
 * Decide whether a guest may follow the room clock.
 * Guests are held locally until they explicitly join the screening. This also
 * prevents an embed's own autoplay behaviour from becoming an independent
 * playback session while the host is still waiting.
 */
export function getGuestPlaybackAction({ role, joinedPlayback, playbackStatus } = {}) {
  if (role !== "guest") return "ignore";
  if (!joinedPlayback) return "pause";
  return playbackStatus === "playing" ? "follow" : "pause";
}
