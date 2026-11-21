export const PLAYBACK_DRIFT_TOLERANCE_SECONDS = 1.5;
export const MAX_PLAYBACK_POSITION_SECONDS = 86400;

export function normalizePlaybackTimestamp(value) {
  if (value && typeof value.toMillis === "function") {
    const timestamp = Number(value.toMillis());
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function getExpectedPlaybackPosition(state, {
  nowMs = Date.now(),
  clockOffsetMs = 0
} = {}) {
  if (!state) return 0;
  const position = Math.max(0, Math.min(MAX_PLAYBACK_POSITION_SECONDS, Number(state.position) || 0));
  const durationValue = Number(state.duration);
  const duration = Number.isFinite(durationValue) && durationValue > 0
    ? Math.min(MAX_PLAYBACK_POSITION_SECONDS, durationValue)
    : MAX_PLAYBACK_POSITION_SECONDS;
  const updatedAt = normalizePlaybackTimestamp(state.updatedAt);
  const elapsed = state.status === "playing" && updatedAt > 0
    ? Math.max(0, (Number(nowMs) + Number(clockOffsetMs || 0) - updatedAt) / 1000)
    : 0;
  return Math.max(0, Math.min(duration, position + elapsed));
}

export function shouldCorrectPlayback(expectedPosition, actualPosition, toleranceSeconds = PLAYBACK_DRIFT_TOLERANCE_SECONDS) {
  const expected = Number(expectedPosition);
  if (!Number.isFinite(expected) || expected < 0) return false;
  if (actualPosition == null || !Number.isFinite(Number(actualPosition))) return true;
  const tolerance = Math.max(0, Number(toleranceSeconds) || 0);
  return Math.abs(expected - Number(actualPosition)) > tolerance;
}

export function isPlaybackRevisionStale(nextRevision, currentRevision) {
  const next = Number(nextRevision) || 0;
  const current = Number(currentRevision) || 0;
  return next < current;
}
