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
  assert.match(desktop, /job\.status==="downloading"\) return "Downloading"/);
  assert.doesNotMatch(desktop, /No peers connected|peerState|discoveryDetail/);
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
  assert.match(engine, /client\.on\("error"/);
  assert.match(engine, /dhtListening: Boolean\(this\.client\.dht && this\.client\.dht\.listening\)/);
  assert.doesNotMatch(desktop, /discoveryDetail|discovery\.lastWarning|lastNoPeerSource/);
  assert.match(engine, /lastWarning/);
});

test("failed movie and episode downloads show their actual recovery reason", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles/my-downloads.css", import.meta.url), "utf8");
  assert.match(desktop, /function errorMarkup\(job\)/);
  assert.match(desktop, /job\.status!==\"failed\"\|\|!job\.error/);
  assert.match(desktop, /progressMarkup\(job\)\+errorMarkup\(job\)\+fileMarkup\(job\)/);
  assert.match(styles, /\.offline-job-error/);
});

test("desktop download list removes cancelled jobs and search keeps peer-only releases", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const engine = await readFile(new URL("../desktop/download-engine.cjs", import.meta.url), "utf8");
  assert.match(desktop, /status!=="cancelled"/);
  assert.match(desktop, /payload\.status==="cancelled"\|\|payload\.removed/);
  assert.doesNotMatch(desktop, /Number\(item\.peers\|\|0\).*peers|seeders/);
  assert.match(engine, /Number\(x\.seeds \|\| 0\) > 0 \|\| Number\(x\.peers \|\| 0\) > 0/);
  assert.match(engine, /announce: FALLBACK_TRACKERS/);
  assert.match(engine, /this\.jobs\.delete\(job\.id\)/);
});


test("desktop player fullscreen uses a viewport flex layout and reflects fullscreen state", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/my-downloads.css", import.meta.url), "utf8");
  assert.match(desktop, /function syncFullscreenButton\(\)/);
  assert.match(desktop, /section\.requestFullscreen\|\|section\.webkitRequestFullscreen/);
  assert.match(desktop, /document\.addEventListener\("fullscreenchange"/);
  assert.match(css, /\.offline-player-section:fullscreen\s*\{[^}]*display:\s*flex/s);
});

test("torrent progress events are coalesced instead of rebuilding the library on every event", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  assert.match(desktop, /function scheduleProgressRender\(\)/);
  assert.match(desktop, /\},300\)/);
  assert.match(desktop, /engine\.onProgress\(payload=>\{[\s\S]*?scheduleProgressRender\(\);[\s\S]*?\}\);/);
});
