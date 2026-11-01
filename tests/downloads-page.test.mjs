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
  assert.match(script, /release\.html_url \|\| RELEASE_PAGE/);
});

test("download buttons have direct file fallbacks and wait for release lookup before navigating", () => {
  assert.match(script, /RELEASE_DOWNLOAD = .*releases\/latest\/download/);
  assert.match(script, /Vivid-Cinema-Android\.apk/);
  assert.match(script, /Vivid-Cinema-Setup-1\.0\.28\.exe/);
  assert.match(script, /Vivid-Cinema-Portable-1\.0\.28\.exe/);
  assert.match(script, /await releaseReady/);
  assert.match(script, /window\.location\.assign\(link\.href\)/);
  assert.match(script, /Keep direct download URLs usable during GitHub API outages/);
});

test("downloads page has responsive and keyboard-focus styles", () => {
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
});


test("downloads page advertises offline movie and TV downloads on Windows", () => {
  assert.match(html, /AVAILABLE NOW · WINDOWS APP/);
  assert.match(html, /Download movies &amp; TV shows\. Watch offline\./);
  assert.match(html, /download movies and TV episodes to your device, then watch them offline right inside the app/i);
  assert.match(html, /My Downloads/);
  assert.match(styles, /downloads-feature-status-available/);
});

test("Android offline downloads and website downloads are clearly marked in development", () => {
  assert.match(html, /Android &amp; website offline downloads are next/);
  assert.match(html, /movie and TV offline downloads are being developed for it/);
  assert.match(html, /website download experience is also still in development/);
  assert.match(html, /downloads-feature-status-pending/);
});


test("download page never hardcodes an obsolete Windows installer fallback", async () => {
  assert.doesNotMatch(html, /Vivid-Cinema-(?:Setup|Portable)-1\.0\.\d+\.exe/);
  assert.doesNotMatch(script, /Vivid-Cinema-(?:Setup|Portable)-1\.0\.\d+\.exe/);
  assert.match(html, /scripts\/downloads\.js\?v=direct-download-v4/);
});
