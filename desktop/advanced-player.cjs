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
      throw new Error("The Vivid Advanced Player runtime is missing. Reinstall or update Vivid Cinema to repair it.");
    }

    const savedPosition = this.downloadEngine.getPlaybackPosition?.(jobId, index) || 0;
    const startAt = Number.isFinite(Number(savedPosition)) ? Math.max(0, Number(savedPosition)) : 0;
    const ipcPath = "\\\\.\\pipe\\vivid-mpv-" + this.randomUUID();
    this.stop();
    const child = this.spawnImpl(executable, createMpvArgs(realMediaPath, startAt, ipcPath), {
      cwd: path.dirname(executable),
      windowsHide: false,
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
        connected = true;
        this.sendIpc(["observe_property", 1, "time-pos"]);
      });
      socket.on("data", chunk => {
        buffer += String(chunk);
        if (buffer.length > 65536) buffer = buffer.slice(-32768);
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line);
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
