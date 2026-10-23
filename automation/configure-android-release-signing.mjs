import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const gradlePath = path.resolve(process.env.VIVID_ANDROID_GRADLE_FILE || "android/app/build.gradle");
const storeFile = process.env.VIVID_ANDROID_KEYSTORE_FILE;
const requiredEnv = [
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD"
];
if (!storeFile || requiredEnv.some((name) => !process.env[name])) {
  throw new Error("Android release signing environment is incomplete.");
}

let gradle = await readFile(gradlePath, "utf8");
if (/signingConfigs\s*\{\s*release\s*\{/.test(gradle)) {
  throw new Error("Release signing is already configured; refusing to inject a duplicate block.");
}
const androidBlock = /android\s*\{/;
if (!androidBlock.test(gradle)) throw new Error("Could not find the Android Gradle configuration block.");
gradle = gradle.replace(androidBlock, `android {
    signingConfigs {
        release {
            storeFile file(System.getenv("VIVID_ANDROID_KEYSTORE_FILE"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
`);
const releaseBlock = /(buildTypes\s*\{\s*release\s*\{)/;
if (!releaseBlock.test(gradle)) throw new Error("Could not find buildTypes.release in generated Gradle configuration.");
gradle = gradle.replace(releaseBlock, "$1\n            signingConfig signingConfigs.release");
await writeFile(gradlePath, gradle, "utf8");
console.log("Configured release signing from environment variables; secret values were not written to source.");
