import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Adcash ads are disabled from the shared app shell and service worker", async () => {
  const loader = await readFile(path.join(root, "scripts", "app-shell.js"), "utf8");
  const serviceWorker = await readFile(path.join(root, "service-worker.js"), "utf8");
  const headers = await readFile(path.join(root, "_headers"), "utf8");
  const firebase = await readFile(path.join(root, "firebase.json"), "utf8");
  const landing = await readFile(path.join(root, "index.html"), "utf8");

  assert.doesNotMatch(loader, /import ["']\.\/adcash\.js["']/);
  assert.doesNotMatch(landing, /adcash|acscdn|runAutoTag/i);
  assert.doesNotMatch(serviceWorker, /scripts\/adcash\.js/);
  assert.match(serviceWorker, /vivid-cinema-shell-v250/);
  assert.doesNotMatch(headers, /acscdn\.com/i);
  assert.doesNotMatch(firebase, /acscdn\.com/i);
});
