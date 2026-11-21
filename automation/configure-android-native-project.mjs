import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = process.env.VIVID_ANDROID_ROOT
  ? path.resolve(process.env.VIVID_ANDROID_ROOT)
  : path.join(root, "android");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const buildNumber = Number(process.env.VIVID_ANDROID_BUILD || process.env.GITHUB_RUN_NUMBER || 1);
if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) throw new Error("Android build number must be a positive integer.");
const versionCode = 100000 + buildNumber;
const versionName = packageJson.version;
const gradlePath = path.join(androidRoot, "app", "build.gradle");
let gradle = await readFile(gradlePath, "utf8");
if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+["'][^"']+["']/.test(gradle)) {
  throw new Error("Could not find Android versionCode/versionName in generated app/build.gradle.");
}
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+["'][^"']+["']/, `versionName "${versionName}"`);
await writeFile(gradlePath, gradle, "utf8");

const javaRoot = path.join(androidRoot, "app", "src", "main", "java", "com", "vividcinema", "app");
const mainActivityPath = path.join(javaRoot, "MainActivity.java");
let mainActivity = await readFile(mainActivityPath, "utf8");
for (const pluginClass of ["VividUpdaterPlugin.class", "VividNavigationPlugin.class"]) {
  if (mainActivity.includes(pluginClass)) continue;
  const superCall = /([ \\t]*)super\\.onCreate\\(savedInstanceState\\);/;
  if (superCall.test(mainActivity)) {
    mainActivity = mainActivity.replace(superCall, `$1registerPlugin(${pluginClass});\n$1super.onCreate(savedInstanceState);`);
  } else {
    mainActivity = mainActivity.replace(
      /public class MainActivity extends BridgeActivity\s*\{/,
      `public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(${pluginClass});\n        super.onCreate(savedInstanceState);\n    }`
    );
  }
}
if (!mainActivity.includes("VividUpdaterPlugin.class") || !mainActivity.includes("VividNavigationPlugin.class")) {
  throw new Error("Could not register all Vivid native plugins in MainActivity.");
}
if (!mainActivity.includes("VividWebChromeClient")) {
  const superCall = /([ \\t]*)super\\.onCreate\\(savedInstanceState\\);/;
  if (!superCall.test(mainActivity)) throw new Error("Could not install the Vivid fullscreen WebChromeClient.");
  mainActivity = mainActivity.replace(
    superCall,
    `$1super.onCreate(savedInstanceState);\\n$1if (getBridge() != null && getBridge().getWebView() != null) {\\n$1    getBridge().getWebView().setWebChromeClient(new VividWebChromeClient(getBridge()));\\n$1}`
  );
}
await writeFile(mainActivityPath, mainActivity, "utf8");
for (const nativeSource of [
  "VividUpdaterPlugin.java",
  "VividNavigationPlugin.java",
  "VividWebChromeClient.java"
]) {
  await copyFile(
    path.join(root, "native", "android", nativeSource),
    path.join(javaRoot, nativeSource)
  );
}







const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");
let manifestChanged = false;
for (const permission of [
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS"
]) {
  if (manifest.includes(permission)) continue;
  manifest = manifest.replace(
    /<application\b/,
    `    <uses-permission android:name="${permission}" />\n\n    <application`
  );
  manifestChanged = true;
}
if (!manifest.includes('android.hardware.microphone')) {
  manifest = manifest.replace(
    /<application\b/,
    '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n\n    <application'
  );
  manifestChanged = true;
}
if (manifestChanged) await writeFile(manifestPath, manifest, "utf8");
console.log(`Configured Vivid Android updater plugin (version ${versionName}, build ${buildNumber}, versionCode ${versionCode}).`);
