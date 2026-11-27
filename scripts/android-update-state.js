export const ANDROID_UPDATE_STATE_KEY = "vivid:android:update-state:v1";
export const ANDROID_UPDATE_SUCCESS_TTL_MS = 15 * 60 * 1000;
export const ANDROID_UPDATE_FAILURE_TTL_MS = 5 * 60 * 1000;

export function readAndroidUpdateState(storage) {
  try {
    const value = JSON.parse(storage?.getItem(ANDROID_UPDATE_STATE_KEY) || "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return {
      checkedAt: Number.isFinite(value.checkedAt) ? value.checkedAt : 0,
      failed: value.failed === true,
      dismissedBuild: Number.isSafeInteger(value.dismissedBuild) ? value.dismissedBuild : 0,
      update: value.update && Number.isSafeInteger(value.update.build) &&
        value.update.build > 0 && typeof value.update.url === "string"
        ? {
            build: value.update.build,
            version: String(value.update.version || "latest"),
            url: value.update.url
          }
        : null
    };
  } catch {
    return {};
  }
}

export function isAndroidUpdateCheckFresh(state, now = Date.now()) {
  const checkedAt = Number(state?.checkedAt || 0);
  if (!Number.isFinite(checkedAt) || checkedAt <= 0 || now < checkedAt) return false;
  const ttl = state?.failed ? ANDROID_UPDATE_FAILURE_TTL_MS : ANDROID_UPDATE_SUCCESS_TTL_MS;
  return now - checkedAt < ttl;
}

export function shouldShowAndroidUpdate(state, localBuild = 0) {
  const update = state?.update;
  return Boolean(
    update &&
    Number.isSafeInteger(update.build) &&
    update.build > Number(localBuild || 0) &&
    update.build > Number(state?.dismissedBuild || 0) &&
    typeof update.url === "string" &&
    update.url.startsWith("https://github.com/")
  );
}

export function writeAndroidUpdateState(storage, state) {
  try {
    storage?.setItem(ANDROID_UPDATE_STATE_KEY, JSON.stringify({
      checkedAt: Number.isFinite(state?.checkedAt) ? state.checkedAt : 0,
      failed: state?.failed === true,
      dismissedBuild: Number.isSafeInteger(state?.dismissedBuild) ? state.dismissedBuild : 0,
      update: state?.update || null
    }));
    return true;
  } catch {
    return false;
  }
}
