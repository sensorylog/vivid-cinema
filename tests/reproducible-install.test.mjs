import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const workflowPaths = [
  "../.github/workflows/ci.yml",
  "../.github/workflows/windows-desktop.yml",
  "../.github/workflows/android-debug-apk.yml",
  "../.github/workflows/android-release.yml"
];
const workflows = await Promise.all(workflowPaths.map(path => readFile(new URL(path, import.meta.url), "utf8")));

test("npm lockfile is v3 and matches root package metadata", () => {
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies);
});

test("Windows, Android, and CI workflows use npm ci rather than floating npm install", () => {
  for (const workflow of workflows) {
    assert.match(workflow, /npm ci --no-audit --no-fund/);
    assert.doesNotMatch(workflow, /npm install --no-audit --no-fund/);
  }
});
