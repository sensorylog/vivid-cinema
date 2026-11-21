import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ANDROID_UPDATE_STATE_KEY,
  ANDROID_UPDATE_SUCCESS_TTL_MS,
  ANDROID_UPDATE_FAILURE_TTL_MS,
  isAndroidUpdateCheckFresh,
  readAndroidUpdateState,
  shouldShowAndroidUpdate,
  writeAndroidUpdateState
} from "../scripts/android-update-state.js";

const [workflow, updater, builder, configure, downloads, capacitorConfig, iconScript] = await Promise.all([
  readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/android-updater.js", import.meta.url), "utf8"),
  readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-native-project.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/downloads.js", import.meta.url), "utf8"),
  readFile(new URL("../capacitor.config.json", import.meta.url), "utf8"),
  readFile(new URL("../automation/apply-android-icon.mjs", import.meta.url), "utf8")
]);

test("Android workflow publishes a cleanly named APK and build metadata without production secrets", () => {
  assert.match(workflow, /name: Android APK Build/);
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /pull_request:\s*\n\s*paths:/, "all application changes must exercise the Android bundle");
  assert.match(workflow, /release:\s*\n\s*types: \[published\]/);
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /configure-android-native-project\\.mjs/);
  assert.ok(workflow.indexOf("npm run cap:sync") < workflow.indexOf("configure-android-native-project.mjs"));
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
  assert.match(updater, /shouldShowAndroidUpdate/);
  assert.match(updater, /isAndroidUpdateCheckFresh/);
  assert.match(updater, /if \(!nativeRuntime\(\) \|\| updateCheckInFlight\) return/);
  assert.match(updater, /finally \{[\s\S]*?updateCheckInFlight = false/);
  assert.match(updater, /if \(!remote\)[\s\S]*?failed: true/);
  assert.match(updater, /retain any cached APK/);
  assert.match(updater, /downloadAndInstall\(\{ url: update\.url, version: update\.version \}\)/);
  assert.match(updater, /Update Vivid Cinema/);
  assert.match(updater, /Download &amp; Install/);
});

test("Android update checks are cached across page navigation", () => {
  assert.match(updater, /window\.localStorage/);
  assert.match(updater, /writeAndroidUpdateState\(storage/);
  assert.equal(ANDROID_UPDATE_SUCCESS_TTL_MS, 6 * 60 * 60 * 1000);
  assert.equal(ANDROID_UPDATE_FAILURE_TTL_MS, 15 * 60 * 1000);
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

test("successful Android update checks stay fresh for six hours", () => {
  const checkedAt = 1_000_000;
  assert.equal(isAndroidUpdateCheckFresh({ checkedAt, failed: false }, checkedAt + ANDROID_UPDATE_SUCCESS_TTL_MS - 1), true);
  assert.equal(isAndroidUpdateCheckFresh({ checkedAt, failed: false }, checkedAt + ANDROID_UPDATE_SUCCESS_TTL_MS), false);
});

test("failed Android update checks use a shorter retry cooldown", () => {
  const checkedAt = 1_000_000;
  assert.equal(isAndroidUpdateCheckFresh({ checkedAt, failed: true }, checkedAt + ANDROID_UPDATE_FAILURE_TTL_MS - 1), true);
  assert.equal(isAndroidUpdateCheckFresh({ checkedAt, failed: true }, checkedAt + ANDROID_UPDATE_FAILURE_TTL_MS), false);
  assert.equal(isAndroidUpdateCheckFresh({ checkedAt, failed: true }, checkedAt - 1), false);
});

test("dismissed Android update stays dismissed until a newer build is available", () => {
  const state = {
    dismissedBuild: 1420,
    update: { build: 1420, version: "1.0.47", url: "https://github.com/sensorylog/vivid-cinema/releases/download/v1.0.47/Vivid-Cinema-Android.apk" }
  };
  assert.equal(shouldShowAndroidUpdate(state, 1415), false);
  assert.equal(shouldShowAndroidUpdate({ ...state, update: { ...state.update, build: 1421 } }, 1415), true);
  assert.equal(shouldShowAndroidUpdate(state, 1420), false);
});

test("Android update state survives storage round-trips and rejects unsafe URLs", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const state = {
    checkedAt: 123456,
    failed: false,
    dismissedBuild: 100,
    update: { build: 101, version: "1.0.47", url: "https://github.com/sensorylog/vivid-cinema/releases/download/v1.0.47/Vivid-Cinema-Android.apk" }
  };
  assert.equal(writeAndroidUpdateState(storage, state), true);
  assert.equal(values.has(ANDROID_UPDATE_STATE_KEY), true);
  assert.deepEqual(readAndroidUpdateState(storage), state);
  assert.equal(shouldShowAndroidUpdate({ update: { ...state.update, url: "https://evil.example/app.apk" } }, 1), false);
});

test("corrupt or unavailable Android update storage fails safely", () => {
  const storage = { getItem: () => "{broken" };
  assert.deepEqual(readAndroidUpdateState(storage), {});
  assert.equal(writeAndroidUpdateState({ setItem: () => { throw new Error("quota"); } }, {}), false);
});
