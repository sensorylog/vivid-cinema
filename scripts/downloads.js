import { androidVersionFromTag, latestAndroidBuild, selectLatestAndroidRelease } from "./android-release-feed.js";

const OWNER = "sensorylog";
const REPO = "vivid-cinema";
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const ANDROID_RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;
const RELEASE_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const ANDROID_RELEASE_PAGE = `https://github.com/${OWNER}/${REPO}/releases?q=android`;
const byId = id => document.getElementById(id);

function setDownload(id, url, filename) {
  const link = byId(id);
  if (!link || !url) return;
  link.href = url;
  link.dataset.filename = filename || "";
  link.rel = "noopener";
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function setAssetSize(id, asset, prefix) {
  const small = byId(id)?.querySelector("small");
  if (!small || !asset) return;
  const size = humanSize(asset.size);
  if (size) small.textContent = `${prefix} · ${size}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Release lookup returned ${response.status}`);
  return response.json();
}

function setReleaseFallback() {
  setDownload("windows-installer", RELEASE_PAGE, "View the latest official Vivid Cinema Windows installer");
  setDownload("windows-portable", RELEASE_PAGE, "View the latest official Vivid Cinema portable build");
  setDownload("android-apk", ANDROID_RELEASE_PAGE, "View Android releases");
}

async function loadLatestRelease() {
  setReleaseFallback();
  const [windowsResult, androidResult] = await Promise.allSettled([
    fetchJson(RELEASE_API),
    fetchJson(ANDROID_RELEASES_API)
  ]);
  const missing = [];

  if (windowsResult.status === "fulfilled") {
    const release = windowsResult.value;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assets.find(asset => /^Vivid-Cinema-Setup-\d+(?:\.\d+){1,3}\.exe$/i.test(asset.name || ""));
    const portable = assets.find(asset => /^Vivid-Cinema-Portable-\d+(?:\.\d+){1,3}\.exe$/i.test(asset.name || ""));

    if (installer) {
      setDownload("windows-installer", installer.browser_download_url, installer.name);
      setAssetSize("windows-installer", installer, "Windows installer");
    } else {
      missing.push("Windows installer");
    }
    if (portable) {
      setDownload("windows-portable", portable.browser_download_url, portable.name);
      setAssetSize("windows-portable", portable, "Portable Windows build");
    } else {
      missing.push("portable Windows build");
    }

    const version = String(release.tag_name || release.name || "").replace(/^v/i, "");
    if (version) byId("release-version").textContent = `Windows version ${version}`;
    if (release.published_at) {
      const date = new Date(release.published_at);
      if (!Number.isNaN(date.getTime())) {
        byId("release-date").textContent = `Released ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
      }
    }
    byId("all-releases").href = release.html_url || RELEASE_PAGE;
  } else {
    missing.push("Windows release information");
  }

  if (androidResult.status === "fulfilled") {
    const androidRelease = selectLatestAndroidRelease(androidResult.value);
    const androidAsset = androidRelease ? latestAndroidBuild(androidRelease.assets) : null;
    if (androidRelease && androidAsset) {
      const version = androidVersionFromTag(androidRelease.tag_name) || "latest";
      setDownload("android-apk", androidAsset.url, "Vivid-Cinema-Android.apk");
      const title = byId("android-apk")?.querySelector("strong");
      const subtitle = byId("android-apk")?.querySelector("small");
      if (title) title.textContent = "Download Android app";
      if (subtitle) subtitle.textContent = `Android v${version}`;
      setAssetSize("android-apk", androidRelease.assets.find(asset => asset.name === "Vivid-Cinema-Android.apk"), `Android v${version}`);
    } else {
      missing.push("Android APK");
      const title = byId("android-apk")?.querySelector("strong");
      const subtitle = byId("android-apk")?.querySelector("small");
      if (title) title.textContent = "Find Android APK";
      if (subtitle) subtitle.textContent = "Open Android releases";
    }
  } else {
    missing.push("Android release information");
  }

  byId("downloads-status").textContent = missing.length
    ? `Some downloads are unavailable: ${missing.join(", ")}. Open the relevant release page for details.`
    : "Choose the Windows or Android build for your device.";
}

const releaseReady = loadLatestRelease().catch(() => {
  byId("downloads-status").textContent = "Using official release pages. If a direct download is unavailable, open release notes to see the latest builds.";
});
for (const id of ["windows-installer", "windows-portable", "android-apk"]) {
  const link = byId(id);
  link?.addEventListener("click", async event => {
    if (link.dataset.releaseReady === "true") return;
    event.preventDefault();
    link.setAttribute("aria-busy", "true");
    try {
      await releaseReady;
      link.dataset.releaseReady = "true";
      window.location.assign(link.href);
    } finally {
      link.removeAttribute("aria-busy");
    }
  });
}
releaseReady.then(() => {
  for (const id of ["windows-installer", "windows-portable", "android-apk"]) {
    const link = byId(id);
    if (link) link.dataset.releaseReady = "true";
  }
});
