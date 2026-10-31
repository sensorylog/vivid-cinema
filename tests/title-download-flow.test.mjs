import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("title download action no longer searches public archives or offers archive links", async () => {
  const script = await readFile(new URL("../scripts/title.js", import.meta.url), "utf8");
  assert.match(script, /id="title-download"/);
  assert.match(script, /Downloads unavailable/);
  assert.match(script, /authorized direct-download source/);
  assert.doesNotMatch(script, /Internet Archive|archive\.org|Wikimedia|wikimedia\.org|VIVID_DOWNLOADS|public archives|openly licensed downloadable copy/i);
});
