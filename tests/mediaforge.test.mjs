import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const page = await readFile(new URL("mediaforge.html", root), "utf8");
const launcher = await readFile(new URL("scripts/mediaforge.js", root), "utf8");
const home = await readFile(new URL("home.html", root), "utf8");

test("MediaForge has a separate entry point linked from Vivid home", () => {
  assert.match(page, /id="mf-form"/);
  assert.match(home, /href="mediaforge\.html"/);
  assert.match(page, /watch\.html|VidAPI|existing player/i);
});

test("launcher defaults to the local MediaForge instance and opens it separately", () => {
  assert.match(page, /value="http:\/\/localhost:8080"/);
  assert.match(launcher, /window\.open\(target, "_blank"\)/);
  assert.match(launcher, /opened\.opener = null/);
});

test("launcher rejects insecure remote URLs and never asks for an API key", () => {
  assert.match(launcher, /url\.protocol !== "https:"/);
  assert.match(launcher, /isLocal && url\.protocol === "http:"/);
  assert.doesNotMatch(page, /type="password"|X-Api-Key/i);
  assert.doesNotMatch(launcher, /X-Api-Key|api[_ -]?key/i);
});

test("launcher stores only the instance base URL locally", () => {
  assert.match(launcher, /vivid:mediaforge:instance-url:v1/);
  assert.match(launcher, /localStorage\.setItem\(STORAGE_KEY, target\)/);
});
