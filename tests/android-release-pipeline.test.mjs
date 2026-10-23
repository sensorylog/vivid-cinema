import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, signer, docs] = await Promise.all([
  readFile(new URL("../.github/workflows/android-release.yml", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-release-signing.mjs", import.meta.url), "utf8"),
  readFile(new URL("../ANDROID_BUILD.md", import.meta.url), "utf8")
]);

test("signed Android release is manual and requires repository signing secrets", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ANDROID_KEYSTORE_BASE64/);
  assert.match(workflow, /ANDROID_KEYSTORE_PASSWORD/);
  assert.match(workflow, /ANDROID_KEY_ALIAS/);
  assert.match(workflow, /ANDROID_KEY_PASSWORD/);
  assert.match(workflow, /assembleRelease/);
  assert.match(workflow, /apksigner.*verify/);
  assert.match(workflow, /publish_to_github_release/);
});

test("release signer reads credentials only from environment and never writes secrets into source", () => {
  assert.match(signer, /process\.env\.VIVID_ANDROID_KEYSTORE_FILE/);
  assert.match(signer, /process\.env\[name\]/);
  assert.match(signer, /storePassword System\.getenv/);
  assert.match(signer, /keyPassword System\.getenv/);
  assert.doesNotMatch(signer, /storePassword\s+["'][^"']+["']/);
});

test("Android release docs explain keystore continuity and secret setup", () => {
  assert.match(docs, /ANDROID_KEYSTORE_BASE64/);
  assert.match(docs, /never commit/i);
  assert.match(docs, /same signing key/i);
  assert.match(docs, /signed release APK/i);
});
