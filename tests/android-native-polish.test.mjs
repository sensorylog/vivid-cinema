import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAndroidBackAction } from "../scripts/android-navigation.js";

const [builder, nativeCss, capacitorConfig, nativeConfigurator, appShell] = await Promise.all([
  readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8"),
  readFile(new URL("../styles/vivid-native-app.css", import.meta.url), "utf8"),
  readFile(new URL("../capacitor.config.json", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-debug-build.mjs", import.meta.url), "utf8"),
  readFile(new URL("../scripts/app-shell.js", import.meta.url), "utf8")
]);

test("native-only styling is injected into the generated bundle, not source HTML", () => {
  assert.match(builder, /addNativeEnhancements\(output\)/);
  assert.match(builder, /window\.Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.match(builder, /styles\/vivid-native-app\.css/);
  assert.match(builder, /id="vivid-native-app-enhancements"/);
});

test("native styling covers safe areas, touch targets, and accessible focus", () => {
  assert.match(nativeCss, /env\(safe-area-inset-bottom/);
  assert.match(nativeCss, /min-height:\s*44px/);
  assert.match(nativeCss, /font-size:\s*16px/);
  assert.match(nativeCss, /:focus-visible/);
  assert.match(nativeCss, /prefers-reduced-motion/);
});

test("Capacitor remains configured for the Vivid Cinema app", () => {
  const config = JSON.parse(capacitorConfig);
  assert.equal(config.appId, "com.vividcinema.app");
  assert.equal(config.appName, "Vivid Cinema");
  assert.equal(config.webDir, "dist");
});

test("generated Android project registers a native hardware Back bridge", () => {
  assert.match(nativeConfigurator, /VividNavigationPlugin\.class/);
  assert.match(nativeConfigurator, /@CapacitorPlugin\(name = "VividNavigation"\)/);
  assert.match(nativeConfigurator, /OnBackPressedCallback/);
  assert.match(nativeConfigurator, /notifyListeners\("backButton"/);
  assert.match(nativeConfigurator, /getActivity\(\)\.finish\(\)/);
  assert.match(appShell, /window\.Capacitor\?\.Plugins\?\.VividNavigation/);
  assert.match(appShell, /plugin\.addListener\("backButton"/);
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
