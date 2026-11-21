import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveAndroidBackAction } from "../scripts/android-navigation.js";
import { applyPerformanceProfile, isLegacyPerformanceDevice } from "../scripts/performance-profile.js";

const [builder, nativeCss, capacitorConfig, nativeConfigurator, appShell, nativeNavigation, nativeWebChrome] = await Promise.all([
  readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8"),
  readFile(new URL("../styles/vivid-native-app.css", import.meta.url), "utf8"),
  readFile(new URL("../capacitor.config.json", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-native-project.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/app-shell.js", import.meta.url), "utf8"),
  readFile(new URL("../native/android/VividNavigationPlugin.java", import.meta.url), "utf8"),
  readFile(new URL("../native/android/VividWebChromeClient.java", import.meta.url), "utf8")
]);

test("native-only styling is injected into the generated bundle, not source HTML", () => {
  assert.match(builder, /addNativeEnhancements\(output\)/);
  assert.match(builder, /window\.Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.match(builder, /styles\/vivid-native-app\.css/);
  assert.match(builder, /id="vivid-native-app-enhancements"/);
});

test("native styling covers safe areas, touch targets, and accessible focus", () => {
  assert.match(nativeCss, /env\(safe-area-inset-bottom/);
  assert.match(nativeCss, /html\.vivid-native-app body/);
  assert.match(nativeCss, /min-height:\s*44px/);
  assert.match(nativeCss, /font-size:\s*16px/);
  assert.doesNotMatch(nativeCss, /touch-action:\s*pan-x\s+pan-y\s*;/, "native shell must not disable pinch-to-zoom");
  assert.match(nativeCss, /:focus-visible/);
  assert.match(nativeCss, /prefers-reduced-motion/);
  assert.match(nativeCss, /\.vivid-player-dialog:fullscreen/);
  assert.match(nativeCss, /vivid-player-fullscreen-fallback/);
  assert.match(nativeCss, /iframe:not\(\[hidden\]\)/);
  assert.match(nativeCss, /video:not\(\[hidden\]\)/);
});

test("Android mobile navigation uses five accessible primary tabs and a secondary More menu", () => {
  assert.match(appShell, /function isAndroidNativeRuntime\(\)/);
  assert.match(appShell, /data-vivid-more-navigation/);
  assert.match(appShell, /aria-expanded/);
  assert.match(appShell, /aria-controls/);
  assert.match(appShell, /aria-haspopup/);
  assert.match(appShell, /aria-current", "page"/);
  assert.match(appShell, /Escape/);
  assert.match(appShell, /querySelector\("\.vivid-native-more-menu:not\(\[hidden\]\)"\)/);
  assert.match(appShell, /navLink\("home\.html"/);
  assert.match(appShell, /navLink\("discover\.html"/);
  assert.match(appShell, /navLink\("for-you\.html"/);
  assert.match(appShell, /navLink\("library\.html"/);
  assert.match(appShell, /navLink\("watch-rooms\.html"/);
  assert.match(nativeCss, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(nativeCss, /\.vivid-native-more-menu\[hidden\]/);
  assert.match(nativeCss, /min-height:\s*50px/);
});

test("Capacitor remains configured for the Vivid Cinema app", () => {
  const config = JSON.parse(capacitorConfig);
  assert.equal(config.appId, "com.vividcinema.app");
  assert.equal(config.appName, "Vivid Cinema");
  assert.equal(config.webDir, "dist");
});

test("generated Android project registers a native hardware Back bridge", () => {
  assert.match(nativeConfigurator, /VividNavigationPlugin\.class/);
  assert.match(nativeNavigation, /@CapacitorPlugin\(name = "VividNavigation"\)/);
  assert.match(nativeNavigation, /OnBackPressedCallback/);
  assert.match(nativeNavigation, /notifyListeners\("backButton"/);
  assert.match(nativeNavigation, /VividWebChromeClient\.exitActiveCustomView\(\)/);
  assert.ok(nativeNavigation.indexOf("VividWebChromeClient.exitActiveCustomView()") < nativeNavigation.indexOf('notifyListeners("backButton"'), "native fullscreen must close before JavaScript handles Back");
  assert.match(nativeWebChrome, /static boolean exitActiveCustomView\(\)/);
  assert.match(nativeWebChrome, /WeakReference<VividWebChromeClient>/);
  assert.match(nativeWebChrome, /WindowInsetsController/);
  assert.match(nativeWebChrome, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
  assert.match(nativeWebChrome, /WindowInsets\.Type\.systemBars\(\)/);
  assert.match(nativeWebChrome, /originalStatusBarVisible/);
  assert.match(nativeWebChrome, /originalNavigationBarVisible/);
  assert.match(nativeNavigation, /getActivity\(\)\.finish\(\)/);
  assert.match(nativeWebChrome, /extends BridgeWebChromeClient/);
  assert.match(nativeWebChrome, /onShowCustomView\(View view, CustomViewCallback callback\)/);
  assert.match(nativeWebChrome, /onHideCustomView\(\)/);
  assert.match(appShell, /window\.Capacitor\?\.Plugins\?\.VividNavigation/);
  assert.match(appShell, /plugin\.addListener\("backButton"/);
  assert.match(appShell, /playerOverlay && !playerOverlay\.hidden/);
  assert.match(appShell, /vivid:android-back/);
});

test("Android Back follows the in-app route stack before using WebView history", () => {
  const action = resolveAndroidBackAction({
    currentRoute: "/title.html?id=7",
    stack: ["/home.html", "/discover.html", "/title.html?id=7"],
    canGoBack: true,
    historyLength: 3
  });
  assert.deepEqual(action, {
    type: "route",
    route: "/discover.html",
    stack: ["/home.html"]
  });
});

test("Android Back uses WebView history when no saved Vivid route remains", () => {
  assert.deepEqual(resolveAndroidBackAction({
    currentRoute: "/home.html",
    stack: ["/home.html"],
    canGoBack: true,
    historyLength: 2
  }), { type: "history", stack: [] });
});

test("Android Back exits only when the app is already at its root", () => {
  assert.deepEqual(resolveAndroidBackAction({
    currentRoute: "/home.html",
    stack: ["/home.html"],
    canGoBack: false,
    historyLength: 1
  }), { type: "exit", stack: [] });
});

test("Android applies the low-compositing profile when hardware hints show a constrained device", () => {
  assert.equal(isLegacyPerformanceDevice({ hardwareConcurrency: 4, deviceMemory: 0, platform: "android" }), true);
  assert.equal(isLegacyPerformanceDevice({ hardwareConcurrency: 4, deviceMemory: 4, platform: "android" }), true);
  assert.equal(isLegacyPerformanceDevice({ hardwareConcurrency: 4, deviceMemory: 8, platform: "android" }), false);
  assert.equal(isLegacyPerformanceDevice({ hardwareConcurrency: 8, deviceMemory: 0, platform: "android" }), false);
  assert.equal(isLegacyPerformanceDevice({ hardwareConcurrency: 4, deviceMemory: 0, platform: "web" }), false);
});

test("native Android project generation registers both plugins idempotently", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "vivid-android-native-"));
  try {
    const androidRoot = path.join(temp, "android");
    const gradlePath = path.join(androidRoot, "app", "build.gradle");
    const javaRoot = path.join(androidRoot, "app", "src", "main", "java", "com", "vividcinema", "app");
    await mkdir(javaRoot, { recursive: true });
    await writeFile(gradlePath, [
      "android {",
      "  defaultConfig {",
      "    versionCode 1",
      '    versionName "1.0.0"',
      "  }",
      "}"
    ].join("\n"), "utf8");
    await writeFile(path.join(javaRoot, "MainActivity.java"), [
      "package com.vividcinema.app;",
      "import com.getcapacitor.BridgeActivity;",
      "public class MainActivity extends BridgeActivity {}"
    ].join("\n"), "utf8");

    const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
    await writeFile(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="Vivid Cinema"><activity android:name=".MainActivity" android:exported="true"></activity></application></manifest>', "utf8");

    const script = fileURLToPath(new URL("../automation/configure-android-native-project.mjs", import.meta.url));
    const env = {
      ...process.env,
      VIVID_ANDROID_ROOT: androidRoot,
      VIVID_ANDROID_BUILD: "1000001",
      VIVID_ANDROID_ENABLE_VOICE: "true",
      GITHUB_RUN_NUMBER: "12"
    };
    const first = spawnSync(process.execPath, [script], { encoding: "utf8", env });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const gradle = await readFile(gradlePath, "utf8");
    const activity = await readFile(path.join(javaRoot, "MainActivity.java"), "utf8");
    const updaterPlugin = await readFile(path.join(javaRoot, "VividUpdaterPlugin.java"), "utf8");
    const navigationPlugin = await readFile(path.join(javaRoot, "VividNavigationPlugin.java"), "utf8");
    const webChromeClient = await readFile(path.join(javaRoot, "VividWebChromeClient.java"), "utf8");
    const manifest = await readFile(manifestPath, "utf8");
    const [trackedUpdater, trackedNavigation, trackedWebChrome] = await Promise.all([
      readFile(new URL("../native/android/VividUpdaterPlugin.java", import.meta.url), "utf8"),
      readFile(new URL("../native/android/VividNavigationPlugin.java", import.meta.url), "utf8"),
      readFile(new URL("../native/android/VividWebChromeClient.java", import.meta.url), "utf8")
    ]);
    assert.equal(updaterPlugin, trackedUpdater);
    assert.equal(navigationPlugin, trackedNavigation);
    assert.equal(webChromeClient, trackedWebChrome);
    assert.match(gradle, /versionCode 1100001/);
    assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
    assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
    assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
    assert.match(manifest, /android\.hardware\.microphone" android:required="false"/);
    assert.match(manifest, /android:usesCleartextTraffic="false"/);
    assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
    assert.match(activity, /registerPlugin\(VividUpdaterPlugin\.class\)/);
    assert.match(activity, /registerPlugin\(VividNavigationPlugin\.class\)/);
    assert.match(activity, /setWebChromeClient\(new VividWebChromeClient\(getBridge\(\)\)\)/);
    assert.equal((activity.match(/super\.onCreate\(savedInstanceState\)/g) || []).length, 1);
    assert.match(updaterPlugin, /@CapacitorPlugin\(name = "VividUpdater"\)/);
    assert.match(updaterPlugin, /getSharedPreferences\(PREFERENCES/);
    assert.match(updaterPlugin, /handleOnResume/);
    assert.match(updaterPlugin, /reconcileDownload/);
    assert.match(updaterPlugin, /getPackageManager\(\)\.canRequestPackageInstalls/);
    assert.match(updaterPlugin, /ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
    assert.match(updaterPlugin, /STATUS_SUCCESSFUL/);
    assert.match(navigationPlugin, /@CapacitorPlugin\(name = "VividNavigation"\)/);
    assert.match(navigationPlugin, /OnBackPressedCallback/);
    assert.match(webChromeClient, /extends BridgeWebChromeClient/);
    assert.match(webChromeClient, /onShowCustomView\(View view, CustomViewCallback callback\)/);
    assert.match(webChromeClient, /onHideCustomView\(\)/);
    assert.match(webChromeClient, /decorView\)\.addView/);
    assert.match(webChromeClient, /removeView\(customView\)/);
    assert.match(webChromeClient, /SYSTEM_UI_FLAG_IMMERSIVE_STICKY/);

    const second = spawnSync(process.execPath, [script], { encoding: "utf8", env });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const activityAfterSecondRun = await readFile(path.join(javaRoot, "MainActivity.java"), "utf8");
    assert.equal((activityAfterSecondRun.match(/registerPlugin\(VividUpdaterPlugin\.class\)/g) || []).length, 1);
    assert.equal((activityAfterSecondRun.match(/registerPlugin\(VividNavigationPlugin\.class\)/g) || []).length, 1);
    assert.equal((activityAfterSecondRun.match(/setWebChromeClient\(new VividWebChromeClient/g) || []).length, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("Play Store native configuration omits the sideload updater and install-from-source permission", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "vivid-android-play-"));
  try {
    const androidRoot = path.join(temp, "android");
    const gradlePath = path.join(androidRoot, "app", "build.gradle");
    const javaRoot = path.join(androidRoot, "app", "src", "main", "java", "com", "vividcinema", "app");
    await mkdir(javaRoot, { recursive: true });
    await writeFile(gradlePath, [
      "android {",
      "  defaultConfig {",
      "    versionCode 1",
      '    versionName "1.0.0"',
      "  }",
      "}"
    ].join("\n"), "utf8");
    await writeFile(path.join(javaRoot, "MainActivity.java"), [
      "package com.vividcinema.app;",
      "import com.getcapacitor.BridgeActivity;",
      "public class MainActivity extends BridgeActivity {}"
    ].join("\n"), "utf8");
    const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
    await writeFile(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="Vivid Cinema"><activity android:name=".MainActivity" android:exported="true"></activity></application></manifest>', "utf8");

    const script = fileURLToPath(new URL("../automation/configure-android-native-project.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        VIVID_ANDROID_ROOT: androidRoot,
        VIVID_ANDROID_BUILD: "2000001",
        VIVID_ANDROID_DISTRIBUTION: "play"
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const activity = await readFile(path.join(javaRoot, "MainActivity.java"), "utf8");
    const manifest = await readFile(manifestPath, "utf8");
    assert.match(activity, /registerPlugin\(VividNavigationPlugin\.class\)/);
    assert.doesNotMatch(activity, /VividUpdaterPlugin/);
    assert.doesNotMatch(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
    assert.doesNotMatch(manifest, /android\.permission\.RECORD_AUDIO/);
    assert.doesNotMatch(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
    assert.doesNotMatch(manifest, /android\.hardware\.microphone/);
    assert.match(manifest, /android:usesCleartextTraffic="false"/);
    assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
    await assert.rejects(
      readFile(path.join(javaRoot, "VividUpdaterPlugin.java"), "utf8"),
      error => error.code === "ENOENT"
    );
    await readFile(path.join(javaRoot, "VividWebChromeClient.java"), "utf8");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("Android native performance profile reads Navigator capability getters without spreading Navigator", () => {
  const originalWindow = globalThis.window;
  const added = [];
  const documentRef = {
    documentElement: { classList: { add: value => added.push(value) } },
    head: { appendChild: value => added.push(value) },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, setAttribute() {} })
  };
  globalThis.window = { Capacitor: { getPlatform: () => "android" } };
  try {
    const profile = applyPerformanceProfile({
      documentRef,
      navigatorRef: { hardwareConcurrency: 4, deviceMemory: undefined }
    });
    assert.equal(profile, "legacy");
    assert.ok(added.includes("vivid-performance-legacy"));
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
