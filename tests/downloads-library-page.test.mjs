import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Offline page exposes a native desktop download hub and local player", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  assert.match(page, /data-vivid-page="downloads-library"/);
  assert.match(page, /scripts\/my-downloads\.js/);
  assert.match(page, /My <span>Downloads<\/span>/);
  assert.match(page, /desktop-search-form/);
  assert.match(page, /offline-player/);
  assert.match(page, /id="desktop-download-search" class="offline-desktop-search" hidden/);
});

test("browser library remains available separately from the native Electron manager", async () => {
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  assert.match(script, /createIndexedDBPersistence\(\{ownerId:owner\}\)/);
  assert.match(script, /createBrowserDownloadAdapter/);
  assert.match(script, /createOfflinePlaybackController/);
  assert.match(script, /window\.vividDownloads\?\.available/);
  assert.match(desktop, /engine\.list\(\)/);
  assert.match(desktop, /engine\.mediaUrl\(job\.id,fileIndex\)/);
  assert.match(desktop, /Downloads are saved to your computer/);
  assert.doesNotMatch(script, /VIVID_DOWNLOADS|provider-integration|archive\.org|wikimedia\.org/i);
});


test("desktop downloads expose live transfer phases and accessible progress updates", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const engine = await readFile(new URL("../desktop/download-engine.cjs", import.meta.url), "utf8");
  assert.match(engine, /statusTimer = setInterval/);
  assert.match(engine, /Waiting for peers/);
  assert.match(engine, /Finding peers and metadata/);
  assert.match(engine, /phase: job\.phase/);
  assert.match(desktop, /job\.phase \|\| "Connecting to peers"/);
  assert.match(desktop, /No peers connected/);
  assert.match(desktop, /role="progressbar"/);
});

test("desktop search result button leaves Starting state after the start request settles", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  assert.match(desktop, /finally\s*\{[\s\S]*button\.disabled=false;button\.textContent="Download"/);
});

test("desktop torrent diagnostics expose tracker, DHT, peer and warning events", async () => {
  const engine = await readFile(new URL("../desktop/download-engine.cjs", import.meta.url), "utf8");
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  assert.match(engine, /torrent\.on\("trackerAnnounce"/);
  assert.match(engine, /torrent\.on\("dhtAnnounce"/);
  assert.match(engine, /torrent\.on\("noPeers"/);
  assert.match(engine, /torrent\.on\("warning"/);
  assert.match(engine, /this\.client\.on\("error"/);
  assert.match(engine, /dhtListening: Boolean\(this\.client\.dht && this\.client\.dht\.listening\)/);
  assert.match(desktop, /discoveryDetail/);
  assert.match(desktop, /discovery\.lastWarning/);
});

test("desktop download list removes cancelled jobs and search keeps peer-only releases", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const engine = await readFile(new URL("../desktop/download-engine.cjs", import.meta.url), "utf8");
  assert.match(desktop, /status!=="cancelled"/);
  assert.match(desktop, /payload\.status==="cancelled"\|\|payload\.removed/);
  assert.match(desktop, /Number\(item\.peers\|\|0\)\+' peers'/);
  assert.match(engine, /Number\(x\.seeds \|\| 0\) > 0 \|\| Number\(x\.peers \|\| 0\) > 0/);
  assert.match(engine, /announce: FALLBACK_TRACKERS/);
  assert.match(engine, /this\.jobs\.delete\(job\.id\)/);
});
