import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const res = path.join(root, "android", "app", "src", "main", "res");
const source = path.join(root, "icons", "vivid-icon-180.png");

async function exists(file) {
  try { await readFile(file); return true; } catch { return false; }
}

if (!(await exists(source))) throw new Error("Missing shared Vivid Cinema icon: icons/vivid-icon-180.png");
if (!(await exists(res))) throw new Error("Android resources not found. Run npx cap add android first.");

const mipmapDirs = (await readdir(res, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && entry.name.startsWith("mipmap-"))
  .map(entry => path.join(res, entry.name));

if (!mipmapDirs.length) throw new Error("No Android mipmap icon folders found.");

for (const dir of mipmapDirs) {
  for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
    const target = path.join(dir, name);
    if (await exists(target)) await copyFile(source, target);
  }
}

const adaptiveDir = path.join(res, "mipmap-anydpi-v26");
if (await exists(adaptiveDir)) {
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
    const target = path.join(adaptiveDir, name);
    if (await exists(target)) await writeFile(target, adaptiveIcon, "utf8");
  }

  const valuesDir = path.join(res, "values");
  await mkdir(valuesDir, { recursive: true });
  await writeFile(path.join(valuesDir, "vivid_icon_colors.xml"), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="vivid_icon_background">#030509</color>
</resources>
`, "utf8");
}

console.log("Applied the shared Vivid Cinema icon to Android launcher resources.");
