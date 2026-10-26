const OWNER = "sensorylog";
const REPO = "vivid-cinema";
const RELEASE_API = \`https://api.github.com/repos/\${OWNER}/\${REPO}/releases/latest\`;
const RELEASE_PAGE = \`https://github.com/\${OWNER}/\${REPO}/releases/latest\`;
const RELEASE_DOWNLOAD = \`https://github.com/\${OWNER}/\${REPO}/releases/latest/download\`;
const byId = (id) => document.getElementById(id);

// These are real, direct assets on the current stable release. They let a tap
// start a download even if the GitHub API is slow or temporarily unavailable.
function setReleaseFallback() {
  setDownload("windows-installer", \`\${RELEASE_DOWNLOAD}/Vivid-Cinema-Setup-1.0.22.exe\`, "Vivid Cinema Windows installer");
  setDownload("windows-portable", \`\${RELEASE_DOWNLOAD}/Vivid-Cinema-Portable-1.0.22.exe\`, "Vivid Cinema portable for Windows");
  setDownload("android-apk", \`\${RELEASE_DOWNLOAD}/Vivid-Cinema-Android.apk\`, "Vivid Cinema Android APK");
}

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
  return \`\${size.toFixed(unit === 0 ? 0 : 1)} \${units[unit]}\`;
}

function assetLink(assets, predicate) {
  return assets.find((asset) => predicate(asset.name)) || null;
}

async function loadLatestRelease() {
  setReleaseFallback();
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(\`Release lookup returned \${response.status}\`);
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const installer = assetLink(assets, (name) => /^Vivid-Cinema-Setup-\d+(?:\.\d+){1,3}\.exe$/i.test(name));
    const portable = assetLink(assets, (name) => /^Vivid-Cinema-Portable-\d+(?:\.\d+){1,3}\.exe$/i.test(name));
    const apk = assetLink(assets, (name) => /^Vivid-Cinema-Android\.apk$/i.test(name))
      || assetLink(assets, (name) => /^Vivid-Cinema-Android-\d+(?:\.\d+){1,3}-build-\d+\.apk$/i.test(name))
      || assetLink(assets, (name) => /^Vivid-Cinema-Android-\d+(?:\.\d+){1,3}\.apk$/i.test(name));

    if (installer) setDownload("windows-installer", installer.browser_download_url, installer.name);
    else setDownload("windows-installer", release.html_url || RELEASE_PAGE, "View available Windows releases");

    if (portable) setDownload("windows-portable", portable.browser_download_url, portable.name);
    else setDownload("windows-portable", release.html_url || RELEASE_PAGE, "View available Windows releases");

    if (apk) {
      setDownload("android-apk", apk.browser_download_url, apk.name);
    } else {
      setDownload("android-apk", release.html_url || RELEASE_PAGE, "View Android release assets");
      const androidButton = byId("android-apk");
      const androidTitle = androidButton?.querySelector("strong");
      const androidSubtitle = androidButton?.querySelector("small");
      if (androidTitle) androidTitle.textContent = "Find Android APK";
      if (androidSubtitle) androidSubtitle.textContent = "Open official release assets";
    }

    const version = String(release.tag_name || release.name || "").replace(/^v/i, "");
    if (version) byId("release-version").textContent = \`Version \${version}\`;
    if (release.published_at) {
      const date = new Date(release.published_at);
      if (!Number.isNaN(date.getTime())) {
        byId("release-date").textContent = \`Released \${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date)}\`;
      }
    }
    byId("all-releases").href = release.html_url || RELEASE_PAGE;

    const missing = [];
    if (!installer) missing.push("Windows installer");
    if (!portable) missing.push("portable Windows build");
    if (!apk) missing.push("Android APK");
    if (missing.length) {
      byId("downloads-status").textContent = \`Some files are missing from the latest release: \${missing.join(", ")}. Open release notes to see available files.\`;
    }

    for (const [id, asset] of [["windows-installer", installer], ["windows-portable", portable], ["android-apk", apk]]) {
      if (!asset) continue;
      const small = byId(id)?.querySelector("small");
      if (small) {
        const size = humanSize(asset.size);
        if (size) small.textContent = \`\${small.textContent.split(" · ")[0]} · \${size}\`;
      }
    }
  } catch {
    // Keep direct download URLs usable during GitHub API outages.
    byId("downloads-status").textContent = "Using direct links to the latest known official files. If a download fails, open release notes to see the newest available builds.";
    byId("all-releases").href = RELEASE_PAGE;
  }
}

// Analytics is deliberately optional: a Firebase/configuration failure must never
// break the download page. A bounded wait lets authenticated clicks reach Firestore
// before navigation without making downloads depend on analytics availability.
const pulseTrackerReady = import("./vivid-pulse.js").catch((error) => {
  console.debug("Vivid Pulse download tracking unavailable:", error?.code || error?.message || error);
  return null;
});
const waitAtMost = (promise, ms) => Promise.race([
  Promise.resolve(promise),
  new Promise((resolve) => setTimeout(resolve, ms))
]);

const releaseReady = loadLatestRelease();
for (const id of ["windows-installer", "windows-portable", "android-apk"]) {
  const link = byId(id);
  link?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.dataset.pulseNavigationStarted === "true") return;
    link.dataset.pulseNavigationStarted = "true";
    link.setAttribute("aria-busy", "true");
    try {
      await releaseReady;
      const isDirectReleaseAsset = /\\/releases\\/(?:latest\\/download|download\\/[^/]+\\/)/i.test(link.href);
      if (isDirectReleaseAsset) {
        const tracker = await waitAtMost(pulseTrackerReady, 350);
        if (tracker?.recordPulseDownload) {
          const targetPlatform = id === "android-apk" ? "android" : "windows";
          await waitAtMost(tracker.recordPulseDownload(targetPlatform, "downloads_page"), 600);
        }
      }
    } catch (error) {
      // Tracking must remain best-effort and must not strand a valid download.
      console.debug("Vivid Pulse download event skipped:", error?.code || error?.message || error);
    } finally {
      link.removeAttribute("aria-busy");
      window.location.assign(link.href);
    }
  });
}
releaseReady.then(() => {
  for (const id of ["windows-installer", "windows-portable", "android-apk"]) {
    const link = byId(id);
    if (link) link.dataset.releaseReady = "true";
  }
});
