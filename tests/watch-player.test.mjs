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
