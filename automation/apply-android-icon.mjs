import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = path.join(root, "android", "app", "src", "main", "res");
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
const source = path.join(root, "icons", "vivid-icon-180.png");

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

if (!(await exists(source))) throw new Error("Missing shared Vivid Cinema icon: icons/vivid-icon-180.png");
if (!(await exists(res))) throw new Error("Android resources not found. Run npx cap add android first.");

const sourceBytes = await readFile(source);
if (sourceBytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error("Shared Vivid Cinema icon is not a PNG.");
const sourceWidth = sourceBytes.readUInt32BE(16);
const sourceHeight = sourceBytes.readUInt32BE(20);
if (sourceWidth < 180 || sourceHeight < 180) throw new Error(`Shared launcher icon is too small: ${sourceWidth}x${sourceHeight}`);

const mipmapDirs = (await readdir(res, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name.startsWith("mipmap-"))
  .map(entry => path.join(res, entry.name));

if (!mipmapDirs.length) throw new Error("No Android mipmap icon folders found.");

let written = 0;
for (const dir of mipmapDirs) {
  // Explicitly replace both legacy launcher variants and the generated foreground
  // fallback. This prevents Capacitor's starter artwork surviving in any density.
  for (const name of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
    const target = path.join(dir, name);
    if (await exists(target)) {
      await copyFile(source, target);
      written++;
    }
  }
}

const adaptiveDir = path.join(res, "mipmap-anydpi-v26");
if (!(await exists(adaptiveDir))) throw new Error("Android adaptive icon directory missing after cap add android.");
const foregroundDir = path.join(res, "drawable-nodpi");
await mkdir(foregroundDir, { recursive: true });
await copyFile(source, path.join(foregroundDir, "vivid_icon_foreground.png"));

const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/vivid_icon_background"/>
    <foreground android:drawable="@drawable/vivid_icon_foreground"/>
</adaptive-icon>
`;
for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
  await writeFile(path.join(adaptiveDir, name), adaptiveIcon, "utf8");
}

const valuesDir = path.join(res, "values");
await mkdir(valuesDir, { recursive: true });
await writeFile(path.join(valuesDir, "vivid_icon_colors.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="vivid_icon_background">#030509</color>
</resources>
`, "utf8");

// Pin the application manifest to the exact resources generated above.
if (!(await exists(manifestPath))) throw new Error("AndroidManifest.xml missing; cannot verify launcher icon wiring.");
let manifest = await readFile(manifestPath, "utf8");
if (!/android:icon="@mipmap\/ic_launcher"/.test(manifest)) {
  manifest = manifest.replace(/android:icon="[^"]*"/, 'android:icon="@mipmap/ic_launcher"');
}
if (/android:roundIcon=/.test(manifest)) {
  manifest = manifest.replace(/android:roundIcon="[^"]*"/, 'android:roundIcon="@mipmap/ic_launcher_round"');
}
if (!/android:icon="@mipmap\/ic_launcher"/.test(manifest)) {
  throw new Error("Could not set android:icon to @mipmap/ic_launcher in AndroidManifest.xml.");
}
await writeFile(manifestPath, manifest, "utf8");

const foreground = await readFile(path.join(foregroundDir, "vivid_icon_foreground.png"));
if (!foreground.equals(sourceBytes)) throw new Error("Adaptive launcher foreground does not match the shared icon source.");
console.log(`Applied Vivid Cinema launcher icon (${sourceWidth}x${sourceHeight}); replaced ${written} generated density icons and pinned manifest icon resources.`);
