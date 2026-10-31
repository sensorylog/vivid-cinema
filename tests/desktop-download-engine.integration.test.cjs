"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const requireDesktop = createRequire(path.resolve(__dirname, "../desktop/package.json"));
const WebTorrent = requireDesktop("webtorrent");
const { Server: TrackerServer } = requireDesktop("bittorrent-tracker");
const { DesktopDownloadEngine } = require("../desktop/download-engine.cjs");

function waitFor(predicate, timeoutMs, description) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      let value;
      try {
        value = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for " + description));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function closeClient(client) {
  if (!client) return Promise.resolve();
  return new Promise(resolve => client.destroy(() => resolve()));
}

function closeTracker(tracker) {
  if (!tracker) return Promise.resolve();
  return new Promise(resolve => tracker.close(() => resolve()));
}

test("desktop engine downloads a real video file from a local seeded torrent", { timeout: 90000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-download-integration-"));
  const videoPath = path.join(root, "vivid-integration.mp4");
  const downloadsPath = path.join(root, "downloads");
  const userDataPath = path.join(root, "user-data");
  const payload = Buffer.alloc(768 * 1024);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 31 + Math.floor(index / 251)) % 251;
  }
  await fs.writeFile(videoPath, payload);

  let tracker;
  let seeder;
  let engine;
  try {
    tracker = new TrackerServer({ udp: false, http: false, ws: true, stats: false });
    const trackerPort = await new Promise((resolve, reject) => {
      tracker.once("error", reject);
      tracker.listen(0, "127.0.0.1", () => {
        const address = tracker.ws && tracker.ws.address();
        if (!address || typeof address.port !== "number") {
          reject(new Error("Local WebSocket tracker did not bind to a port"));
          return;
        }
        resolve(address.port);
      });
    });
    const trackerUrl = "ws://127.0.0.1:" + trackerPort;

    seeder = new WebTorrent({ dht: false, tracker: { announce: [trackerUrl] } });
    const seedTorrent = await new Promise((resolve, reject) => {
      seeder.once("error", reject);
      const torrent = seeder.seed(
        videoPath,
        { announce: [trackerUrl], name: "vivid-integration.mp4" },
        resolve
      );
      torrent.once("error", reject);
    });
    assert.match(seedTorrent.magnetURI, /^magnet:\?xt=urn:btih:/);
    assert.ok(seedTorrent.magnetURI.includes(encodeURIComponent(trackerUrl)));

    engine = new DesktopDownloadEngine({
      app: {
        getPath(name) {
          return name === "downloads" ? downloadsPath : userDataPath;
        }
      },
      BrowserWindow: { getAllWindows: () => [] },
      dialog: {},
      shell: {}
    });

    await engine.ready;
    engine.searchResults.set("local-fixture", {
      title: "Vivid integration fixture",
      provider: "local-test",
      magnet: seedTorrent.magnetURI
    });

    const started = await engine.start({
      id: "local-fixture",
      title: "Vivid integration fixture",
      magnet: seedTorrent.magnetURI
    }, {
      title: "Vivid integration fixture",
      media_type: "movie"
    });
    const job = engine.jobs.get(started.id);
    assert.ok(job, "engine should register a download job");

    await waitFor(
      () => ["completed", "failed"].includes(job.status),
      60000,
      "the seeded video transfer to complete"
    );

    assert.equal(job.status, "completed", "engine should complete the local torrent: " + JSON.stringify(engine.snapshot(job)));
    assert.ok(job.filePath, "completed job should expose a playable file path");
    const downloaded = await fs.readFile(job.filePath);
    assert.equal(downloaded.length, payload.length, "downloaded file should have the expected byte length");
    assert.deepEqual(downloaded, payload, "downloaded file should match the seeded video bytes");
    assert.ok(job.discovery.trackerAnnounces > 0, "download should announce through the local tracker");
  } finally {
    if (engine) await engine.shutdown().catch(() => {});
    await closeClient(seeder);
    await closeTracker(tracker);
    await fs.rm(root, { recursive: true, force: true });
  }
});
