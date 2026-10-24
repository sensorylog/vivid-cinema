const OWNER = "sensorylog";
const REPO = "vivid-cinema";
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

function nativeRuntime() {
  try { return Boolean(window.Capacitor?.isNativePlatform?.()); } catch { return false; }
}

function versionLabel(version, build) {
  return build ? `Version ${version} · build ${build}` : `Version ${version}`;
}

function createUpdateNotice(version, build, url) {
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
      <p>${versionLabel(version, build)} is ready to install.</p>
      <small>Keep your app fresh with the latest improvements.</small>
    </div>
    <div class="vivid-android-update-actions">
      <button type="button" class="vivid-android-update-install">Download &amp; Install</button>
      <button type="button" class="vivid-android-update-dismiss" aria-label="Dismiss update notice">Later</button>
    </div>`;
  document.body.appendChild(notice);
  notice.querySelector(".vivid-android-update-dismiss").addEventListener("click", () => notice.remove());
  notice.querySelector(".vivid-android-update-install").addEventListener("click", async event => {
    const button = event.currentTarget;
    const nativeUpdater = window.Capacitor?.Plugins?.VividUpdater;
    if (!nativeUpdater?.downloadAndInstall) {
      window.open(url, "_blank", "noopener");
      return;
    }
    button.disabled = true;
    button.textContent = "Starting download…";
    try {
      await nativeUpdater.downloadAndInstall({ url, version });
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

async function checkForAndroidUpdate() {
  if (!nativeRuntime()) return;
  const local = window.VIVID_ANDROID_BUILD_INFO || { version: "0.0.0", build: 0 };
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (!response.ok) return;
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const apk = assets.find(asset => asset.name === "Vivid-Cinema-Android.apk");
    const metadata = assets.map(asset => {
      const match = /^Vivid-Cinema-Android-build-(\\d+)\\.json$/i.exec(asset.name || "");
      return match ? { ...asset, build: Number(match[1]) } : null;
    }).filter(Boolean).sort((a, b) => b.build - a.build)[0];

    // The stable APK filename stays simple; its companion asset name carries the CI build.
    if (apk?.browser_download_url && metadata && metadata.build > Number(local.build || 0)) {
      const version = String(release.tag_name || local.version || "latest").replace(/^v/i, "");
      createUpdateNotice(version, metadata.build, apk.browser_download_url);
      return;
    }

    // Backward compatibility for versioned APKs from earlier workflow runs.
    const legacyApk = assets.map(asset => {
      const match = /^Vivid-Cinema-Android-(\d+(?:\.\d+){1,3})-build-(\d+)\.apk$/i.exec(asset.name || "");
      return match ? { ...asset, version: match[1], build: Number(match[2]) } : null;
    }).filter(Boolean).sort((a, b) => b.build - a.build)[0];
    if (legacyApk?.browser_download_url && legacyApk.build > Number(local.build || 0)) {
      createUpdateNotice(legacyApk.version, legacyApk.build, legacyApk.browser_download_url);
    }
  } catch (error) {
    console.debug("Vivid Android update check skipped:", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void checkForAndroidUpdate(), { once: true });
} else {
  void checkForAndroidUpdate();
}
