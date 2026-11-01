"use strict";
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const WebTorrent = require("webtorrent");
const TorrentSearchApi = require("torrent-search-api");

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mkv|avi|mov|webm|ogv|mpg|mpeg|wmv|flv|ts|m2ts|3gp)$/i;
 // Maintained public tracker endpoints provide extra discovery paths for
 // magnets with missing or unreliable tracker metadata.
const FALLBACK_TRACKERS = Object.freeze([
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://explodie.org:6969/announce",
  "http://tracker2.dler.org:80/announce",
  "http://tracker.renfei.net:8080/announce"
]);
const safeText = (value, max = 180) => String(value || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
const roundProgress = torrent => Math.round((Number(torrent?.progress) || 0) * 1000) / 10;

class DesktopDownloadEngine {
  constructor({ app, BrowserWindow, dialog, shell }) {
    Object.assign(this, { app, BrowserWindow, dialog, shell });
    // Do not set uploadLimit: 0: WebTorrent applies it to all outgoing peer traffic,
    // including handshakes and piece requests needed to download. Disable payload
    // uploads per torrent instead, while leaving protocol traffic unrestricted.
    this.clientError = null;
    this.createClient();
    this.jobs = new Map();
    this.searchResults = new Map();
    this.playbackPositions = new Map();
    this.persistQueue = Promise.resolve();
    this.downloadPath = path.join(app.getPath("downloads"), "Vivid Cinema");
    this.statePath = path.join(app.getPath("userData"), "vivid-downloads.json");
    fs.mkdirSync(this.downloadPath, { recursive: true });
    TorrentSearchApi.enablePublicProviders();
    this.ready = this.restore();
  }

  createClient() {
    const client = new WebTorrent();
    this.client = client;
    client.on("error", error => {
      // A fatal WebTorrent client error destroys that client and every torrent
      // attached to it. Preserve each job's verified progress and replace the
      // client so Resume can reattach to the existing on-disk torrent store.
      if (this.client !== client) return;
      this.clientError = safeText(error?.message || "Torrent engine failed", 240);
      for (const job of this.jobs.values()) {
        const torrent = job.torrent;
        if (!torrent || !["downloading", "verifying"].includes(job.status)) continue;
        if (job.statusTimer) clearInterval(job.statusTimer);
        job.statusTimer = null;
        if (job.persistTimer) clearTimeout(job.persistTimer);
        job.persistTimer = null;
        job.progress = Math.max(Number(job.progress) || 0, roundProgress(torrent));
        job.downloaded = Math.max(Number(job.downloaded) || 0, Number(torrent.downloaded) || 0);
        job.total = Math.max(Number(job.total) || 0, Number(torrent.length) || 0);
        job.status = "failed";
        job.phase = "Torrent engine error";
        job.needsRescan = job.downloaded > 0;
        job.error = "Torrent engine stopped: " + this.clientError;
        job.torrent = null;
        this.send("vivid-download-error", { id: job.id, message: job.error });
      }
      this.createClient();
      void this.persist().catch(saveError => console.warn("Download state save failed:", saveError.message));
    });
  }

  send(channel, data) {
    for (const win of this.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, data);
    }
  }

  async persist() {
    const rows = [...this.jobs.values()].map(job => ({
      id: job.id, title: job.title, resultTitle: job.resultTitle,
      media: job.media, magnet: job.magnet, status: job.status, phase: job.phase || null, downloadPath: job.downloadPath || this.downloadPath,
      filePath: job.filePath || null, files: Array.isArray(job.files) ? job.files : [],
      error: job.error || null, progress: job.progress || 0, downloaded: job.downloaded || 0, total: job.total || 0,
      needsRescan: Boolean(job.needsRescan), createdAt: job.createdAt, updatedAt: Date.now()
    }));
    const state = JSON.stringify({ version: 1, downloadPath: this.downloadPath, jobs: rows, playbackPositions: Object.fromEntries(this.playbackPositions) }, null, 2);
    this.persistQueue = this.persistQueue.catch(() => {}).then(async () => {
      await fsp.mkdir(path.dirname(this.statePath), { recursive: true });
      const temporary = this.statePath + ".tmp";
      await fsp.writeFile(temporary, state, "utf8");
      await fsp.rename(temporary, this.statePath);
    });
    return this.persistQueue;
  }

  async restore() {
    try {
      const state = JSON.parse(await fsp.readFile(this.statePath, "utf8"));
      if (state.playbackPositions && typeof state.playbackPositions === "object") {
        for (const [key, value] of Object.entries(state.playbackPositions)) {
          if (typeof key === "string" && Number.isFinite(Number(value)) && Number(value) >= 0) this.playbackPositions.set(key, Number(value));
        }
      }
      if (typeof state.downloadPath === "string" && path.isAbsolute(state.downloadPath)) {
        this.downloadPath = state.downloadPath;
      }
      fs.mkdirSync(this.downloadPath, { recursive: true });
      for (const row of Array.isArray(state.jobs) ? state.jobs : []) {
        if (!row || typeof row.id !== "string" || typeof row.magnet !== "string" || !row.magnet.startsWith("magnet:?")) continue;
        // Cancelled rows from older versions are stale history, not active downloads.
        if (row.status === "cancelled") continue;
        const files = Array.isArray(row.files) ? row.files.filter(file => file && typeof file.path === "string" && path.isAbsolute(file.path) && fs.existsSync(file.path)) : [];
        if (!files.length && row.filePath && fs.existsSync(row.filePath)) files.push({ name: path.basename(row.filePath), path: row.filePath, size: 0 });
        const status = row.status === "completed" && files.length
          ? "completed"
          : ["cancelled", "failed"].includes(row.status) ? row.status : "paused";
        this.jobs.set(row.id, { ...row, phase: row.phase || null, files, filePath: files[0]?.path || row.filePath || null, downloadPath: path.isAbsolute(row.downloadPath || "") ? row.downloadPath : this.downloadPath, needsRescan: !["completed", "cancelled"].includes(status), status, torrent: null, error: row.error || null });
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
    return (Array.isArray(rows) ? rows : []).filter(x => x && x.title && (Number(x.seeds || 0) > 0 || Number(x.peers || 0) > 0)).map(source => {
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
    if (!this.client || this.client.destroyed) this.createClient();
    const magnet = result.magnet || await TorrentSearchApi.getMagnet(source);
    if (typeof magnet !== "string" || !magnet.startsWith("magnet:?")) throw new Error("No valid magnet link was returned.");
    const id = crypto.randomUUID();
    const job = {
      id, title: safeText(media.title || result.title), resultTitle: safeText(result.title, 300),
      media: { id: safeText(media.id, 80), media_type: media.media_type === "tv" ? "tv" : "movie",
        title: safeText(media.title || result.title), season: Number.isInteger(Number(media.season)) ? Number(media.season) : null,
        episode: Number.isInteger(Number(media.episode)) ? Number(media.episode) : null,
        episodeTitle: safeText(media.episodeTitle, 180) },
      magnet, status: "queued", torrent: null, filePath: null, downloadPath: path.join(this.downloadPath, id), error: null, createdAt: Date.now()
    };
    this.jobs.set(id, job);
    await this.persist();
    this.attachTorrent(job);
    return { id, status: job.status };
  }

  attachTorrent(job) {
    if (!this.client || this.client.destroyed) this.createClient();
    job.status = "downloading";
    job.phase = "Connecting to peers";
    job.error = null;
    const jobPath = job.downloadPath || this.downloadPath;
    fs.mkdirSync(jobPath, { recursive: true });
    let torrent;
    try {
      torrent = this.client.add(job.magnet, { path: jobPath, uploads: 0, announce: FALLBACK_TRACKERS });
    } catch (error) {
      job.status = "failed";
      job.phase = "Could not restart saved download";
      job.needsRescan = Number(job.downloaded) > 0;
      job.error = safeText(error?.message || "Could not resume this download", 300);
      job.torrent = null;
      this.send("vivid-download-error", { id: job.id, message: job.error });
      void this.persist().catch(saveError => console.warn("Download state save failed:", saveError.message));
      return false;
    }
    job.torrent = torrent;
    const publish = () => {
      // A newly attached torrent has an empty in-memory bitfield until the
      // saved store has been rescanned. Do not replace persisted progress with
      // that temporary zero; the successful rescan calls publish again.
      if (!job.needsRescan) job.progress = roundProgress(torrent);
      job.downloaded = Number(torrent.downloaded) || job.downloaded || 0;
      job.total = Number(torrent.length) || job.total || 0;
      job.phase = torrent.ready
        ? (torrent.numPeers > 0 ? (job.downloaded > 0 ? "Receiving data" : "Connected · waiting for data") : "Waiting for peers")
        : "Finding peers and metadata";
      const payload = this.snapshot(job);
      this.send("vivid-download-progress", payload);
      if (!job.persistTimer) {
        job.persistTimer = setTimeout(() => {
          job.persistTimer = null;
          void this.persist().catch(error => console.warn("Download state save failed:", error.message));
        }, 2000);
        job.persistTimer.unref?.();
      }
    };
    torrent.on("ready", () => {
      if (!job.needsRescan) return;
      job.status = "verifying";
      this.send("vivid-download-progress", this.snapshot(job));
      torrent.rescanFiles(error => {
        if (job.torrent !== torrent) return;
        if (error) {
          job.progress = Math.max(Number(job.progress) || 0, roundProgress(torrent));
          job.downloaded = Math.max(Number(job.downloaded) || 0, Number(torrent.downloaded) || 0);
          job.total = Math.max(Number(job.total) || 0, Number(torrent.length) || 0);
          job.status = "failed";
          job.needsRescan = job.downloaded > 0;
          job.error = "Could not verify the saved partial download: " + safeText(error.message, 220);
          job.torrent = null;
          void torrent.destroy({ destroyStore: false }, () => {});
          this.send("vivid-download-error", { id: job.id, message: job.error });
          void this.persist().catch(saveError => console.warn("Download state save failed:", saveError.message));
        } else {
          job.needsRescan = false;
          job.status = "downloading";
          publish();
        }
        void this.persist().catch(saveError => console.warn("Download state save failed:", saveError.message));
      });
    });
    const publishWhenReady = () => { if (!job.needsRescan) publish(); };
    const discovery = job.discovery = {
      trackerCount: Array.isArray(torrent.announce) ? torrent.announce.length : 0,
      trackerAnnounces: 0,
      dhtAnnounces: 0,
      noPeerAnnounces: 0,
      lastNoPeerSource: null,
      lastWarning: null
    };
    torrent.on("metadata", publishWhenReady);
    torrent.on("trackerAnnounce", () => { discovery.trackerAnnounces += 1; publishWhenReady(); });
    torrent.on("dhtAnnounce", () => { discovery.dhtAnnounces += 1; publishWhenReady(); });
    torrent.on("noPeers", source => {
      discovery.noPeerAnnounces += 1;
      discovery.lastNoPeerSource = safeText(source || "unknown", 24);
      publishWhenReady();
    });
    torrent.on("warning", warning => {
      discovery.lastWarning = safeText(warning?.message || warning || "Unknown discovery warning", 180);
      publishWhenReady();
    });
    torrent.on("wire", () => { if (job.torrent === torrent) { job.phase = "Connected · waiting for data"; publishWhenReady(); } });
    torrent.on("download", () => { if (job.torrent === torrent) job.phase = "Receiving data"; publishWhenReady(); });
    torrent.on("upload", publishWhenReady);
    // WebTorrent emits download events only when pieces arrive. A lightweight heartbeat
    // keeps peer count, speed and the waiting-for-peers state visible even while stalled.
    job.statusTimer = setInterval(() => {
      if (job.torrent !== torrent || !["downloading", "verifying"].includes(job.status)) {
        clearInterval(job.statusTimer);
        job.statusTimer = null;
        return;
      }
      if (job.status === "downloading") {
        job.phase = torrent.ready
          ? (torrent.numPeers > 0 ? (torrent.downloaded > 0 ? "Receiving data" : "Connected · waiting for data") : "Waiting for peers")
          : "Finding peers and metadata";
      }
      this.send("vivid-download-progress", this.snapshot(job));
    }, 2000);
    job.statusTimer.unref?.();
    torrent.on("done", () => {
      if (job.statusTimer) clearInterval(job.statusTimer);
      job.statusTimer = null;
      job.files = [...torrent.files]
        .filter(item => VIDEO_EXTENSIONS.test(item.name))
        .map(item => ({ name: safeText(item.name, 300), path: path.resolve(jobPath, item.path), size: Number(item.length) || 0 }))
        .filter(item => fs.existsSync(item.path) && fs.statSync(item.path).isFile())
        .sort((a, b) => b.size - a.size);
      job.filePath = job.files[0]?.path || null;
      job.status = job.files.length ? "completed" : "failed";
      job.phase = job.status === "completed" ? "Downloaded" : "Could not find a playable video";
      if (!job.filePath) job.error = "The release finished, but no playable video file was found.";
      job.torrent = null;
      publish();
      this.send(job.status === "completed" ? "vivid-download-complete" : "vivid-download-error",
        job.status === "completed" ? { ...this.snapshot(job), filePath: job.filePath } : { id: job.id, message: job.error });
    });
    torrent.on("error", error => {
      if (job.statusTimer) clearInterval(job.statusTimer);
      job.statusTimer = null;
      if (job.status === "cancelled" || job.status === "paused") return;
      job.progress = Math.max(Number(job.progress) || 0, roundProgress(torrent));
      job.downloaded = Math.max(Number(job.downloaded) || 0, Number(torrent.downloaded) || 0);
      job.total = Math.max(Number(job.total) || 0, Number(torrent.length) || 0);
      job.status = "failed";
      job.needsRescan = job.downloaded > 0;
      job.error = safeText(error?.message || "Download failed", 300);
      job.torrent = null;
      publish();
      this.send("vivid-download-error", { id: job.id, message: job.error });
      void this.persist().catch(saveError => console.warn("Download state save failed:", saveError.message));
    });
    publish();
  }

  snapshot(job) {
    const torrent = job.torrent;
    const fileSize = job.filePath && fs.existsSync(job.filePath) ? fs.statSync(job.filePath).size : 0;
    return {
      id: job.id, title: job.title, media: job.media, status: job.status,
      // WebTorrent's bitfield is rebuilt during rescanFiles after Resume.
      // Keep the last verified percentage visible until that scan completes.
      progress: job.status === "verifying"
        ? Math.max(Number(job.progress) || 0, torrent ? roundProgress(torrent) : 0)
        : torrent ? roundProgress(torrent) : job.status === "completed" ? 100 : Number(job.progress) || 0,
      phase: job.phase || null,
      discovery: job.discovery ? {
        trackerCount: job.discovery.trackerCount,
        trackerAnnounces: job.discovery.trackerAnnounces,
        dhtAnnounces: job.discovery.dhtAnnounces,
        noPeerAnnounces: job.discovery.noPeerAnnounces,
        lastNoPeerSource: job.discovery.lastNoPeerSource,
        lastWarning: job.discovery.lastWarning,
        dhtEnabled: Boolean(this.client.dht),
        dhtListening: Boolean(this.client.dht && this.client.dht.listening)
      } : null,
      speed: torrent?.downloadSpeed || 0, downloaded: torrent?.downloaded || job.downloaded || 0,
      total: torrent?.length || job.total || fileSize || 0, peers: torrent?.numPeers || 0,
      filePath: job.filePath || null,
      files: (job.files || []).map((file, index) => ({ index, name: file.name, size: file.size })),
      error: job.error || null, createdAt: job.createdAt
    };
  }

  playbackPositionKey(id, fileIndex = 0) {
    const index = Number(fileIndex);
    if (!Number.isInteger(index) || index < 0) throw new Error("Invalid video index.");
    return String(id) + ":" + index;
  }

  getPlaybackPosition(id, fileIndex = 0) {
    return this.playbackPositions.get(this.playbackPositionKey(id, fileIndex)) || 0;
  }

  async setPlaybackPosition(id, fileIndex = 0, seconds = 0) {
    const job = this.jobs.get(String(id));
    const value = Number(seconds);
    if (!job || job.status !== "completed" || !Number.isFinite(value) || value < 0) return false;
    this.playbackPositions.set(this.playbackPositionKey(id, fileIndex), Math.floor(value));
    await this.persist();
    return true;
  }

  async clearPlaybackPosition(id, fileIndex = 0) {
    this.playbackPositions.delete(this.playbackPositionKey(id, fileIndex));
    await this.persist();
    return true;
  }

  mediaFile(id, fileIndex = 0) {
    const job = this.jobs.get(String(id));
    if (!job || job.status !== "completed") return null;
    const index = Number(fileIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    const file = (job.files || [])[index] || (index === 0 && job.filePath ? { path: job.filePath } : null);
    if (!file?.path) return null;
    const target = path.resolve(file.path);
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
      if (job.persistTimer) clearTimeout(job.persistTimer);
      job.persistTimer = null;
      if (job.statusTimer) clearInterval(job.statusTimer);
      job.statusTimer = null;
      job.progress = roundProgress(torrent);
      job.downloaded = Number(torrent.downloaded) || 0;
      job.total = Number(torrent.length) || 0;
      job.status = "paused";
      job.phase = "Paused";
      job.needsRescan = true;
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
    if (action === "cancel" && ["queued", "downloading", "verifying", "paused", "failed"].includes(job.status)) {
      job.status = "cancelled";
      job.phase = "Cancelled";
      if (job.statusTimer) clearInterval(job.statusTimer);
      job.statusTimer = null;
      if (job.persistTimer) clearTimeout(job.persistTimer);
      job.persistTimer = null;
      if (job.torrent) {
        const torrent = job.torrent;
        job.torrent = null;
        await new Promise(resolve => torrent.destroy({ destroyStore: true }, resolve));
      }
      // Paused/failed jobs have no live torrent to destroy, so remove their
      // per-job partial folder explicitly. Never target the shared download root.
      const jobPath = path.resolve(job.downloadPath || "");
      if (path.basename(jobPath) === job.id && jobPath !== path.resolve(this.downloadPath)) {
        await fsp.rm(jobPath, { recursive: true, force: true })
          .catch(error => console.warn("Could not remove cancelled download data:", error.message));
      }
      this.jobs.delete(job.id);
      await this.persist();
      this.send("vivid-download-progress", { id: job.id, status: "cancelled", removed: true });
      return true;
    }
    if (action === "show" && job.filePath) { this.shell.showItemInFolder(job.filePath); return true; }
    return false;
  }

  async shutdown() {
    for (const job of this.jobs.values()) {
      if (job.persistTimer) clearTimeout(job.persistTimer);
      job.persistTimer = null;
      if (job.statusTimer) clearInterval(job.statusTimer);
      job.statusTimer = null;
      if (["downloading", "verifying"].includes(job.status) && job.torrent) {
        job.progress = roundProgress(job.torrent);
        job.downloaded = Number(job.torrent.downloaded) || job.downloaded || 0;
        job.total = Number(job.torrent.length) || job.total || 0;
        job.status = "paused";
        job.phase = "Paused";
        job.needsRescan = job.downloaded > 0;
      }
      job.torrent = null;
    }
    await this.persist().catch(error => console.warn("Could not persist downloads on exit:", error.message));
    await new Promise(resolve => this.client.destroy(resolve));
  }
}
module.exports = { DesktopDownloadEngine, FALLBACK_TRACKERS };
