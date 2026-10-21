import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");

// Keep Netlify's publish directory limited to the actual static site.
// Mirror Firebase Hosting's source-only exclusions and avoid publishing repo metadata.
const excludedDirectories = new Set([
  ".git",
  ".github",
  ".netlify",
  "node_modules",
  "automation",
  "dist",
  "functions",
  "docs",
  "tests",
]);
const excludedFiles = new Set([
  "firebase.json",
  "firestore.rules",
  "firestore.indexes.json",
  "README.md",
  "LICENSE",
  "netlify.toml",
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

await rm(output, { recursive: true, force: true });
await copySite(root, output);
console.log("Prepared Netlify static site in dist/");
