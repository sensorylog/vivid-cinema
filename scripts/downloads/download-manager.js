const STATUSES = new Set(["queued", "downloading", "paused", "completed", "failed", "cancelled"]);
const ACTIVE = new Set(["queued", "downloading"]);

function normalizeMedia(input = {}) {
  const mediaType = input.media_type;
  const id = String(input.id ?? "");
  const title = String(input.title ?? "").trim().slice(0, 180);
  if (!["movie", "tv"].includes(mediaType) || !/^\d{1,12}$/.test(id) || !title) {
    throw new TypeError("A valid movie/TV identity and title are required.");
  }
  const season = input.season == null ? null : Number(input.season);
  const episode = input.episode == null ? null : Number(input.episode);
  if ((season == null) !== (episode == null)) throw new TypeError("Season and episode must be supplied together.");
  if (mediaType === "movie" && season != null) throw new TypeError("Movies cannot have episode coordinates.");
  if (mediaType === "tv" && season != null &&
      (!Number.isInteger(season) || season < 0 || season > 99 ||
       !Number.isInteger(episode) || episode < 0 || episode > 999)) {
    throw new TypeError("Season and episode must be valid non-negative integers.");
  }
  return {
    id, media_type: mediaType, title, season, episode,
    year: String(input.year ?? "").slice(0, 8),
    poster_path: String(input.poster_path ?? "").slice(0, 500),
    source_id: String(input.source_id ?? "").slice(0, 80),
    source_file: String(input.source_file ?? "").slice(0, 300)
  };
}
const copy = value => JSON.parse(JSON.stringify(value));

/**
 * Platform-neutral download queue.
 * The injected adapter owns media resolution and byte storage; this manager
 * persists only job metadata and never stores expiring source URLs or secrets.
 */
export class DownloadManager {
  constructor({ persistence, adapter, concurrency = 1, now = () => Date.now(), idFactory } = {}) {
    if (!persistence?.load || !persistence?.save) throw new TypeError("A persistence adapter is required.");
    if (typeof adapter?.download !== "function") throw new TypeError("A platform download adapter is required.");
    this.persistence = persistence;
    this.adapter = adapter;
    this.concurrency = Math.max(1, Math.min(3, Number(concurrency) || 1));
    this.now = now;
    this.idFactory = idFactory || (() => globalThis.crypto?.randomUUID?.() || `job-${this.now()}-${Math.random().toString(36).slice(2)}`);
    this.jobs = new Map();
    this.controllers = new Map();
    this.tasks = new Map();
    this.listeners = new Set();
    this.running = 0;
    this.hydrated = false;
    this.persistChain = Promise.resolve();
  }

  async hydrate() {
    if (this.hydrated) return this.snapshot();
    const saved = await this.persistence.load();
    if (Array.isArray(saved)) for (const raw of saved) {
      if (!raw || typeof raw.id !== "string" || !STATUSES.has(raw.status)) continue;
      const job = { ...raw, progress: Math.max(0, Math.min(100, Number(raw.progress) || 0)) };
      if (job.status === "queued" || job.status === "downloading") {
        job.status = "paused";
        job.error = "Download interrupted. Resume when ready.";
        job.updatedAt = this.now();
      }
      this.jobs.set(job.id, job);
    }
    this.hydrated = true;
    await this.persist();
    this.emit();
    return this.snapshot();
  }

  snapshot() { return [...this.jobs.values()].map(copy).sort((a, b) => b.createdAt - a.createdAt); }
  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Listener must be a function.");
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }
  emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) { try { listener(state); } catch { /* isolate UI listeners */ } }
  }
  persist() {
    const state = this.snapshot();
    this.persistChain = this.persistChain.catch(() => {}).then(() => this.persistence.save(state));
    return this.persistChain;
  }
  async ready() { if (!this.hydrated) await this.hydrate(); }

  async enqueue(input, options = {}) {
    await this.ready();
    const media = normalizeMedia(input);
    const quality = String(options.quality ?? "Auto").slice(0, 24);
    const key = [media.media_type, media.id, media.source_id, media.source_file, media.season ?? "", media.episode ?? "", quality].join(":");
    const existing = [...this.jobs.values()].find(job => job.key === key && job.status !== "cancelled");
    if (existing) return copy(existing);
    const timestamp = this.now();
    const job = {
      id: String(this.idFactory()), key, media, quality,
      status: "queued", progress: 0, bytesDownloaded: 0, totalBytes: null,
      error: null, asset: null, createdAt: timestamp, updatedAt: timestamp
    };
    this.jobs.set(job.id, job);
    await this.persist();
    this.emit();
    this.pump();
    return copy(job);
  }

  async pause(id) {
    const job = this.jobs.get(String(id));
    if (!job || !ACTIVE.has(job.status)) return false;
    job.status = "paused";
    job.updatedAt = this.now();
    this.controllers.get(job.id)?.abort("paused");
    await this.persist();
    this.emit();
    return true;
  }

  async cancel(id) {
    const job = this.jobs.get(String(id));
    if (!job || job.status === "completed" || job.status === "cancelled") return false;
    job.status = "cancelled";
    job.updatedAt = this.now();
    this.controllers.get(job.id)?.abort("cancelled");
    const task = this.tasks.get(job.id);
    if (task) await task;
    try { await this.adapter.removePartial?.(copy(job)); } catch { /* keep cancellation visible */ }
    await this.persist();
    this.emit();
    return true;
  }

  async retry(id) {
    const job = this.jobs.get(String(id));
    if (!job || !["failed", "paused"].includes(job.status)) return false;
    job.status = "queued";
    job.error = null;
    job.updatedAt = this.now();
    await this.persist();
    this.emit();
    this.pump();
    return true;
  }

  async remove(id) {
    const job = this.jobs.get(String(id));
    if (!job || ACTIVE.has(job.status)) return false;
    if (job.status === "completed") await this.adapter.removeAsset?.(copy(job));
    this.jobs.delete(String(id));
    await this.persist();
    this.emit();
    return true;
  }

  pump() {
    if (!this.hydrated) return;
    while (this.running < this.concurrency) {
      const job = [...this.jobs.values()].find(item => item.status === "queued");
      if (!job) break;
      const task = this.run(job);
      this.tasks.set(job.id, task);
      const clearTask = () => {
        if (this.tasks.get(job.id) === task) this.tasks.delete(job.id);
      };
      void task.then(clearTask, clearTask);
    }
  }

  async run(job) {
    this.running += 1;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.status = "downloading";
    job.error = null;
    job.updatedAt = this.now();
    try {
      await this.persist();
      this.emit();
      const result = await this.adapter.download(copy(job), {
        signal: controller.signal,
        onProgress: ({ bytesDownloaded = 0, totalBytes = null, progress: reportedProgress = null } = {}) => {
          if (controller.signal.aborted || job.status !== "downloading") return;
          const bytes = Math.max(0, Number(bytesDownloaded) || 0);
          const total = Number.isFinite(Number(totalBytes)) && Number(totalBytes) > 0 ? Number(totalBytes) : null;
          job.bytesDownloaded = bytes;
          job.totalBytes = total;
          const reported = Number(reportedProgress);
          job.progress = Number.isFinite(reported) ? Math.min(99, Math.max(job.progress, Math.floor(reported))) : total ? Math.min(99, Math.max(job.progress, Math.floor(bytes / total * 100))) : job.progress;
          job.updatedAt = this.now();
          this.emit();
          void this.persist();
        }
      });
      if (job.status === "downloading" && !controller.signal.aborted) {
        job.status = "completed";
        job.progress = 100;
        job.asset = result && typeof result === "object" ? {
          uri: typeof result.uri === "string" ? result.uri.slice(0, 2048) : null,
          mimeType: typeof result.mimeType === "string" ? result.mimeType.slice(0, 100) : null,
          size: Number.isFinite(Number(result.size)) ? Number(result.size) : null
        } : null;
        job.error = null;
      }
    } catch (error) {
      if (job.status === "downloading") {
        job.status = controller.signal.aborted ? "paused" : "failed";
        job.error = String(error?.message || "Download failed").slice(0, 300);
      }
    } finally {
      this.controllers.delete(job.id);
      this.running = Math.max(0, this.running - 1);
      job.updatedAt = this.now();
      try {
        await this.persist();
      } finally {
        this.emit();
        this.pump();
      }
    }
  }
}
