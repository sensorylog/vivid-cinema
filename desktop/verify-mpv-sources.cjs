"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { MPV_SOURCE_COMMIT } = require("./prepare-mpv.cjs");

function verifyMpvSources({ projectRoot = path.resolve(__dirname, ".."), skip = process.env.VIVID_SKIP_MPV_PREPARE === "1" } = {}) {
  if (skip) return { skipped: true };
  const licenseRoot = path.join(projectRoot, "licenses", "mpv");
  const archivePath = path.join(licenseRoot, "CORRESPONDING-SOURCE.zip");
  const manifestPath = path.join(licenseRoot, "SOURCE-MANIFEST.json");
  if (!fs.existsSync(archivePath) || !fs.existsSync(manifestPath)) {
    throw new Error("Refusing to build a redistributable Vivid installer with mpv: add the complete CORRESPONDING-SOURCE.zip and verified SOURCE-MANIFEST.json first.");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("The mpv corresponding-source manifest is not valid JSON.");
  }
  if (manifest.formatVersion !== 1 || manifest.verified !== true) {
    throw new Error("The mpv corresponding-source manifest has not been verified.");
  }
  if (manifest.mpv?.commit !== MPV_SOURCE_COMMIT || !/^[0-9a-f]{40}$/.test(manifest.ffmpeg?.commit || "")) {
    throw new Error("The source manifest does not identify the pinned mpv release and exact FFmpeg source commit.");
  }
  if (!Array.isArray(manifest.components) || manifest.components.length === 0) {
    throw new Error("The source manifest must enumerate all additional bundled components and their licences.");
  }
  const incomplete = manifest.components.some(component =>
    !component || typeof component.name !== "string" || !component.name.trim() ||
    typeof component.license !== "string" || !component.license.trim() ||
    typeof component.source !== "string" || !component.source.trim() ||
    !(typeof component.commit === "string" && component.commit.trim()) &&
      !(typeof component.version === "string" && component.version.trim())
  );
  if (incomplete) {
    throw new Error("Every source-manifest component must include its name, licence, source location and exact commit or version.");
  }
  if (!manifest.verification || typeof manifest.verification.method !== "string" ||
      !manifest.verification.method.trim() || typeof manifest.verification.verifiedBy !== "string" ||
      !manifest.verification.verifiedBy.trim()) {
    throw new Error("The source manifest must record who verified the source bundle and how it was checked.");
  }

  const archiveSha256 = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  if (manifest.archiveSha256 !== archiveSha256) {
    throw new Error("The mpv corresponding-source archive does not match its manifest SHA-256.");
  }
  return { skipped: false, archiveSha256, componentCount: manifest.components.length };
}

if (require.main === module) {
  try {
    const result = verifyMpvSources();
    if (result.skipped) console.log("Skipping mpv source gate for a non-release preview build.");
    else console.log("Verified mpv corresponding-source bundle:", result.componentCount, "components");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyMpvSources };
