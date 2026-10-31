import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("title download action is connected to the Electron download bridge", async () => {
  const script = await readFile(new URL("../scripts/title.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const engine = await readFile(new URL("../desktop/download-engine.cjs", import.meta.url), "utf8");
  assert.match(script, /id="title-download"/);
  assert.match(script, /engine\.search\(media\.title\)/);
  assert.match(script, /engine\.start\(/);
  assert.match(preload, /exposeInMainWorld\("vividDownloads"/);
  assert.match(main, /configureDownloadEngine\(\)/);
  assert.match(engine, /TorrentSearchApi\.enablePublicProviders/);
  assert.match(engine, /new WebTorrent/);
  assert.doesNotMatch(script, /Downloads unavailable/);
  assert.doesNotMatch(script, /Internet Archive|archive\.org|Wikimedia|wikimedia\.org/i);
});
