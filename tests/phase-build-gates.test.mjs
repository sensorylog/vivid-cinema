import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("draft pull requests skip Android APK and Windows packaging jobs", async () => {
  const android = await readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8");
  const windows = await readFile(new URL("../.github/workflows/windows-desktop.yml", import.meta.url), "utf8");
  const gate = /if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft != true/;
  assert.match(android, gate);
  assert.match(windows, gate);
});
