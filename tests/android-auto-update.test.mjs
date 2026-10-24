import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, updater, builder, configure, downloads, capacitorConfig, iconScript] = await Promise.all([
  readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/android-updater.js", import.meta.url), "utf8"),
  readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-debug-build.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/downloads.js", import.meta.url), "utf8"),
  readFile(new URL("../capacitor.config.json", import.meta.url), "utf8"),
  readFile(new URL("../automation/apply-android-icon.mjs", import.meta.url), "utf8")
]);

test("Android workflow publishes a cleanly named APK and build metadata without production secrets", () => {
  assert.match(workflow, /name: Android APK Build/);
  assert.match(workflow, /release:\s*\n\s*types: \[published\]/);
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /apk_name="Vivid-Cinema-Android\.apk"/);
  assert.match(workflow, /Vivid-Cinema-Android-build-/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /Vivid-Cinema-Debug\.keystore/);
  assert.doesNotMatch(workflow, /ANDROID_KEYSTORE_BASE64|ANDROID_KEYSTORE_PASSWORD/);
});

test("Android bundle embeds build metadata and loads the updater", () => {
  assert.match(builder, /VIVID_ANDROID_VERSION/);
  assert.match(builder, /VIVID_ANDROID_BUILD/);
  assert.match(builder, /VIVID_ANDROID_BUILD_INFO/);
  assert.match(builder, /scripts\/android-updater\.js/);
});

test("updater compares remote metadata and installs the cleanly named APK", () => {
  assert.match(updater, /Vivid-Cinema-Android-build-/);
  assert.match(updater, /Vivid-Cinema-Android\.apk/);
  assert.match(updater, /remoteBuild <= Number\(local\.build/);
  assert.match(updater, /downloadAndInstall\(\{ url, version \}\)/);
  assert.match(updater, /Update Vivid Cinema/);
  assert.match(updater, /Download &amp; Install/);
});

test("Android package keeps the simple Vivid Cinema display name and shared launcher icon", () => {
  assert.equal(JSON.parse(capacitorConfig).appName, "Vivid Cinema");
  assert.match(configure, /VividUpdaterPlugin/);
  assert.match(configure, /REQUEST_INSTALL_PACKAGES/);
  assert.match(configure, /versionCode/);
  assert.match(configure, /versionName/);
  assert.match(configure, /DownloadManager/);
  assert.match(iconScript, /vivid-icon-180\.png/);
  assert.match(iconScript, /ic_launcher_round\.png/);
});

test("downloads page resolves stable and legacy Android APK assets", () => {
  assert.match(downloads, /Vivid-Cinema-Android/);
  assert.match(downloads, /browser_download_url/);
});
