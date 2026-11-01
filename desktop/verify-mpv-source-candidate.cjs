"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
function main() {
  const arg = process.argv.indexOf("--project-root");
  const projectRoot = path.resolve(arg >= 0 ? process.argv[arg + 1] : ".");
  const licenseRoot = path.join(projectRoot, "licenses", "mpv");
  const archivePath = path.join(licenseRoot, "CORRESPONDING-SOURCE.zip");
  const manifestPath = path.join(licenseRoot, "SOURCE-MANIFEST.json");
  const runtimeDir = path.join(projectRoot, "desktop", "vendor", "mpv");
  for (const file of [archivePath, manifestPath, path.join(runtimeDir, "mpv.exe")]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) throw new Error("Candidate build is incomplete: " + path.relative(projectRoot, file));
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.verified !== false || manifest.mpv?.commit !== "41f6a645068483470267271e1d09966ca3b9f413") throw new Error("Candidate manifest must preserve the pinned mpv revision and remain explicitly unverified.");
  if (!/^[0-9a-f]{40}$/.test(manifest.ffmpeg?.commit || "")) throw new Error("Candidate manifest is missing the exact FFmpeg checkout revision.");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  if (digest !== manifest.archiveSha256) throw new Error("Candidate source archive SHA-256 does not match its manifest.");
  if (!Array.isArray(manifest.components) || manifest.components.length < 1) throw new Error("Candidate manifest contains no dependency source inventory.");
  for (const file of [manifest.mpv?.licenseFile, manifest.ffmpeg?.licenseFile]) {
    const licensePath = path.resolve(licenseRoot, file || "");
    const relative = path.relative(licenseRoot, licensePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(licensePath) || !fs.statSync(licensePath).isFile()) {
      throw new Error("Candidate mpv/FFmpeg licence text is missing from the notice bundle.");
    }
  }
  for (const component of manifest.components) {
    const licensePath = path.resolve(licenseRoot, component.licenseFile || "");
    const relative = path.relative(licenseRoot, licensePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(licensePath) || !fs.statSync(licensePath).isFile()) throw new Error("Candidate source component is missing its bundled licence text: " + component.name);
    if (!component.source || !component.commit || !component.license) throw new Error("Candidate source component has incomplete provenance: " + component.name);
  }
  console.log("Candidate verified structurally (not legally certified):", manifest.components.length, "components; SHA-256", digest);
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
