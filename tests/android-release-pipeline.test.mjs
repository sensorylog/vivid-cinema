import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [workflow, signer, nativeConfigurator, docs, debugWorkflow] = await Promise.all([
  readFile(new URL("../.github/workflows/android-release.yml", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-release-signing.mjs", import.meta.url), "utf8"),
  readFile(new URL("../automation/configure-android-native-project.mjs", import.meta.url), "utf8"),
  readFile(new URL("../ANDROID_BUILD.md", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8")
]);

test("production-signed Android release remains manual until signing is configured", () => {
  assert.doesNotMatch(workflow, /release:\s*\n\s*types: \[published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /ANDROID_KEYSTORE_BASE64/);
  assert.match(workflow, /ANDROID_KEYSTORE_PASSWORD/);
  assert.match(workflow, /ANDROID_KEY_ALIAS/);
  assert.match(workflow, /ANDROID_KEY_PASSWORD/);
  assert.match(workflow, /assembleRelease/);
  assert.match(workflow, /bundleRelease/);
  assert.equal((workflow.match(/VIVID_ANDROID_DISTRIBUTION: play/g) || []).length, 2);
  assert.match(nativeConfigurator, /playStoreDistribution/);
  assert.match(nativeConfigurator, /playStoreDistribution \? \[\] : \["VividUpdaterPlugin\.class"\]/);
  assert.match(nativeConfigurator, /playStoreDistribution \? \[\] : \["android\.permission\.REQUEST_INSTALL_PACKAGES"\]/);
  assert.match(workflow, /Vivid-Cinema-Android\.aab/);
  assert.match(workflow, /jarsigner -verify/);
  assert.match(workflow, /apksigner.*verify/);
  assert.match(workflow, /publish_to_github_release/);
  assert.match(workflow, /if: inputs\.publish_to_github_release/);
  assert.match(workflow, /Vivid-Cinema-Android\.apk/);
  assert.match(workflow, /Set Android app version metadata/);
  assert.match(workflow, /production_build=\$\(\(1000000 \+ GITHUB_RUN_NUMBER\)\)/);
  assert.match(workflow, /VIVID_ANDROID_BUILD=\$production_build/);
  assert.match(workflow, /configure-android-native-project\.mjs/);
  assert.ok(workflow.indexOf("npm run cap:sync") < workflow.indexOf("configure-android-native-project.mjs"));
  assert.ok(workflow.indexOf("configure-android-native-project.mjs") < workflow.indexOf("Configure release signing"));
  assert.match(workflow, /Vivid-Cinema-Android-build-\$VIVID_ANDROID_BUILD\.json/);
  assert.match(nativeConfigurator, /VividNavigationPlugin\.class/);
  assert.match(nativeConfigurator, /VividUpdaterPlugin\.class/);
  assert.match(nativeConfigurator, /process\.env\.VIVID_ANDROID_BUILD \|\| process\.env\.GITHUB_RUN_NUMBER/);
});

test("release signer reads credentials only from environment and never writes secrets into source", () => {
  assert.match(signer, /process\.env\.VIVID_ANDROID_KEYSTORE_FILE/);
  assert.match(signer, /process\.env\[name\]/);
  assert.match(signer, /storePassword System\.getenv/);
  assert.match(signer, /keyPassword System\.getenv/);
  assert.doesNotMatch(signer, /storePassword\s+["'][^"']+["']/);
});

test("debug APK release never republishes the Android signing keystore", async () => {
  const debugWorkflow = await readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8");
  const publishStep = debugWorkflow.split("Publish latest Android APK for in-app updates")[1] || "";
  assert.match(publishStep, /gh release upload/);
  assert.doesNotMatch(publishStep, /Vivid-Cinema-Debug\\.keystore/);
  assert.match(debugWorkflow, /gh release download/);
  assert.match(debugWorkflow, /vars\.ANDROID_PRODUCTION_SIGNING_ENABLED != 'true'/);
  assert.match(debugWorkflow, /workflow_dispatch.*github\.ref == 'refs\/heads\/main'/);
});

test("Android release docs explain keystore continuity and secret setup", () => {
  assert.match(docs, /ANDROID_KEYSTORE_BASE64/);
  assert.match(docs, /never commit/i);
  assert.match(docs, /same signing key/i);
  assert.match(docs, /signed release APK/i);
  assert.match(docs, /ANDROID_PRODUCTION_SIGNING_ENABLED/);
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
