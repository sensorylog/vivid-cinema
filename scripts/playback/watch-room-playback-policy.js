/**
 * Decide whether a guest may follow the room clock.
 * A guest follows the room clock as soon as their active screening is open.
 * The provider/browser may still require one user gesture before audible
 * playback can begin; after that, remote commands keep the player aligned.
 */
export function getGuestPlaybackAction({ role, joinedPlayback, playbackStatus } = {}) {
  if (role !== "guest") return "ignore";
  if (!joinedPlayback) return "pause";
  return playbackStatus === "playing" ? "follow" : "pause";
}
