import {
  androidVersionFromTag,
  latestAndroidBuild,
  selectLatestAndroidRelease
} from "./android-release-feed.js";
import {
  isAndroidUpdateCheckFresh,
  readAndroidUpdateState,
  shouldShowAndroidUpdate,
  writeAndroidUpdateState
} from "./android-update-state.js";

const OWNER = "sensorylog";
const REPO = "vivid-cinema";
const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;

function nativeRuntime() {
  try { return Boolean(window.Capacitor?.isNativePlatform?.()); } catch { return false; }
}

function versionLabel(version, build) {
  return build ? `Version ${version} · build ${build}` : `Version ${version}`;
}

function createUpdateNotice(update, onDismiss) {
  if (document.getElementById("vivid-android-update-notice")) return;
  const notice = document.createElement("section");
  notice.id = "vivid-android-update-notice";
  notice.className = "vivid-android-update-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.innerHTML = `
    <div class="vivid-android-update-copy">
      <span class="vivid-android-update-kicker">UPDATE AVAILABLE</span>
      <strong>Update Vivid Cinema</strong>
      <p>${versionLabel(update.version, update.build)} is ready to install.</p>
      <small>Keep your app fresh with the latest improvements.</small>
    </div>
    <div class="vivid-android-update-actions">
      <button type="button" class="vivid-android-update-install">Download &amp; Install</button>
      <button type="button" class="vivid-android-update-dismiss" aria-label="Dismiss update notice">Later</button>
    </div>`;
  document.body.appendChild(notice);
  notice.querySelector(".vivid-android-update-dismiss").addEventListener("click", () => {
    onDismiss();
    notice.remove();
  });
  notice.querySelector(".vivid-android-update-install").addEventListener("click", async event => {
    const button = event.currentTarget;
    const nativeUpdater = window.Capacitor?.Plugins?.VividUpdater;
    if (!nativeUpdater?.downloadAndInstall) {
      window.open(update.url, "_blank", "noopener");
      return;
    }
    button.disabled = true;
    button.textContent = "Starting download…";
    try {
      await nativeUpdater.downloadAndInstall({ url: update.url, version: update.version });
      button.textContent = "Downloading update…";
      const copy = notice.querySelector(".vivid-android-update-copy small");
      if (copy) copy.textContent = "Android will open the installer when the download finishes.";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Try Download Again";
      const copy = notice.querySelector(".vivid-android-update-copy small");
      if (copy) copy.textContent = error?.message || "The download could not start. Please try again.";
    }
  });
}

let updateCheckInFlight = false;

async function checkForAndroidUpdate() {
  // Google Play installs are updated by Google Play, never by the sideload APK feed.
  if (!nativeRuntime() || window.VIVID_ANDROID_DISTRIBUTION === "play" || updateCheckInFlight) return;
  updateCheckInFlight = true;
  try {
    const local = window.VIVID_ANDROID_BUILD_INFO || { version: "0.0.0", build: 0 };
    const storage = (() => { try { return window.localStorage; } catch { return null; } })();
    let state = readAndroidUpdateState(storage);

    if (shouldShowAndroidUpdate(state, Number(local.build || 0))) {
      createUpdateNotice(state.update, () => {
        state = { ...state, dismissedBuild: state.update.build };
        writeAndroidUpdateState(storage, state);
      });
    }
    if (isAndroidUpdateCheckFresh(state)) return;

    try {
      const response = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store"
      });
      if (!response.ok) {
        writeAndroidUpdateState(storage, { ...state, checkedAt: Date.now(), failed: true });
        return;
      }
      const releases = await response.json();
      const release = selectLatestAndroidRelease(releases);
      const remote = release ? latestAndroidBuild(release.assets) : null;
      if (!release || !remote) {
        // Windows releases are deliberately ignored. Retry soon if the Android
        // release is still being uploaded, without discarding a cached APK.
        writeAndroidUpdateState(storage, { ...state, checkedAt: Date.now(), failed: true });
        return;
      }
      const version = androidVersionFromTag(release.tag_name) || remote.version || local.version || "latest";
      state = {
        ...state,
        checkedAt: Date.now(),
        failed: false,
        update: { ...remote, version }
      };
      writeAndroidUpdateState(storage, state);
      if (shouldShowAndroidUpdate(state, Number(local.build || 0))) {
        createUpdateNotice(state.update, () => {
          state = { ...state, dismissedBuild: state.update.build };
          writeAndroidUpdateState(storage, state);
        });
      }
    } catch (error) {
      writeAndroidUpdateState(storage, { ...state, checkedAt: Date.now(), failed: true });
      console.debug("Vivid Android update check skipped:", error);
    }
  } finally {
    updateCheckInFlight = false;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void checkForAndroidUpdate(), { once: true });
} else {
  void checkForAndroidUpdate();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkForAndroidUpdate();
});
window.addEventListener("online", () => void checkForAndroidUpdate());
