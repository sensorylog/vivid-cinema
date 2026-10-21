import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/watch.js", import.meta.url), "utf8");

test("player accepts JSON-string provider messages and validates parsed payloads", () => {
  assert.match(source, /typeof payload === "string"/);
  assert.match(source, /payload = JSON\.parse\(payload\)/);
  assert.match(source, /Array\.isArray\(payload\)/);
});

test("known provider origin aliases are recognized without trusting arbitrary origins", () => {
  assert.match(source, /VIDSRC_ORIGINS\.has\(event\.origin\)/);
  assert.match(source, /VIDKING_ORIGINS\.has\(event\.origin\)/);
  assert.match(source, /VIDPLUS_ORIGINS\.has\(event\.origin\)/);
  assert.match(source, /event\.source !== player\.contentWindow/);
});

test("player iframe sends only the origin referrer for provider domain checks without sandboxing embeds", () => {
  assert.match(source, /referrerpolicy="origin"/);
  assert.doesNotMatch(source, /<iframe[^>]*sandbox=/);
});

test("watch page no longer contains the removed Movie Scraper Player 2 integration", () => {
  assert.doesNotMatch(source, /movie-scraper-lovat-three|secondaryPlayerMarkup|vivid-secondary-player|upstream stream extraction has failed/);
});


test("direct-stream diagnostics require an explicit playbackDebug query flag", () => {
  assert.match(source, /route\.params\.get\("playbackDebug"\) === "1"/);
  assert.match(source, /onDiagnostics:\s*sample\s*=>/);
  assert.match(source, /\[Vivid playback diagnostics\]/);
});


test("iframe diagnostics are opt-in and do not log raw provider payloads", () => {
  assert.match(source, /\[Vivid iframe diagnostics\]/);
  assert.match(source, /debugData\.event \|\| debugData\.player_status/);
  assert.match(source, /route\.params\.get\("playbackDebug"\) === "1"/);
  assert.doesNotMatch(source, /console\.info\("\[Vivid iframe diagnostics\]",\s*payload/);
});



test("anime playback excludes the unverified Aniweeb source and automatically falls back after timeout", () => {
  assert.doesNotMatch(source, /data-player-source="aniweeb"/);
  assert.doesNotMatch(source, /\["aniweeb", "vidplus"/);
  assert.match(source, /\? \["vidplus", "vidlink", "vidsrc", "vidapi"\]/);
  assert.match(source, /if \(isAnimePlayback\(\)\) triggerFallback\("anime_source_timeout"\)/);
  assert.match(source, /isAnimePlayback\(\) \? 12000 : 25000/);
});
