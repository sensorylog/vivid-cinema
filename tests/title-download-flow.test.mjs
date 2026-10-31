import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("movie and TV title pages expose a download quality chooser beside watch actions", async () => {
  const script = await readFile(new URL("../scripts/title.js", import.meta.url), "utf8");
  assert.match(script, /id="title-download"/);
  assert.match(script, /function openTitleDownload\(\)/);
  assert.match(script, /isTv \? 'an episode'/);
  assert.match(script, /download-season/);
  assert.match(script, /download-episode/);
  assert.match(script, /VIVID_DOWNLOADS/);
  assert.match(script, /vivid:pending-download/);
  assert.match(script, /No authorized downloadable files are available/);
});
