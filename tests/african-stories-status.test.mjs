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
  assert.match(page, /african-development-notice/);
  assert.match(page, /African films, documentaries, filmmakers, cultural history and audiovisual archives/);
  assert.match(page, /rights-cleared viewing pathways/);
  assert.match(styles, /\.african-development-notice/);
});

test("African Stories remains a destination but is not presented as a launched streaming catalogue", async () => {
  const page = await readFile(path.join(root, "african-stories.html"), "utf8");
  const discovery = await readFile(path.join(root, "scripts", "african-stories", "discovery.js"), "utf8");
  assert.match(page, /id="african-discovery-status"/);
  assert.match(page, /Preparing the African Stories atlas/);
  assert.match(page, /In Development/);
});
