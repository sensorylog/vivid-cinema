"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const MPV_VERSION = "0.41.0-dev-g9e2ed65eb";
const ARCHIVE_NAME = "mpv-v0.41.0-dev-g9e2ed65eb-41103006513-x86_64-w64-mingw32-full.zip";
const ARCHIVE_URL = "https://github.com/mpv-player/mpv/releases/download/git-release/" + ARCHIVE_NAME;
const ARCHIVE_SHA256 = "24a5ac969219767c617f5d109761d4e24db8ba05dee30db485ea756415dc63b4";
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;

async function downloadPinnedArchive(destination) {
  const response = await fetch(ARCHIVE_URL, { redirect: "follow" });
  if (!response.ok) throw new Error("mpv download failed with HTTP " + response.status);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_ARCHIVE_BYTES) throw new Error("mpv archive exceeded the allowed size.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error("mpv archive exceeded the allowed size.");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== ARCHIVE_SHA256) throw new Error("mpv archive checksum mismatch; refusing to package an unverified player.");
  fs.writeFileSync(destination, bytes, { flag: "wx" });
}

function extractZip(archivePath, destination) {
  const scriptPath = path.join(path.dirname(archivePath), "extract-mpv.ps1");
  fs.writeFileSync(scriptPath, [
    "param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)",
    "$ErrorActionPreference = 'Stop'",
    "Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force"
  ].join("\r\n"), "utf8");
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath, "-Archive", archivePath, "-Destination", destination
  ], { windowsHide: true, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("Could not extract the verified mpv archive: " + (result.stderr || result.error?.message || "PowerShell extraction failed"));
  }
}

function findExecutable(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === "mpv.exe") return fullPath;
    if (entry.isDirectory()) {
      const found = findExecutable(fullPath);
      if (found) return found;
    }
  }
  return null;
}

async function prepareMpv({ platform = process.platform, projectRoot = path.resolve(__dirname, "..") } = {}) {
  if (process.env.VIVID_SKIP_MPV_PREPARE === "1") {
    console.log("Skipping mpv packaging for this non-release build.");
    return { skipped: true };
  }
  if (platform !== "win32") {
    console.log("Skipping bundled mpv preparation: the Vivid desktop player runtime is Windows-only.");
    return { skipped: true };
  }
  const vendorPath = path.join(projectRoot, "desktop", "vendor", "mpv");
  const existingManifest = path.join(vendorPath, "vivid-mpv-runtime.json");
  if (fs.existsSync(path.join(vendorPath, "mpv.exe")) && fs.existsSync(existingManifest)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(existingManifest, "utf8"));
      if (manifest.sha256 === ARCHIVE_SHA256) return { skipped: false, cached: true, executable: path.join(vendorPath, "mpv.exe"), version: MPV_VERSION };
    } catch { /* Replace incomplete or invalid cached runtime. */ }
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vivid-mpv-"));
  const archivePath = path.join(tempRoot, ARCHIVE_NAME);
  const extractPath = path.join(tempRoot, "extracted");
  try {
    fs.mkdirSync(extractPath, { recursive: true });
    await downloadPinnedArchive(archivePath);
    extractZip(archivePath, extractPath);
    const executable = findExecutable(extractPath);
    if (!executable) throw new Error("The verified mpv archive did not contain mpv.exe.");
    const runtimeDirectory = path.dirname(executable);
    const stagedPath = vendorPath + ".staged";
    fs.rmSync(stagedPath, { recursive: true, force: true });
    fs.cpSync(runtimeDirectory, stagedPath, { recursive: true });
    if (!fs.existsSync(path.join(stagedPath, "mpv.exe"))) throw new Error("mpv.exe was not staged correctly.");
    fs.rmSync(vendorPath, { recursive: true, force: true });
    fs.renameSync(stagedPath, vendorPath);
    fs.writeFileSync(path.join(vendorPath, "vivid-mpv-runtime.json"), JSON.stringify({
      version: MPV_VERSION,
      archive: ARCHIVE_NAME,
      archiveUrl: ARCHIVE_URL,
      sha256: ARCHIVE_SHA256,
      source: "https://github.com/mpv-player/mpv/tree/9e2ed65eb0c02f99a352dfa1ad3c85ecceefe005",
      buildWorkflow: "https://github.com/mpv-player/mpv/blob/4013a3c9b6f6b3b4d2d8f971e91c2e1eab3f8184/.github/workflows/build.yml"
    }, null, 2) + "\n");
    return { skipped: false, executable: path.join(vendorPath, "mpv.exe"), version: MPV_VERSION };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  prepareMpv().then(result => {
    if (!result.skipped) console.log("Prepared checksum-verified mpv runtime:", result.version);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { prepareMpv, downloadPinnedArchive, ARCHIVE_URL, ARCHIVE_SHA256, MPV_VERSION };
