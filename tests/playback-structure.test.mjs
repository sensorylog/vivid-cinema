import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const playbackFiles = [
  "player-engine.js",
  "playback-urls.js",
  "playback-servers.js",
  "server-settings.js",
  "tflix-secondary-player.js",
  "direct-stream-validation.js"
];

test("playback implementation modules stay grouped under scripts/playback", async () => {
  for (const file of playbackFiles) {
    await access(path.join(root, "scripts", "playback", file));
    await assert.rejects(access(path.join(root, "scripts", file)), { code: "ENOENT" });
  }
});

test("watch controller and service worker use the grouped playback paths", async () => {
  const watch = await readFile(path.join(root, "scripts", "watch.js"), "utf8");
  const serviceWorker = await readFile(path.join(root, "service-worker.js"), "utf8");

  for (const file of [
    "player-engine.js",
    "playback-servers.js",
    "server-settings.js",
    "playback-urls.js",
    "tflix-secondary-player.js"
  ]) {
    assert.ok(watch.includes(`./playback/${file}`), `watch.js should import playback/${file}`);
    assert.ok(serviceWorker.includes(`./scripts/playback/${file}`), `service worker should precache playback/${file}`);
    assert.ok(!serviceWorker.includes(`./scripts/${file}`), `service worker must not retain the old ${file} path`);
  }
});


test("direct-stream diagnostics observe stalls and buffer-ahead without controlling playback", async () => {
  const engine = await readFile(path.join(root, "scripts", "playback", "player-engine.js"), "utf8");
  for (const event of ["waiting", "stalled", "playing", "error", "progress"]) {
    assert.ok(engine.includes('"' + event + '"'), "direct player diagnostics should observe " + event);
  }
  assert.match(engine, /onDiagnostics = null/);
  assert.match(engine, /bufferedAhead/);
  assert.match(engine, /Diagnostics must never interrupt playback/);
  assert.match(engine, /target\\.removeEventListener\\(eventName, listener\\)/);
});
