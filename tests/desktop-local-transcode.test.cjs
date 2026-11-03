"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LocalTranscodeEngine, preferredEnglishSubtitle, executablePath, waitForFile, runProcess } = require("../desktop/local-transcode-engine.cjs");

test("English subtitle selection prefers default English over forced or non-English tracks", () => {
  const selected = preferredEnglishSubtitle([
    { index: 2, codec_type: "subtitle", tags: { language: "jpn" }, disposition: { default: 1 } },
    { index: 4, codec_type: "subtitle", tags: { language: "eng" }, disposition: { forced: 1 } },
    { index: 5, codec_type: "subtitle", tags: { language: "en" }, disposition: { default: 1 } }
  ]);
  assert.equal(selected.index, 5);
  assert.equal(preferredEnglishSubtitle([{ codec_type: "subtitle", tags: { language: "fra" } }]), null);
});

test("packaged FFmpeg binaries are resolved from Electron's asar-unpacked directory", () => {
  const input = path.join(path.sep, "app", "resources", "app.asar", "desktop", "node_modules", "ffmpeg-static", "ffmpeg.exe");
  const resolved = executablePath(input, { isPackaged: true });
  assert.ok(resolved.includes("app.asar.unpacked"));
  assert.equal(executablePath(input, { isPackaged: false }), input);
});

test("waitForFile resolves after an HLS artifact is written", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-transcode-test-"));
  const target = path.join(directory, "segment_00000.ts");
  try {
    setTimeout(() => { void fs.writeFile(target, Buffer.from("segment")); }, 40);
    const stat = await waitForFile(target, { timeoutMs: 1500 });
    assert.equal(stat.size, 7);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("FFprobe process wrapper captures output and checks exit status", async () => {
  const result = await runProcess(process.execPath, ["-e", "process.stdout.write('probe-ok')"], { timeoutMs: 3000 });
  assert.equal(result.stdout, "probe-ok");
});

test("local transcode server binds to loopback and rejects untrusted web origins", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-transcode-server-"));
  const engine = new LocalTranscodeEngine({
    app: { getPath: () => directory, isPackaged: false },
    ffmpegPath: process.execPath,
    ffprobePath: process.execPath,
    allowedOrigins: ["https://vivid-cinema.pages.dev"]
  });
  try {
    const origin = await engine.start();
    assert.match(origin, /^http:\/\/127\.0\.0\.1:/);
    const allowed = await fetch(origin + "/missing", { headers: { Origin: "https://vivid-cinema.pages.dev" } });
    assert.equal(allowed.status, 404);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://vivid-cinema.pages.dev");
    const blocked = await fetch(origin + "/missing", { headers: { Origin: "https://untrusted.example" } });
    assert.equal(blocked.status, 403);
    const preflight = await fetch(origin + "/session/000000000000000000000000000000000000000000000000/index.m3u8", {
      method: "OPTIONS",
      headers: { Origin: "https://vivid-cinema.pages.dev" }
    });
    assert.equal(preflight.status, 204);
  } finally {
    await engine.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
