import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserDownloadAdapter } from "../scripts/downloads/browser-direct-adapter.js";

function fakeOPFS() {
  const files = new Map();
  const directory = {
    async getFileHandle(name) {
      return {
        async createWritable() {
          let chunks = [];
          return {
            async write(chunk) { chunks.push(new Uint8Array(chunk)); },
            async close() { files.set(name, new Blob(chunks, { type: "video/mp4" })); },
            async abort() { chunks = []; files.delete(name); }
          };
        },
        async getFile() {
          if (!files.has(name)) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
          return files.get(name);
        }
      };
    },
    async removeEntry(name) {
      if (!files.delete(name)) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    }
  };
  return {
    files,
    storage: { async getDirectory() { return { async getDirectoryHandle() { return directory; } }; } }
  };
}

function videoResponse(chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])], headers = {}) {
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); }
  }), { status: 200, headers: { "content-type": "video/mp4", "content-length": String(chunks.reduce((n, chunk) => n + chunk.byteLength, 0)), ...headers } });
}

const job = { id: "job_123", media: { id: "550", media_type: "movie", title: "Example" } };

test("downloads an authorized direct video file into OPFS and reports progress", async () => {
  const opfs = fakeOPFS();
  const calls = [];
  const adapter = createBrowserDownloadAdapter({
    resolve: async () => ({ url: "https://media.example.test/movie.mp4", mimeType: "video/mp4" }),
    allowedHosts: ["media.example.test"],
    storage: opfs.storage,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return videoResponse(); }
  });
  const progress = [];
  const asset = await adapter.download(job, { onProgress: value => progress.push(value) });
  assert.equal(asset.uri, "opfs://vivid-cinema-downloads/job_123");
  assert.equal(asset.size, 4);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.deepEqual(progress.map(item => item.bytesDownloaded), [2, 4]);
  assert.equal((await adapter.getAssetFile(asset)).size, 4);
  await adapter.removeAsset({ ...job, asset });
  assert.equal(opfs.files.size, 0);
});

test("rejects non-allowlisted and non-HTTPS sources before fetching", async () => {
  const opfs = fakeOPFS();
  let fetched = false;
  const adapter = createBrowserDownloadAdapter({
    resolve: async () => ({ url: "http://media.example.test/movie.mp4" }),
    allowedHosts: ["media.example.test"],
    storage: opfs.storage,
    fetchImpl: async () => { fetched = true; return videoResponse(); }
  });
  await assert.rejects(adapter.download(job), /not HTTPS|not authorized/);
  assert.equal(fetched, false);
});

test("rejects redirects and non-video responses", async () => {
  const opfs = fakeOPFS();
  const makeAdapter = fetchImpl => createBrowserDownloadAdapter({
    resolve: async () => ({ url: "https://media.example.test/movie" }),
    allowedHosts: ["media.example.test"], storage: opfs.storage, fetchImpl
  });
  await assert.rejects(makeAdapter(async () => new Response("", { status: 302 })).download(job), /direct file response/);
  await assert.rejects(makeAdapter(async () => new Response("not video", { headers: { "content-type": "text/html" } })).download(job), /Only direct video-file/);
});

test("enforces a streaming size limit and removes partial output", async () => {
  const opfs = fakeOPFS();
  const adapter = createBrowserDownloadAdapter({
    resolve: async () => ({ url: "https://media.example.test/movie.mp4" }),
    allowedHosts: ["media.example.test"], storage: opfs.storage, maxBytes: 3,
    fetchImpl: async () => videoResponse()
  });
  await assert.rejects(adapter.download(job), /size limit/);
  assert.equal(opfs.files.size, 0);
});

test("cancellation cleans partial output", async () => {
  const opfs = fakeOPFS();
  const controller = new AbortController();
  const adapter = createBrowserDownloadAdapter({
    resolve: async () => ({ url: "https://media.example.test/movie.mp4" }),
    allowedHosts: ["media.example.test"], storage: opfs.storage,
    fetchImpl: async (_url, options) => {
      options.signal.addEventListener("abort", () => {}, { once: true });
      return videoResponse();
    }
  });
  controller.abort();
  await assert.rejects(adapter.download(job, { signal: controller.signal }), /aborted/i);
  assert.equal(opfs.files.size, 0);
});

test("requires an explicit resolver, host allowlist and OPFS support", () => {
  assert.throws(() => createBrowserDownloadAdapter({}), /resolver/);
  assert.throws(() => createBrowserDownloadAdapter({ resolve() {}, storage: fakeOPFS().storage }), /authorized download host/);
  assert.throws(() => createBrowserDownloadAdapter({ resolve() {}, allowedHosts: ["media.example.test"], storage: {} }), /Origin Private File System/);
});
