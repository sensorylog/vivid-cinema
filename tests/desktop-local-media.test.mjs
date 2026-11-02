import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createLocalMediaRegistry, isSupportedLocalVideoFile } = require("../desktop/local-media.cjs");

test("recognizes common local video containers case-insensitively", () => {
  for (const file of ["movie.mp4", "movie.MKV", "movie.webm", "movie.mov", "movie.avi", "movie.m2ts"]) {
    assert.equal(isSupportedLocalVideoFile(file), true, file);
  }
});

test("rejects non-video and unsupported file extensions", () => {
  for (const file of ["notes.txt", "captions.srt", "image.png", "archive.zip", "", "no-extension"]) {
    assert.equal(isSupportedLocalVideoFile(file), false, file);
  }
});

test("local media registry issues opaque tokens and resolves only registered paths", () => {
  const registry = createLocalMediaRegistry({ createToken: () => "opaque-token" });
  const token = registry.register("C:\\Videos\\feature.MKV", 7);
  assert.equal(token, "opaque-token");
  assert.deepEqual(registry.get(token), {
    filePath: require("node:path").resolve("C:\\Videos\\feature.MKV"),
    senderId: 7
  });
});

test("local media tokens can only be released by the renderer that received them", () => {
  const registry = createLocalMediaRegistry({ createToken: () => "owned-token" });
  const token = registry.register("/media/movie.mp4", 11);
  assert.equal(registry.release(token, 12), false);
  assert.ok(registry.get(token));
  assert.equal(registry.release(token, 11), true);
  assert.equal(registry.get(token), null);
});

test("registry bounds retained file grants and clears on shutdown", () => {
  let next = 0;
  const registry = createLocalMediaRegistry({ maxEntries: 2, createToken: () => "token-" + (++next) });
  const first = registry.register("/media/one.mp4", 1);
  registry.register("/media/two.mp4", 1);
  registry.register("/media/three.mp4", 1);
  assert.equal(registry.size, 2);
  assert.equal(registry.get(first), null);
  registry.clear();
  assert.equal(registry.size, 0);
});
