"use strict";
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const WebTorrent = require("webtorrent");
const TorrentSearchApi = require("torrent-search-api");

class DesktopDownloadEngine {
  constructor({ app, BrowserWindow, dialog, shell }) {
    Object.assign(this, { app, BrowserWindow, dialog, shell });
    this.client = new WebTorrent();
    this.jobs = new Map();
    this.searchResults = new Map();
    this.downloadPath = path.join(app.getPath("downloads"), "Vivid Cinema");
    fs.mkdirSync(this.downloadPath, { recursive: true });
    TorrentSearchApi.enablePublicProviders();
  }
  send(channel, data) {
    for (const win of this.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, data);
    }
  }
  async search(query) {
    const term = String(query || "").trim().slice(0, 160);
    if (term.length < 2) throw new Error("Enter at least two characters.");
    const rows = await TorrentSearchApi.search(term, "All", 60);
    return (Array.isArray(rows) ? rows : []).filter(x => x && x.title && Number(x.seeds || 0) > 0).map(source => {
      const id = crypto.randomUUID();
      this.searchResults.set(id, source);
      return {
      id,
      title: String(source.title).slice(0, 300),
      provider: String(source.provider || "Torrent provider").slice(0, 80),
      seeds: Math.max(0, Number(source.seeds) || 0),
      peers: Math.max(0, Number(source.peers) || 0),
      size: String(source.size || "").slice(0, 40),
      magnet: typeof source.magnet === "string" ? source.magnet : null
    };
    });
  }
  async chooseFolder() {
    const result = await this.dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (!result.canceled && result.filePaths[0]) this.downloadPath = result.filePaths[0];
    return this.downloadPath;
  }
  async start(result, media = {}) {
    const source = result && this.searchResults.get(String(result.id));
    if (!source) throw new Error("Search result expired. Search again and choose a result.");
    const magnet = result.magnet || await TorrentSearchApi.getMagnet(source);
    if (typeof magnet !== "string" || !magnet.startsWith("magnet:?")) throw new Error("No valid magnet link was returned.");
    const id = crypto.randomUUID();
    const torrent = this.client.add(magnet, { path: this.downloadPath });
    const job = { id, title: String(media.title || result.title).slice(0, 180), resultTitle: result.title, torrent, status: "downloading" };
    this.jobs.set(id, job);
    const publish = () => this.send("vivid-download-progress", {
      id, title: job.title, status: job.status,
      progress: Math.round((torrent.progress || 0) * 1000) / 10,
      speed: torrent.downloadSpeed || 0, downloaded: torrent.downloaded || 0,
      total: torrent.length || 0, peers: torrent.numPeers || 0
    });
    torrent.on("download", publish);
    torrent.on("done", () => {
      job.status = "completed";
      const file = [...torrent.files].filter(f => /\.(mp4|mkv|avi|mov|webm)$/i.test(f.name)).sort((a,b) => b.length-a.length)[0];
      job.filePath = file ? path.join(this.downloadPath, file.path) : this.downloadPath;
      publish();
      this.send("vivid-download-complete", { id, title: job.title, filePath: job.filePath });
    });
    torrent.on("error", error => {
      job.status = "failed";
      this.send("vivid-download-error", { id, message: String(error.message || "Download failed").slice(0, 300) });
      publish();
    });
    publish();
    return { id, status: job.status };
  }
  list() {
    return [...this.jobs.values()].map(j => ({
      id: j.id, title: j.title, status: j.status,
      progress: Math.round((j.torrent.progress || 0) * 1000) / 10,
      speed: j.torrent.downloadSpeed || 0, downloaded: j.torrent.downloaded || 0,
      total: j.torrent.length || 0, peers: j.torrent.numPeers || 0, filePath: j.filePath || null
    }));
  }
  async control(id, action) {
    const job = this.jobs.get(String(id));
    if (!job) return false;
    if (action === "pause" || action === "cancel") {
      job.status = action === "pause" ? "paused" : "cancelled";
      await new Promise(resolve => job.torrent.destroy({ destroyStore: action === "cancel" }, resolve));
      return true;
    }
    if (action === "show" && job.filePath) { this.shell.showItemInFolder(job.filePath); return true; }
    return false;
  }
  async shutdown() { await new Promise(resolve => this.client.destroy(() => resolve())); }
}
module.exports = { DesktopDownloadEngine };
