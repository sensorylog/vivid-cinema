import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, updater, builder, configure, downloads] = await Promise.all([
  readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/android-updater.js", import.meta.url), "utf8"),
  readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-debug-build.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/downloads.js", import.meta.url), "utf8")
]);

test("Android workflow builds debug APKs and publishes a versioned asset without production secrets", () => {
  assert.match(workflow, /release:\s*\n\s*types: \[published\]/);
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /Vivid-Cinema-Debug\.keystore/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /Vivid-Cinema-Android-\$VIVID_ANDROID_VERSION-build-\$VIVID_ANDROID_BUILD\.apk/);
  assert.doesNotMatch(workflow, /ANDROID_KEYSTORE_BASE64|ANDROID_KEYSTORE_PASSWORD/);
});

test("Android bundle embeds its own build number and loads the update checker", () => {
  assert.match(builder, /VIVID_ANDROID_VERSION/);
  assert.match(builder, /VIVID_ANDROID_BUILD/);
  assert.match(builder, /VIVID_ANDROID_BUILD_INFO/);
  assert.match(builder, /scripts\/android-updater\.js/);
});

test("in-app update checker compares remote APK build numbers and calls the native installer", () => {
  assert.match(updater, /releases\/latest/);
  assert.match(updater, /-build-\(\\d\+\)/);
  assert.match(updater, /apk\.build <= Number\(local\.build/);
  assert.match(updater, /downloadAndInstall\(\{ url, version \}\)/);
  assert.match(updater, /Update Vivid Cinema/);
  assert.match(updater, /Download &amp; Install/);
});

test("Android native updater uses stable debug signing and requests package installation", () => {
  assert.match(configure, /VividUpdaterPlugin/);
  assert.match(configure, /REQUEST_INSTALL_PACKAGES/);
  assert.match(configure, /versionCode/);
  assert.match(configure, /versionName/);
  assert.match(configure, /DownloadManager/);
});

test("downloads page can resolve versioned Android build assets", () => {
  assert.match(downloads, /Vivid-Cinema-Android-.*build-/);
});
