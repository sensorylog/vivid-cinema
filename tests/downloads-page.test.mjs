import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../downloads.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../scripts/downloads.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/downloads.css", import.meta.url), "utf8");

test("downloads page provides official Windows installer, portable, and Android APK choices", () => {
  assert.match(html, /id="windows-installer"/);
  assert.match(html, /id="windows-portable"/);
  assert.match(html, /id="android-apk"/);
  assert.match(html, /Official Vivid Cinema APK/);
  assert.match(html, /Windows 10 and Windows 11/);
});

test("downloads page resolves current assets from the latest GitHub release", () => {
  assert.match(script, /api\.github\.com\/repos/);
  assert.match(script, /Vivid-Cinema-Setup-/);
  assert.match(script, /Vivid-Cinema-Portable-/);
  assert.match(script, /Vivid-Cinema-Android/);
  assert.match(script, /browser_download_url/);
  assert.match(script, /View Android release assets/);
  assert.match(script, /release\\.html_url \\|\\| RELEASE_PAGE/);
});

test("downloads page has responsive and keyboard-focus styles", () => {
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
});
