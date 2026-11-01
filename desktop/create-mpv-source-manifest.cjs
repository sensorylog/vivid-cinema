"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const MPV_COMMIT = "41f6a645068483470267271e1d09966ca3b9f413";
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key || !key.startsWith("--") || !value) throw new Error("Invalid command-line arguments.");
    out[key.slice(2)] = value;
  }
  return out;
}
function gitOutput(directory, args) {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function findLicenseFile(root) {
  const preferred = /^(license|licence|copying|copyright|ftl)(\.|$)/i;
  const candidates = [];
  function walk(directory, depth) {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "builddir" || entry.name === "mingw_build") continue;
      const full = path.join(directory, entry.name);
      if (entry.isFile() && preferred.test(entry.name)) candidates.push(full);
      else if (entry.isDirectory()) walk(full, depth + 1);
    }
  }
  walk(root, 0);
  candidates.sort((a, b) => path.relative(root, a).split(path.sep).length - path.relative(root, b).split(path.sep).length || a.localeCompare(b));
  return candidates[0] || null;
}
function collectGitRepositories(root) {
  const found = [];
  function walk(directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    if (fs.existsSync(path.join(directory, ".git"))) {
      try {
        found.push({
          directory,
          commit: gitOutput(directory, ["rev-parse", "HEAD"]),
          source: gitOutput(directory, ["config", "--get", "remote.origin.url"])
        });
      } catch { throw new Error("Found a Git checkout without readable revision metadata: " + directory); }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || [".git", "mingw_build", "mingw_prefix", "artifact", "builddir"].includes(entry.name)) continue;
      walk(path.join(directory, entry.name));
    }
  }
  walk(root);
  return found;
}
function copyLicense(source, licenseRoot, slug) {
  const license = findLicenseFile(source);
  if (!license) throw new Error("No upstream licence file found for source component: " + source);
  const targetDir = path.join(licenseRoot, "source-notices");
  fs.mkdirSync(targetDir, { recursive: true });
  const targetName = slug.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 72) + "-" + path.basename(license).replace(/[^A-Za-z0-9._-]/g, "_");
  const target = path.join(targetDir, targetName);
  fs.copyFileSync(license, target);
  return path.relative(licenseRoot, target).split(path.sep).join("/");
}
function main() {
  const args = parseArgs(process.argv);
  const sourceRoot = path.resolve(args["source-root"] || "");
  const archivePath = path.resolve(args.archive || "");
  const projectRoot = path.resolve(args["project-root"] || ".");
  if (!fs.existsSync(path.join(sourceRoot, ".git")) || !fs.existsSync(archivePath)) throw new Error("The pinned mpv checkout and source archive must exist.");
  const licenseRoot = path.join(projectRoot, "licenses", "mpv");
  const repositories = collectGitRepositories(sourceRoot);
  const mpvRepo = repositories.find(repo => path.resolve(repo.directory) === sourceRoot);
  const ffmpegRepo = repositories.find(repo => path.resolve(repo.directory) === path.join(sourceRoot, "ffmpeg"));
  if (!mpvRepo || mpvRepo.commit !== MPV_COMMIT) throw new Error("The source snapshot does not contain the exact pinned mpv commit.");
  if (!ffmpegRepo) throw new Error("The source snapshot is missing the FFmpeg checkout used by the build.");
  const components = [];
  for (const repo of repositories) {
    if (repo === mpvRepo || repo === ffmpegRepo) continue;
    const relative = path.relative(sourceRoot, repo.directory).split(path.sep).join("/");
    const licenseFile = copyLicense(repo.directory, licenseRoot, relative || path.basename(repo.directory));
    components.push({ name: relative || path.basename(repo.directory), license: "See bundled upstream licence text", source: repo.source, commit: repo.commit, licenseFile });
  }
  const tarballSources = [
    ["libiconv-1.18", "https://ftpmirror.gnu.org/gnu/libiconv/libiconv-1.18.tar.gz", "1.18"],
    ["zlib-1.3.1", "https://zlib.net/fossils/zlib-1.3.1.tar.gz", "1.3.1"],
    ["freetype-2.14.1", "https://download.savannah.gnu.org/releases/freetype/freetype-2.14.1.tar.xz", "2.14.1"],
    ["fribidi-1.0.16", "https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz", "1.0.16"],
    ["harfbuzz-12.2.0", "https://github.com/harfbuzz/harfbuzz/releases/download/12.2.0/harfbuzz-12.2.0.tar.xz", "12.2.0"]
  ];
  for (const [directoryName, source, version] of tarballSources) {
    const directory = path.join(sourceRoot, directoryName);
    if (!fs.existsSync(directory)) throw new Error("Pinned source tarball was not unpacked: " + directoryName);
    const licenseFile = copyLicense(directory, licenseRoot, directoryName);
    components.push({
      name: directoryName,
      license: "See bundled upstream licence text",
      source,
      version,
      licenseFile
    });
  }

  const subprojectsRoot = path.join(sourceRoot, "subprojects");
  if (fs.existsSync(subprojectsRoot)) {
    for (const entry of fs.readdirSync(subprojectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(subprojectsRoot, entry.name);
      if (repositories.some(repo => path.resolve(repo.directory) === path.resolve(directory))) continue;
      const license = findLicenseFile(directory);
      if (!license) continue;
      const wrapPath = path.join(subprojectsRoot, entry.name + ".wrap");
      const wrap = fs.existsSync(wrapPath) ? fs.readFileSync(wrapPath, "utf8") : "";
      const sourceMatch = wrap.match(/^\\s*(?:source_url|url)\\s*=\\s*(.+)$/m);
      const source = sourceMatch ? sourceMatch[1].trim() : "Meson subproject source snapshot: " + entry.name;
      const licenseFile = copyLicense(directory, licenseRoot, "subproject-" + entry.name);
      components.push({
        name: "subprojects/" + entry.name,
        license: "See bundled upstream licence text",
        source,
        version: entry.name,
        licenseFile
      });
    }
  }

  const mpvLicenseFile = copyLicense(sourceRoot, licenseRoot, "mpv");
  const ffmpegLicenseFile = copyLicense(ffmpegRepo.directory, licenseRoot, "ffmpeg");
  const archiveSha256 = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  const manifest = {
    formatVersion: 1,
    verified: false,
    status: "candidate-build-only; independent source and licence review required before redistribution",
    mpv: { version: "0.41.0", commit: mpvRepo.commit, source: mpvRepo.source, licenseFile: mpvLicenseFile },
    ffmpeg: { commit: ffmpegRepo.commit, source: ffmpegRepo.source, licenseFile: ffmpegLicenseFile },
    components,
    archiveSha256,
    verification: {
      method: "Generated from the exact source working tree used by the successful Windows cross-build; Git revisions and upstream licence files are recorded. This is a candidate inventory, not a legal compliance certification.",
      verifiedBy: "Automated Vivid Cinema candidate-build workflow; manual review pending"
    }
  };
  fs.writeFileSync(path.join(licenseRoot, "SOURCE-MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("Created candidate source manifest:", repositories.length, "Git checkouts,", components.length, "additional components");
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
