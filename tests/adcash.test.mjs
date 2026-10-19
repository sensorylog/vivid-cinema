import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Adcash Autotag is configured once and skips the watch/player page", async () => {
  const loader = await readFile(path.join(root, "scripts", "adcash.js"), "utf8");
  const shell = await readFile(path.join(root, "scripts", "app-shell.js"), "utf8");
  const watch = await readFile(path.join(root, "watch.html"), "utf8");

  assert.match(loader, /qj1fxyobo/);
  assert.match(loader, /acscdn\.com\/script\/aclib\.js/);
  assert.match(loader, /runAutoTag\(\{ zoneId: ADCASH_ZONE_ID \}\)/);
  assert.match(loader, /__vividAdcashAutotagStarted/);
  assert.match(loader, /data-vivid-page.*watch|watch\.html/);
  assert.match(shell, /import ["']\.\/adcash\.js["']/);
  assert.doesNotMatch(watch, /scripts\/adcash\.js/);
});

test("every non-watch root HTML page uses the shared shell or standalone Adcash loader", async () => {
  const files = (await readdir(root)).filter(file => file.toLowerCase().endsWith(".html"));
  const missing = [];
  for (const file of files) {
    const html = await readFile(path.join(root, file), "utf8");
    if (file === "watch.html") {
      if (/scripts\/adcash\.js/i.test(html)) missing.push(file + ": watch page must not load Adcash directly");
      continue;
    }
    const viaShell = /scripts\/app-shell\.js(?:\?[^"']*)?/i.test(html);
    const direct = /scripts\/adcash\.js/i.test(html);
    if (!viaShell && !direct) missing.push(file + ": missing Adcash integration path");
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});

test("Adcash host is allowed without widening unrelated CSP directives and the shell cache is bumped", async () => {
  const config = await readFile(path.join(root, "firebase.json"), "utf8");
  const serviceWorker = await readFile(path.join(root, "service-worker.js"), "utf8");
  assert.match(config, /script-src 'self' https:\/\/acscdn\.com/);
  assert.match(serviceWorker, /const CACHE_NAME = "vivid-cinema-shell-v231"/);
});
