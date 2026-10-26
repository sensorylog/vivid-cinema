import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tracker = await readFile(new URL("../scripts/vivid-pulse.js", import.meta.url), "utf8");
const downloads = await readFile(new URL("../scripts/downloads.js", import.meta.url), "utf8");
const html = await readFile(new URL("../downloads.html", import.meta.url), "utf8");
const landing = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("landing page loads the Firestore tracker alongside existing analytics", () => {
  assert.match(landing, /scripts\/vivid-pulse\.js/);
  assert.match(landing, /scripts\/analytics\.js/);
});

test("Pulse tracker writes schema-compatible server-timestamped events", () => {
  assert.match(tracker, /collection\(db, ["']analyticsEvents["']\)/);
  assert.match(tracker, /timestamp:\s*serverTimestamp\(\)/);
  assert.match(tracker, /userId:\s*uid/);
  assert.match(tracker, /sessionId:\s*getSessionId\(\)/);
  assert.match(tracker, /return \{ recorded: true, id: ref\.id \}/);
});

test("download tracking only supports Windows and Android and uses Pulse event names", () => {
  assert.match(tracker, /export async function recordPulseDownload/);
  assert.match(tracker, /\["windows", "android"\]/);
  assert.match(tracker, /"download_" \+ targetPlatform/);
});

test("download click tracking is optional and cannot prevent the actual download when Firebase is unavailable", () => {
  assert.match(downloads, /import\(["']\.\/vivid-pulse\.js["']\)/);
  assert.match(downloads, /\.catch\(/);
  assert.match(downloads, /Promise\.race/);
  assert.match(downloads, /window\.location\.assign\(link\.href\)/);
  assert.match(downloads, /isDirectReleaseAsset =/);
  assert.ok(downloads.includes("latest") && downloads.includes("download"));
  assert.match(downloads, /recordPulseDownload/);
  assert.match(html, /id="windows-installer"/);
  assert.match(html, /id="windows-portable"/);
  assert.match(html, /id="android-apk"/);
});
