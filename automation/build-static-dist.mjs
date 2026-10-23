import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");

// Keep static site's publish directory limited to the actual static site.
// Mirror Firebase Hosting's source-only exclusions and avoid publishing repo metadata.
const excludedDirectories = new Set([
  ".git",
  ".github",
  "node_modules",
  "automation",
  "dist",
  "functions",
  "api",
  "android",
  "ios",
  "docs",
  "tests",
]);
const excludedFiles = new Set([
  "firebase.json",
  "firestore.rules",
  "firestore.indexes.json",
  "README.md",
  "LICENSE",
  ".gitignore",
  ".gitattributes",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

async function copySite(source, destination, relative = "") {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const rel = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if (entry.isFile() && (excludedFiles.has(entry.name) || entry.name.startsWith(".env"))) continue;

    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copySite(from, to, rel);
    } else if (entry.isFile()) {
      await cp(from, to);
    }
  }
}

// Build the static site used by Cloudflare Pages, Firebase Hosting, and the generated Capacitor APK. The website remains
// visually unchanged in a normal browser; only a genuine Capacitor runtime receives
// the native class and stylesheet.
async function addNativeEnhancements(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await addNativeEnhancements(target);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;

    let html = await readFile(target, "utf8");
    if (!html.includes('id="vivid-native-app-enhancements"')) {
      const enhancement = [
        '<script id="vivid-native-app-enhancements">',
        '(()=>{try{if(window.Capacitor?.isNativePlatform?.()){document.documentElement.classList.add("vivid-native-app");}}catch{}})();',
        "</script>",
        '<link rel="stylesheet" href="/styles/vivid-native-app.css">'
      ].join("");
      html = html.replace("</head>", enhancement + "</head>");
      await writeFile(target, html, "utf8");
    }
  }
}

await rm(output, { recursive: true, force: true });
await copySite(root, output);
await addNativeEnhancements(output);
console.log("Prepared static site in dist/ with native-only Capacitor polish.");
