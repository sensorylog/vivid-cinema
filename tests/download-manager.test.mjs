import test from "node:test";
import assert from "node:assert/strict";
import { DownloadManager } from "../scripts/downloads/download-manager.js";

function setup({ saved = [], download, concurrency = 1 } = {}) {
  let data = structuredClone(saved);
  const persistence = {
    async load() { return structuredClone(data); },
    async save(value) { data = structuredClone(value); }
  };
  const adapter = { download: download || (async (_job, { onProgress }) => {
    onProgress({ bytesDownloaded: 50, totalBytes: 100 });
    return { uri: "file:///offline/movie.mp4", mimeType: "video/mp4", size: 100 };
  }) };
  let nextId = 0;
  const manager = new DownloadManager({
    persistence, adapter, concurrency,
    idFactory: () => "job-" + (++nextId)
  });
  return { manager, adapter, getSaved: () => data };
}
const movie = { id: 550, media_type: "movie", title: "Fight Club" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("enqueue creates a typed job and completes through the injected platform adapter", async () => {
  const { manager } = setup();
  await manager.hydrate();
  const job = await manager.enqueue(movie, { quality: "720p" });
  assert.ok(["queued", "downloading"].includes(job.status));
  await tick();
  assert.equal(manager.snapshot()[0].status, "completed");
  assert.equal(manager.snapshot()[0].progress, 100);
  assert.equal(manager.snapshot()[0].asset.uri, "file:///offline/movie.mp4");
});

test("duplicate movie-quality jobs are not queued twice", async () => {
  const { manager } = setup();
  await manager.hydrate();
  const a = await manager.enqueue(movie, { quality: "720p" });
  const b = await manager.enqueue(movie, { quality: "720p" });
  assert.equal(a.id, b.id);
});

test("TV episodes retain distinct season and episode identity", async () => {
  const { manager } = setup();
  await manager.hydrate();
  const a = await manager.enqueue({ id: 1399, media_type: "tv", title: "Game of Thrones", season: 1, episode: 1 });
  const b = await manager.enqueue({ id: 1399, media_type: "tv", title: "Game of Thrones", season: 1, episode: 2 });
  assert.notEqual(a.key, b.key);
});

test("invalid media identities and partial episode coordinates are rejected", async () => {
  const { manager } = setup();
  await manager.hydrate();
  await assert.rejects(manager.enqueue({ id: "../x", media_type: "movie", title: "Bad" }), /valid movie\/TV identity/);
  await assert.rejects(manager.enqueue({ id: 2, media_type: "tv", title: "Bad", season: 1 }), /supplied together/);
});

test("interrupted active jobs recover as paused", async () => {
  const saved = [{ id: "old", key: "movie:1:::Auto", media: movie, quality: "Auto", status: "downloading", progress: 41, createdAt: 1, updatedAt: 2 }];
  const { manager } = setup({ saved });
  await manager.hydrate();
  assert.equal(manager.snapshot()[0].status, "paused");
  assert.equal(manager.snapshot()[0].progress, 41);
});

test("adapter errors become retryable failed jobs", async () => {
  const { manager } = setup({ download: async () => { throw new Error("network broke"); } });
  await manager.hydrate();
  const job = await manager.enqueue(movie);
  await tick();
  assert.equal(manager.snapshot()[0].status, "failed");
  assert.match(manager.snapshot()[0].error, /network broke/);
  assert.equal(await manager.retry(job.id), true);
});

test("cancellation aborts the adapter and removes partial output", async () => {
  let started = false;
  let removed = false;
  const { manager, adapter } = setup({
    download: (_job, { signal }) => new Promise((_resolve, reject) => {
      started = true;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  adapter.removePartial = async () => { removed = true; };
  await manager.hydrate();
  const job = await manager.enqueue(movie);
  await tick();
  assert.equal(started, true);
  assert.equal(await manager.cancel(job.id), true);
  await tick();
  assert.equal(removed, true);
  assert.equal(manager.snapshot()[0].status, "cancelled");
});

test("active jobs cannot be removed; completed jobs can be removed with their asset", async () => {
  let removed = false;
  const { manager, adapter } = setup();
  adapter.removeAsset = async () => { removed = true; };
  await manager.hydrate();
  const job = await manager.enqueue(movie);
  assert.equal(await manager.remove(job.id), false);
  await tick();
  assert.equal(await manager.remove(job.id), true);
  assert.equal(removed, true);
});
