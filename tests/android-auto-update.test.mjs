import test from "node:test";
import assert from "node:assert/strict";
import { androidVersionFromTag, latestAndroidBuild, selectLatestAndroidRelease } from "../scripts/android-release-feed.js";
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

const [workflow, updater, builder, configure, legacyConfigure, nativeUpdater, downloads, capacitorConfig, iconScript, independentWorkflow, feed] = await Promise.all([
  readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/android-updater.js", import.meta.url), "utf8"),
  readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-native-project.mjs", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-debug-build.mjs", import.meta.url), "utf8"),
  readFile(new URL("../native/android/VividUpdaterPlugin.java", import.meta.url), "utf8"),
  readFile(new URL("../scripts/downloads.js", import.meta.url), "utf8"),
  readFile(new URL("../capacitor.config.json", import.meta.url), "utf8"),
  readFile(new URL("../automation/apply-android-icon.mjs", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/android-direct-release.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/android-release-feed.js", import.meta.url), "utf8")
]);

test("Android workflow publishes a cleanly named APK and build metadata without production secrets", () => {
  assert.match(workflow, /name: Android APK Build/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /publish-direct-apk:[\s\S]*?permissions:\s*\n\s*contents: write/);
  assert.doesNotMatch(workflow, /pull_request:\s*\n\s*paths:/, "all application changes must exercise the Android bundle");
  assert.match(workflow, /release:\s*\n\s*types: \[published\]/);
  assert.match(workflow, /assembleDebug/);
  assert.match(workflow, /REQUEST_INSTALL_PACKAGES/);
  assert.match(workflow, /configure-android-native-project\.mjs/);
  assert.ok(workflow.indexOf("npm run cap:sync") < workflow.indexOf("configure-android-native-project.mjs"));
  assert.match(workflow, /apk_name="Vivid-Cinema-Android\.apk"/);
  assert.match(workflow, /Vivid-Cinema-Android-build-/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /tag="v\$version"/);
  assert.match(workflow, /Vivid-Cinema-Debug\.keystore/);
  assert.doesNotMatch(workflow, /ANDROID_KEYSTORE_BASE64|ANDROID_KEYSTORE_PASSWORD/);
});

test("Android bundle embeds build metadata and loads the updater", () => {
  assert.match(builder, /VIVID_ANDROID_VERSION/);
  assert.match(builder, /VIVID_ANDROID_BUILD/);
  assert.match(builder, /VIVID_ANDROID_BUILD_INFO/);
  assert.match(builder, /VIVID_ANDROID_DISTRIBUTION/);
  assert.match(builder, /scripts\/android-updater\.js/);
});

test("updater compares remote metadata and installs the cleanly named APK", () => {
  assert.match(feed, /Vivid-Cinema-Android-build-/);
  assert.doesNotMatch(feed, /Vivid-Cinema-Android-Play-build-/);
  assert.match(feed, /Vivid-Cinema-Android\.apk/);
  assert.match(updater, /shouldShowAndroidUpdate/);
  assert.match(updater, /isAndroidUpdateCheckFresh/);
  assert.match(updater, /window\.VIVID_ANDROID_DISTRIBUTION === "play"/);
  assert.match(updater, /finally \{[\s\S]*?updateCheckInFlight = false/);
  assert.ok(updater.includes("if (!release || !remote)"));
  assert.match(updater, /without discarding a cached APK/);
  assert.match(updater, /downloadAndInstall\(\{ url: update\.url, version: update\.version \}\)/);
  assert.match(updater, /Update Vivid Cinema/);
  assert.match(updater, /Download &amp; Install/);
});

test("Android update checks are cached across page navigation", () => {
  assert.match(updater, /window\.localStorage/);
  assert.match(updater, /writeAndroidUpdateState\(storage/);
  assert.equal(ANDROID_UPDATE_SUCCESS_TTL_MS, 15 * 60 * 1000);
  assert.equal(ANDROID_UPDATE_FAILURE_TTL_MS, 5 * 60 * 1000);
});

test("Android package keeps the simple Vivid Cinema display name and shared launcher icon", () => {
  assert.equal(JSON.parse(capacitorConfig).appName, "Vivid Cinema");
  assert.match(configure, /VividUpdaterPlugin/);
  assert.match(legacyConfigure, /configure-android-native-project\.mjs/);
  assert.match(configure, /REQUEST_INSTALL_PACKAGES/);
  assert.match(configure, /versionCode/);
  assert.match(configure, /versionName/);
  assert.match(nativeUpdater, /DownloadManager/);
  assert.match(nativeUpdater, /ContextCompat\.RECEIVER_NOT_EXPORTED/);
  assert.match(nativeUpdater, /getPackageManager\(\)\.canRequestPackageInstalls/);
  assert.match(nativeUpdater, /getSharedPreferences/);
  assert.match(nativeUpdater, /handleOnResume/);
  assert.match(nativeUpdater, /handleOnDestroy/);
  assert.match(nativeUpdater, /unregisterReceiver\(receiver\)/);
  assert.match(iconScript, /vivid-icon-180\.png/);
  assert.match(iconScript, /ic_launcher_round\.png/);
});

test("downloads page resolves stable and legacy Android APK assets", () => {
  assert.match(downloads, /Vivid-Cinema-Android/);
  assert.match(downloads, /browser_download_url/);
});

test("successful Android update checks stay fresh for fifteen minutes", () => {
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

test("Android v1 update discovery is isolated from Windows desktop releases", () => {
  assert.ok(updater.includes("releases?per_page=100"));
  assert.ok(!updater.includes("releases/latest"));
  assert.ok(updater.includes("selectLatestAndroidRelease"));
  const selected = selectLatestAndroidRelease([
    { tag_name: "v1.0.99", published_at: "2026-11-27T00:00:00Z", assets: [] },
    { tag_name: "android-v1.0.0", published_at: "2026-11-27T01:00:00Z", assets: [] },
    { tag_name: "android-v1.1.0", prerelease: true, assets: [] },
    { tag_name: "android-v1.0.1", published_at: "2026-11-27T02:00:00Z", assets: [] },
    { tag_name: "android-v2.0.0", draft: true, assets: [] }
  ]);
  assert.equal(selected.tag_name, "android-v1.0.1");
  assert.equal(androidVersionFromTag(selected.tag_name), "1.0.1");
  const build = latestAndroidBuild([
    { name: "Vivid-Cinema-Android.apk", browser_download_url: "https://github.com/sensorylog/vivid-cinema/releases/download/android-v1.0.1/Vivid-Cinema-Android.apk" },
    { name: "Vivid-Cinema-Android-build-2000011.json" },
    { name: "Vivid-Cinema-Android-build-2000010.json" },
    { name: "Vivid-Cinema-Setup-1.0.99.exe", browser_download_url: "https://example.com/windows.exe" }
  ]);
  assert.deepEqual(build, {
    build: 2000011,
    version: null,
    url: "https://github.com/sensorylog/vivid-cinema/releases/download/android-v1.0.1/Vivid-Cinema-Android.apk"
  });
});

test("fresh Android v1 workflow builds and publishes an independent APK release", () => {
  assert.ok(independentWorkflow.includes("name: Vivid Cinema Android Direct Release"));
  assert.ok(independentWorkflow.includes("workflow_dispatch:"));
  assert.ok(independentWorkflow.includes("paths:"));
  assert.ok(independentWorkflow.includes(".github/workflows/android-direct-release.yml"));
  assert.ok(independentWorkflow.includes("release-guard:"));
  assert.ok(independentWorkflow.includes("needs.release-guard.outputs.should_build"));
  assert.ok(independentWorkflow.includes('default: "1.0.0"'));
  assert.ok(independentWorkflow.includes('tag="android-v$ANDROID_VERSION_INPUT"'));
  assert.ok(independentWorkflow.includes("VIVID_ANDROID_VERSION_CODE"));
  assert.ok(independentWorkflow.includes("build_number=$((2000000 + GITHUB_RUN_NUMBER))"));
  assert.ok(independentWorkflow.includes("make_latest=false"));
  assert.ok(independentWorkflow.includes("Vivid-Cinema-Debug.keystore"));
  assert.ok(independentWorkflow.includes("Refusing to generate a new key"));
  assert.ok(independentWorkflow.includes("legacy installed apps"));
  assert.ok(independentWorkflow.includes("bridge_legacy_release"));
  assert.ok(independentWorkflow.includes("gh release download v1.0.46"));
  assert.ok(independentWorkflow.includes("adb install -r"));
  assert.ok(independentWorkflow.includes("Vivid-Cinema-Android-$ANDROID_VERSION_INPUT-build-$VIVID_ANDROID_BUILD.apk"));
  assert.ok(!independentWorkflow.includes("if: false"));
  assert.ok(configure.includes("process.env.VIVID_ANDROID_VERSION || packageJson.version"));
});

test("Android download page resolves Android v1 independently of the Windows release", () => {
  assert.ok(downloads.includes("ANDROID_RELEASES_API"));
  assert.ok(downloads.includes("selectLatestAndroidRelease"));
  assert.ok(downloads.includes("androidVersionFromTag"));
  assert.ok(downloads.includes("Windows version"));
});
