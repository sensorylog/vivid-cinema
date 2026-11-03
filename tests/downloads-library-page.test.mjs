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

test("desktop release search is identity-gated and batches up to five unique movies or episodes", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  assert.ok(desktop.includes("matchesSelectedRelease(media,item)"));
  assert.ok(desktop.includes("batchQueue.length>=5"));
  assert.ok(desktop.includes("batchIdentity(item.media)===key"));
  assert.ok(desktop.includes("Promise.allSettled(pending.map(item=>engine.start"));
  assert.ok(desktop.includes("sessionStorage.setItem(BATCH_KEY"));
  assert.ok(desktop.includes("function transferText(job)"));
  assert.ok(desktop.includes("Number(job.peers)"));
  assert.match(page, /id="desktop-add-selected"/);
  assert.match(page, /id="desktop-batch-queue"/);
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
  assert.ok(desktop.includes("progressMarkup(job)+transferMarkup(job)+errorMarkup(job)+fileMarkup(job)"));
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
  assert.match(desktop, /section\.requestFullscreen/);
  assert.match(desktop, /section\.webkitRequestFullscreen/);
  assert.match(desktop, /document\.webkitExitFullscreen/);
  assert.match(desktop, /document\.addEventListener\("fullscreenchange"/);
  assert.match(css, /\.offline-player-section:fullscreen\s*\{[^}]*display:\s*flex/s);
});

test("torrent progress events are coalesced instead of rebuilding the library on every event", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  assert.match(desktop, /function scheduleProgressRender\(\)/);
  assert.match(desktop, /\},300\)/);
  assert.match(desktop, /engine\.onProgress\(payload=>\{[\s\S]*?scheduleProgressRender\(\);[\s\S]*?\}\);/);
});


test("offline player fullscreen fills the viewport and floats controls over the video", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/my-downloads.css", import.meta.url), "utf8");
  assert.match(desktop, /function currentFullscreenElement\(\)/);
  assert.match(desktop, /webkitRequestFullscreen/);
  assert.match(desktop, /\},2200\)/);
  assert.ok(desktop.includes("setTimeout(hidePlayerControlsNow,280)"));
  assert.match(css, /\.offline-player-section:fullscreen\s*\{[\s\S]*?height:\s*100dvh/);
  assert.match(css, /\.offline-player-section:fullscreen video\s*\{[\s\S]*?position:\s*absolute[\s\S]*?height:\s*100%/);
  assert.match(css, /\.offline-player-section:fullscreen \.offline-custom-controls\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(css, /\.offline-player-section:fullscreen\.controls-hidden \.offline-custom-controls/);
});


test("MKV playback selects a default audio track and reports decoder failures", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  assert.match(desktop, /function audioTrackLabel\(track,index\)/);
  assert.match(desktop, /choosePreferredTrack\(tracks,currentPlaybackPreferences\.audioTrackLanguage\|\|currentPlaybackPreferences\.audioLanguage\)/);
  assert.match(desktop, /if\(selectedIndex<0\)selectedIndex=0;/);
  assert.match(desktop, /tracks\[index\]\.enabled=index===selectedIndex/);
  assert.match(desktop, /function describePlaybackError\(\)/);
  assert.match(desktop, /code===3/);
  assert.match(desktop, /code===4/);
  assert.doesNotMatch(desktop, /webkitAudioDecodedByteCount/);
  assert.match(desktop, /select\.value=String\(selectedIndex\)/);
  assert.match(desktop, /player\.addEventListener\("canplay",refreshAudioTracks\)/);
});


test("fullscreen uses only Vivid overlay controls and pointer movement can hide them", async () => {
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/my-downloads.css", import.meta.url), "utf8");
  assert.match(desktop, /player\.controls=!active/);
  assert.match(desktop, /function hasKeyboardFocusedPlayerControl\(\)/);
  assert.match(desktop, /controlsHideTimer=setTimeout\(\(\)=>\{\s*hidePlayerControlsNow\(\);/);
  assert.ok(desktop.includes("setTimeout(hidePlayerControlsNow,280)"));
  assert.doesNotMatch(desktop, /!section.matches/);
  assert.match(css, /\.offline-player-section:fullscreen\.controls-hidden \.offline-custom-controls\s*\{[\s\S]*?visibility:\s*hidden/);
});

test("Windows player runtime and stylesheet have cache-busting URLs", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../scripts/my-downloads.js", import.meta.url), "utf8");
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(page, /my-downloads\.css\?v=offline-cinema-batch-1/);
  assert.match(script, /desktop-offline\.js\?strict-release-batch-v1/);
  assert.match(worker, /vivid-cinema-shell-v270/);
  assert.match(worker, /desktop-offline\.js\?strict-release-batch-v1/);
  assert.match(worker, /my-downloads\.css\?v=offline-cinema-batch-1/);
});

test("offline library filters movies, sorts saved media, and reports on-device storage", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles/my-downloads.css", import.meta.url), "utf8");
  assert.match(page, /id="offline-storage"/);
  assert.match(page, /data-library-filter="movies"/);
  assert.match(page, /id="offline-library-sort"/);
  assert.match(page, /option value="recent"/);
  assert.match(page, /option value="title"/);
  assert.match(page, /option value="largest"/);
  assert.match(desktop, /libraryFilter==="movies"/);
  assert.match(desktop, /librarySort==="title"/);
  assert.match(desktop, /librarySort==="largest"/);
  assert.match(desktop, /byId\("offline-storage"\)\.textContent=bytes\(savedBytes\)/);
  assert.match(desktop, /files\.reduce\(\(fileSum,file\)=>fileSum\+Math\.max\(0,Number\(file\.size\)\|\|0\),0\)/);
  assert.match(desktop, /files\.length\+\' playable files · \'\+bytes\(total\)/);
  assert.match(styles, /offline-library-sort/);
  assert.match(styles, /offline-file-meta/);
});


test("offline redesign provides title details, season grouping and continue watching", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  const desktop = await readFile(new URL("../scripts/downloads/desktop-offline.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles/my-downloads.css", import.meta.url), "utf8");
  assert.match(page, /offline-title-dialog/);
  assert.match(page, /offline-continue-section/);
  assert.match(desktop, /async function showTitleDetails\(job\)/);
  assert.match(desktop, /offline-season-group/);
  assert.match(desktop, /async function renderContinueWatching\(\)/);
  assert.match(desktop, /offline-continue-list\"\)\.addEventListener\(\"click\"/);
  assert.match(desktop, /engine\.getPlaybackPosition\(job\.id,0\)/);
  assert.match(styles, /\.offline-title-dialog/);
  assert.match(styles, /\.offline-continue-card/);
});

test("offline redesign cache is versioned and precaches the active stylesheet", async () => {
  const page = await readFile(new URL("../my-downloads.html", import.meta.url), "utf8");
  const worker = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(page, /my-downloads\.css\?v=offline-cinema-batch-1/);
  assert.match(worker, /vivid-cinema-shell-v270/);
  assert.match(worker, /my-downloads\.css\?v=offline-cinema-batch-1/);
});
