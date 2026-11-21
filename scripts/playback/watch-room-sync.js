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
  const positionAt = normalizePlaybackTimestamp(state.positionAtMs ?? state.updatedAt);
  const elapsed = state.status === "playing" && positionAt > 0
    ? Math.max(0, (Number(nowMs) + Number(clockOffsetMs || 0) - positionAt) / 1000)
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

export function shouldThrottlePlaybackWrite(previousStatus, nextStatus, previousEventAtMs, nowMs, minimumIntervalMs = 1800) {
  if (nextStatus !== "playing" || previousStatus !== "playing") return false;
  const previousEventAt = Number(previousEventAtMs);
  const now = Number(nowMs);
  const interval = Number(minimumIntervalMs);
  if (!Number.isFinite(previousEventAt) || previousEventAt <= 0) return false;
  if (!Number.isFinite(now) || now < previousEventAt) return false;
  if (!Number.isFinite(interval) || interval <= 0) return false;
  return now - previousEventAt < interval;
}


export function getEstimatedLocalPlaybackPosition({
  position,
  status,
  duration,
  observedAtMs
} = {}, { nowMs = Date.now() } = {}) {
  if (position == null) return null;
  const raw = Number(position);
  if (!Number.isFinite(raw) || raw < 0) return null;
  const maxDuration = Number(duration);
  const ceiling = Number.isFinite(maxDuration) && maxDuration > 0
    ? Math.min(MAX_PLAYBACK_POSITION_SECONDS, maxDuration)
    : MAX_PLAYBACK_POSITION_SECONDS;
  const observedAt = Number(observedAtMs);
  const elapsed = status === "playing" && Number.isFinite(observedAt) && observedAt > 0
    ? Math.max(0, (Number(nowMs) - observedAt) / 1000)
    : 0;
  return Math.max(0, Math.min(ceiling, raw + elapsed));
}

export function classifyPlaybackEvent({ event, status, previousStatus } = {}) {
  const name = String(event || "").toLowerCase();
  const nextStatus = String(status || "").toLowerCase();
  if (/(seek|scrub)/.test(name) || nextStatus === "seeked" || nextStatus === "seeking") return "seek";
  if (/(ended|completed)/.test(name) || nextStatus === "ended" || nextStatus === "completed") return "ended";
  if (/(pause)/.test(name) || nextStatus === "paused" || nextStatus === "pause") return "pause";
  if (name === "play" || nextStatus === "play") return "play";
  if (name === "playing" || nextStatus === "playing") {
    return String(previousStatus || "").toLowerCase() === "playing" ? "progress" : "play";
  }
  return "progress";
}
