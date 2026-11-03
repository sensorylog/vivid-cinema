"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

function executablePath(value, app) {
  if (!value) throw new Error("The FFmpeg runtime is not installed.");
  if (!app?.isPackaged) return value;
  const archiveMarker = path.sep + "app.asar" + path.sep;
  return value.includes(archiveMarker)
    ? value.replace(archiveMarker, path.sep + "app.asar.unpacked" + path.sep)
    : value;
}

function runProcess(binary, args, { timeoutMs = 30000, maxOutput = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Media inspection timed out."));
    }, timeoutMs);
    const collect = (target, chunk) => {
      if (target === "stdout") stdout = (stdout + chunk.toString("utf8")).slice(-maxOutput);
      else stderr = (stderr + chunk.toString("utf8")).slice(-maxOutput);
    };
    child.stdout.on("data", chunk => collect("stdout", chunk));
    child.stderr.on("data", chunk => collect("stderr", chunk));
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    child.once("error", error => finish(error));
    child.once("close", code => {
      if (code === 0) finish(null);
      else finish(new Error(stderr.trim().slice(-1600) || "Media tool exited with code " + code + "."));
    });
  });
}

function waitForFile(filePath, { timeoutMs = 30000, processRef = null } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.isFile() && stat.size > 0) return resolve(stat);
      } catch {}
      if (processRef?.exitCode !== null && processRef?.exitCode !== undefined) {
        return reject(new Error(processRef.stderrText?.trim().slice(-1600) || "FFmpeg stopped before producing playable media."));
      }
      if (Date.now() - started >= timeoutMs) return reject(new Error("FFmpeg took too long to prepare the first playable segment."));
      setTimeout(check, 120);
    };
    void check();
  });
}

function preferredEnglishSubtitle(streams) {
  const textCodecs = new Set(["subrip", "ass", "ssa", "mov_text", "webvtt", "text"]);
  const candidates = (Array.isArray(streams) ? streams : []).filter(stream => {
    if (stream.codec_type !== "subtitle" || !textCodecs.has(String(stream.codec_name || "").toLowerCase())) return false;
    const language = String(stream.tags?.language || "").toLowerCase();
    return language === "en" || language === "eng" || language.startsWith("en-");
  });
  candidates.sort((a, b) =>
    Number(Boolean(b.disposition?.default)) - Number(Boolean(a.disposition?.default)) ||
    Number(Boolean(b.disposition?.forced)) - Number(Boolean(a.disposition?.forced))
  );
  return candidates[0] || null;
}

class LocalTranscodeEngine {
  constructor({ app, allowedOrigins = [], ffmpegPath = null, ffprobePath = null, startupTimeoutMs = 45000 } = {}) {
    if (!app || typeof app.getPath !== "function") throw new TypeError("Electron app is required.");
    this.app = app;
    this.ffmpegPath = executablePath(ffmpegPath || require("ffmpeg-static"), app);
    const probePackage = ffprobePath ? null : require("ffprobe-static");
    this.ffprobePath = executablePath(ffprobePath || probePackage.path, app);
    this.allowedOrigins = new Set(allowedOrigins.filter(Boolean));
    this.startupTimeoutMs = startupTimeoutMs;
    this.sessions = new Map();
    this.server = null;
    this.origin = null;
    this.root = path.join(app.getPath("temp"), "vivid-cinema-transcodes");
    this.closing = false;
  }

  async start() {
    if (this.server) return this.origin;
    await fs.promises.mkdir(this.root, { recursive: true });
    this.server = http.createServer((request, response) => { void this.handleRequest(request, response); });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    this.origin = "http://127.0.0.1:" + address.port;
    return this.origin;
  }

  async inspect(filePath) {
    const result = await runProcess(this.ffprobePath, [
      "-v", "error",
      "-show_entries", "stream=index,codec_type,codec_name,profile,width,height,channels,channel_layout:stream_tags=language,title:stream_disposition=default,forced",
      "-of", "json",
      filePath
    ]);
    let data;
    try { data = JSON.parse(result.stdout || "{}"); }
    catch { throw new Error("FFprobe returned invalid media metadata."); }
    const streams = Array.isArray(data.streams) ? data.streams : [];
    if (!streams.some(stream => stream.codec_type === "video")) throw new Error("This file does not contain a video stream.");
    return streams;
  }

  async createSession(filePath, ownerId) {
    if (this.closing || !this.server) throw new Error("The local media service is not ready.");
    if (!Number.isInteger(ownerId)) throw new Error("Invalid media requester.");
    const absolutePath = await fs.promises.realpath(filePath);
    const inputStat = await fs.promises.stat(absolutePath);
    if (!inputStat.isFile()) throw new Error("The selected media file is not a regular file.");
    const streams = await this.inspect(absolutePath);
    const video = streams.find(stream => stream.codec_type === "video");
    const audio = streams.filter(stream => stream.codec_type === "audio").sort((a, b) => Number(Boolean(b.disposition?.default)) - Number(Boolean(a.disposition?.default)))[0] || null;
    const subtitle = preferredEnglishSubtitle(streams);
    const sessionId = crypto.randomBytes(24).toString("hex");
    const directory = path.join(this.root, sessionId);
    await fs.promises.mkdir(directory, { recursive: true });

    const playlistPath = path.join(directory, "index.m3u8");
    const segmentPattern = path.join(directory, "segment_%05d.ts");
    const args = [
      "-y", "-hide_banner", "-loglevel", "warning",
      "-i", absolutePath,
      "-map", "0:v:0",
      "-map", audio ? "0:" + audio.index : "0:a:0?",
      "-sn", "-dn",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
      "-max_muxing_queue_size", "1024",
      "-f", "hls", "-hls_time", "4", "-hls_list_size", "0",
      "-hls_flags", "independent_segments+temp_file",
      "-hls_segment_filename", segmentPattern,
      playlistPath
    ];

    const child = spawn(this.ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const record = {
      id: sessionId, ownerId, directory, child, stderrText: "",
      exitCode: null, subtitleExitCode: null, stopped: false, subtitlePromise: null
    };
    this.sessions.set(sessionId, record);
    child.stderr.on("data", chunk => { record.stderrText = (record.stderrText + chunk.toString("utf8")).slice(-12000); });
    child.once("error", error => { record.stderrText += "\n" + error.message; record.exitCode = -1; });
    child.once("close", code => { record.exitCode = code; });

    if (subtitle) {
      const subtitleTempPath = path.join(directory, "english.vtt.tmp");
      const subtitleFinalPath = path.join(directory, "english.vtt");
      const subtitleChild = spawn(this.ffmpegPath, [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", absolutePath,
        "-map", "0:" + subtitle.index,
        "-c:s", "webvtt",
        "-f", "webvtt",
        subtitleTempPath
      ], { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
      record.subtitleChild = subtitleChild;
      record.subtitlePromise = new Promise(resolve => {
        const subtitleTimer = setTimeout(() => {
          if (subtitleChild.exitCode === null && !subtitleChild.killed) subtitleChild.kill();
        }, Math.max(this.startupTimeoutMs * 4, 180000));
        subtitleChild.once("close", async code => {
          clearTimeout(subtitleTimer);
          if (code === 0) {
            try {
              await fs.promises.rename(subtitleTempPath, subtitleFinalPath);
              record.subtitleExitCode = 0;
              resolve(true);
            } catch {
              record.subtitleExitCode = -1;
              resolve(false);
            }
          } else {
            record.subtitleExitCode = code;
            resolve(false);
          }
        });
        subtitleChild.once("error", () => {
          record.subtitleExitCode = -1;
          clearTimeout(subtitleTimer);
          resolve(false);
        });
      });
    }

    try {
      await Promise.all([
        waitForFile(path.join(directory, "index.m3u8"), { timeoutMs: this.startupTimeoutMs, processRef: record }),
        waitForFile(path.join(directory, "segment_00000.ts"), { timeoutMs: this.startupTimeoutMs, processRef: record })
      ]);
      return {
        sessionId,
        url: this.origin + "/session/" + sessionId + "/index.m3u8",
        subtitleUrl: subtitle ? this.origin + "/session/" + sessionId + "/english.vtt" : null,
        fileName: path.basename(absolutePath),
        fileSize: inputStat.size,
        codecs: {
          inputVideo: video.codec_name || "unknown",
          inputAudio: audio?.codec_name || null,
          outputVideo: "h264",
          outputAudio: audio ? "aac-stereo" : null
        },
        subtitle: subtitle ? { language: "en", label: "English", sourceCodec: subtitle.codec_name || "unknown" } : null
      };
    } catch (error) {
      await this.stopSession(sessionId, ownerId);
      throw error;
    }
  }

  async handleRequest(request, response) {
    const origin = String(request.headers.origin || "");
    if (origin && !this.allowedOrigins.has(origin)) { response.writeHead(403).end("Origin not allowed"); return; }
    response.setHeader("Access-Control-Allow-Origin", origin || "*");
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD, OPTIONS" }).end(); return; }
    let url;
    try { url = new URL(request.url || "/", this.origin); }
    catch { response.writeHead(400).end("Bad request"); return; }
    const match = /^\/session\/([a-f0-9]{48})\/(index\.m3u8|english\.vtt|segment_\d{5}\.ts)$/.exec(url.pathname);
    if (!match) { response.writeHead(404).end("Not found"); return; }
    const record = this.sessions.get(match[1]);
    if (!record || record.stopped) { response.writeHead(404).end("Session expired"); return; }
    const filename = match[2];
    const filePath = path.join(record.directory, filename);
    if (filename === "english.vtt") {
      if (record.subtitleExitCode !== null && record.subtitleExitCode !== undefined && record.subtitleExitCode !== 0) {
        response.writeHead(404).end("Subtitle not available"); return;
      }
      try { await waitForFile(filePath, { timeoutMs: 180000, processRef: { get exitCode() { return record.subtitleExitCode; } } }); }
      catch { response.writeHead(404).end("Subtitle not available"); return; }
    }
    let stat;
    try { stat = await fs.promises.stat(filePath); }
    catch { response.writeHead(404).end("Not ready"); return; }
    if (!stat.isFile()) { response.writeHead(404).end("Not found"); return; }
    const contentType = filename.endsWith(".m3u8") ? "application/vnd.apple.mpegurl"
      : filename.endsWith(".vtt") ? "text/vtt; charset=utf-8" : "video/mp2t";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": filename.endsWith(".m3u8") ? "no-store" : "public, max-age=31536000, immutable"
    });
    if (request.method === "HEAD") { response.end(); return; }
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => { if (!response.headersSent) response.writeHead(500); response.end(); });
    stream.pipe(response);
  }

  async stopSession(sessionId, ownerId) {
    const record = this.sessions.get(String(sessionId || ""));
    if (!record || record.ownerId !== ownerId) return false;
    this.sessions.delete(record.id);
    record.stopped = true;
    const children = [record.child, record.subtitleChild].filter(Boolean);
    for (const child of children) {
      if (child.exitCode === null && !child.killed) { try { child.kill(); } catch {} }
    }
    await Promise.all(children.map(child => {
      if (child.exitCode !== null) return Promise.resolve();
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 3000);
        child.once("close", () => { clearTimeout(timer); resolve(); });
        child.once("error", () => { clearTimeout(timer); resolve(); });
      });
    }));
    if (record.subtitlePromise) await record.subtitlePromise.catch(() => false);
    await fs.promises.rm(record.directory, { recursive: true, force: true }).catch(() => {});
    return true;
  }

  async stopOwner(ownerId) {
    const ids = [...this.sessions.values()].filter(record => record.ownerId === ownerId).map(record => record.id);
    await Promise.all(ids.map(id => this.stopSession(id, ownerId)));
  }

  async shutdown() {
    if (this.closing) return;
    this.closing = true;
    const records = [...this.sessions.values()];
    await Promise.all(records.map(record => this.stopSession(record.id, record.ownerId)));
    if (this.server) {
      await new Promise(resolve => this.server.close(() => resolve()));
      this.server = null;
    }
    await fs.promises.rm(this.root, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { LocalTranscodeEngine, preferredEnglishSubtitle, runProcess, waitForFile, executablePath };
