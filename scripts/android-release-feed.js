const ANDROID_TAG = /^android-v(\d+)\.(\d+)\.(\d+)$/i;

function versionParts(tag) {
  const match = ANDROID_TAG.exec(String(tag || ""));
  return match ? match.slice(1).map(Number) : null;
}

function compareAndroidTags(left, right) {
  const a = versionParts(left.tag_name);
  const b = versionParts(right.tag_name);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return String(right.published_at || "").localeCompare(String(left.published_at || ""));
}

export function selectLatestAndroidRelease(releases) {
  if (!Array.isArray(releases)) return null;
  return releases
    .filter(release => !release?.draft && !release?.prerelease && versionParts(release?.tag_name))
    .sort(compareAndroidTags)[0] || null;
}

export function latestAndroidBuild(assets) {
  if (!Array.isArray(assets)) return null;
  const apk = assets.find(asset => asset?.name === "Vivid-Cinema-Android.apk");
  const metadata = assets.map(asset => {
    const match = /^Vivid-Cinema-Android-build-(\d+)\.json$/i.exec(asset?.name || "");
    return match ? { ...asset, build: Number(match[1]) } : null;
  }).filter(asset => asset && Number.isSafeInteger(asset.build) && asset.build > 0)
    .sort((a, b) => b.build - a.build)[0];
  if (!apk?.browser_download_url || !metadata) return null;
  return {
    build: metadata.build,
    version: metadata.version || null,
    url: apk.browser_download_url
  };
}

export function androidVersionFromTag(tag) {
  const parts = versionParts(tag);
  return parts ? parts.join(".") : null;
}
