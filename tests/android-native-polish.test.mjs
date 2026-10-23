import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [builder, nativeCss, capacitorConfig] = await Promise.all([
  readFile(new URL("../automation/build-static-dist.mjs", import.meta.url), "utf8"),
  readFile(new URL("../styles/vivid-native-app.css", import.meta.url), "utf8"),
  readFile(new URL("../capacitor.config.json", import.meta.url), "utf8")
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
