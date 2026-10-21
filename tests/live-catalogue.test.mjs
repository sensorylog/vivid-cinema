import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(path.join(root, file), "utf8");

test("Vivid Live normalizes M3U entries into grouped channel records", async () => {
  const source = await read("scripts/live.js");
  assert.match(source, /function parseM3U\(text,provider\)/);
  assert.match(source, /function normalizeM3U\(text,provider\)/);
  assert.match(source, /for\(const row of parseM3U\(text,provider\)\)/);
  assert.match(source, /sources:\[source\]/);
  assert.doesNotMatch(source, /normalizeM3U\s*\(await res\.text\(\),\s*SOURCES\[i\]\.name/);
});

test("Vivid Live searches multiple public catalogues and merges successful results", async () => {
  const source = await read("scripts/live.js");
  assert.match(source, /https:\/\/dearbulut\.github\.io\/iptv\/api\/v1\/channels\.online\.json/);
  assert.match(source, /\.\.\.SOURCES\.map\(async source/);
  assert.match(source, /let next=mergeCatalogue\(parsed\)/);
  assert.match(source, /normalizeApiFallback\(channelsData,streamsData,countriesData\)/);
  assert.match(source, /if\(next\.length<50\)/);
});

test("Vivid Live exposes manual refresh and periodically refreshes while visible", async () => {
  const html = await read("live.html");
  const source = await read("scripts/live.js");
  assert.match(html, /id="live-refresh"/);
  assert.match(html, /id="live-guide-status" aria-live="polite"/);
  assert.match(source, /live-refresh.*addEventListener\("click"/);
  assert.match(source, /const CATALOGUE_REFRESH_MS=30\*60\*1000/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /if\(!next\.length\)throw Error\("No live channels returned"\)/);
  assert.match(source, /Refresh unavailable; showing last results/);
});


test("Vivid Live includes a dedicated public sports M3U source", async () => {
  const source = await read("scripts/live.js");
  assert.match(source, /name:"IPTV-org Sports",url:"https:\\/\\/iptv-org\\.github\\.io\\/iptv\\/categories\\/sports\\.m3u"/);
  assert.match(source, /"IPTV-org Sports":2/);
});
