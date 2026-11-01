"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function resolveMpvExecutable({ isPackaged, resourcesPath, appPath }) {
  return isPackaged
    ? path.join(resourcesPath, "mpv", "mpv.exe")
    : path.join(appPath, "desktop", "vendor", "mpv", "mpv.exe");
}

function createMpvArgs(mediaPath) {
  return [
    "--no-config",
    "--no-terminal",
    "--force-window=yes",
    "--osc=yes",
    "--input-default-bindings=yes",
    "--input-vo-keyboard=yes",
    "--hwdec=auto-safe",
    "--keep-open=no",
    "--title=Vivid Cinema · Advanced Player",
    "--",
    mediaPath
  ];
}

class AdvancedPlayer {
  constructor({ app, downloadEngine, spawnImpl = spawn, platform = process.platform, resourcesPath = process.resourcesPath } = {}) {
    if (!app || !downloadEngine) throw new TypeError("AdvancedPlayer requires app and downloadEngine");
    this.app = app;
    this.downloadEngine = downloadEngine;
    this.spawnImpl = spawnImpl;
    this.platform = platform;
    this.resourcesPath = resourcesPath;
    this.child = null;
    this.currentMediaPath = null;
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
      await fs.promises.access(executable, fs.constants.X_OK);
    } catch {
      throw new Error("The Vivid Advanced Player runtime is missing. Reinstall or update Vivid Cinema to repair it.");
    }

    this.stop();
    const child = this.spawnImpl(executable, createMpvArgs(realMediaPath), {
      cwd: path.dirname(executable),
      windowsHide: false,
      shell: false,
      detached: false,
      stdio: "ignore"
    });
    this.child = child;
    this.currentMediaPath = realMediaPath;

    return new Promise((resolve, reject) => {
      let settled = false;
      child.once("spawn", () => {
        settled = true;
        resolve({ started: true, engine: "mpv" });
      });
      child.once("error", error => {
        if (this.child === child) {
          this.child = null;
          this.currentMediaPath = null;
        }
        console.error("Vivid Advanced Player failed to start:", error?.message || error);
        if (!settled) reject(new Error("Vivid Advanced Player could not start: " + (error?.message || "process launch failed")));
      });
      child.once("exit", (code, signal) => {
        if (this.child === child) {
          this.child = null;
          this.currentMediaPath = null;
        }
        if (!settled) reject(new Error("Vivid Advanced Player exited before opening the video (code " + code + ", signal " + signal + ")."));
      });
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.currentMediaPath = null;
    if (child && child.exitCode === null && !child.killed) {
      try { child.kill(); } catch (error) {
        console.warn("Could not stop Vivid Advanced Player:", error?.message || error);
      }
    }
    return true;
  }
}

module.exports = { AdvancedPlayer, createMpvArgs, resolveMpvExecutable };
