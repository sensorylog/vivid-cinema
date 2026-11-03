"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LocalTranscodeEngine, preferredEnglishSubtitle, executablePath, waitForFile, runProcess } = require("../desktop/local-transcode-engine.cjs");

test("English subtitle selection prefers default English over forced or non-English tracks", () => {
  const selected = preferredEnglishSubtitle([
    { index: 2, codec_type: "subtitle", codec_name: "subrip", tags: { language: "jpn" }, disposition: { default: 1 } },
    { index: 4, codec_type: "subtitle", codec_name: "ass", tags: { language: "eng" }, disposition: { forced: 1 } },
    { index: 5, codec_type: "subtitle", codec_name: "mov_text", tags: { language: "en" }, disposition: { default: 1 } }
  ]);
  assert.equal(selected.index, 5);
  assert.equal(preferredEnglishSubtitle([{ codec_type: "subtitle", codec_name: "subrip", tags: { language: "fra" } }]), null);
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

test("real FFmpeg transcodes a sample MKV and serves HLS plus an embedded English subtitle", async t => {
  let ffmpegPath;
  let ffprobePath;
  try {
    ffmpegPath = require("ffmpeg-static");
    ffprobePath = require("ffprobe-static").path;
    if (!ffmpegPath || !ffprobePath) throw new Error("FFmpeg binaries unavailable");
  } catch {
    t.skip("Desktop runtime dependencies are installed in the Windows packaging job.");
    return;
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-transcode-e2e-"));
  const input = path.join(directory, "sample.mkv");
  const subtitle = path.join(directory, "english.srt");
  await fs.writeFile(subtitle, "1\\n00:00:00,200 --> 00:00:01,700\\nHello from Vivid\\n");
  const engine = new LocalTranscodeEngine({
    app: { getPath: () => directory, isPackaged: false },
    ffmpegPath,
    ffprobePath,
    allowedOrigins: ["https://vivid-cinema.pages.dev"],
    startupTimeoutMs: 30000
  });
  try {
    await runProcess(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=size=160x90:rate=12",
      "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
      "-i", subtitle,
      "-t", "2",
      "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0",
      "-c:v", "mpeg4", "-q:v", "5", "-c:a", "mp3", "-c:s", "srt",
      "-metadata:s:a:0", "language=eng",
      "-metadata:s:s:0", "language=eng",
      input
    ], { timeoutMs: 30000 });

    const origin = await engine.start();
    const session = await engine.createSession(input, 77);
    assert.equal(session.codecs.outputVideo, "h264");
    assert.equal(session.codecs.outputAudio, "aac-stereo");
    assert.ok(session.subtitleUrl);

    const headers = { Origin: "https://vivid-cinema.pages.dev" };
    const playlistResponse = await fetch(session.url, { headers });
    assert.equal(playlistResponse.status, 200);
    const playlist = await playlistResponse.text();
    assert.match(playlist, /#EXTM3U/);
    const segmentName = playlist.split(/\\r?\\n/).find(line => /^segment_\\d+\\.ts$/.test(line.trim()));
    assert.ok(segmentName, "HLS playlist includes a media segment");
    const segmentResponse = await fetch(new URL(segmentName.trim(), session.url), { headers });
    assert.equal(segmentResponse.status, 200);
    assert.ok(Number(segmentResponse.headers.get("content-length")) > 0);

    const subtitleResponse = await fetch(session.subtitleUrl, { headers });
    assert.equal(subtitleResponse.status, 200);
    assert.match(await subtitleResponse.text(), /WEBVTT/);

    const compatibleInput = path.join(directory, "compatible-h264-aac.mkv");
    await runProcess(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error", "-i", input,
      "-map", "0:v:0", "-map", "0:a:0",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ac", "2", compatibleInput
    ], { timeoutMs: 30000 });
    const compatibleSession = await engine.createSession(compatibleInput, 77);
    assert.equal(compatibleSession.codecs.videoMode, "copy");
    assert.equal(compatibleSession.codecs.audioMode, "copy");
    assert.equal(compatibleSession.codecs.downscaled, false);
    const compatiblePlaylist = await fetch(compatibleSession.url, { headers });
    assert.equal(compatiblePlaylist.status, 200);
    assert.match(await compatiblePlaylist.text(), /#EXTM3U/);
    assert.equal(await engine.stopSession(compatibleSession.sessionId, 77), true);

    assert.equal(await engine.stopSession(session.sessionId, 77), true);
    assert.equal(await engine.stopSession(session.sessionId, 78), false);
    assert.ok(origin.startsWith("http://127.0.0.1:"));
  } finally {
    await engine.shutdown();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
