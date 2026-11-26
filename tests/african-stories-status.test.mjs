import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("African Stories is visibly marked as in development in navigation and destination", async () => {
  const shell = await readFile(path.join(root, "scripts", "app-shell.js"), "utf8");
  const page = await readFile(path.join(root, "african-stories.html"), "utf8");
  const styles = await readFile(path.join(root, "styles", "african-stories.css"), "utf8");
  assert.match(shell, /vivid-african-stories-link/);
  assert.match(shell, /vivid-nav-development">In Development/);
  assert.match(page, /african-development-gate/);
  assert.match(page, /In Development/);
  assert.match(page, /full destination isn't open yet/);
  assert.match(styles, /\.african-development-gate/);
});

test("African Stories public landing, player and submission routes are gated, not merely badged", async () => {
  for (const file of ["african-stories.html", "african-stories-watch.html", "african-stories-submit.html"]) {
    const page = await readFile(path.join(root, file), "utf8");
    assert.match(page, /african-development-gate/);
    assert.match(page, /In Development/);
    assert.doesNotMatch(page, /scripts\/african-stories\/(?:discovery|player|acquisition)\.js/);
    assert.doesNotMatch(page, /african-discovery-query|african-player-frame|african-submission-form/);
  }
});

test("service worker no longer precaches gated African Stories feature runtimes", async () => {
  const worker = await readFile(path.join(root, "service-worker.js"), "utf8");
  assert.match(worker, /const CACHE_NAME = "vivid-cinema-shell-v\d+"/);
  assert.doesNotMatch(worker, /\.\/scripts\/african-stories\/(?:discovery|player|acquisition)\.js/);
  assert.doesNotMatch(worker, /\.\/african-stories-watch\.html|\.\/african-stories-submit\.html/);
});
