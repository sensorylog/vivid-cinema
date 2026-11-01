"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { MPV_SOURCE_COMMIT } = require("../desktop/prepare-mpv.cjs");
const { verifyMpvSources } = require("../desktop/verify-mpv-sources.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vivid-mpv-source-gate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const licenseRoot = path.join(root, "licenses", "mpv");
  fs.mkdirSync(licenseRoot, { recursive: true });
  fs.writeFileSync(path.join(licenseRoot, "LICENSE.GPL"), "test licence text");
  return { root, licenseRoot, archivePath: path.join(licenseRoot, "CORRESPONDING-SOURCE.zip"), manifestPath: path.join(licenseRoot, "SOURCE-MANIFEST.json") };
}

function writeValidBundle(paths) {
  const bytes = Buffer.from("test source archive contents");
  fs.writeFileSync(paths.archivePath, bytes);
  fs.writeFileSync(paths.manifestPath, JSON.stringify({
    formatVersion: 1,
    verified: true,
    mpv: { commit: MPV_SOURCE_COMMIT },
    ffmpeg: { commit: "a".repeat(40) },
    components: [{ name: "example-lib", license: "LGPL-2.1-or-later", source: "https://example.invalid/source", version: "1.2.3", licenseFile: "LICENSE.GPL" }],
    verification: { method: "reviewed source manifest and archive contents", verifiedBy: "test-fixture" },
    archiveSha256: crypto.createHash("sha256").update(bytes).digest("hex")
  }));
}

test("source gate allows only an explicitly skipped preview build", () => {
  assert.deepEqual(verifyMpvSources({ skip: true, projectRoot: os.tmpdir() }), { skipped: true });
});

test("source gate blocks redistributable builds without the source archive and manifest", t => {
  const paths = fixture(t);
  assert.throws(() => verifyMpvSources({ projectRoot: paths.root, skip: false }), /CORRESPONDING-SOURCE.zip/);
});

test("source gate verifies exact mpv/FFmpeg provenance, component metadata and archive hash", t => {
  const paths = fixture(t);
  writeValidBundle(paths);
  const result = verifyMpvSources({ projectRoot: paths.root, skip: false });
  assert.equal(result.skipped, false);
  assert.equal(result.componentCount, 1);
  assert.equal(result.archiveSha256, JSON.parse(fs.readFileSync(paths.manifestPath, "utf8")).archiveSha256);
});

test("source gate rejects an archive changed after manifest verification", t => {
  const paths = fixture(t);
  writeValidBundle(paths);
  fs.appendFileSync(paths.archivePath, "tampered");
  assert.throws(() => verifyMpvSources({ projectRoot: paths.root, skip: false }), /SHA-256/);
});

test("source gate rejects incomplete component licence provenance", t => {
  const paths = fixture(t);
  writeValidBundle(paths);
  const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, "utf8"));
  manifest.components = [{ name: "missing-provenance" }];
  fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyMpvSources({ projectRoot: paths.root, skip: false }), /Every source-manifest component/);
});


test("source gate rejects licence paths that escape the bundled notice directory", t => {
  const paths = fixture(t);
  writeValidBundle(paths);
  const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, "utf8"));
  manifest.components[0].licenseFile = "../../package.json";
  fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyMpvSources({ projectRoot: paths.root, skip: false }), /bundled licence file/);
});
