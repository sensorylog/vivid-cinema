const OWNER = "sensorylog";
const REPO = "vivid-cinema";
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const byId = (id) => document.getElementById(id);

function setDownload(id, url, filename) {
  const link = byId(id);
  if (!link || !url) return;
  link.href = url;
  link.dataset.filename = filename || "";
  link.rel = "noopener";
}

function setReleaseFallback() {
  setDownload("windows-installer", RELEASE_PAGE, "Windows installer");
  setDownload("windows-portable", RELEASE_PAGE, "Windows portable");
  setDownload("android-apk", `https://github.com/${OWNER}/${REPO}/releases/latest/download/Vivid-Cinema-Android.apk`, "Android APK");
}

function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function assetLink(assets, predicate) {
  return assets.find((asset) => predicate(asset.name)) || null;
}

async function loadLatestRelease() {
  setReleaseFallback();
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Release lookup returned ${response.status}`);
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assetLink(assets, (name) => /^Vivid-Cinema-Setup-\d+(?:\.\d+){1,3}\.exe$/i.test(name));
    const portable = assetLink(assets, (name) => /^Vivid-Cinema-Portable-\d+(?:\.\d+){1,3}\.exe$/i.test(name));
    const apk = assetLink(assets, (name) => /^Vivid-Cinema-Android\.apk$/i.test(name) || /^Vivid-Cinema-Android-\d+(?:\.\d+){1,3}\.apk$/i.test(name));
    if (installer) setDownload("windows-installer", installer.browser_download_url, installer.name);
    if (portable) setDownload("windows-portable", portable.browser_download_url, portable.name);
    if (apk) {
      setDownload("android-apk", apk.browser_download_url, apk.name);
    } else {
      // Never send visitors to a guaranteed 404 when the release has no APK asset yet.
      setDownload("android-apk", release.html_url || RELEASE_PAGE, "View Android release assets");
      const androidButton = byId("android-apk");
      const androidTitle = androidButton?.querySelector("strong");
      const androidSubtitle = androidButton?.querySelector("small");
      if (androidTitle) androidTitle.textContent = "Find Android APK";
      if (androidSubtitle) androidSubtitle.textContent = "Open official release assets";
    }
    const version = String(release.tag_name || release.name || "").replace(/^v/i, "");
    if (version) byId("release-version").textContent = `Version ${version}`;
    if (release.published_at) {
      const date = new Date(release.published_at);
      if (!Number.isNaN(date.getTime())) byId("release-date").textContent = `Released ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}`;
    }
    byId("all-releases").href = release.html_url || RELEASE_PAGE;
    const missing = [];
    if (!installer) missing.push("Windows installer");
    if (!portable) missing.push("portable Windows build");
    if (!apk) missing.push("Android APK (open release assets to check availability)");
    if (missing.length) {
      byId("downloads-status").textContent = `Some files are not attached to the latest release yet: ${missing.join(", ")}. Open release notes to see available files.`;
    }
    for (const [id, asset] of [["windows-installer", installer], ["windows-portable", portable], ["android-apk", apk]]) {
      if (!asset) continue;
      const small = byId(id)?.querySelector("small");
      if (small) {
        const size = humanSize(asset.size);
        if (size) small.textContent = `${small.textContent.split(" · ")[0]} · ${size}`;
      }
    }
  } catch (error) {
    byId("downloads-status").textContent = "Showing the latest known download links. If a file does not start, open the official release page for available builds.";
  }
}

loadLatestRelease();
