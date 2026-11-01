import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createMediaResponse, getMediaContentType, parseByteRange } = require("../desktop/media-protocol.cjs");

test("byte ranges support closed, open-ended and suffix requests", () => {
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-4", 10), { start: 6, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-40", 10), { start: 0, end: 9 });
  assert.deepEqual(parseByteRange("bytes=2-99", 10), { start: 2, end: 9 });
  assert.equal(parseByteRange(null, 10), null);
});

test("invalid and multi-range requests are rejected as unsatisfiable", () => {
  for (const header of ["bytes=", "items=0-1", "bytes=-0", "bytes=10-", "bytes=8-2", "bytes=0-1,4-5"]) {
    assert.deepEqual(parseByteRange(header, 10), { unsatisfiable: true }, header);
  }
  assert.deepEqual(parseByteRange("bytes=0-", 0), { unsatisfiable: true });
});

test("media MIME lookup covers common offline containers without guessing unknown formats", () => {
  assert.equal(getMediaContentType("film.MKV"), "video/x-matroska");
  assert.equal(getMediaContentType("film.m2ts"), "video/mp2t");
  assert.equal(getMediaContentType("film.mp4"), "video/mp4");
  assert.equal(getMediaContentType("film.unknown"), "application/octet-stream");
});

test("local media responses stream complete files and exact byte ranges", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-media-response-"));
  const filePath = path.join(root, "sample.mkv");
  const payload = Buffer.from("0123456789");
  try {
    await fs.writeFile(filePath, payload);
    const stat = await fs.stat(filePath);

    const full = createMediaResponse(new Request("https://vivid.test/media"), filePath, stat);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("content-type"), "video/x-matroska");
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), payload);

    const partial = createMediaResponse(new Request("https://vivid.test/media", {
      headers: { Range: "bytes=3-6" }
    }), filePath, stat);
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 3-6/10");
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), Buffer.from("3456"));

    const suffix = createMediaResponse(new Request("https://vivid.test/media", {
      headers: { Range: "bytes=-3" }
    }), filePath, stat);
    assert.equal(suffix.status, 206);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), Buffer.from("789"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("HEAD, invalid ranges and unsupported methods return correct response metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vivid-media-head-"));
  const filePath = path.join(root, "sample.mp4");
  try {
    await fs.writeFile(filePath, "video-data");
    const stat = await fs.stat(filePath);

    const head = createMediaResponse(new Request("https://vivid.test/media", { method: "HEAD" }), filePath, stat);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(await head.text(), "");

    const invalid = createMediaResponse(new Request("https://vivid.test/media", {
      headers: { Range: "bytes=999-" }
    }), filePath, stat);
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */10");

    const method = createMediaResponse(new Request("https://vivid.test/media", { method: "POST" }), filePath, stat);
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET, HEAD");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
