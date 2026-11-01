import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [install, styles, worker, home, nativeStyles, builder, workflow] = await Promise.all([
  read("../install.html"),
  read("../styles/vivid-install.css"),
  read("../service-worker.js"),
  read("../home.html"),
  read("../styles/vivid-native-app.css"),
  read("../automation/build-static-dist.mjs"),
  read("../.github/workflows/ios-build.yml")
]);

test("iPhone install guide gives the correct Safari Home Screen route", () => {
  assert.match(install, /viewport-fit=cover/);
  assert.match(install, /Install with Safari/);
  assert.match(install, /Add to Home Screen/);
  assert.match(install, /Open as Web App/);
  assert.match(install, /No App Store needed/);
  assert.match(install, /official installable web app \(PWA\)/);
  assert.doesNotMatch(install, /Trust Developer|VPN & Device Management|install an? IPA/i);
});

test("Home and service worker expose and cache the iPhone install guide", () => {
  assert.match(home, /class="vivid-iphone-install-link" href="install\.html"/);
  assert.match(worker, /"\.\/install\.html"/);
  assert.match(worker, /"\.\/styles\/vivid-install\.css"/);
  assert.match(worker, /vivid-cinema-shell-v266/);
});

test("install page styles remain responsive and respect reduced motion", () => {
  assert.match(styles, /@media\(max-width:640px\)/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(styles, /safe-area|install-shell/);
});

test("native shell applies its styling class to both html and body", () => {
  assert.match(builder, /document\.documentElement\.classList\.add\("vivid-native-app"\)/);
  assert.match(builder, /document\.body\?\.classList\.add\("vivid-native-app"\)/);
  assert.match(nativeStyles, /html\.vivid-native-app/);
  assert.match(nativeStyles, /body\.vivid-native-app/);
  assert.match(nativeStyles, /safe-area-inset-bottom/);
});

test("iOS workflow builds an unsigned simulator artifact without a signing vendor", () => {
  assert.match(workflow, /runs-on: macos-15/);
  assert.match(workflow, /xcodebuild/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflow, /vivid-cinema-ios-simulator/);
  assert.doesNotMatch(workflow, /match\s+\S+|fastlane\s+match|enterprise certificate/i);
});
