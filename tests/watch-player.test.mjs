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

test("Player 2 offers a same-title VidLink fallback and can switch back to Movie Scraper", () => {
  assert.match(source, /secondaryPlayerFallbackUrl = "https:\/\/vidlink\.pro\/"\s*\+/);
  assert.match(source, /"tv\/" \+ encodeURIComponent\(String\(media\.id\)\) \+ "\/" \+ Math\.max\(1, Number\(params\.season\) \|\| 1\) \+ "\/" \+ Math\.max\(1, Number\(params\.episode\) \|\| 1\)/);
  assert.match(source, /"movie\/" \+ encodeURIComponent\(String\(media\.id\)\)/);
  assert.match(source, /secondaryPlayerFallback\.dataset\.active = showingFallback \? "scraper" : "vidlink"/);
  assert.match(source, /secondaryPlayerOpen\.href = nextUrl/);
});

test("Player 2 preserves the scraper ID and TV season/episode query parameters", () => {
  assert.match(source, /new URLSearchParams\(\{ id: String\(media\.id \|\| ""\) \}\)/);
  assert.match(source, /secondaryPlayerQuery\.set\("s", String\(params\.season \|\| 1\)\)/);
  assert.match(source, /secondaryPlayerQuery\.set\("e", String\(params\.episode \|\| 1\)\)/);
});
