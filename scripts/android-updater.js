import {
  isAndroidUpdateCheckFresh,
  readAndroidUpdateState,
  shouldShowAndroidUpdate,
  writeAndroidUpdateState
} from "./android-update-state.js";

const OWNER = "sensorylog";
const REPO = "vivid-cinema";
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

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

function latestAndroidBuild(assets) {
  const apk = assets.find(asset => asset.name === "Vivid-Cinema-Android.apk");
  const metadata = assets.map(asset => {
    const match = /^Vivid-Cinema-Android-build-(\d+)\.json$/i.exec(asset.name || "");
    return match ? { ...asset, build: Number(match[1]) } : null;
  }).filter(Boolean).sort((a, b) => b.build - a.build)[0];

  if (apk?.browser_download_url && metadata && Number.isSafeInteger(metadata.build)) {
    return { build: metadata.build, url: apk.browser_download_url };
  }

  // Backward compatibility for versioned APKs from earlier workflow runs.
  const legacyApk = assets.map(asset => {
    const match = /^Vivid-Cinema-Android-(\d+(?:\.\d+){1,3})-build-(\d+)\.apk$/i.exec(asset.name || "");
    return match ? { ...asset, version: match[1], build: Number(match[2]) } : null;
  }).filter(Boolean).sort((a, b) => b.build - a.build)[0];
  return legacyApk?.browser_download_url
    ? { build: legacyApk.build, version: legacyApk.version, url: legacyApk.browser_download_url }
    : null;
}

async function checkForAndroidUpdate() {
  if (!nativeRuntime()) return;
  const local = window.VIVID_ANDROID_BUILD_INFO || { version: "0.0.0", build: 0 };
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  let state = readAndroidUpdateState(storage);

  // Render a previously discovered update immediately. Every page in the bundled
  // site loads this module, so persistent state prevents both repeated API calls
  // and a dismissed notice reappearing on the next navigation.
  if (shouldShowAndroidUpdate(state, Number(local.build || 0))) {
    createUpdateNotice(state.update, () => {
      state = { ...state, dismissedBuild: state.update.build };
      writeAndroidUpdateState(storage, state);
    });
  }
  if (isAndroidUpdateCheckFresh(state)) return;

  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (!response.ok) {
      writeAndroidUpdateState(storage, { ...state, checkedAt: Date.now(), failed: true });
      return;
    }
    const release = await response.json();
    const remote = latestAndroidBuild(Array.isArray(release.assets) ? release.assets : []);
    const version = String(release.tag_name || local.version || "latest").replace(/^v/i, "");
    state = {
      ...state,
      checkedAt: Date.now(),
      failed: false,
      update: remote ? { ...remote, version: remote.version || version } : null
    };
    writeAndroidUpdateState(storage, state);
    if (shouldShowAndroidUpdate(state, Number(local.build || 0))) {
      createUpdateNotice(state.update, () => {
        state = { ...state, dismissedBuild: state.update.build };
        writeAndroidUpdateState(storage, state);
      });
    }
  } catch (error) {
    // Avoid hammering the unauthenticated GitHub API on every page while offline.
    writeAndroidUpdateState(storage, { ...state, checkedAt: Date.now(), failed: true });
    console.debug("Vivid Android update check skipped:", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void checkForAndroidUpdate(), { once: true });
} else {
  void checkForAndroidUpdate();
}

// Re-check after returning from Android Settings or the package installer. The
// persistent cooldown makes these lifecycle events cheap when no check is due.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkForAndroidUpdate();
});
window.addEventListener("online", () => void checkForAndroidUpdate());
