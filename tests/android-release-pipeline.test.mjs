import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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


test("Gradle signing injection works against a generated-project fixture", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "vivid-gradle-signing-"));
  try {
    const gradlePath = path.join(temp, "build.gradle");
    const fixture = [
      'plugins { id "com.android.application" }',
      "android {",
      '    namespace "com.vividcinema.app"',
      "    buildTypes {",
      "        release {",
      "            minifyEnabled false",
      "        }",
      "    }",
      "}"
    ].join("\n");
    await writeFile(gradlePath, fixture, "utf8");
    const scriptPath = fileURLToPath(new URL("../automation/configure-android-release-signing.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        VIVID_ANDROID_GRADLE_FILE: gradlePath,
        VIVID_ANDROID_KEYSTORE_FILE: path.join(temp, "release.jks"),
        ANDROID_KEYSTORE_PASSWORD: "test-store-secret",
        ANDROID_KEY_ALIAS: "test-alias",
        ANDROID_KEY_PASSWORD: "test-key-secret"
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const gradle = await readFile(gradlePath, "utf8");
    assert.match(gradle, /signingConfigs\s*\{\s*release\s*\{/);
    assert.match(gradle, /signingConfig signingConfigs\.release/);
    assert.match(gradle, /storePassword System\.getenv\("ANDROID_KEYSTORE_PASSWORD"\)/);
    assert.doesNotMatch(gradle, /test-store-secret|test-key-secret/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
