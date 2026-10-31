import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("movie and TV title pages expose an automatic download source chooser", async () => {
  const script = await readFile(new URL("../scripts/title.js", import.meta.url), "utf8");
  assert.match(script, /id="title-download"/);
  assert.match(script, /VIVID_DOWNLOADS/);
  assert.match(script, /vivid:pending-download/);
  assert.match(script, /No openly licensed downloadable copy was found/);
  assert.match(script, /public-domain and Creative Commons/);
  assert.doesNotMatch(script, /FlixQuest|flixquest|API URL/);
});
