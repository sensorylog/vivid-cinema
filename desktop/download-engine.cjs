"use strict";
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const WebTorrent = require("webtorrent");
const TorrentSearchApi = require("torrent-search-api");

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mkv|avi|mov|webm|ogv)$/i;
const safeText = (value, max = 180) => String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
const roundProgress = torrent => Math.round((Number(torrent?.progress) || 0) * 1000) / 10;

class DesktopDownloadEngine {
  constructor({ app, BrowserWindow, dialog, shell }) {
    Object.assign(this, { app, BrowserWindow, dialog, shell });
    this.client = new WebTorrent();
    this.jobs = new Map();
    this.searchResults = new Map();
    this.downloadPath = path.join(app.getPath("downloads"), "Vivid Cinema");
    this.statePath = path.join(app.getPath("userData"), "vivid-downloads.json");
    fs.mkdirSync(this.downloadPath, { recursive: true });
    TorrentSearchApi.enablePublicProviders();
    this.ready = this.restore();
  }

  send(channel, data) {
    for (const win of this.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, data);
    }
  }

  async persist() {
    const rows = [...this.jobs.values()].map(job => ({
      id: job.id, title: job.title, resultTitle: job.resultTitle,
      media: job.media, magnet: job.magnet, status: job.status,
      filePath: job.filePath || null, error: job.error || null,
      progress: job.progress || 0, downloaded: job.downloaded || 0, total: job.total || 0,
      createdAt: job.createdAt, updatedAt: Date.now()
    }));
    await fsp.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = this.statePath + ".tmp";
    await fsp.writeFile(temporary, JSON.stringify({ version: 1, downloadPath: this.downloadPath, jobs: rows }, null, 2), "utf8");
    await fsp.rename(temporary, this.statePath);
  }

  async restore() {
    try {
      const state = JSON.parse(await fsp.readFile(this.statePath, "utf8"));
      if (typeof state.downloadPath === "string" && path.isAbsolute(state.downloadPath)) {
        this.downloadPath = state.downloadPath;
      }
      fs.mkdirSync(this.downloadPath, { recursive: true });
      for (const row of Array.isArray(state.jobs) ? state.jobs : []) {
        if (!row || typeof row.id !== "string" || typeof row.magnet !== "string" || !row.magnet.startsWith("magnet:?")) continue;
        const status = row.status === "completed" && row.filePath && fs.existsSync(row.filePath)
          ? "completed"
          : ["cancelled", "failed"].includes(row.status) ? row.status : "paused";
        this.jobs.set(row.id, { ...row, status, torrent: null, error: row.error || null });
      }
      await this.persist();
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("Could not restore Vivid downloads:", error.message);
    }
  }

  async search(query) {
    await this.ready;
    const term = safeText(query, 160);
    if (term.length < 2) throw new Error("Enter at least two characters.");
    const rows = await TorrentSearchApi.search(term, "All", 60);
    return (Array.isArray(rows) ? rows : []).filter(x => x && x.title && Number(x.seeds || 0) > 0).map(source => {
      const id = crypto.randomUUID();
      this.searchResults.set(id, source);
      return {
        id, title: safeText(source.title, 300),
        provider: safeText(source.provider || "Torrent provider", 80),
        seeds: Math.max(0, Number(source.seeds) || 0),
        peers: Math.max(0, Number(source.peers) || 0),
        size: safeText(source.size, 40),
        magnet: typeof source.magnet === "string" ? source.magnet : null
      };
    });
  }

  async chooseFolder() {
    const result = await this.dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (!result.canceled && result.filePaths[0]) {
      this.downloadPath = result.filePaths[0];
      await this.persist();
    }
    return this.downloadPath;
  }

  async start(result, media = {}) {
    await this.ready;
    const source = result && this.searchResults.get(String(result.id));
    if (!source) throw new Error("Search result expired. Search again and choose a result.");
    const magnet = result.magnet || await TorrentSearchApi.getMagnet(source);
    if (typeof magnet !== "string" || !magnet.startsWith("magnet:?")) throw new Error("No valid magnet link was returned.");
    const id = crypto.randomUUID();
    const job = {
      id, title: safeText(media.title || result.title), resultTitle: safeText(result.title, 300),
      media: { id: safeText(media.id, 80), media_type: media.media_type === "tv" ? "tv" : "movie",
        title: safeText(media.title || result.title), season: Number.isInteger(Number(media.season)) ? Number(media.season) : null,
        episode: Number.isInteger(Number(media.episode)) ? Number(media.episode) : null },
      magnet, status: "queued", torrent: null, filePath: null, error: null, createdAt: Date.now()
    };
    this.jobs.set(id, job);
    await this.persist();
    this.attachTorrent(job);
    return { id, status: job.status };
  }

  attachTorrent(job) {
    job.status = "downloading";
    job.error = null;
    const torrent = this.client.add(job.magnet, { path: this.downloadPath });
    job.torrent = torrent;
    const publish = () => {
      job.progress = roundProgress(torrent);
      job.downloaded = Number(torrent.downloaded) || job.downloaded || 0;
      job.total = Number(torrent.length) || job.total || 0;
      const payload = this.snapshot(job);
      this.send("vivid-download-progress", payload);
      void this.persist().catch(error => console.warn("Download state save failed:", error.message));
    };
    torrent.on("metadata", publish);
    torrent.on("download", publish);
    torrent.on("upload", publish);
    torrent.on("done", () => {
      const file = [...torrent.files].filter(item => VIDEO_EXTENSIONS.test(item.name)).sort((a, b) => b.length - a.length)[0];
      job.filePath = file ? path.resolve(this.downloadPath, file.path) : null;
      job.status = job.filePath ? "completed" : "failed";
      if (!job.filePath) job.error = "The release finished, but no playable video file was found.";
      job.torrent = null;
      publish();
      this.send(job.status === "completed" ? "vivid-download-complete" : "vivid-download-error",
        job.status === "completed" ? { ...this.snapshot(job), filePath: job.filePath } : { id: job.id, message: job.error });
    });
    torrent.on("error", error => {
      if (job.status === "cancelled" || job.status === "paused") return;
      job.status = "failed";
      job.error = safeText(error?.message || "Download failed", 300);
      job.torrent = null;
      publish();
      this.send("vivid-download-error", { id: job.id, message: job.error });
    });
    publish();
  }

  snapshot(job) {
    const torrent = job.torrent;
    const fileSize = job.filePath && fs.existsSync(job.filePath) ? fs.statSync(job.filePath).size : 0;
    return {
      id: job.id, title: job.title, media: job.media, status: job.status,
      progress: torrent ? roundProgress(torrent) : job.status === "completed" ? 100 : Number(job.progress) || 0,
      speed: torrent?.downloadSpeed || 0, downloaded: torrent?.downloaded || job.downloaded || 0,
      total: torrent?.length || job.total || fileSize || 0, peers: torrent?.numPeers || 0,
      filePath: job.filePath || null, error: job.error || null, createdAt: job.createdAt
    };
  }

  mediaFile(id) {
    const job = this.jobs.get(String(id));
    if (!job || job.status !== "completed" || !job.filePath) return null;
    const target = path.resolve(job.filePath);
    return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
  }

  async list() {
    await this.ready;
    return [...this.jobs.values()].map(job => this.snapshot(job));
  }

  async control(id, action) {
    await this.ready;
    const job = this.jobs.get(String(id));
    if (!job) return false;
    if (action === "pause" && job.status === "downloading" && job.torrent) {
      const torrent = job.torrent;
      job.progress = roundProgress(torrent);
      job.downloaded = Number(torrent.downloaded) || 0;
      job.total = Number(torrent.length) || 0;
      job.status = "paused";
      job.torrent = null;
      await new Promise(resolve => torrent.destroy({ destroyStore: false }, resolve));
      await this.persist();
      this.send("vivid-download-progress", this.snapshot(job));
      return true;
    }
    if (action === "resume" && ["paused", "failed"].includes(job.status)) {
      this.attachTorrent(job);
      await this.persist();
      return true;
    }
    if (action === "cancel" && ["queued", "downloading", "paused", "failed"].includes(job.status)) {
      job.status = "cancelled";
      if (job.torrent) {
        const torrent = job.torrent;
        job.torrent = null;
        await new Promise(resolve => torrent.destroy({ destroyStore: true }, resolve));
      }
      await this.persist();
      this.send("vivid-download-progress", this.snapshot(job));
      return true;
    }
    if (action === "show" && job.filePath) { this.shell.showItemInFolder(job.filePath); return true; }
    return false;
  }

  async shutdown() {
    for (const job of this.jobs.values()) {
      if (job.status === "downloading") job.status = "paused";
      job.torrent = null;
    }
    await this.persist().catch(error => console.warn("Could not persist downloads on exit:", error.message));
    await new Promise(resolve => this.client.destroy({ destroyStore: false }, resolve));
  }
}
module.exports = { DesktopDownloadEngine };
