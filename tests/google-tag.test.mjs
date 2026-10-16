import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shared app shell loads the sitewide GA4 Google tag", async () => {
  const shell = await readFile(path.join(root, "scripts", "app-shell.js"), "utf8");
  const tag = await readFile(path.join(root, "scripts", "google-tag.js"), "utf8");
  assert.match(shell, /import ["']\.\/google-tag\.js["']/);
  assert.match(tag, /G-TKXLVSEFL4/);
  assert.match(tag, /googletagmanager\.com\/gtag\/js/);
  assert.match(tag, /__vividGtagLoaded/);
  assert.match(tag, /gtag\(["']config["'],\s*GOOGLE_ANALYTICS_ID\)/);
});

test("every root HTML page loads Google tag directly or through app shell exactly once", async () => {
  const files = (await readdir(root)).filter(file => file.toLowerCase().endsWith(".html"));
  assert.ok(files.length > 0, "HTML pages should be present");
  const problems = [];
  for (const file of files) {
    // This utility page is intentionally isolated from the sitewide app shell/analytics.
    if (file === "auth-diagnostics.html") continue;
    const html = await readFile(path.join(root, file), "utf8");
    const direct = /scripts\/google-tag\.js/i.test(html);
    const viaShell = /scripts\/app-shell\.js(?:\?[^"']*)?/i.test(html);
    const legacyInline = /googletagmanager\.com\/gtag\/js/i.test(html);
    if (direct === viaShell) problems.push(file + ": expected exactly one of direct Google tag or shared app shell");
    if (legacyInline) problems.push(file + ": inline/duplicate Google tag loader found");
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});
