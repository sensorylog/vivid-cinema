import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/android-debug-apk.yml", import.meta.url), "utf8");
const iconScript = await readFile(new URL("../automation/apply-android-icon.mjs", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("Android APK workflow applies the shared Vivid icon after Capacitor sync", () => {
  assert.match(workflow, /automation\/apply-android-icon\.mjs/);
  assert.ok(workflow.indexOf("npm run cap:sync") < workflow.indexOf("automation/apply-android-icon.mjs"));
});

test("Android launcher and web manifest use the same Vivid Cinema PNG source", () => {
  assert.match(iconScript, /icons", "vivid-icon-180\.png/);
  assert.ok(manifest.icons.some(icon => icon.src === "./icons/vivid-icon-180.png" && icon.sizes === "180x180"));
  assert.match(iconScript, /ic_launcher_round\.png/);
  assert.match(iconScript, /ic_launcher_foreground\.png/);
  assert.match(iconScript, /vivid_icon_foreground\.png/);
});

test("Android icon script pins both launcher manifest attributes to generated resources", () => {
  assert.match(iconScript, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(iconScript, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(iconScript, /Adaptive launcher foreground does not match the shared icon source/);
  assert.match(iconScript, /Shared launcher icon is too small/);
});
