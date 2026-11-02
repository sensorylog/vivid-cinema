import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const player = fs.readFileSync(path.join(root, "scripts", "downloads", "desktop-offline.js"), "utf8");
const page = fs.readFileSync(path.join(root, "my-downloads.html"), "utf8");

test("Windows offline player exposes high-resolution seeking and frame stepping", () => {
  assert.match(page, /id="offline-seek"[^>]*max="100000"/);
  assert.match(player, /currentTime\/duration\*100000/);
  assert.match(player, /function stepFrame\(direction\)/);
  assert.match(player, /player\.pause\(\)/);
  assert.match(player, /1\/frameRate/);
  assert.match(page, /id="offline-frame-back"/);
  assert.match(page, /id="offline-frame-forward"/);
});

test("Windows offline player supports expanded transport keyboard shortcuts", () => {
  for (const shortcut of ['key==="k"', 'key==="l"', 'key==="j"', 'key==="."', 'key===","', 'key==="f"', 'key==="p"', 'key==="c"', 'key==="m"']) {
    assert.ok(player.includes(shortcut), "missing shortcut " + shortcut);
  }
  assert.match(player, /event\.shiftKey\?30:5/);
  assert.match(player, /event\.shiftKey\?-30:-5/);
});

test("Windows offline player provides Picture in Picture and windowed cinema modes", () => {
  assert.match(page, /id="offline-pip"/);
  assert.match(page, /id="offline-cinema-mode"/);
  assert.match(player, /requestPictureInPicture/);
  assert.match(player, /exitPictureInPicture/);
  assert.match(player, /windowed-cinema/);
});

test("Windows offline player offers bounded audio boost with compression and audio delay", () => {
  assert.match(page, /id="offline-audio-boost"[^>]*min="100" max="250"/);
  assert.match(page, /id="offline-audio-delay"[^>]*min="0" max="500"/);
  assert.match(player, /createMediaElementSource\(player\)/);
  assert.match(player, /createDynamicsCompressor\(\)/);
  assert.match(player, /audioGain\.connect\(audioCompressor\)/);
  assert.match(player, /audioCompressor\.connect\(audioDelay\)/);
  assert.match(player, /audioDelay\.delayTime\.setTargetAtTime/);
});

test("Chapter navigation and skip actions are only driven by chapter metadata", () => {
  for (const id of ["offline-chapter-controls", "offline-chapter-previous", "offline-chapter-next", "offline-skip-intro", "offline-skip-credits"]) {
    assert.ok(page.includes('id="' + id + '"'), "missing chapter control " + id);
  }
  assert.match(player, /track\.kind==="chapters"/);
  assert.match(player, /introPattern/);
  assert.match(player, /creditsPattern/);
  assert.match(player, /seekToChapter\(direction\)/);
  assert.match(player, /cue\.endTime/);
});
