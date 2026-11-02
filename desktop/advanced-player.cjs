"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");
const crypto = require("node:crypto");

function resolveMpvExecutable({ isPackaged, resourcesPath, appPath }) {
  return isPackaged
    ? path.join(resourcesPath, "mpv", "mpv.exe")
    : path.join(appPath, "desktop", "vendor", "mpv", "mpv.exe");
}

function createMpvArgs(mediaPath, startSeconds = 0, ipcPath = "") {
  return [
    "--no-config",
    "--no-terminal",
    "--force-window=yes",
    "--osc=yes",
    "--sub-auto=fuzzy",
    "--audio-file-auto=fuzzy",
    "--input-default-bindings=yes",
    "--input-vo-keyboard=yes",
    "--hwdec=auto-safe",
    "--keep-open=no",
    ...(ipcPath ? ["--input-ipc-server=" + ipcPath] : []),
    ...(Number.isFinite(startSeconds) && startSeconds > 0 ? ["--start=" + Math.min(86400, startSeconds).toFixed(3)] : []),
    "--title=Vivid Cinema · Advanced Player",
    "--",
    mediaPath
  ];
}

class AdvancedPlayer {
  constructor({ app, downloadEngine, spawnImpl = spawn, netImpl = net, randomUUID = crypto.randomUUID, platform = process.platform, resourcesPath = process.resourcesPath } = {}) {
    if (!app || !downloadEngine) throw new TypeError("AdvancedPlayer requires app and downloadEngine");
    this.app = app;
    this.downloadEngine = downloadEngine;
    this.spawnImpl = spawnImpl;
    this.netImpl = netImpl;
    this.randomUUID = randomUUID;
    this.platform = platform;
    this.resourcesPath = resourcesPath;
    this.child = null;
    this.currentMediaPath = null;
    this.ipcSocket = null;
    this.ipcRetryTimer = null;
    this.lastPositionWrite = 0;
    this.currentJob = null;
    this.nextIpcRequestId = 10;
    this.pendingIpcRequests = new Map();
  }

  executablePath() {
    return resolveMpvExecutable({
      isPackaged: this.app.isPackaged,
      resourcesPath: this.resourcesPath,
      appPath: this.app.getAppPath()
    });
  }

  async open(jobId, fileIndex = 0) {
    if (this.platform !== "win32") {
      throw new Error("Vivid Advanced Player is currently available in the Windows desktop app only.");
    }
    if (typeof jobId !== "string" || !jobId.trim()) throw new Error("Choose a saved download first.");
    const index = Number(fileIndex);
    if (!Number.isSafeInteger(index) || index < 0 || index > 10000) {
      throw new Error("The selected media file is invalid.");
    }

    const mediaPath = this.downloadEngine.mediaFile(jobId, index);
    if (!mediaPath) throw new Error("This download is not ready to play.");
    const realMediaPath = await fs.promises.realpath(mediaPath);
    const mediaStat = await fs.promises.stat(realMediaPath);
    if (!mediaStat.isFile()) throw new Error("The selected download is not a playable file.");

    const executable = this.executablePath();
    try {
      await fs.promises.access(executable, fs.constants.F_OK);
    } catch {
      throw new Error("The Vivid Advanced Player is not bundled with this build. Use a Windows release that includes the Advanced Player runtime.");
    }

    const savedPosition = this.downloadEngine.getPlaybackPosition?.(jobId, index) || 0;
    const startAt = Number.isFinite(Number(savedPosition)) ? Math.max(0, Number(savedPosition)) : 0;
    const ipcPath = "\\\\.\\pipe\\vivid-mpv-" + this.randomUUID();
    this.stop();
    const child = this.spawnImpl(executable, createMpvArgs(realMediaPath, startAt, ipcPath), {
      cwd: path.dirname(executable),
      windowsHide: true,
      shell: false,
      detached: false,
      stdio: "ignore"
    });
    this.child = child;
    this.currentMediaPath = realMediaPath;
    this.currentJob = { id: jobId, fileIndex: index };
    this.latestPosition = startAt;
    this.lastPositionWrite = 0;

    return new Promise((resolve, reject) => {
      let settled = false;
      child.once("spawn", () => {
        settled = true;
        this.connectIpc(ipcPath, child);
        resolve({ started: true, engine: "mpv", resumedFrom: startAt });
      });
      child.once("error", error => {
        if (this.child === child) {
          this.child = null;
          this.currentMediaPath = null;
          this.currentJob = null;
          this.closeIpc();
        }
        console.error("Vivid Advanced Player failed to start:", error?.message || error);
        if (!settled) reject(new Error("Vivid Advanced Player could not start: " + (error?.message || "process launch failed")));
      });
      child.once("exit", (code, signal) => {
        if (this.child === child) {
          this.child = null;
          this.persistLatestPosition();
          this.currentMediaPath = null;
          this.currentJob = null;
          this.closeIpc();
        }
        if (!settled) reject(new Error("Vivid Advanced Player exited before opening the video (code " + code + ", signal " + signal + ")."));
      });
    });
  }

  connectIpc(pipePath, child) {
    let attempts = 0;
    const connect = () => {
      if (this.child !== child || attempts >= 12) return;
      attempts += 1;
      let socket;
      try {
        socket = this.netImpl.createConnection(pipePath);
      } catch (error) {
        if (attempts < 12 && this.child === child) this.ipcRetryTimer = setTimeout(connect, 250);
        else console.warn("Vivid Advanced Player IPC could not connect:", error?.message || error);
        return;
      }
      this.ipcSocket = socket;
      let buffer = "";
      let connected = false;
      socket.setEncoding?.("utf8");
      socket.once("connect", () => {
        if (this.child !== child) { socket.destroy?.(); return; }
        connected = true;
        this.sendIpc(["observe_property", 1, "time-pos"]);
      });
      socket.on("data", chunk => {
        if (this.child !== child) return;
        buffer += String(chunk);
        if (buffer.length > 65536) buffer = buffer.slice(-32768);
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line);
            if (Number.isInteger(message.request_id) && this.pendingIpcRequests.has(message.request_id)) {
              const pending = this.pendingIpcRequests.get(message.request_id);
              this.pendingIpcRequests.delete(message.request_id);
              clearTimeout(pending.timer);
              if (message.error && message.error !== "success") pending.reject(new Error("mpv command failed: " + message.error));
              else pending.resolve(message.data);
              continue;
            }
            if (message.event === "property-change" && message.name === "time-pos" && Number.isFinite(message.data)) {
              this.latestPosition = Math.max(0, message.data);
              if (Date.now() - this.lastPositionWrite >= 5000) {
                this.lastPositionWrite = Date.now();
                this.persistLatestPosition();
              }
            }
          } catch { /* Ignore malformed or unrelated mpv IPC events. */ }
        }
      });
      socket.once("error", error => {
        if (this.child !== child) { socket.destroy?.(); return; }
        if (this.ipcSocket === socket) this.ipcSocket = null;
        socket.destroy?.();
        if (!connected && this.child === child && attempts < 12) {
          this.ipcRetryTimer = setTimeout(connect, 250);
        } else if (this.child === child) {
          console.warn("Vivid Advanced Player position sync unavailable:", error?.message || error);
        }
      });
      socket.once("close", () => { if (this.ipcSocket === socket) this.ipcSocket = null; });
    };
    connect();
  }

  sendIpc(command) {
    if (!this.ipcSocket || this.ipcSocket.destroyed) return false;
    try { this.ipcSocket.write(JSON.stringify({ command }) + "\n"); return true; }
    catch { return false; }
  }

  requestIpc(command, timeoutMs = 1800) {
    if (!this.ipcSocket || this.ipcSocket.destroyed) {
      return Promise.reject(new Error("Advanced Player controls are not connected yet."));
    }
    const requestId = this.nextIpcRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIpcRequests.delete(requestId);
        reject(new Error("Advanced Player did not respond in time."));
      }, timeoutMs);
      this.pendingIpcRequests.set(requestId, { resolve, reject, timer });
      try {
        this.ipcSocket.write(JSON.stringify({ command, request_id: requestId }) + "\n");
      } catch (error) {
        clearTimeout(timer);
        this.pendingIpcRequests.delete(requestId);
        reject(error);
      }
    });
  }

  async getTracks() {
    const tracks = await this.requestIpc(["get_property", "track-list"]);
    if (!Array.isArray(tracks)) return { audio: [], subtitles: [] };
    const normalize = track => ({
      id: Number(track.id),
      title: String(track.title || track.lang || "").slice(0, 160),
      language: String(track.lang || "").slice(0, 32),
      codec: String(track.codec || "").slice(0, 48),
      selected: Boolean(track.selected),
      external: Boolean(track.external),
      default: Boolean(track.default),
      forced: Boolean(track.forced)
    });
    return {
      audio: tracks.filter(track => track.type === "audio").map(normalize),
      subtitles: tracks.filter(track => track.type === "sub").map(normalize)
    };
  }

  async selectTrack(type, trackId) {
    const property = type === "audio" ? "aid" : type === "subtitle" ? "sid" : null;
    if (!property) throw new Error("Choose an audio or subtitle track.");
    const value = trackId === null || trackId === "off" ? "no" : Number(trackId);
    if (value !== "no" && (!Number.isSafeInteger(value) || value < 1 || value > 10000)) {
      throw new Error("The selected track is invalid.");
    }
    await this.requestIpc(["set_property", property, value]);
    return true;
  }

  persistLatestPosition() {
    const current = this.currentJob;
    const seconds = Number(this.latestPosition);
    if (!current || !Number.isFinite(seconds) || seconds <= 0) return;
    void this.downloadEngine.setPlaybackPosition(current.id, current.fileIndex, seconds).catch(error => {
      console.warn("Vivid Advanced Player position save failed:", error?.message || error);
    });
  }

  closeIpc() {
    if (this.ipcRetryTimer) clearTimeout(this.ipcRetryTimer);
    this.ipcRetryTimer = null;
    const socket = this.ipcSocket;
    this.ipcSocket = null;
    if (socket && !socket.destroyed) socket.destroy();
    for (const pending of this.pendingIpcRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Advanced Player closed before the command completed."));
    }
    this.pendingIpcRequests.clear();
  }

  stop() {
    this.persistLatestPosition();
    this.closeIpc();
    const child = this.child;
    this.child = null;
    this.currentMediaPath = null;
    this.currentJob = null;
    if (child && child.exitCode === null && !child.killed) {
      try { child.kill(); } catch (error) {
        console.warn("Could not stop Vivid Advanced Player:", error?.message || error);
      }
    }
    return true;
  }
}

module.exports = { AdvancedPlayer, createMpvArgs, resolveMpvExecutable };
