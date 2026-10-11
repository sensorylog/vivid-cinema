import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/playback/direct-stream-validation.js", import.meta.url), "utf8");
const { createAllowlistedFetchRequest, inferAuthorizedStreamType, normalizeAllowedHosts, validateAllowedHttpsUrl } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

const hosts = ["media.example.com", "cdn.example.com"];

test("normalizes exact hostname allowlists and removes duplicates", () => {
  assert.deepEqual(
    normalizeAllowedHosts([" MEDIA.EXAMPLE.COM ", "media.example.com", "https://media.example.com", "cdn.example.com/path", "cdn.example.com:8443", ""]),
    ["media.example.com"]
  );
});

test("accepts HTTPS URLs only on exact allowlisted hosts and standard ports", () => {
  assert.equal(validateAllowedHttpsUrl("https://media.example.com/master.m3u8", hosts)?.hostname, "media.example.com");
  assert.equal(validateAllowedHttpsUrl("https://media.example.com:443/movie.mp4", hosts)?.hostname, "media.example.com");
  assert.equal(validateAllowedHttpsUrl("http://media.example.com/master.m3u8", hosts), null);
  assert.equal(validateAllowedHttpsUrl("https://sub.media.example.com/master.m3u8", hosts), null);
  assert.equal(validateAllowedHttpsUrl("https://media.example.com.evil.test/master.m3u8", hosts), null);
  assert.equal(validateAllowedHttpsUrl("https://media.example.com:8443/master.m3u8", hosts), null);
});

test("rejects credentials, malformed URLs, and non-string values", () => {
  assert.equal(validateAllowedHttpsUrl("https://user:pass@media.example.com/master.m3u8", hosts), null);
  assert.equal(validateAllowedHttpsUrl("not a URL", hosts), null);
  assert.equal(validateAllowedHttpsUrl("", hosts), null);
  assert.equal(validateAllowedHttpsUrl(null, hosts), null);
});

test("infers supported stream formats from the URL path", () => {
  assert.equal(inferAuthorizedStreamType(new URL("https://media.example.com/master.m3u8")), "hls");
  assert.equal(inferAuthorizedStreamType(new URL("https://media.example.com/manifest.mpd")), "dash");
  assert.equal(inferAuthorizedStreamType(new URL("https://media.example.com/movie.MP4")), "file");
  assert.equal(inferAuthorizedStreamType(new URL("https://media.example.com/movie.webm")), "file");
  assert.equal(inferAuthorizedStreamType(new URL("https://media.example.com/page")), "");
});

test("accepts explicit supported types and rejects unknown declared types by inference", () => {
  const url = new URL("https://media.example.com/play");
  assert.equal(inferAuthorizedStreamType(url, "HLS"), "hls");
  assert.equal(inferAuthorizedStreamType(url, "dash"), "dash");
  assert.equal(inferAuthorizedStreamType(url, "file"), "file");
  assert.equal(inferAuthorizedStreamType(url, "unknown"), "");
});

test("HLS fetch requests reject redirects and disallowed resource hosts", () => {
  const request = createAllowlistedFetchRequest("https://media.example.com/segment.ts", { method: "GET" }, hosts);
  assert.equal(request.redirect, "error");
  assert.equal(request.url, "https://media.example.com/segment.ts");
  assert.throws(
    () => createAllowlistedFetchRequest("https://untrusted.example/segment.ts", {}, hosts),
    /not allowlisted/
  );
});
