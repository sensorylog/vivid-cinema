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
const { DesktopDownloadEngine, FALLBACK_TRACKERS } = require("../desktop/download-engine.cjs");

function withTimeout(value, timeoutMs, description) {
  let timer;
  return Promise.race([
    Promise.resolve(value),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for " + description)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

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
  return withTimeout(new Promise(resolve => {
    try { client.destroy(() => resolve()); } catch { resolve(); }
  }), 5000, "torrent client shutdown").catch(() => {});
}

function closeTracker(tracker) {
  if (!tracker) return Promise.resolve();
  try { tracker.http?.closeAllConnections?.(); } catch {}
  return withTimeout(new Promise(resolve => {
    try { tracker.close(() => resolve()); } catch { resolve(); }
  }), 5000, "local tracker shutdown").catch(() => {});
}

test("verification keeps the last confirmed progress visible instead of showing a restart", { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-progress-fixture-"));
  let engine;
  try {
    engine = new DesktopDownloadEngine({
      app: { getPath(name) { return name === "downloads" ? path.join(root, "downloads") : path.join(root, "user-data"); } },
      BrowserWindow: { getAllWindows: () => [] },
      dialog: {},
      shell: {}
    });
    await withTimeout(engine.ready, 10000, "progress fixture engine initialization");
    const job = {
      id: "verifying-fixture",
      title: "Verification fixture",
      status: "verifying",
      progress: 82.4,
      downloaded: 824,
      total: 1000,
      torrent: { progress: 0, downloaded: 0, length: 1000, downloadSpeed: 0, numPeers: 0 },
      files: [],
      discovery: null
    };
    assert.equal(engine.snapshot(job).progress, 82.4,
      "re-scanning the existing store must not visually reset a job to zero");
  } finally {
    if (engine) await engine.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a fatal WebTorrent client error preserves job progress and replaces the dead client", { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-client-recovery-"));
  let engine;
  let oldClient;
  try {
    engine = new DesktopDownloadEngine({
      app: { getPath(name) { return name === "downloads" ? path.join(root, "downloads") : path.join(root, "user-data"); } },
      BrowserWindow: { getAllWindows: () => [] },
      dialog: {},
      shell: {}
    });
    await withTimeout(engine.ready, 10000, "client recovery fixture initialization");
    oldClient = engine.client;
    const job = {
      id: "client-recovery-fixture",
      title: "Client recovery fixture",
      status: "downloading",
      progress: 64,
      downloaded: 640,
      total: 1000,
      torrent: { progress: 0.71, downloaded: 710, length: 1000 },
      statusTimer: null,
      persistTimer: null
    };
    engine.jobs.set(job.id, job);
    oldClient.emit("error", new Error("simulated fatal torrent client error"));
    assert.notEqual(engine.client, oldClient, "Resume must have a fresh usable torrent client");
    assert.equal(job.status, "failed");
    assert.equal(job.progress, 71);
    assert.equal(job.downloaded, 710);
    assert.equal(job.needsRescan, true);
    assert.equal(job.torrent, null);
  } finally {
    if (oldClient && oldClient !== engine?.client) await closeClient(oldClient);
    if (engine) await engine.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("desktop engine downloads a video-extension payload from a local seeded torrent", { timeout: 90000 }, async () => {
  console.log("[vivid-integration] stage: create fixture");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-download-integration-"));
  const videoPath = path.join(root, "vivid-integration.mp4");
  const downloadsPath = path.join(root, "downloads");
  const userDataPath = path.join(root, "user-data");
  const payload = Buffer.alloc(8 * 1024 * 1024);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 31 + Math.floor(index / 251)) % 251;
  }
  await fs.writeFile(videoPath, payload);

  let tracker;
  let seeder;
  let engine;
  try {
    console.log("[vivid-integration] stage: create tracker");
    tracker = new TrackerServer({ udp: false, http: true, ws: false, stats: false });
    const trackerPort = await withTimeout(new Promise((resolve, reject) => {
      tracker.once("error", reject);
      tracker.listen(0, "127.0.0.1", () => {
        const address = tracker.http && tracker.http.address();
        if (!address || typeof address.port !== "number") {
          reject(new Error("Local HTTP tracker did not bind to a port"));
          return;
        }
        resolve(address.port);
      });
    }), 10000, "local HTTP tracker startup");
    const trackerUrl = "http://127.0.0.1:" + trackerPort + "/announce";
    console.log("[vivid-integration] stage: tracker listening", trackerUrl);
    let seederAnnounced = false;
    const trackerEvents = { start: 0, update: 0, complete: 0, stop: 0 };
    for (const event of Object.keys(trackerEvents)) {
      tracker.on(event, () => { trackerEvents[event] += 1; });
    }
    tracker.on("start", addr => {
      seederAnnounced = true;
      console.log("[vivid-integration] tracker start from", addr);
    });
    tracker.on("warning", warning => {
      console.log("[vivid-integration] tracker warning", warning?.message || String(warning));
    });

    console.log("[vivid-integration] stage: create seeder");
    seeder = new WebTorrent({ dht: false, utp: false, tracker: { announce: [trackerUrl] } });
    const seedTorrent = await withTimeout(new Promise((resolve, reject) => {
      seeder.once("error", reject);
      const torrent = seeder.seed(
        videoPath,
        { announce: [trackerUrl], name: "vivid-integration.mp4" },
        resolve
      );
      torrent.once("error", reject);
    }), 20000, "local torrent seeding");
    assert.match(seedTorrent.magnetURI, /^magnet:\?xt=urn:btih:/);
    assert.ok(seedTorrent.magnetURI.includes(encodeURIComponent(trackerUrl)));
    await waitFor(() => seederAnnounced, 10000, "seeder registration with the local tracker");
    console.log("[vivid-integration] stage: seeder announced");

    console.log("[vivid-integration] stage: construct download engine");
    const originalUtpSupport = WebTorrent.UTP_SUPPORT;
    WebTorrent.UTP_SUPPORT = false;
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
    WebTorrent.UTP_SUPPORT = originalUtpSupport;

    await withTimeout(engine.ready, 10000, "download engine initialization");
    console.log("[vivid-integration] stage: engine ready");
    assert.equal(engine.client.throttleGroups.up.getEnabled(), false,
      "outgoing peer protocol traffic must not be blocked by a zero-byte upload throttle");
    // Keep this fixture isolated: the test validates tracker discovery and TCP transfer,
    // not public DHT routing or external network access.
    if (engine.client.dht) {
      const dht = engine.client.dht;
      try { dht.destroy(); } catch {}
      engine.client.dht = null;
    }
    engine.searchResults.set("local-fixture", {
      title: "Vivid integration fixture",
      provider: "local-test",
      magnet: seedTorrent.magnetURI
    });

    console.log("[vivid-integration] stage: start download");
    const started = await withTimeout(engine.start({
      id: "local-fixture",
      title: "Vivid integration fixture",
      magnet: seedTorrent.magnetURI
    }, {
      title: "Vivid integration fixture",
      media_type: "movie"
    }), 10000, "download job start");
    const job = engine.jobs.get(started.id);
    assert.ok(job, "engine should register a download job");
    const torrent = job.torrent;
    assert.ok(FALLBACK_TRACKERS.length >= 5, "fallback tracker list should provide multiple discovery routes");
    assert.ok(FALLBACK_TRACKERS.every(url => /^(udp|https?):\/\//.test(url)), "fallback trackers must use supported UDP/HTTP protocols");
    assert.ok(torrent.announce.some(url => FALLBACK_TRACKERS.includes(url)), "fallback trackers should be added to each torrent");
    assert.equal(torrent?._rechokeNumSlots, 0,
      "the downloader should disable peer payload uploads without throttling protocol traffic");
    seedTorrent.on("wire", (wire, address) => {
      console.log("[vivid-integration] seeder peer connected", address || "unknown");
    });
    torrent?.on("peer", address => {
      console.log("[vivid-integration] leecher peer discovered", address || "unknown");
    });
    torrent?.on("wire", (wire, address) => {
      console.log("[vivid-integration] leecher peer connected", address || "unknown");
    });
    torrent?.on("warning", warning => {
      console.log("[vivid-integration] leecher warning", warning?.message || String(warning));
    });

    // Pause only after verified bytes have reached disk. The previous test
    // paused immediately after enqueue and never proved partial data survives.
    await waitFor(
      () => job.torrent?.ready && Number(job.torrent.downloaded) >= 64 * 1024 && job.torrent.progress < 0.95,
      20000,
      "a genuine partial transfer before pause"
    );
    const progressBeforePause = Number(job.torrent.progress) * 100;
    const bytesBeforePause = Number(job.torrent.downloaded);
    assert.ok(bytesBeforePause >= 64 * 1024, "pause fixture must contain verified partial bytes");
    assert.equal(await engine.control(started.id, "pause"), true,
      "an active desktop download should pause");
    assert.equal(job.status, "paused", "pause should persist a paused job state");
    assert.ok(job.progress >= progressBeforePause - 0.1, "pause must preserve the verified percentage");
    const pausedState = JSON.parse(await fs.readFile(engine.statePath, "utf8"));
    assert.equal(pausedState.jobs.find(row => row.id === started.id)?.status, "paused",
      "the paused state should survive in the on-disk job record");
    assert.equal(await engine.control(started.id, "resume"), true,
      "a paused desktop download should resume");
    assert.equal(job.status, "downloading", "resume should reattach the torrent");
    await waitFor(() => job.status === "downloading" && job.needsRescan === false,
      20000, "partial torrent verification to finish after resume");
    assert.ok(job.progress >= progressBeforePause - 0.1,
      "resume must restore verified pieces rather than restart at zero");
    assert.ok(Number(job.torrent?.downloaded) >= bytesBeforePause,
      "resume must reuse previously downloaded bytes from the existing store");

    try {
      await waitFor(
        () => ["completed", "failed"].includes(job.status),
        30000,
        "the seeded video transfer to complete"
      );
    } catch (error) {
      const liveTorrent = job.torrent;
      const swarm = tracker.torrents?.[seedTorrent.infoHash];
      console.error("[vivid-integration] timeout state", JSON.stringify({
        job: engine.snapshot(job),
        torrent: liveTorrent ? {
          ready: liveTorrent.ready,
          numPeers: liveTorrent.numPeers,
          downloaded: liveTorrent.downloaded,
          received: liveTorrent.received,
          length: liveTorrent.length,
          progress: liveTorrent.progress,
          announce: liveTorrent.announce,
          wireCount: liveTorrent.wires?.length ?? null
        } : null,
        seeder: {
          ready: seedTorrent.ready,
          numPeers: seedTorrent.numPeers,
          uploaded: seedTorrent.uploaded,
          length: seedTorrent.length
        },
        tracker: {
          infoHash: seedTorrent.infoHash,
          swarm: swarm ? {
            complete: swarm.complete,
            incomplete: swarm.incomplete,
            peerCount: Object.keys(swarm.peers || {}).length,
            peerCacheKeys: swarm.peers?.keys || [],
            peers: (swarm.peers?.keys || []).map(key => {
              const peer = swarm.peers.peek(key);
              return {
                key,
                type: peer?.type ?? null,
                ip: peer?.ip ?? null,
                port: peer?.port ?? null,
                peerId: peer?.peerId ?? null,
                complete: peer?.complete ?? null
              };
            })
          } : null,
          knownTorrents: Object.keys(tracker.torrents || {})
        },
        seederNetwork: {
          numPeers: seedTorrent.numPeers,
          wires: seedTorrent.wires?.map(wire => ({
            type: wire.type,
            remoteAddress: wire.remoteAddress,
            remotePort: wire.remotePort,
            peerId: wire.peerId?.toString("hex") || null
          })) || [],
          clientDestroyed: seeder.destroyed
        },
        downloaderNetwork: {
          clientDestroyed: engine.client.destroyed,
          clientListening: engine.client.listening,
          torrentWires: liveTorrent?.wires?.map(wire => ({
            type: wire.type,
            remoteAddress: wire.remoteAddress,
            remotePort: wire.remotePort,
            peerId: wire.peerId?.toString("hex") || null
          })) || []
        },
        trackerEvents
      }));
      throw error;
    }

    console.log("[vivid-integration] stage: transfer terminal", job.status, JSON.stringify(engine.snapshot(job)));
    assert.equal(job.status, "completed", "engine should complete the local torrent: " + JSON.stringify(engine.snapshot(job)));
    assert.ok(job.filePath, "completed job should expose a playable file path");
    const downloaded = await fs.readFile(job.filePath);
    assert.equal(downloaded.length, payload.length, "downloaded file should have the expected byte length");
    assert.deepEqual(downloaded, payload, "downloaded file should match the seeded video bytes");
    assert.ok(job.discovery.trackerAnnounces > 0, "download should announce through the local tracker");

    // Exercise the real offline-library persistence boundary: save a playback
    // position, close the engine as if Vivid were exiting, then restore it.
    assert.equal(await engine.setPlaybackPosition(started.id, 0, 123.9), true,
      "completed media should accept a per-file playback position");
    assert.equal(engine.getPlaybackPosition(started.id, 0), 123,
      "playback positions should be stored as whole seconds");
    assert.equal(await engine.setPlaybackPosition(started.id, 0, -1), false,
      "negative playback positions must be rejected");

    console.log("[vivid-integration] stage: restart engine and restore library");
    await withTimeout(engine.shutdown(), 10000, "pre-restart download engine shutdown");
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
    await withTimeout(engine.ready, 10000, "download library restoration");
    const restoredJobs = await engine.list();
    assert.equal(restoredJobs.length, 1, "the completed download should appear once after restart");
    assert.equal(restoredJobs[0].id, started.id, "the original download identity should survive restart");
    assert.equal(restoredJobs[0].status, "completed", "completed media should remain saved after restart");
    assert.equal(engine.getPlaybackPosition(started.id, 0), 123,
      "the per-file playback position should survive restart");
    assert.equal(engine.mediaFile(started.id, 0), job.filePath,
      "restored completed media should remain addressable by the player");
    assert.deepEqual(await fs.readFile(engine.mediaFile(started.id, 0)), payload,
      "the restored library should still point to the original downloaded bytes");
  } finally {
    if (engine) await withTimeout(engine.shutdown(), 10000, "download engine shutdown").catch(() => {});
    await closeClient(seeder);
    await closeTracker(tracker);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cancelling a paused download removes its row and partial files", { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-cancel-integration-"));
  const downloadsPath = path.join(root, "downloads");
  const userDataPath = path.join(root, "user-data");
  const id = "cancel-fixture";
  const jobPath = path.join(downloadsPath, id);
  let engine;
  try {
    await fs.mkdir(jobPath, { recursive: true });
    await fs.writeFile(path.join(jobPath, "partial.data"), Buffer.from("partial torrent data"));
    engine = new DesktopDownloadEngine({
      app: { getPath(name) { return name === "downloads" ? downloadsPath : userDataPath; } },
      BrowserWindow: { getAllWindows: () => [] },
      dialog: {},
      shell: {}
    });
    await withTimeout(engine.ready, 10000, "cancel fixture engine initialization");
    engine.jobs.set(id, {
      id, title: "Cancelled fixture", resultTitle: "Cancelled fixture",
      media: { id: "1", media_type: "movie", title: "Cancelled fixture", season: null, episode: null, episodeTitle: "" },
      magnet: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
      status: "paused", phase: "Paused", torrent: null, downloadPath: jobPath,
      filePath: null, files: [], progress: 12, downloaded: 100, total: 800,
      error: null, createdAt: Date.now(), needsRescan: true
    });
    await engine.persist();
    assert.equal(await engine.control(id, "cancel"), true);
    assert.equal((await engine.list()).some(job => job.id === id), false);
    await assert.rejects(fs.access(jobPath));
    const state = JSON.parse(await fs.readFile(engine.statePath, "utf8"));
    assert.equal(state.jobs.some(job => job.id === id), false);
  } finally {
    if (engine) await engine.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  }
});
