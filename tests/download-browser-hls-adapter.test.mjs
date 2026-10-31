import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserHlsDownloadAdapter, parseHlsPlaylist } from "../scripts/downloads/browser-hls-adapter.js";

function fakeOPFS() {
  const files = new Map();
  const directories = new Set([""]);
  function directory(prefix = "") {
    return {
      async getDirectoryHandle(name, { create = false } = {}) {
        const path = prefix + name + "/";
        if (!directories.has(path) && !create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
        directories.add(path);
        return directory(path);
      },
      async getFileHandle(name, { create = false } = {}) {
        const path = prefix + name;
        if (!files.has(path) && !create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
        return {
          async createWritable() {
            let chunks = [];
            return {
              async write(value) { chunks.push(value instanceof Blob ? value : new Blob([value])); },
              async close() { files.set(path, new Blob(chunks)); },
              async abort() { chunks = []; files.delete(path); }
            };
          },
          async getFile() {
            if (!files.has(path)) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
            return files.get(path);
          }
        };
      },
      async removeEntry(name, { recursive = false } = {}) {
        const path = prefix + name;
        if (files.delete(path)) return;
        const dirPath = path + "/";
        const children = [...files.keys()].filter(key => key.startsWith(dirPath));
        const childDirs = [...directories].filter(key => key.startsWith(dirPath));
        if (!children.length && !childDirs.length) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
        if (!recursive && (children.length || childDirs.length)) throw new Error("Directory not empty");
        children.forEach(key => files.delete(key));
        childDirs.forEach(key => directories.delete(key));
        directories.delete(dirPath);
      }
    };
  }
  return { files, storage: { async getDirectory() { return directory(""); } } };
}

const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
high/index.m3u8
`;
const media = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
seg-001.m4s
#EXTINF:5.5,
seg-002.m4s
#EXT-X-ENDLIST
`;
const job = { id: "hls_job_01", media: { id: "123", media_type: "movie", title: "Test" } };

test("selects a bounded HLS variant and resolves its playlist URL", () => {
  const parsed = parseHlsPlaylist(master, "https://media.example.test/master.m3u8", {
    maxHeight: 720, allowedHosts: ["media.example.test"]
  });
  assert.equal(parsed.kind, "master");
  assert.equal(parsed.variantUrl, "https://media.example.test/low/index.m3u8");
});

test("parses VOD media playlists and rewrites initialization maps and segments", () => {
  const parsed = parseHlsPlaylist(media, "https://media.example.test/vod/index.m3u8", {
    allowedHosts: ["media.example.test"]
  });
  assert.equal(parsed.kind, "media");
  assert.equal(parsed.segmentCount, 2);
  assert.equal(parsed.resources.length, 3);
  assert.match(parsed.playlist, /segments\/init-00000\.bin/);
  assert.match(parsed.playlist, /segments\/segment-000001\.bin/);
  assert.equal(parsed.resources[0].uri, "init.mp4");
  assert.equal(parsed.mediaUrl, "https://media.example.test/vod/index.m3u8");
});

test("rejects live, encrypted, byte-range and alternate-audio playlists", () => {
  assert.throws(() => parseHlsPlaylist("#EXTM3U\n#EXTINF:6,\na.ts\n", "https://media.example.test/a.m3u8"), /VOD playlist/);
  assert.throws(() => parseHlsPlaylist("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST", "https://media.example.test/a.m3u8"), /Encrypted HLS/);
  assert.throws(() => parseHlsPlaylist("#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST", "https://media.example.test/a.m3u8"), /byte-range/);
  assert.throws(() => parseHlsPlaylist("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",URI=\"audio.m3u8\"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST", "https://media.example.test/a.m3u8"), /alternate audio/);
});

test("stores an explicitly authorized HLS VOD asset in OPFS and exposes a local playlist URL", async () => {
  const opfs = fakeOPFS();
  const calls = [];
  const adapter = createBrowserHlsDownloadAdapter({
    resolve: async () => ({ type: "hls", offlineAllowed: true, url: "https://media.example.test/master.m3u8" }),
    allowedHosts: ["media.example.test"],
    maxHeight: 720,
    storage: opfs.storage,
    fetchImpl: async url => {
      calls.push(url);
      if (url.endsWith("/master.m3u8")) return new Response(master, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
      if (url.endsWith("/low/index.m3u8")) return new Response(media, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
      if (url.endsWith("/init.mp4")) return new Response(new Uint8Array([0, 1]), { headers: { "content-type": "video/mp4" } });
      if (url.endsWith("/seg-001.m4s")) return new Response(new Uint8Array([2, 3, 4]), { headers: { "content-type": "video/iso.segment" } });
      if (url.endsWith("/seg-002.m4s")) return new Response(new Uint8Array([5, 6]), { headers: { "content-type": "video/iso.segment" } });
      throw new Error("Unexpected URL: " + url);
    }
  });
  const progress = [];
  const asset = await adapter.download(job, { onProgress: value => progress.push(value.bytesDownloaded) });
  assert.equal(asset.uri, "opfs-hls://vivid-cinema-downloads/hls_job_01");
  assert.equal(asset.kind, "hls");
  assert.equal(asset.size, 7);
  assert.equal(calls.length, 5);
  assert.ok(progress.at(-1) >= 7);
  assert.ok(opfs.files.has("vivid-cinema-downloads/hls_job_01/index.m3u8"));
  const playlistUrl = await adapter.getAssetUrl(asset);
  assert.match(playlistUrl, /^blob:/);
  adapter.revokeAssetUrl(asset);
  await adapter.removeAsset({ asset });
  assert.equal([...opfs.files.keys()].some(key => key.includes("hls_job_01")), false);
});

test("does not fetch HLS unless the resolver explicitly authorizes offline storage", async () => {
  const opfs = fakeOPFS();
  let fetched = false;
  const adapter = createBrowserHlsDownloadAdapter({
    resolve: async () => ({ type: "hls", url: "https://media.example.test/master.m3u8" }),
    allowedHosts: ["media.example.test"],
    storage: opfs.storage,
    fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); }
  });
  await assert.rejects(adapter.download(job), /explicitly authorize/);
  assert.equal(fetched, false);
});

test("rejects an unallowlisted segment host and removes partial files", async () => {
  const opfs = fakeOPFS();
  const adapter = createBrowserHlsDownloadAdapter({
    resolve: async () => ({ type: "hls", offlineAllowed: true, url: "https://media.example.test/master.m3u8" }),
    allowedHosts: ["media.example.test"],
    storage: opfs.storage,
    fetchImpl: async url => {
      if (url.endsWith("/master.m3u8")) return new Response("#EXTM3U\n#EXTINF:6,\nhttps://evil.example/seg.ts\n#EXT-X-ENDLIST", { headers: { "content-type": "application/vnd.apple.mpegurl" } });
      throw new Error("Unexpected fetch");
    }
  });
  await assert.rejects(adapter.download(job), /not HTTPS or its host is not allowlisted/);
  assert.equal([...opfs.files.keys()].some(key => key.includes("hls_job_01")), false);
});
